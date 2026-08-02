const fs   = require('fs');
const path = require('path');
const crypto = require('crypto');

const TMP_DIR = path.join(__dirname, 'cache', 'tmp');
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

const API_BASE        = 'https://yt-dlp-stream.onrender.com/api/v2/q?=';
const SEARCH_API_BASE = 'https://yt-dlp-stream.onrender.com/api/v3/q?=';

const pending        = new Map();
const pendingSearch  = new Map();
const processing     = new Set();

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

async function fetchMedia(query) {
  const res = await fetch(`${API_BASE}${encodeURIComponent(query)}`, {
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`API returned HTTP ${res.status}`);
  const data = await res.json();
  if (!data.title || (!data.media?.mp4 && !data.media?.mp3)) {
    throw new Error('No media found for that query.');
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

  await ctx.editText(
    statusMessageId,
    `🎬 <b>${data.title}</b>\n\nChoose output format:`,
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

// ── Download with redirect-follow + validation + live progress ──────
async function downloadWithProgress(url, destPath, onProgress) {
  const res = await fetch(url, {
    redirect: 'follow', // some hosts trigger download via redirect
    signal: AbortSignal.timeout(180_000),
    headers: {
      // some auto-download endpoints check UA / accept headers
      'User-Agent': 'Mozilla/5.0 (compatible; TelegramBot/1.0)',
      'Accept': '*/*',
    },
  });

  if (!res.ok) throw new Error(`Download failed — HTTP ${res.status}`);

  const contentType = res.headers.get('content-type') || '';
  const contentLength = parseInt(res.headers.get('content-length') || '0', 10);

  // If it's HTML, the URL didn't give us the actual file — likely an interstitial page
  if (contentType.includes('text/html')) {
    throw new Error('Server returned a webpage instead of the file (link may need direct access, not a redirect).');
  }

  if (!res.body) throw new Error('No response body from download URL.');

  const reader = res.body.getReader();
  const chunks = [];
  let received = 0;
  let lastUpdate = Date.now();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;

    // Throttle progress updates to every ~2s to avoid Telegram rate limits
    const now = Date.now();
    if (onProgress && now - lastUpdate > 2000) {
      lastUpdate = now;
      await onProgress(received, contentLength).catch(() => {});
    }
  }

  const buffer = Buffer.concat(chunks);

  // Guard against empty or suspiciously tiny "files" (likely error pages)
  if (buffer.length < 1024) {
    throw new Error(`Downloaded file too small (${buffer.length} bytes) — likely not real media.`);
  }

  fs.writeFileSync(destPath, buffer);
  return buffer;
}

module.exports = {
  name: 'ytdl',
  version: '1.2.0',
  description: 'Download a YouTube video as MP4 or MP3.',
  usage: '/ytdl <YouTube URL or video title>  |  /ytdl -search <query>  |  /ytdl -s <query>',
  aliases: ['yt', 'youtube'],
  callbackPrefix: 'ytdl:',

  async execute(ctx) {
    const { args, raw: msg } = ctx;

    if (!args || args.length === 0) {
      return ctx.replyWithHTML(
        '❌ Please provide a YouTube URL or video title.\n\n' +
        'Example: <code>/ytdl never gonna give you up</code>\n' +
        'Search:  <code>/ytdl -search never gonna give you up</code>'
      );
    }

    const firstArg = args[0].toLowerCase();
    const isSearch = firstArg === '-search' || firstArg === '-s';
    const query = (isSearch ? args.slice(1) : args).join(' ').trim();

    // Fixed: explicit empty-query guard after stripping the flag
    if (query.length === 0) {
      return ctx.replyWithHTML(
        isSearch
          ? '❌ Please provide a search query after -search/-s.\n\nExample: <code>/ytdl -search never gonna give you up</code>'
          : '❌ Please provide a YouTube URL or video title.\n\nExample: <code>/ytdl never gonna give you up</code>'
      );
    }

    const status = await ctx.reply(isSearch ? '🔍 Searching…' : '🔍 Looking up…');

    // ── SEARCH MODE ────────────────────────────────────────────
    if (isSearch) {
      let data;
      try {
        const res = await fetch(`${SEARCH_API_BASE}${encodeURIComponent(query)}`, {
          signal: AbortSignal.timeout(60_000),
        });
        if (!res.ok) throw new Error(`API returned HTTP ${res.status}`);
        data = await res.json();
        if (!Array.isArray(data.results) || data.results.length === 0) {
          throw new Error('No results found for that query.');
        }
      } catch (err) {
        await ctx.editText(status.message_id, `❌ Search failed: ${err.message}`);
        return;
      }

      const results = data.results.slice(0, 8);
      const requestId = crypto.randomBytes(6).toString('hex');
      pendingSearch.set(requestId, {
        initiatorId: msg.from.id,
        messageId:   status.message_id,
        results,
        createdAt:   Date.now(),
      });

      const lines = results.map((r, i) =>
        `${i + 1}. <b>${r.title}</b>\n   👤 ${r.channel_name}  •  ⏱ ${r.duration}  •  👁 ${r.views.toLocaleString()}`
      );

      const buttons = results.map((r, i) => ([
        { text: `${i + 1}`, callback_data: `ytdl:pick:${requestId}:${i}` },
      ]));

      await ctx.editText(
        status.message_id,
        `🔎 <b>Search results for:</b> ${query}\n\n${lines.join('\n\n')}\n\nTap a number to choose:`,
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

    // ── DIRECT MODE ─────────────────────────────────────────────
    let data;
    try {
      data = await fetchMedia(query);
    } catch (err) {
      await ctx.editText(status.message_id, `❌ Search failed: ${err.message}`);
      return;
    }

    await showFormatPicker(ctx, status.message_id, msg.from.id, data);
  },

  async onCallback(ctx, cq) {
    const parts  = cq.data.split(':');
    const action = parts[1];

    // ── Search result pick ──────────────────────────────────────
    if (action === 'pick') {
      const requestId   = parts[2];
      const index       = parseInt(parts[3], 10);
      const searchState = pendingSearch.get(requestId);

      if (!searchState) {
        return ctx.answerCallback(cq.id, '⏱ This search has expired.', true);
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

    const requestId = parts[2];
    const state      = pending.get(requestId);

    if (!state) {
      return ctx.answerCallback(cq.id, '⏱ This request has expired.', true);
    }
    if (cq.from.id !== state.initiatorId) {
      return ctx.answerCallback(cq.id, '🚫 Only the person who ran /ytdl can choose.', true);
    }
    if (processing.has(requestId)) {
      return ctx.answerCallback(cq.id, '⏳ Already processing, please wait.', true);
    }

    if (action === 'cancel') {
      pending.delete(requestId);
      pendingSearch.delete(requestId);
      await ctx.answerCallback(cq.id);
      return ctx.editText(state.messageId, '❌ Download cancelled.');
    }

    if (action !== 'mp4' && action !== 'mp3') {
      return ctx.answerCallback(cq.id, 'Unknown action.', true);
    }

    const downloadUrl = action === 'mp4' ? state.mp4Url : state.mp3Url;
    if (!downloadUrl) {
      return ctx.answerCallback(cq.id, `No ${action.toUpperCase()} link available.`, true);
    }

    processing.add(requestId);
    pending.delete(requestId);
    await ctx.answerCallback(cq.id);

    const ext      = action === 'mp4' ? '.mp4' : '.mp3';
    const filename = `${safeFilename(state.title)}${ext}`;
    const tmpPath  = path.join(TMP_DIR, `${requestId}${ext}`);

    try {
      // ── Live-updating download progress ─────────────────────────
      let lastText = '';
      await downloadWithProgress(downloadUrl, tmpPath, async (received, total) => {
        const receivedStr = formatBytes(received);
        const pct = total > 0 ? Math.min(100, Math.round((received / total) * 100)) : null;
        const bar = pct !== null
          ? '▰'.repeat(Math.floor(pct / 10)) + '▱'.repeat(10 - Math.floor(pct / 10))
          : null;

        const text = pct !== null
          ? `⏳ Downloading…\n\n🎬 <b>${state.title}</b>\n📁 Format: ${action.toUpperCase()}\n\n${bar} ${pct}%\n📦 ${receivedStr} / ${formatBytes(total)}`
          : `⏳ Downloading…\n\n🎬 <b>${state.title}</b>\n📁 Format: ${action.toUpperCase()}\n\n📦 ${receivedStr} received (size unknown)`;

        // Avoid redundant edits (Telegram rate-limits identical/rapid edits)
        if (text !== lastText) {
          lastText = text;
          await ctx.editText(state.messageId, text, { parse_mode: 'HTML' });
        }
      });

      const stat = fs.statSync(tmpPath);
      const size = formatBytes(stat.size);

      await ctx.editText(
        state.messageId,
        `📤 Uploading to Telegram…\n\n🎬 <b>${state.title}</b>\n📦 ${size}`,
        { parse_mode: 'HTML' }
      );

      const telegramType = action === 'mp4' ? 'video' : 'audio';
      const caption = [
        `🎬 <b>${state.title}</b>`,
        `📁 ${action.toUpperCase()}  •  📦 ${size}`,
      ].join('\n');

      const renamedPath = path.join(TMP_DIR, filename);
      fs.renameSync(tmpPath, renamedPath);

      // Guard the upload itself with a timeout so it can't hang forever
      await Promise.race([
        ctx.sendMediaFile(renamedPath, telegramType, { caption, parse_mode: 'HTML' }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Upload to Telegram timed out after 120s')), 120_000)
        ),
      ]);

      await ctx.editText(state.messageId, '✅ Done! File sent above.');
    } catch (err) {
      console.error('[ytdl] Error:', err.message);
      await ctx.editText(
        state.messageId,
        `❌ Failed: ${err.message}`
      ).catch(() => {});
    } finally {
      processing.delete(requestId);
      for (const ext of ['.mp4', '.mp3']) {
        const f = path.join(TMP_DIR, `${requestId}${ext}`);
        if (fs.existsSync(f)) try { fs.unlinkSync(f); } catch {}
      }
      const renamed = path.join(TMP_DIR, filename);
      if (fs.existsSync(renamed)) try { fs.unlinkSync(renamed); } catch {}
    }
  },
};