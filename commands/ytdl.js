const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

// ── Changed: Save directly in the 'cache' folder instead of 'cache/tmp' ──────
const CACHE_DIR = path.join(__dirname, 'cache');
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

const API_BASE        = 'https://yt-dlp-stream.onrender.com/api/v2/q?=';
const SEARCH_API_BASE = 'https://yt-dlp-stream.onrender.com/api/v3/q?=';

// Telegram bot upload limit (50 MB)
const TG_MAX_BYTES = 50 * 1024 * 1024;

const pending        = new Map();
const pendingSearch  = new Map();
const processing     = new Set();

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let val = bytes / 1024, i = 0;
  while (val >= 1024 && i < units.length - 1) { val /= 1024; i++; }
  return `${val.toFixed(2)} ${units[i]}`;
}

function safeFilename(title) {
  return title.replace(/[/\\?%*:|"<>\r\n]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
}

/** Fetch with a single automatic retry on network/5xx failure. */
async function fetchWithRetry(url, opts = {}, retries = 2) {
  let lastErr;
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, opts);
      if (!res.ok && res.status >= 500 && i < retries - 1) {
        lastErr = new Error(`API returned HTTP ${res.status}`);
        await new Promise(r => setTimeout(r, 2000 * (i + 1)));
        continue;
      }
      return res;
    } catch (err) {
      lastErr = err;
      if (i < retries - 1) await new Promise(r => setTimeout(r, 2000 * (i + 1)));
    }
  }
  throw lastErr;
}

async function fetchMedia(query) {
  const res = await fetchWithRetry(`${API_BASE}${encodeURIComponent(query)}`, {
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`Media API returned HTTP ${res.status}. The backend may be waking up — try again in a moment.`);
  const data = await res.json();
  if (!data.title || (!data.media?.mp4 && !data.media?.mp3)) {
    throw new Error('No downloadable media found for that query.');
  }
  return data;
}

async function showFormatPicker(ctx, statusMessageId, initiatorId, data) {
  const requestId = crypto.randomBytes(6).toString('hex');
  pending.set(requestId, {
    initiatorId,
    title:     data.title,
    mp4Url:    data.media.mp4 || null,
    mp3Url:    data.media.mp3 || null,
    messageId: statusMessageId,
    createdAt: Date.now(),
  });

  const buttons = [];
  if (data.media.mp4) buttons.push({ text: '🎥 MP4', callback_data: `ytdl:mp4:${requestId}` });
  if (data.media.mp3) buttons.push({ text: '🎵 MP3', callback_data: `ytdl:mp3:${requestId}` });

  const thumb = data.thumbnail ? `\n🖼 <a href="${data.thumbnail}"></a>` : '';
  const dur   = data.duration   ? `\n⏱ ${data.duration}`                 : '';

  await ctx.editText(
    statusMessageId,
    `🎬 <b>${data.title}</b>${dur}\n\nChoose output format:${thumb}`,
    {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          buttons,
          [{ text: '❌ Cancel', callback_data: `ytdl:cancel:${requestId}` }],
        ],
      },
    }
  );
}

// ── Download with redirect-follow + validation + live progress ────────────────
async function downloadWithProgress(url, destPath, onProgress) {
  const res = await fetchWithRetry(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(300_000),
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': '*/*',
      'Accept-Encoding': 'gzip, deflate',
      'Connection': 'keep-alive',
    },
  });

  if (!res.ok) throw new Error(`Download failed — HTTP ${res.status}`);

  const contentType   = res.headers.get('content-type') || '';
  const contentLength = parseInt(res.headers.get('content-length') || '0', 10);

  if (contentType.includes('text/html') || contentType.includes('application/json')) {
    throw new Error('Server returned a webpage/JSON instead of media. Link may have expired.');
  }

  // Pre-flight size check — reject before wasting bandwidth
  if (contentLength > 0 && contentLength > TG_MAX_BYTES) {
    throw new Error(
      `File is too large (${formatBytes(contentLength)} > 50 MB limit). ` +
      `Try a lower resolution or shorter video.`
    );
  }

  if (!res.body) throw new Error('No response body from download URL.');

  const reader   = res.body.getReader();
  const chunks   = [];
  let received   = 0;
  let lastUpdate = Date.now();

  while (true) {
    try {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;

      // Hard-abort if we somehow pass the limit mid-stream
      if (received > TG_MAX_BYTES) {
        reader.cancel();
        throw new Error(`File exceeds 50 MB limit. Download aborted at ${formatBytes(received)}.`);
      }

      const now = Date.now();
      if (onProgress && now - lastUpdate > 1000) {
        lastUpdate = now;
        await onProgress(received, contentLength).catch(() => {});
      }
    } catch (err) {
      reader.cancel();
      throw err;
    }
  }

  const buffer = Buffer.concat(chunks);

  if (buffer.length < 1024) {
    throw new Error(`Downloaded file is suspiciously small (${buffer.length} bytes).`);
  }

  fs.writeFileSync(destPath, buffer);
}

// ── Expire old pending requests every 10 minutes ─────────────────────────────
setInterval(() => {
  const ttl = 10 * 60 * 1000;
  const now = Date.now();
  for (const [id, s] of pending)       if (now - s.createdAt > ttl) pending.delete(id);
  for (const [id, s] of pendingSearch) if (now - s.createdAt > ttl) pendingSearch.delete(id);
}, 5 * 60 * 1000);

// ── Command export ────────────────────────────────────────────────────────────
module.exports = {
  name:           'ytdl',
  version:        '3.0.0',
  description:    'Download YouTube videos or audio. Supports direct URLs and keyword search.',
  usage:          '/ytdl <url or title>  |  /ytdl -s <search query>',
  aliases:        ['yt', 'youtube'],
  callbackPrefix: 'ytdl:',

  async execute(ctx) {
    const { args, raw: msg } = ctx;

    if (!args || args.length === 0) {
      return ctx.replyWithHTML(
        '❌ <b>Usage:</b>\n' +
        '  <code>/ytdl &lt;url or title&gt;</code>\n' +
        '  <code>/ytdl -s &lt;search query&gt;</code>\n\n' +
        'Examples:\n' +
        '  <code>/ytdl https://youtu.be/dQw4w9WgXcQ</code>\n' +
        '  <code>/ytdl never gonna give you up</code>\n' +
        '  <code>/ytdl -s lofi hip hop</code>'
      );
    }

    const firstArg = args[0].toLowerCase();
    const isSearch = firstArg === '-search' || firstArg === '-s';
    const query    = (isSearch ? args.slice(1) : args).join(' ').trim();

    if (query.length === 0) {
      return ctx.replyWithHTML(
        isSearch
          ? '❌ Please provide a search query after <code>-s</code>.\n\nExample: <code>/ytdl -s lofi hip hop</code>'
          : '❌ Please provide a YouTube URL or video title.\n\nExample: <code>/ytdl never gonna give you up</code>'
      );
    }

    const status = await ctx.reply(isSearch ? '🔍 Searching…' : '🔍 Looking up…');

    // ── SEARCH MODE ────────────────────────────────────────────────────────
    if (isSearch) {
      let data;
      try {
        const res = await fetchWithRetry(`${SEARCH_API_BASE}${encodeURIComponent(query)}`, {
          signal: AbortSignal.timeout(60_000),
        });
        if (!res.ok) throw new Error(`Search API returned HTTP ${res.status}`);
        data = await res.json();
        if (!Array.isArray(data.results) || data.results.length === 0) {
          throw new Error('No results found for that query.');
        }
      } catch (err) {
        await ctx.editText(status.message_id, `❌ Search failed: ${err.message}`);
        return;
      }

      const results   = data.results.slice(0, 8);
      const requestId = crypto.randomBytes(6).toString('hex');
      pendingSearch.set(requestId, {
        initiatorId: msg.from.id,
        messageId:   status.message_id,
        results,
        createdAt:   Date.now(),
      });

      const lines = results.map((r, i) =>
        `${i + 1}. <b>${r.title}</b>\n   👤 ${r.channel_name}  •  ⏱ ${r.duration}  •  👁 ${(r.views || 0).toLocaleString()}`
      );

      const buttons = results.map((r, i) => ([
        { text: `${i + 1}`, callback_data: `ytdl:pick:${requestId}:${i}` },
      ]));

      await ctx.editText(
        status.message_id,
        `🔎 <b>Search results for:</b> ${query}\n\n${lines.join('\n\n')}\n\nTap a number to download:`,
        {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              ...Array.from({ length: Math.ceil(buttons.length / 4) }, (_, r) =>
                buttons.slice(r * 4, r * 4 + 4).map(b => b[0])
              ),
              [{ text: '❌ Cancel', callback_data: `ytdl:cancel:${requestId}` }],
            ],
          },
        }
      );
      return;
    }

    // ── DIRECT MODE ────────────────────────────────────────────────────────
    let data;
    try {
      data = await fetchMedia(query);
    } catch (err) {
      await ctx.editText(status.message_id, `❌ Lookup failed: ${err.message}`);
      return;
    }

    await showFormatPicker(ctx, status.message_id, msg.from.id, data);
  },

  async onCallback(ctx, cq) {
    const parts  = cq.data.split(':');
    const action = parts[1];

    // ── Search result pick ─────────────────────────────────────────────────
    if (action === 'pick') {
      const requestId   = parts[2];
      const index       = parseInt(parts[3], 10);
      const searchState = pendingSearch.get(requestId);

      if (!searchState) {
        return ctx.answerCallback(cq.id, '⏱ This search has expired. Run /ytdl -s again.', true);
      }
      if (cq.from.id !== searchState.initiatorId) {
        return ctx.answerCallback(cq.id, '🚫 Only the person who searched can choose.', true);
      }

      const chosen = searchState.results[index];
      if (!chosen) {
        return ctx.answerCallback(cq.id, '❌ Invalid selection.', true);
      }

      pendingSearch.delete(requestId);
      await ctx.answerCallback(cq.id);
      await ctx.editText(searchState.messageId, `⏳ Fetching media for:\n<b>${chosen.title}</b>`, { parse_mode: 'HTML' });

      try {
        const data = await fetchMedia(chosen.url || chosen.title);
        await showFormatPicker(ctx, searchState.messageId, searchState.initiatorId, data);
      } catch (err) {
        await ctx.editText(searchState.messageId, `❌ Failed to fetch media: ${err.message}`).catch(() => {});
      }
      return;
    }

    // ── Cancel ─────────────────────────────────────────────────────────────
    const requestId = parts[2];
    const state     = pending.get(requestId);

    if (!state) {
      return ctx.answerCallback(cq.id, '⏱ This request has expired.', true);
    }
    if (cq.from.id !== state.initiatorId) {
      return ctx.answerCallback(cq.id, '🚫 Only the person who ran /ytdl can choose.', true);
    }
    if (processing.has(requestId)) {
      return ctx.answerCallback(cq.id, '⏳ Already processing — please wait.', true);
    }

    if (action === 'cancel') {
      pending.delete(requestId);
      await ctx.answerCallback(cq.id);
      return ctx.editText(state.messageId, '❌ Download cancelled.');
    }

    if (action !== 'mp4' && action !== 'mp3') {
      return ctx.answerCallback(cq.id, 'Unknown action.', true);
    }

    const downloadUrl = action === 'mp4' ? state.mp4Url : state.mp3Url;
    if (!downloadUrl) {
      return ctx.answerCallback(cq.id, `No ${action.toUpperCase()} link available for this video.`, true);
    }

    processing.add(requestId);
    pending.delete(requestId);
    await ctx.answerCallback(cq.id);

    const ext         = action === 'mp4' ? '.mp4' : '.mp3';
    const filename    = `${safeFilename(state.title)}${ext}`;
    const tmpPath     = path.join(CACHE_DIR, `${requestId}${ext}`);
    const renamedPath = path.join(CACHE_DIR, filename);

    try {
      // ── Live download progress ───────────────────────────────────────────
      let lastText = '';
      let lastUpdateTime = 0;
      await downloadWithProgress(downloadUrl, tmpPath, async (received, total) => {
        const receivedStr = formatBytes(received);
        const totalStr = formatBytes(total);
        const pct = total > 0 ? Math.min(100, Math.round((received / total) * 100)) : null;
        
        // Progress bar visualization
        const barLength = 15;
        const filled = Math.floor((pct / 100) * barLength);
        const bar = pct !== null
          ? '[' + '█'.repeat(filled) + '░'.repeat(barLength - filled) + ']'
          : '[░░░░░░░░░░░░░░░]';

        const eta = total > 0 && received > 0
          ? Math.round((total - received) / (received / (Date.now() / 1000)))
          : 0;
        const etaStr = eta > 0 ? `\n⏱ ETA: ~${eta}s` : '';

        const text = pct !== null
          ? `⏳ Downloading…\n\n🎬 <b>${state.title.slice(0, 40)}${state.title.length > 40 ? '...' : ''}</b>\n📁 Format: ${action.toUpperCase()}\n\n${bar} ${pct}%\n[${receivedStr} / ${totalStr}]${etaStr}`
          : `⏳ Downloading…\n\n🎬 <b>${state.title.slice(0, 40)}${state.title.length > 40 ? '...' : ''}</b>\n📁 Format: ${action.toUpperCase()}\n\n📦 ${receivedStr} received…`;

        const now = Date.now();
        if (text !== lastText && now - lastUpdateTime > 1500) {
          lastText = text;
          lastUpdateTime = now;
          await ctx.editText(state.messageId, text, { parse_mode: 'HTML' }).catch(() => {});
        }
      });

      const stat = fs.statSync(tmpPath);
      const size = formatBytes(stat.size);

      await ctx.editText(
        state.messageId,
        `📤 Uploading to Telegram…\n\n🎬 <b>${state.title.slice(0, 40)}${state.title.length > 40 ? '...' : ''}</b>\n📦 ${size}`,
        { parse_mode: 'HTML' }
      );

      const telegramType = action === 'mp4' ? 'video' : 'audio';
      const caption = [
        `🎬 ${state.title}`,
        `📁 ${action.toUpperCase()}  •  📦 ${size}`,
        `🤖 MJL Bot`,
      ].join('\n');

      fs.renameSync(tmpPath, renamedPath);

      // For MP4 videos: use supports_streaming for better experience
      const sendOpts = action === 'mp4'
        ? { caption, parse_mode: 'HTML', supports_streaming: true, thumb: null }
        : { caption, parse_mode: 'HTML' };

      await Promise.race([
        ctx.sendMediaFile(renamedPath, telegramType, sendOpts),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Upload to Telegram timed out after 5 minutes')), 300_000)
        ),
      ]);

      await ctx.editText(state.messageId, `✅ Done! File sent (${size})`);
    } catch (err) {
      console.error('[ytdl] Error:', err.message);
      await ctx.editText(
        state.messageId,
        `❌ <b>Failed:</b> ${err.message}`,
        { parse_mode: 'HTML' }
      ).catch(() => {});
    } finally {
      processing.delete(requestId);

      // ── Cleanup: Auto-delete all temporary and renamed files ────────────
      const filesToDelete = [
        tmpPath,
        renamedPath,
        path.join(CACHE_DIR, `${requestId}.mp4`),
        path.join(CACHE_DIR, `${requestId}.mp3`)
      ];

      for (const filePath of filesToDelete) {
        if (fs.existsSync(filePath)) {
          try {
            fs.unlinkSync(filePath);
          } catch (unlinkErr) {
            console.error(`[ytdl] Failed to delete file ${filePath}:`, unlinkErr.message);
          }
        }
      }
    }
  },
};
