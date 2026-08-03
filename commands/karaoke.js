// ============================================================
//  COMMAND  —  karaoke  v1.0
//  /karaoke <song name or artist - title>
//
//  1. Searches lrclib.net for lyrics (open-source, no API key)
//  2. Fetches the karaoke/instrumental MP3 via yt-dlp-stream API
//  3. Sends lyrics first, then uploads the audio
// ============================================================

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

const CACHE_DIR    = path.join(__dirname, 'cache');
const LYRICS_API   = 'https://lrclib.net/api/search?q=';
const YTDL_API     = 'https://yt-dlp-stream.onrender.com/api/v2/q?=';
const TG_MAX_BYTES = 50 * 1024 * 1024;
const TG_MAX_TEXT  = 4000; // safe Telegram text limit (real cap 4096)

if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

// ── Helpers ───────────────────────────────────────────────────────────────────

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function formatBytes(bytes) {
  if (bytes < 1024)       return `${bytes} B`;
  if (bytes < 1048576)    return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(2)} MB`;
}

function formatEta(seconds) {
  if (seconds < 60)  return `${Math.round(seconds)}s`;
  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}

function formatSpeed(bytesPerSec) {
  if (bytesPerSec < 1048576) return `${(bytesPerSec / 1024).toFixed(1)} KB/s`;
  return `${(bytesPerSec / 1048576).toFixed(2)} MB/s`;
}

function progressBar(pct, len = 14) {
  if (pct === null) {
    const pos = Math.floor((Date.now() / 150) % len);
    return '▱'.repeat(pos) + '▰' + '▱'.repeat(len - pos - 1);
  }
  const filled = Math.max(0, Math.min(len, Math.round((pct / 100) * len)));
  return '▰'.repeat(filled) + '▱'.repeat(len - filled);
}

function safeFilename(title) {
  return title.replace(/[/\\?%*:|"<>\r\n]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
}

function shortTitle(title, max = 40) {
  return title.length > max ? title.slice(0, max) + '…' : title;
}

/** Retry a fetch on 5xx / network errors. */
async function fetchWithRetry(url, opts = {}, retries = 2) {
  let lastErr;
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, opts);
      if (!res.ok && res.status >= 500 && i < retries - 1) {
        lastErr = new Error(`HTTP ${res.status}`);
        await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
        continue;
      }
      return res;
    } catch (err) {
      lastErr = err;
      if (i < retries - 1) await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
    }
  }
  throw lastErr;
}

// ── Lyrics fetcher (lrclib.net — open source, no API key) ─────────────────────

/**
 * Search lrclib.net for lyrics.
 * Returns { trackName, artistName, plainLyrics } or null.
 */
async function fetchLyrics(query) {
  const url = `${LYRICS_API}${encodeURIComponent(query)}`;
  const res = await fetchWithRetry(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`Lyrics API HTTP ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data) || data.length === 0) return null;

  // Prefer results that have plain lyrics
  const withLyrics = data.filter((r) => r.plainLyrics && r.plainLyrics.trim().length > 10);
  if (withLyrics.length === 0) return null;

  const best = withLyrics[0];
  return {
    trackName:  best.trackName  || 'Unknown Title',
    artistName: best.artistName || 'Unknown Artist',
    plainLyrics: best.plainLyrics.trim(),
  };
}

// ── ytdl media fetcher ────────────────────────────────────────────────────────

/**
 * Fetch media info from yt-dlp-stream API.
 * Appends "karaoke" to the query to target karaoke versions.
 */
async function fetchKaraokeMedia(query) {
  // Force karaoke search by appending the keyword
  const karaokeQuery = `${query} karaoke`;
  const url = `${YTDL_API}${encodeURIComponent(karaokeQuery)}`;
  const res = await fetchWithRetry(url, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`Media API HTTP ${res.status}. The backend may be waking up — try again.`);
  const data = await res.json();
  if (!data.title || !data.media?.mp3) {
    throw new Error('No MP3 found for that karaoke query.');
  }
  return data;
}

// ── MP3 downloader with progress ─────────────────────────────────────────────

async function downloadMp3(url, destPath, onProgress) {
  const res = await fetchWithRetry(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(300_000),
    headers: {
      'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      'Accept':          '*/*',
      'Accept-Encoding': 'gzip, deflate',
    },
  });

  if (!res.ok) throw new Error(`Download failed — HTTP ${res.status}`);

  const contentType   = res.headers.get('content-type') || '';
  const contentLength = parseInt(res.headers.get('content-length') || '0', 10);

  if (contentType.includes('text/html') || contentType.includes('application/json')) {
    throw new Error('Server returned a webpage instead of audio. The link may have expired.');
  }
  if (contentLength > 0 && contentLength > TG_MAX_BYTES) {
    throw new Error(`File too large (${formatBytes(contentLength)}) — exceeds Telegram's 50 MB limit.`);
  }
  if (!res.body) throw new Error('No response body from download URL.');

  const reader   = res.body.getReader();
  const chunks   = [];
  let received   = 0;
  let lastNotify = Date.now();

  while (true) {
    try {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;

      if (received > TG_MAX_BYTES) {
        reader.cancel();
        throw new Error(`File exceeded 50 MB at ${formatBytes(received)}. Aborted.`);
      }

      const now = Date.now();
      if (onProgress && now - lastNotify > 1200) {
        lastNotify = now;
        await onProgress(received, contentLength).catch(() => {});
      }
    } catch (err) {
      reader.cancel();
      throw err;
    }
  }

  const buffer = Buffer.concat(chunks);
  if (buffer.length < 512) throw new Error(`Downloaded file suspiciously small (${buffer.length} B).`);

  fs.writeFileSync(destPath, buffer);
  return buffer.length;
}

// ── Lyrics chunk sender ───────────────────────────────────────────────────────

/**
 * Send lyrics as one or more messages, splitting at blank lines if too long.
 */
async function sendLyrics(ctx, trackName, artistName, lyrics) {
  const header = `🎤 <b>${escapeHtml(trackName)}</b>\n👤 <i>${escapeHtml(artistName)}</i>\n${'─'.repeat(28)}\n\n`;

  const full = header + escapeHtml(lyrics);

  if (full.length <= TG_MAX_TEXT) {
    await ctx.replyWithHTML(full);
    return;
  }

  // Split into chunks on blank lines, keeping header on first chunk
  const stanzas = lyrics.split(/\n{2,}/);
  let current   = header;

  for (const stanza of stanzas) {
    const piece = escapeHtml(stanza) + '\n\n';
    if (current.length + piece.length > TG_MAX_TEXT) {
      await ctx.replyWithHTML(current.trimEnd());
      current = '';
    }
    current += piece;
  }

  if (current.trim().length > 0) {
    await ctx.replyWithHTML(current.trimEnd());
  }
}

// ── Module export ─────────────────────────────────────────────────────────────

module.exports = {
  name:        'karaoke',
  version:     '1.0.0',
  description: 'Get lyrics + karaoke MP3 for any song. No API key needed — fully open source.',
  usage:       '/karaoke <song title or artist - title>',
  category:    'Media',
  permission:  1,
  cooldown:    30,  // karaoke downloads are heavy — 30s cooldown
  aliases:     ['kar', 'kara'],

  async execute(ctx) {
    const { args, raw: msg } = ctx;

    if (!args || args.length === 0) {
      return ctx.replyWithHTML(
        '🎤 <b>Karaoke</b>\n\n' +
        'Sends lyrics + a karaoke MP3 for any song.\n\n' +
        '<b>Usage:</b>\n' +
        '  <code>/karaoke &lt;song name&gt;</code>\n' +
        '  <code>/karaoke &lt;artist - title&gt;</code>\n\n' +
        '<b>Examples:</b>\n' +
        '  <code>/karaoke Bohemian Rhapsody</code>\n' +
        '  <code>/karaoke Queen - Bohemian Rhapsody</code>\n' +
        '  <code>/karaoke shape of you ed sheeran</code>\n\n' +
        '🎵 Lyrics from <b>lrclib.net</b> (open source)\n' +
        '🎬 Audio via <b>YouTube</b> karaoke search'
      );
    }

    const query = args.join(' ').trim();

    // ── Status message ──────────────────────────────────────────────────────
    const status = await ctx.replyWithHTML(
      `🎤 <b>Karaoke:</b> <i>${escapeHtml(query)}</i>\n\n⏳ Searching for lyrics and karaoke audio…`
    );

    // ── Phase 1: fetch lyrics + media info in parallel ──────────────────────
    let lyricsResult = null;
    let mediaData    = null;
    let lyricsError  = null;
    let mediaError   = null;

    await ctx.editText(
      status.message_id,
      `🎤 <b>Karaoke:</b> <i>${escapeHtml(query)}</i>\n\n🔍 Fetching lyrics &amp; karaoke audio…`,
      { parse_mode: 'HTML' }
    ).catch(() => {});

    [lyricsResult, mediaData] = await Promise.allSettled([
      fetchLyrics(query),
      fetchKaraokeMedia(query),
    ]).then((results) => [
      results[0].status === 'fulfilled' ? results[0].value : (() => { lyricsError = results[0].reason; return null; })(),
      results[1].status === 'fulfilled' ? results[1].value : (() => { mediaError  = results[1].reason; return null; })(),
    ]);

    // If both failed, bail out
    if (!lyricsResult && !mediaData) {
      await ctx.editText(
        status.message_id,
        `❌ <b>Nothing found</b> for: <i>${escapeHtml(query)}</i>\n\n` +
        `Lyrics: ${escapeHtml(lyricsError?.message || 'not found')}\n` +
        `Audio: ${escapeHtml(mediaError?.message   || 'not found')}\n\n` +
        `<i>Try a different spelling or add the artist name.</i>`,
        { parse_mode: 'HTML' }
      ).catch(() => {});
      return;
    }

    // ── Phase 2: send lyrics ────────────────────────────────────────────────
    if (lyricsResult) {
      await ctx.editText(
        status.message_id,
        `🎤 <b>Karaoke:</b> <i>${escapeHtml(query)}</i>\n\n📜 Sending lyrics…`,
        { parse_mode: 'HTML' }
      ).catch(() => {});

      await sendLyrics(ctx, lyricsResult.trackName, lyricsResult.artistName, lyricsResult.plainLyrics);
    } else {
      // Lyrics failed but audio found — mention it
      await ctx.replyWithHTML(
        `⚠️ <b>Lyrics not found</b> for <i>${escapeHtml(query)}</i>\n` +
        `<i>${escapeHtml(lyricsError?.message || 'No lyrics available')}</i>\n\n` +
        `Sending karaoke audio anyway…`
      );
    }

    // ── Phase 3: download and send karaoke MP3 ──────────────────────────────
    if (!mediaData) {
      await ctx.editText(
        status.message_id,
        `⚠️ <b>Karaoke audio not found</b>\n${escapeHtml(mediaError?.message || 'No MP3 available')}\n\n<i>Lyrics were sent above.</i>`,
        { parse_mode: 'HTML' }
      ).catch(() => {});
      return;
    }

    const mp3Url      = mediaData.media.mp3;
    const titleShort  = shortTitle(mediaData.title);
    const requestId   = crypto.randomBytes(6).toString('hex');
    const tmpPath     = path.join(CACHE_DIR, `kar_${requestId}.mp3`);
    const renamedPath = path.join(CACHE_DIR, `${safeFilename(mediaData.title)}.mp3`);

    try {
      // ── Download stage ─────────────────────────────────────────────────────
      const dlStart = Date.now();
      let lastEditTime = 0;

      await downloadMp3(mp3Url, tmpPath, async (received, total) => {
        const elapsed    = Math.max(0.1, (Date.now() - dlStart) / 1000);
        const speed      = received / elapsed;
        const pct        = total > 0 ? Math.min(100, Math.round((received / total) * 100)) : null;
        const eta        = (total > received && speed > 0) ? (total - received) / speed : null;
        const bar        = progressBar(pct);
        const pctLabel   = pct !== null ? ` ${pct}%` : '';
        const sizeLabel  = total > 0
          ? `${formatBytes(received)} / ${formatBytes(total)}`
          : `${formatBytes(received)} received`;
        const speedLabel = speed > 100 ? formatSpeed(speed) : '…';
        const etaLabel   = eta !== null ? `  ⏱ ~${formatEta(eta)}` : '';

        const text =
          `⬇️ <b>Downloading karaoke…</b>\n\n` +
          `🎤 <b>${escapeHtml(titleShort)}</b>\n\n` +
          `<code>${bar}</code>${pctLabel}\n` +
          `${sizeLabel}  •  ${speedLabel}${etaLabel}`;

        const now = Date.now();
        if (now - lastEditTime > 1500) {
          lastEditTime = now;
          await ctx.editText(status.message_id, text, { parse_mode: 'HTML' }).catch(() => {});
        }
      });

      const finalSize = formatBytes(fs.statSync(tmpPath).size);
      const dlSecs    = ((Date.now() - dlStart) / 1000).toFixed(1);

      // ── Upload stage ───────────────────────────────────────────────────────
      await ctx.editText(
        status.message_id,
        `📤 <b>Uploading karaoke to Telegram…</b>\n\n` +
        `🎤 <b>${escapeHtml(titleShort)}</b>\n` +
        `📦 ${finalSize}  •  ⏱ Downloaded in ${dlSecs}s`,
        { parse_mode: 'HTML' }
      ).catch(() => {});

      fs.renameSync(tmpPath, renamedPath);

      const caption = `🎤 <b>${escapeHtml(mediaData.title)}</b>\n🎵 Karaoke MP3  •  📦 ${finalSize}\n🤖 MJL Bot`;

      await Promise.race([
        ctx.sendMediaFile(renamedPath, 'audio', { caption, parse_mode: 'HTML' }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Upload timed out after 5 minutes')), 300_000)
        ),
      ]);

      await ctx.editText(
        status.message_id,
        `✅ <b>Karaoke ready!</b>  🎤 ${escapeHtml(titleShort)}\n📦 ${finalSize}  •  ⏱ ${dlSecs}s`,
        { parse_mode: 'HTML' }
      ).catch(() => {});

    } catch (err) {
      console.error('[karaoke] Error:', err.message);
      await ctx.editText(
        status.message_id,
        `❌ <b>Audio download failed</b>\n${escapeHtml(err.message)}\n\n<i>Lyrics were sent above. Try again or use a different song name.</i>`,
        { parse_mode: 'HTML' }
      ).catch(() => {});
    } finally {
      for (const p of [tmpPath, renamedPath]) {
        try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch {}
      }
    }
  },
};
