// ============================================================
//  COMMAND  —  karaoke  v3.0
//  /karaoke <song name or artist - title>
//
//  Flow:
//   1. Fetch ytdl media info (query + "karaoke") → get the real title
//   2. In parallel: download MP3  +  search lyrics (3 sources)
//   3. When both are ready → send lyrics first, then send audio
//
//  Lyrics sources (open-source, no API key):
//    lrclib.net  →  lyrics.ovh  →  lrclib (original query)  →  lyrics.ovh (original)
// ============================================================

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

const CACHE_DIR = path.join(__dirname, 'cache');
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

const GeniusLyrics  = require('genius-lyrics');
const GeniusClient  = new GeniusLyrics.Client(); // scraping mode — no API key needed

const YTDL_API       = 'https://yt-dlp-stream.onrender.com/api/v2/q?=';
const LRCLIB_SEARCH  = 'https://lrclib.net/api/search?q=';
const LYRICS_OVH_SUG = 'https://api.lyrics.ovh/suggest/';
const LYRICS_OVH_GET = 'https://api.lyrics.ovh/v1/';

const TG_MAX_BYTES = 50 * 1024 * 1024;
const TG_MAX_TEXT  = 4000;

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

function progressBar(pct, len = 12) {
  if (pct === null) {
    const pos = Math.floor((Date.now() / 150) % len);
    return '▱'.repeat(pos) + '▰' + '▱'.repeat(len - pos - 1);
  }
  const f = Math.max(0, Math.min(len, Math.round((pct / 100) * len)));
  return '▰'.repeat(f) + '▱'.repeat(len - f);
}

function safeFilename(t) {
  return t.replace(/[/\\?%*:|"<>\r\n]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
}

function shortTitle(t, max = 42) {
  return t.length > max ? t.slice(0, max) + '…' : t;
}

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

function parseYtdlTitle(raw) {
  let title  = raw;
  let artist = null;

  const NOISE = [
    /\bkaraoke\s*(version|ver\.?|mix)?\b/gi,
    /\bno\s*vocals?\b/gi,
    /\binstrumental\b/gi,
    /\bofficial\s*(audio|video|lyric\s*video|music\s*video)?\b/gi,
    /\b(lyrics?\s*video|lyric\s*video|with\s*lyrics?)\b/gi,
    /\b(hd|hq|4k|1080p|720p)\b/gi,
    /\bfull\s*(song|version|audio)\b/gi,
    /\[\s*[^\]]*\]/g,
    /\(\s*\)/g,
  ];
  for (const re of NOISE) title = title.replace(re, '');
  title = title.replace(/[|‒–—•·]+/g, '-').replace(/\s{2,}/g, ' ').trim();

  const dash = title.match(/^(.+?)\s*[-–—]\s*(.+)$/);
  if (dash) {
    artist = dash[1].trim();
    title  = dash[2].trim();
  }

  title = title.replace(/\([^)]*\)\s*$/, '').replace(/\s{2,}/g, ' ').trim();
  return { cleanTitle: title || raw, artist };
}

// ── Lyrics sources ────────────────────────────────────────────────────────────

/**
 * Source 0 — Genius.com (via genius-lyrics npm, scraping mode — no API key)
 * Largest and most up-to-date lyrics database.
 */
async function fromGenius(query) {
  const searches = await GeniusClient.songs.search(query);
  if (!searches || searches.length === 0) return null;
  const song   = searches[0];
  const lyrics = await song.lyrics();
  if (!lyrics || lyrics.trim().length < 20) return null;
  return {
    source:     'Genius',
    trackName:  song.title  || query,
    artistName: song.artist?.name || '',
    lyrics:     lyrics.trim(),
  };
}

async function fromLrclib(query) {
  const res = await fetchWithRetry(
    `${LRCLIB_SEARCH}${encodeURIComponent(query)}`,
    { signal: AbortSignal.timeout(12_000) }
  );
  if (!res.ok) throw new Error(`lrclib HTTP ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data)) return null;
  const hit = data.find((r) => r.plainLyrics && r.plainLyrics.trim().length > 20);
  if (!hit) return null;
  return {
    source:     'lrclib.net',
    trackName:  hit.trackName  || query,
    artistName: hit.artistName || '',
    lyrics:     hit.plainLyrics.trim(),
  };
}

async function fromLyricsOvh(query) {
  const sugRes = await fetchWithRetry(
    `${LYRICS_OVH_SUG}${encodeURIComponent(query)}`,
    { signal: AbortSignal.timeout(10_000) }
  );
  if (!sugRes.ok) throw new Error(`lyrics.ovh suggest HTTP ${sugRes.status}`);
  const sugData = await sugRes.json();
  const items = sugData.data;
  if (!Array.isArray(items) || items.length === 0) return null;

  const pick   = items[0];
  const artist = pick.artist?.name || '';
  const title  = pick.title || query;

  const getRes = await fetchWithRetry(
    `${LYRICS_OVH_GET}${encodeURIComponent(artist)}/${encodeURIComponent(title)}`,
    { signal: AbortSignal.timeout(10_000) }
  );
  if (!getRes.ok) throw new Error(`lyrics.ovh get HTTP ${getRes.status}`);
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
 * Try every (source, query) combination in priority order and return the
 * first hit.  Sources are tried round-robin across queries so we get the
 * best source for the best query, not just the best source for the first
 * query.
 *
 * Priority: Genius (newest DB) → lrclib → lyrics.ovh
 * Queries:  [artistTitle, cleanTitle, originalUserQuery, ...]
 */
async function fetchLyrics(queries) {
  const sources = [
    { name: 'Genius',     fn: fromGenius    },
    { name: 'lrclib',     fn: fromLrclib    },
    { name: 'lyrics.ovh', fn: fromLyricsOvh },
  ];

  // Try each query with each source, outer=query inner=source
  // so the "best" query is tried on all sources before moving on.
  for (const q of queries) {
    for (const { name, fn } of sources) {
      try {
        const r = await fn(q);
        if (r) {
          console.log(`[karaoke] lyrics found via ${name} for query: "${q}"`);
          return r;
        }
      } catch (e) {
        console.warn(`[karaoke] ${name} failed (q="${q}"): ${e.message}`);
      }
    }
  }
  return null;
}

// ── ytdl media info ───────────────────────────────────────────────────────────

async function fetchKaraokeMedia(query) {
  const q   = `${query} karaoke`;
  const res = await fetchWithRetry(
    `${YTDL_API}${encodeURIComponent(q)}`,
    { signal: AbortSignal.timeout(60_000) }
  );
  if (!res.ok) throw new Error(`ytdl API HTTP ${res.status} — backend may be waking up, try again.`);
  const data = await res.json();
  if (!data.title || !data.media?.mp3) throw new Error('No MP3 found for that query.');
  return data;
}

// ── MP3 downloader with progress callback ─────────────────────────────────────

async function downloadMp3(url, destPath, onProgress) {
  const res = await fetchWithRetry(url, {
    redirect: 'follow',
    signal:   AbortSignal.timeout(300_000),
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
    throw new Error('Server returned a webpage instead of audio — the link may have expired.');
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
      throw new Error(`File exceeded 50 MB at ${formatBytes(received)} — aborted.`);
    }
    const now = Date.now();
    if (onProgress && now - lastNotify > 1200) {
      lastNotify = now;
      await onProgress(received, len).catch(() => {});
    }
  }

  const buf = Buffer.concat(chunks);
  if (buf.length < 512) throw new Error(`Downloaded file too small (${buf.length} B).`);
  fs.writeFileSync(destPath, buf);
  return buf.length;
}

// ── Lyrics sender (splits at stanza boundaries if > TG_MAX_TEXT) ─────────────

async function sendLyrics(ctx, result) {
  const { source, trackName, artistName, lyrics } = result;
  const header =
    `🎤 <b>${escapeHtml(trackName)}</b>` +
    (artistName ? `\n👤 <i>${escapeHtml(artistName)}</i>` : '') +
    `\n📚 <i>via ${escapeHtml(source)}</i>\n${'─'.repeat(28)}\n\n`;

  const full = header + escapeHtml(lyrics);
  if (full.length <= TG_MAX_TEXT) {
    await ctx.replyWithHTML(full);
    return;
  }

  const stanzas = lyrics.split(/\n{2,}/);
  let chunk = header;
  for (const s of stanzas) {
    const piece = escapeHtml(s) + '\n\n';
    if (chunk.length + piece.length > TG_MAX_TEXT) {
      await ctx.replyWithHTML(chunk.trimEnd());
      chunk = '';
    }
    chunk += piece;
  }
  if (chunk.trim()) await ctx.replyWithHTML(chunk.trimEnd());
}

// ── Command ───────────────────────────────────────────────────────────────────

module.exports = {
  name:        'karaoke',
  version:     '3.0.0',
  description: 'Lyrics + karaoke MP3 for any song. Open-source lyrics, no API keys.',
  usage:       '/karaoke <song name>  |  /karaoke <artist - title>',
  category:    'Media',
  permission:  1,
  cooldown:    30,
  aliases:     ['kar', 'kara'],

  async execute(ctx) {
    const { args } = ctx;

    if (!args || args.length === 0) {
      return ctx.replyWithHTML(
        '🎤 <b>Karaoke</b>\n\n' +
        'Fetches lyrics + a karaoke MP3. Lyrics arrive first, then the audio.\n\n' +
        '<b>Usage:</b>\n' +
        '  <code>/karaoke &lt;song name&gt;</code>\n' +
        '  <code>/karaoke &lt;artist - title&gt;</code>\n\n' +
        '<b>Examples:</b>\n' +
        '  <code>/karaoke Bohemian Rhapsody</code>\n' +
        '  <code>/karaoke Queen - Bohemian Rhapsody</code>\n' +
        '  <code>/karaoke shape of you ed sheeran</code>\n\n' +
        '📚 Lyrics: Genius → lrclib.net → lyrics.ovh (open source, no key)\n' +
        '🎵 Audio: YouTube karaoke search via yt-dlp'
      );
    }

    const userQuery = args.join(' ').trim();
    const requestId = crypto.randomBytes(6).toString('hex');
    const tmpPath   = path.join(CACHE_DIR, `kar_${requestId}.mp3`);

    // ── Status message ──────────────────────────────────────────────────────
    const status = await ctx.replyWithHTML(
      `🎤 <b>Karaoke:</b> <i>${escapeHtml(userQuery)}</i>\n\n` +
      `🔍 Looking up karaoke track…`
    );

    // ── Step 1: fetch media info (need the real ytdl title first) ───────────
    let mediaData;
    try {
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

    const ytTitle  = mediaData.title;
    const mp3Url   = mediaData.media.mp3;
    const { cleanTitle, artist } = parseYtdlTitle(ytTitle);
    const titleShort_ = shortTitle(ytTitle);

    // Build lyrics query list — most-specific to least-specific.
    // Genius/lrclib are tried on each before moving to the next query.
    const lyricsQueries = [...new Set([
      // 1. Artist + clean title (best signal)
      ...(artist ? [`${artist} ${cleanTitle}`] : []),
      // 2. Clean title alone
      cleanTitle,
      // 3. Raw ytdl title (still has context clues even with noise)
      ytTitle,
      // 4. Original user query (what they actually typed)
      userQuery,
      // 5. Artist alone + clean title with different separators, if artist found
      ...(artist ? [`${artist} - ${cleanTitle}`] : []),
    ].filter(Boolean))];

    // ── Step 2: download MP3 and search lyrics IN PARALLEL ──────────────────
    await ctx.editText(
      status.message_id,
      `🎤 <b>Karaoke:</b> <i>${escapeHtml(userQuery)}</i>\n\n` +
      `✅ Found: <b>${escapeHtml(titleShort_)}</b>\n\n` +
      `🎵 Downloading audio…\n` +
      `📜 Searching lyrics for: <i>${escapeHtml(cleanTitle)}</i>…`,
      { parse_mode: 'HTML' }
    ).catch(() => {});

    // Track download progress separately so we can update the status message
    let dlReceived = 0;
    let dlTotal    = 0;
    let dlStart    = Date.now();
    let lastEditMs = 0;

    const updateStatus = async () => {
      const elapsed = Math.max(0.1, (Date.now() - dlStart) / 1000);
      const speed   = dlReceived / elapsed;
      const pct     = dlTotal > 0 ? Math.min(100, Math.round((dlReceived / dlTotal) * 100)) : null;
      const eta     = (dlTotal > dlReceived && speed > 0) ? (dlTotal - dlReceived) / speed : null;

      const text =
        `🎤 <b>Karaoke:</b> <i>${escapeHtml(userQuery)}</i>\n\n` +
        `✅ Found: <b>${escapeHtml(titleShort_)}</b>\n\n` +
        `⬇️ <b>Downloading audio…</b>\n` +
        `<code>${progressBar(pct)}</code>${pct !== null ? ` ${pct}%` : ''}\n` +
        `${dlTotal > 0 ? `${formatBytes(dlReceived)} / ${formatBytes(dlTotal)}` : `${formatBytes(dlReceived)} received`}` +
        `  •  ${speed > 100 ? formatSpeed(speed) : '…'}` +
        `${eta !== null ? `  ⏱ ~${formatEta(eta)}` : ''}\n\n` +
        `📜 Searching lyrics…`;

      const now = Date.now();
      if (now - lastEditMs > 1500) {
        lastEditMs = now;
        await ctx.editText(status.message_id, text, { parse_mode: 'HTML' }).catch(() => {});
      }
    };

    const [dlResult, lyricsResult] = await Promise.allSettled([
      // Download the MP3
      downloadMp3(mp3Url, tmpPath, async (received, total) => {
        dlReceived = received;
        dlTotal    = total;
        await updateStatus();
      }),

      // Search lyrics using the real ytdl title
      fetchLyrics(lyricsQueries),
    ]);

    // ── Check download result ────────────────────────────────────────────────
    if (dlResult.status === 'rejected') {
      console.error('[karaoke] Download failed:', dlResult.reason?.message);
      await ctx.editText(
        status.message_id,
        `❌ <b>Audio download failed</b>\n${escapeHtml(dlResult.reason?.message || 'Unknown error')}\n\n` +
        `<i>Try again or rephrase the song name.</i>`,
        { parse_mode: 'HTML' }
      ).catch(() => {});
      try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch {}
      return;
    }

    const lyrics      = lyricsResult.status === 'fulfilled' ? lyricsResult.value : null;
    const finalSize   = formatBytes(fs.statSync(tmpPath).size);
    const dlSecs      = ((Date.now() - dlStart) / 1000).toFixed(1);
    const renamedPath = path.join(CACHE_DIR, `${safeFilename(ytTitle)}_${requestId}.mp3`);

    fs.renameSync(tmpPath, renamedPath);

    try {
      // ── Step 3a: send lyrics first ─────────────────────────────────────────
      if (lyrics) {
        await ctx.editText(
          status.message_id,
          `🎤 <b>Karaoke:</b> <i>${escapeHtml(userQuery)}</i>\n\n` +
          `✅ Audio ready (${finalSize}) — sending lyrics…`,
          { parse_mode: 'HTML' }
        ).catch(() => {});

        await sendLyrics(ctx, lyrics);
      } else {
        await ctx.replyWithHTML(
          `⚠️ <b>Lyrics not found</b> for <i>${escapeHtml(cleanTitle)}</i>\n` +
          `<i>Tried lrclib.net &amp; lyrics.ovh — no results.</i>`
        );
      }

      // ── Step 3b: upload audio ──────────────────────────────────────────────
      await ctx.editText(
        status.message_id,
        `📤 <b>Uploading karaoke audio…</b>\n\n` +
        `🎤 <b>${escapeHtml(titleShort_)}</b>\n` +
        `📦 ${finalSize}  •  ⬇️ ${dlSecs}s`,
        { parse_mode: 'HTML' }
      ).catch(() => {});

      const caption =
        `🎤 <b>${escapeHtml(ytTitle)}</b>\n` +
        `🎵 Karaoke MP3  •  📦 ${finalSize}\n` +
        `🤖 MJL Bot`;

      await Promise.race([
        ctx.sendMediaFile(renamedPath, 'audio', {
          caption,
          parse_mode: 'HTML',
          title:      ytTitle,
          performer:  artist || undefined,
        }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Upload timed out after 5 minutes')), 300_000)
        ),
      ]);

      // ── Done ───────────────────────────────────────────────────────────────
      await ctx.editText(
        status.message_id,
        `✅ <b>Done!</b>  🎤 ${escapeHtml(titleShort_)}\n📦 ${finalSize}  •  ⏱ ${dlSecs}s`,
        { parse_mode: 'HTML' }
      ).catch(() => {});

    } catch (err) {
      console.error('[karaoke] Upload error:', err.message);
      await ctx.editText(
        status.message_id,
        `❌ <b>Upload failed</b>\n${escapeHtml(err.message)}\n\n` +
        `<i>${lyrics ? 'Lyrics were sent above. ' : ''}Try again.</i>`,
        { parse_mode: 'HTML' }
      ).catch(() => {});
    } finally {
      try { if (fs.existsSync(renamedPath)) fs.unlinkSync(renamedPath); } catch {}
    }
  },
};
