// ============================================================
//  COMMAND  —  karaoke  v2.0
//  /karaoke <song name or artist - title>
//
//  Flow:
//   1. Fetch ytdl media info (query + "karaoke") → get the real title
//   2. Clean that title, use it to search lyrics across 3 sources:
//        lrclib.net  →  lyrics.ovh  →  lrclib fallback (original query)
//   3. Send lyrics first, then download + upload the MP3
//
//  All lyrics sources are open-source / no API key required.
// ============================================================

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

const CACHE_DIR = path.join(__dirname, 'cache');
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

// API endpoints
const YTDL_API       = 'https://yt-dlp-stream.onrender.com/api/v2/q?=';
const LRCLIB_SEARCH  = 'https://lrclib.net/api/search?q=';
const LYRICS_OVH_SUG = 'https://api.lyrics.ovh/suggest/';
const LYRICS_OVH_GET = 'https://api.lyrics.ovh/v1/';

const TG_MAX_BYTES = 50 * 1024 * 1024;
const TG_MAX_TEXT  = 4000; // safe cap (real Telegram limit is 4096)

// ── Generic helpers ───────────────────────────────────────────────────────────

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function formatBytes(b) {
  if (b < 1024)       return `${b} B`;
  if (b < 1048576)    return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1048576).toFixed(2)} MB`;
}

function formatEta(s) {
  if (s < 60)  return `${Math.round(s)}s`;
  return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
}

function formatSpeed(bps) {
  if (bps < 1048576) return `${(bps / 1024).toFixed(1)} KB/s`;
  return `${(bps / 1048576).toFixed(2)} MB/s`;
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

function shortTitle(title, max = 42) {
  return title.length > max ? title.slice(0, max) + '…' : title;
}

/** Retry a fetch on 5xx / network errors (up to `retries` attempts). */
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

// ── Title cleaner ─────────────────────────────────────────────────────────────

/**
 * Strip YouTube-video noise from a title so lyrics APIs get a clean query.
 * e.g. "Queen - Bohemian Rhapsody (Karaoke Version) [HD]"
 *       → "Bohemian Rhapsody"  (with artist "Queen")
 * Returns { cleanTitle, artist } — artist may be null.
 */
function parseYtdlTitle(rawTitle) {
  let title  = rawTitle;
  let artist = null;

  // Strip common suffix noise (case-insensitive)
  const NOISE = [
    /\bkaraoke\s*(version|ver\.?|mix)?\b/gi,
    /\bno\s*vocals?\b/gi,
    /\binstrumental\b/gi,
    /\bofficial\s*(audio|video|lyric\s*video|music\s*video)?\b/gi,
    /\b(lyrics?\s*video|lyric\s*video|with\s*lyrics?)\b/gi,
    /\b(hd|hq|4k|1080p|720p)\b/gi,
    /\bfull\s*(song|version|audio)\b/gi,
    /\[\s*[^\]]*\]/g,   // anything inside [brackets]
    /\(\s*\)/g,         // empty parens
  ];
  for (const re of NOISE) title = title.replace(re, '');
  title = title.replace(/[|‒–—•·]+/g, '-').replace(/\s{2,}/g, ' ').trim();

  // Extract "Artist - Title" or "Artist — Title"
  const dashMatch = title.match(/^(.+?)\s*[-–—]\s*(.+)$/);
  if (dashMatch) {
    artist = dashMatch[1].trim();
    title  = dashMatch[2].trim();
  }

  // Final cleanup: remove trailing punctuation / noise parens
  title = title.replace(/\([^)]*\)\s*$/, '').replace(/\s{2,}/g, ' ').trim();

  return { cleanTitle: title || rawTitle, artist };
}

// ── Lyrics sources ────────────────────────────────────────────────────────────

/**
 * Source 1 — lrclib.net (open source, no API key)
 * Searches by arbitrary query string.
 */
async function fromLrclib(query) {
  const url = `${LRCLIB_SEARCH}${encodeURIComponent(query)}`;
  const res = await fetchWithRetry(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`lrclib HTTP ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data) || data.length === 0) return null;

  const withLyrics = data.filter((r) => r.plainLyrics && r.plainLyrics.trim().length > 20);
  if (withLyrics.length === 0) return null;

  const best = withLyrics[0];
  return {
    source:     'lrclib.net',
    trackName:  best.trackName  || query,
    artistName: best.artistName || '',
    lyrics:     best.plainLyrics.trim(),
  };
}

/**
 * Source 2 — lyrics.ovh (free, no API key)
 * Step 1: suggest endpoint → get artist + title
 * Step 2: fetch lyrics with artist + title
 */
async function fromLyricsOvh(query) {
  // Step 1: suggest
  const sugRes = await fetchWithRetry(
    `${LYRICS_OVH_SUG}${encodeURIComponent(query)}`,
    { signal: AbortSignal.timeout(10_000) }
  );
  if (!sugRes.ok) throw new Error(`lyrics.ovh suggest HTTP ${sugRes.status}`);
  const sugData = await sugRes.json();

  const items = sugData.data;
  if (!Array.isArray(items) || items.length === 0) return null;

  const pick    = items[0];
  const artist  = pick.artist?.name || '';
  const title   = pick.title || query;

  // Step 2: fetch
  const getRes = await fetchWithRetry(
    `${LYRICS_OVH_GET}${encodeURIComponent(artist)}/${encodeURIComponent(title)}`,
    { signal: AbortSignal.timeout(10_000) }
  );
  if (!getRes.ok) throw new Error(`lyrics.ovh fetch HTTP ${getRes.status}`);
  const getData = await getRes.json();

  if (!getData.lyrics || getData.lyrics.trim().length < 20) return null;

  return {
    source:     'lyrics.ovh',
    trackName:  title,
    artistName: artist,
    lyrics:     getData.lyrics.trim(),
  };
}

/**
 * Try all lyrics sources in order; return first success or null.
 * sources: array of async () => result | null
 */
async function fetchLyricsWithFallback(sources) {
  for (const sourceFn of sources) {
    try {
      const result = await sourceFn();
      if (result) return result;
    } catch (err) {
      console.warn(`[karaoke] Lyrics source failed: ${err.message}`);
    }
  }
  return null;
}

// ── ytdl media fetcher ────────────────────────────────────────────────────────

/**
 * Fetch the karaoke track from YouTube via yt-dlp-stream API.
 * Appends "karaoke" to force karaoke/instrumental results.
 */
async function fetchKaraokeMedia(query) {
  const karaokeQuery = `${query} karaoke`;
  const url = `${YTDL_API}${encodeURIComponent(karaokeQuery)}`;
  const res = await fetchWithRetry(url, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`ytdl API HTTP ${res.status} — the backend may be waking up, try again.`);
  const data = await res.json();
  if (!data.title || !data.media?.mp3) throw new Error('No MP3 found for that query.');
  return data;  // { title, duration, thumbnail, media: { mp3, mp4? } }
}

// ── MP3 downloader with progress ──────────────────────────────────────────────

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

  const ct  = res.headers.get('content-type') || '';
  const len = parseInt(res.headers.get('content-length') || '0', 10);

  if (ct.includes('text/html') || ct.includes('application/json'))
    throw new Error('Server returned a webpage instead of audio. The link may have expired.');
  if (len > 0 && len > TG_MAX_BYTES)
    throw new Error(`File too large (${formatBytes(len)}) — Telegram limit is 50 MB.`);
  if (!res.body) throw new Error('No response body from download URL.');

  const reader   = res.body.getReader();
  const chunks   = [];
  let received   = 0;
  let lastNotify = Date.now();

  while (true) {
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
      await onProgress(received, len).catch(() => {});
    }
  }

  const buffer = Buffer.concat(chunks);
  if (buffer.length < 512) throw new Error(`Downloaded file suspiciously small (${buffer.length} B).`);

  fs.writeFileSync(destPath, buffer);
  return buffer.length;
}

// ── Lyrics sender (auto-splits at 4000 chars) ─────────────────────────────────

async function sendLyrics(ctx, result) {
  const { source, trackName, artistName, lyrics } = result;
  const header =
    `🎤 <b>${escapeHtml(trackName)}</b>${artistName ? `\n👤 <i>${escapeHtml(artistName)}</i>` : ''}\n` +
    `📚 <i>Source: ${escapeHtml(source)}</i>\n${'─'.repeat(28)}\n\n`;

  const full = header + escapeHtml(lyrics);

  if (full.length <= TG_MAX_TEXT) {
    await ctx.replyWithHTML(full);
    return;
  }

  // Split on blank lines (stanzas), flush when chunk nears limit
  const stanzas = lyrics.split(/\n{2,}/);
  let chunk = header;

  for (const stanza of stanzas) {
    const piece = escapeHtml(stanza) + '\n\n';
    if (chunk.length + piece.length > TG_MAX_TEXT) {
      await ctx.replyWithHTML(chunk.trimEnd());
      chunk = '';
    }
    chunk += piece;
  }

  if (chunk.trim().length > 0) await ctx.replyWithHTML(chunk.trimEnd());
}

// ── Command export ────────────────────────────────────────────────────────────

module.exports = {
  name:        'karaoke',
  version:     '2.0.0',
  description: 'Lyrics + karaoke MP3 for any song. Open-source lyrics, no API keys.',
  usage:       '/karaoke <song name>  |  /karaoke <artist - title>',
  category:    'Media',
  permission:  1,
  cooldown:    30,
  aliases:     ['kar', 'kara'],

  async execute(ctx) {
    const { args, raw: msg } = ctx;

    // ── Usage hint ──────────────────────────────────────────────────────────
    if (!args || args.length === 0) {
      return ctx.replyWithHTML(
        '🎤 <b>Karaoke</b>\n\n' +
        'Sends lyrics first, then a karaoke MP3.\n\n' +
        '<b>Usage:</b>\n' +
        '  <code>/karaoke &lt;song name&gt;</code>\n' +
        '  <code>/karaoke &lt;artist - title&gt;</code>\n\n' +
        '<b>Examples:</b>\n' +
        '  <code>/karaoke Bohemian Rhapsody</code>\n' +
        '  <code>/karaoke Queen - Bohemian Rhapsody</code>\n' +
        '  <code>/karaoke shape of you ed sheeran</code>\n\n' +
        '📚 <b>Lyrics sources</b> (open-source, no API key):\n' +
        '  • lrclib.net\n' +
        '  • lyrics.ovh\n' +
        '🎵 Audio: YouTube karaoke search via yt-dlp'
      );
    }

    const userQuery = args.join(' ').trim();

    // ── Status message ──────────────────────────────────────────────────────
    const status = await ctx.replyWithHTML(
      `🎤 <b>Karaoke:</b> <i>${escapeHtml(userQuery)}</i>\n\n🔍 Looking up karaoke track on YouTube…`
    );

    // ── Step 1: fetch media info to get the real ytdl title ─────────────────
    let mediaData;
    try {
      await ctx.editText(
        status.message_id,
        `🎤 <b>Karaoke:</b> <i>${escapeHtml(userQuery)}</i>\n\n` +
        `🔍 <b>Step 1/3</b> — Fetching karaoke track info…`,
        { parse_mode: 'HTML' }
      ).catch(() => {});

      mediaData = await fetchKaraokeMedia(userQuery);
    } catch (err) {
      await ctx.editText(
        status.message_id,
        `❌ <b>No karaoke track found</b>\n${escapeHtml(err.message)}\n\n` +
        `<i>Try adding the artist name, e.g. <code>/karaoke Queen Bohemian Rhapsody</code></i>`,
        { parse_mode: 'HTML' }
      ).catch(() => {});
      return;
    }

    const ytTitle = mediaData.title;  // real YouTube video title

    // ── Step 2: use ytdl title to search lyrics across multiple sources ──────
    const { cleanTitle, artist } = parseYtdlTitle(ytTitle);

    // Build query strings for lyrics APIs
    const titleQuery    = artist ? `${artist} ${cleanTitle}` : cleanTitle;
    const fallbackQuery = userQuery;

    await ctx.editText(
      status.message_id,
      `🎤 <b>Karaoke:</b> <i>${escapeHtml(userQuery)}</i>\n\n` +
      `✅ Found: <b>${escapeHtml(shortTitle(ytTitle))}</b>\n` +
      `📜 <b>Step 2/3</b> — Searching lyrics for: <i>${escapeHtml(cleanTitle)}</i>…`,
      { parse_mode: 'HTML' }
    ).catch(() => {});

    const lyricsResult = await fetchLyricsWithFallback([
      () => fromLrclib(titleQuery),           // 1st: lrclib with cleaned ytdl title
      () => fromLyricsOvh(titleQuery),        // 2nd: lyrics.ovh with cleaned ytdl title
      () => fromLrclib(fallbackQuery),        // 3rd: lrclib with original user query
      () => fromLyricsOvh(fallbackQuery),     // 4th: lyrics.ovh with original user query
      () => fromLrclib(cleanTitle),           // 5th: lrclib with just the clean title alone
    ]);

    // ── Step 3a: send lyrics ─────────────────────────────────────────────────
    if (lyricsResult) {
      await ctx.editText(
        status.message_id,
        `🎤 <b>Karaoke:</b> <i>${escapeHtml(userQuery)}</i>\n\n` +
        `✅ Found: <b>${escapeHtml(shortTitle(ytTitle))}</b>\n` +
        `📜 <b>Step 2/3</b> — Sending lyrics…`,
        { parse_mode: 'HTML' }
      ).catch(() => {});

      await sendLyrics(ctx, lyricsResult);
    } else {
      await ctx.replyWithHTML(
        `⚠️ <b>Lyrics not found</b> for <i>${escapeHtml(cleanTitle)}</i>\n` +
        `<i>Checked: lrclib.net, lyrics.ovh (4 attempts)</i>\n\n` +
        `Sending karaoke audio anyway…`
      );
    }

    // ── Step 3b: download & upload the karaoke MP3 ──────────────────────────
    const mp3Url      = mediaData.media.mp3;
    const titleShort_ = shortTitle(ytTitle);
    const requestId   = crypto.randomBytes(6).toString('hex');
    const tmpPath     = path.join(CACHE_DIR, `kar_${requestId}.mp3`);
    const renamedPath = path.join(CACHE_DIR, `${safeFilename(ytTitle)}.mp3`);

    try {
      const dlStart = Date.now();
      let lastEditMs = 0;

      await ctx.editText(
        status.message_id,
        `⬇️ <b>Step 3/3</b> — Downloading karaoke MP3…\n\n🎤 <b>${escapeHtml(titleShort_)}</b>`,
        { parse_mode: 'HTML' }
      ).catch(() => {});

      await downloadMp3(mp3Url, tmpPath, async (received, total) => {
        const elapsed = Math.max(0.1, (Date.now() - dlStart) / 1000);
        const speed   = received / elapsed;
        const pct     = total > 0 ? Math.min(100, Math.round((received / total) * 100)) : null;
        const eta     = (total > received && speed > 0) ? (total - received) / speed : null;

        const text =
          `⬇️ <b>Step 3/3</b> — Downloading karaoke MP3…\n\n` +
          `🎤 <b>${escapeHtml(titleShort_)}</b>\n\n` +
          `<code>${progressBar(pct)}</code>${pct !== null ? ` ${pct}%` : ''}\n` +
          `${total > 0 ? `${formatBytes(received)} / ${formatBytes(total)}` : `${formatBytes(received)} received`}` +
          `  •  ${speed > 100 ? formatSpeed(speed) : '…'}` +
          `${eta !== null ? `  ⏱ ~${formatEta(eta)}` : ''}`;

        const now = Date.now();
        if (now - lastEditMs > 1500) {
          lastEditMs = now;
          await ctx.editText(status.message_id, text, { parse_mode: 'HTML' }).catch(() => {});
        }
      });

      const finalSize = formatBytes(fs.statSync(tmpPath).size);
      const dlSecs    = ((Date.now() - dlStart) / 1000).toFixed(1);

      await ctx.editText(
        status.message_id,
        `📤 Uploading to Telegram…\n\n🎤 <b>${escapeHtml(titleShort_)}</b>\n📦 ${finalSize}  •  ⬇️ ${dlSecs}s`,
        { parse_mode: 'HTML' }
      ).catch(() => {});

      fs.renameSync(tmpPath, renamedPath);

      await Promise.race([
        ctx.sendMediaFile(renamedPath, 'audio', {
          caption:     `🎤 <b>${escapeHtml(ytTitle)}</b>\n🎵 Karaoke MP3  •  📦 ${finalSize}\n🤖 MJL Bot`,
          parse_mode:  'HTML',
          title:       ytTitle,
          performer:   artist || undefined,
        }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Upload timed out after 5 minutes')), 300_000)
        ),
      ]);

      await ctx.editText(
        status.message_id,
        `✅ <b>Done!</b>  🎤 ${escapeHtml(titleShort_)}\n📦 ${finalSize}  •  ⏱ ${dlSecs}s`,
        { parse_mode: 'HTML' }
      ).catch(() => {});

    } catch (err) {
      console.error('[karaoke] Audio error:', err.message);
      await ctx.editText(
        status.message_id,
        `❌ <b>Audio download failed</b>\n${escapeHtml(err.message)}\n\n` +
        `<i>${lyricsResult ? 'Lyrics were sent above.' : ''} Try again or rephrase the song name.</i>`,
        { parse_mode: 'HTML' }
      ).catch(() => {});
    } finally {
      for (const p of [tmpPath, renamedPath]) {
        try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch {}
      }
    }
  },
};
