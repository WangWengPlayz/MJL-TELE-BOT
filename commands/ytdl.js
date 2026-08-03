// ============================================================
//  COMMAND  —  ytdl  v3.2
//  /ytdl <url or title>  |  /ytdl -s <search>
//  YouTube downloader with rich animated progress UI.
// ============================================================

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

const CACHE_DIR = path.join(__dirname, 'cache');
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

const API_BASE        = 'https://yt-dlp-stream.onrender.com/api/v2/q?=';
const SEARCH_API_BASE = 'https://yt-dlp-stream.onrender.com/api/v3/q?=';
const TG_MAX_BYTES    = 50 * 1024 * 1024;

const pending       = new Map();
const pendingSearch = new Map();
const processing    = new Set();

// ── Spinner frame sets ────────────────────────────────────────────────────────
const SPINNERS = {
  braille: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'],
  dots:    ['⣾', '⣽', '⣻', '⢿', '⡿', '⣟', '⣯', '⣷'],
  bounce:  ['⠁', '⠂', '⠄', '⡀', '⢀', '⠠', '⠐', '⠈'],
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatBytes(bytes) {
  if (bytes < 1024)       return `${bytes} B`;
  if (bytes < 1048576)    return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(2)} MB`;
  return `${(bytes / 1073741824).toFixed(2)} GB`;
}

function formatSpeed(bytesPerSec) {
  if (bytesPerSec < 1024)    return `${bytesPerSec.toFixed(0)} B/s`;
  if (bytesPerSec < 1048576) return `${(bytesPerSec / 1024).toFixed(1)} KB/s`;
  return `${(bytesPerSec / 1048576).toFixed(2)} MB/s`;
}

function formatEta(seconds) {
  if (seconds < 60)  return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

function safeFilename(title) {
  return title.replace(/[/\\?%*:|"<>\r\n]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
}

function shortTitle(title, maxLen = 38) {
  return title.length > maxLen ? title.slice(0, maxLen) + '…' : title;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Progress bar: ▰▰▰▰▰▰▱▱▱▱ 60%
 * Bouncing bar when total size is unknown.
 */
function progressBar(pct, len = 14) {
  if (pct === null) {
    // Animate a "running dot" using current time
    const pos = Math.floor((Date.now() / 150) % len);
    return '▱'.repeat(pos) + '▰' + '▱'.repeat(len - pos - 1);
  }
  const filled = Math.max(0, Math.min(len, Math.round((pct / 100) * len)));
  return '▰'.repeat(filled) + '▱'.repeat(len - filled);
}

/**
 * Animated spinner on a message. Returns a stop() function.
 * label can be a static string or a () => string factory for dynamic labels.
 */
function startLoadingAnimation(ctx, messageId, label, intervalMs = 550, spinnerKey = 'braille') {
  const frames  = SPINNERS[spinnerKey] || SPINNERS.braille;
  let i         = 0;
  let stopped   = false;

  const getLabel = typeof label === 'function' ? label : () => label;

  const tick = async () => {
    if (stopped) return;
    const frame = frames[i % frames.length];
    const text  = `${frame} ${getLabel()}`;
    await ctx.editText(messageId, text, { parse_mode: 'HTML' }).catch(() => {});
    i++;
  };

  tick();
  const handle = setInterval(tick, intervalMs);

  return () => {
    stopped = true;
    clearInterval(handle);
  };
}

/** Fetch with retry on 5xx / network error. */
async function fetchWithRetry(url, opts = {}, retries = 2) {
  let lastErr;
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, opts);
      if (!res.ok && res.status >= 500 && i < retries - 1) {
        lastErr = new Error(`API HTTP ${res.status}`);
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

async function fetchMedia(query) {
  const res = await fetchWithRetry(`${API_BASE}${encodeURIComponent(query)}`, {
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`Media API HTTP ${res.status}. The backend may be waking — try again shortly.`);
  const data = await res.json();
  if (!data.title || (!data.media?.mp4 && !data.media?.mp3)) {
    throw new Error('No downloadable media found for that query.');
  }
  return data;
}

async function showFormatPicker(ctx, statusMsgId, initiatorId, data) {
  const requestId = crypto.randomBytes(6).toString('hex');
  pending.set(requestId, {
    initiatorId,
    title:     data.title,
    mp4Url:    data.media.mp4 || null,
    mp3Url:    data.media.mp3 || null,
    messageId: statusMsgId,
    createdAt: Date.now(),
  });

  const buttons = [];
  if (data.media.mp4) buttons.push({ text: '🎥 MP4 Video', callback_data: `ytdl:mp4:${requestId}` });
  if (data.media.mp3) buttons.push({ text: '🎵 MP3 Audio', callback_data: `ytdl:mp3:${requestId}` });

  const dur   = data.duration ? `\n⏱ <b>Duration:</b> ${data.duration}` : '';
  const thumb = data.thumbnail ? `\n\n<a href="${data.thumbnail}">&#8203;</a>` : '';

  await ctx.editText(
    statusMsgId,
    `✅ <b>Found!</b>\n\n` +
    `🎬 <b>${escapeHtml(data.title)}</b>${dur}\n\n` +
    `Choose output format:${thumb}`,
    {
      parse_mode:  'HTML',
      reply_markup: {
        inline_keyboard: [
          buttons,
          [{ text: '❌ Cancel', callback_data: `ytdl:cancel:${requestId}` }],
        ],
      },
    }
  );
}

// ── Download with progress tracking ───────────────────────────────────────────
async function downloadWithProgress(url, destPath, onProgress) {
  const res = await fetchWithRetry(url, {
    redirect: 'follow',
    signal:   AbortSignal.timeout(300_000),
    headers: {
      'User-Agent':       'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept':           '*/*',
      'Accept-Encoding':  'gzip, deflate',
      'Connection':       'keep-alive',
    },
  });

  if (!res.ok) throw new Error(`Download failed — HTTP ${res.status}`);

  const contentType   = res.headers.get('content-type') || '';
  const contentLength = parseInt(res.headers.get('content-length') || '0', 10);

  if (contentType.includes('text/html') || contentType.includes('application/json')) {
    throw new Error('Server returned a webpage instead of media. The link may have expired.');
  }
  if (contentLength > 0 && contentLength > TG_MAX_BYTES) {
    throw new Error(`File too large (${formatBytes(contentLength)} > 50 MB Telegram limit).`);
  }
  if (!res.body) throw new Error('No response body from download URL.');

  const reader     = res.body.getReader();
  const chunks     = [];
  let received     = 0;
  let lastNotify   = Date.now();

  while (true) {
    try {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;

      if (received > TG_MAX_BYTES) {
        reader.cancel();
        throw new Error(`File exceeded 50 MB limit at ${formatBytes(received)}. Download aborted.`);
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

// ── Expire old pending requests ───────────────────────────────────────────────
setInterval(() => {
  const ttl = 10 * 60_000;
  const now = Date.now();
  for (const [id, s] of pending)       if (now - s.createdAt > ttl) pending.delete(id);
  for (const [id, s] of pendingSearch) if (now - s.createdAt > ttl) pendingSearch.delete(id);
}, 5 * 60_000);

// ── Command export ────────────────────────────────────────────────────────────
module.exports = {
  name:           'ytdl',
  version:        '3.2.0',
  description:    'Download YouTube videos or audio. Supports direct URLs and keyword search.',
  usage:          '/ytdl <url or title>  |  /ytdl -s <search query>',
  category:       'Media',
  permission:     1,
  aliases:        ['yt', 'youtube'],
  callbackPrefix: 'ytdl:',

  async execute(ctx) {
    const { args, raw: msg } = ctx;

    if (!args || args.length === 0) {
      return ctx.replyWithHTML(
        '📺 <b>YouTube Downloader</b>\n\n' +
        '<b>Usage:</b>\n' +
        '  <code>/ytdl &lt;url or title&gt;</code> — direct lookup\n' +
        '  <code>/ytdl -s &lt;query&gt;</code> — search YouTube\n\n' +
        '<b>Examples:</b>\n' +
        '  <code>/ytdl https://youtu.be/dQw4w9WgXcQ</code>\n' +
        '  <code>/ytdl never gonna give you up</code>\n' +
        '  <code>/ytdl -s lofi hip hop</code>'
      );
    }

    const firstArg = args[0].toLowerCase();
    const isSearch = firstArg === '-search' || firstArg === '-s';
    const query    = (isSearch ? args.slice(1) : args).join(' ').trim();

    if (!query) {
      return ctx.replyWithHTML(
        isSearch
          ? '❌ Missing search query. Example: <code>/ytdl -s lofi hip hop</code>'
          : '❌ Missing URL or title. Example: <code>/ytdl never gonna give you up</code>'
      );
    }

    // ── Status message ─────────────────────────────────────────────────────
    const status = await ctx.replyWithHTML(
      isSearch
        ? `🔍 <b>Searching YouTube…</b>\n<code>${escapeHtml(query)}</code>`
        : `🔍 <b>Looking up…</b>\n<code>${escapeHtml(query)}</code>`
    );

    // ── SEARCH MODE ────────────────────────────────────────────────────────
    if (isSearch) {
      const stopAnim = startLoadingAnimation(
        ctx, status.message_id,
        () => `Searching YouTube for: <i>${escapeHtml(query)}</i>`,
        600, 'dots'
      );

      let data;
      try {
        const res = await fetchWithRetry(`${SEARCH_API_BASE}${encodeURIComponent(query)}`, {
          signal: AbortSignal.timeout(60_000),
        });
        if (!res.ok) throw new Error(`Search API HTTP ${res.status}`);
        data = await res.json();
        if (!Array.isArray(data.results) || data.results.length === 0) {
          throw new Error('No results found for that query.');
        }
      } catch (err) {
        stopAnim();
        await ctx.editText(
          status.message_id,
          `❌ <b>Search failed</b>\n${escapeHtml(err.message)}`,
          { parse_mode: 'HTML' }
        );
        return;
      }

      stopAnim();

      const results   = data.results.slice(0, 8);
      const requestId = crypto.randomBytes(6).toString('hex');
      pendingSearch.set(requestId, {
        initiatorId: msg.from.id,
        messageId:   status.message_id,
        results,
        createdAt:   Date.now(),
      });

      const lines = results.map((r, i) =>
        `${i + 1}. <b>${escapeHtml(r.title)}</b>\n` +
        `   👤 ${escapeHtml(r.channel_name || '?')}  •  ⏱ ${r.duration || '?'}  •  👁 ${(r.views || 0).toLocaleString()}`
      );

      // Number buttons in rows of 4
      const numBtns = results.map((_, i) => ({ text: `${i + 1}`, callback_data: `ytdl:pick:${requestId}:${i}` }));
      const btnRows = [];
      for (let r = 0; r < numBtns.length; r += 4) btnRows.push(numBtns.slice(r, r + 4));

      await ctx.editText(
        status.message_id,
        `🔎 <b>Search:</b> <i>${escapeHtml(query)}</i>\n${'─'.repeat(28)}\n\n${lines.join('\n\n')}\n\n<i>Tap a number to download:</i>`,
        {
          parse_mode:  'HTML',
          reply_markup: {
            inline_keyboard: [
              ...btnRows,
              [{ text: '❌ Cancel', callback_data: `ytdl:cancel:${requestId}` }],
            ],
          },
        }
      );
      return;
    }

    // ── DIRECT MODE ────────────────────────────────────────────────────────
    const stopAnim = startLoadingAnimation(
      ctx, status.message_id,
      () => `Fetching video info…\n<code>${escapeHtml(query.slice(0, 50))}</code>`,
      550, 'braille'
    );

    let data;
    try {
      data = await fetchMedia(query);
    } catch (err) {
      stopAnim();
      await ctx.editText(
        status.message_id,
        `❌ <b>Lookup failed</b>\n${escapeHtml(err.message)}`,
        { parse_mode: 'HTML' }
      );
      return;
    }

    stopAnim();
    await showFormatPicker(ctx, status.message_id, msg.from.id, data);
  },

  // ── Callbacks ──────────────────────────────────────────────────────────────
  async onCallback(ctx, cq) {
    const parts  = cq.data.split(':');
    const action = parts[1];

    // ── Search pick ────────────────────────────────────────────────────────
    if (action === 'pick') {
      const requestId   = parts[2];
      const index       = parseInt(parts[3], 10);
      const searchState = pendingSearch.get(requestId);

      if (!searchState) {
        return ctx.answerCallback(cq.id, '⏱ Search expired — run /ytdl -s again.', true);
      }
      if (cq.from.id !== searchState.initiatorId) {
        return ctx.answerCallback(cq.id, '🚫 Only the person who searched can pick.', true);
      }

      const chosen = searchState.results[index];
      if (!chosen) return ctx.answerCallback(cq.id, '❌ Invalid selection.', true);

      pendingSearch.delete(requestId);
      await ctx.answerCallback(cq.id);

      const stopAnim = startLoadingAnimation(
        ctx, searchState.messageId,
        () => `Fetching media for:\n<b>${escapeHtml(shortTitle(chosen.title))}</b>`,
        550, 'braille'
      );

      try {
        const data = await fetchMedia(chosen.url || chosen.title);
        stopAnim();
        await showFormatPicker(ctx, searchState.messageId, searchState.initiatorId, data);
      } catch (err) {
        stopAnim();
        await ctx.editText(
          searchState.messageId,
          `❌ <b>Failed to fetch media</b>\n${escapeHtml(err.message)}`,
          { parse_mode: 'HTML' }
        ).catch(() => {});
      }
      return;
    }

    // ── All other actions need a pending state ─────────────────────────────
    const requestId = parts[2];
    const state     = pending.get(requestId);

    if (!state) {
      return ctx.answerCallback(cq.id, '⏱ Request expired — run /ytdl again.', true);
    }
    if (cq.from.id !== state.initiatorId) {
      return ctx.answerCallback(cq.id, '🚫 Only the person who ran /ytdl can choose.', true);
    }
    if (processing.has(requestId)) {
      return ctx.answerCallback(cq.id, '⏳ Already processing — please wait.', true);
    }

    // ── Cancel ─────────────────────────────────────────────────────────────
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
    const titleShort  = shortTitle(state.title);
    const formatIcon  = action === 'mp4' ? '🎥' : '🎵';

    try {
      // ── Download stage ───────────────────────────────────────────────────
      const downloadStart = Date.now();
      let lastText        = '';
      let lastEditTime    = 0;

      await downloadWithProgress(downloadUrl, tmpPath, async (received, total) => {
        const elapsed   = Math.max(0.1, (Date.now() - downloadStart) / 1000);
        const speed     = received / elapsed;                              // bytes/sec
        const pct       = total > 0 ? Math.min(100, Math.round((received / total) * 100)) : null;
        const eta       = (total > received && speed > 0) ? (total - received) / speed : null;

        const bar       = progressBar(pct);
        const pctLabel  = pct !== null ? ` ${pct}%` : '';
        const sizeLabel = total > 0
          ? `${formatBytes(received)} / ${formatBytes(total)}`
          : `${formatBytes(received)} received`;
        const speedLabel = speed > 100 ? formatSpeed(speed) : '…';
        const etaLabel   = eta !== null ? `  ⏱ ~${formatEta(eta)}` : '';

        const text =
          `⬇️ <b>Downloading…</b>\n\n` +
          `${formatIcon} <b>${escapeHtml(titleShort)}</b>\n` +
          `📁 Format: <code>${action.toUpperCase()}</code>\n\n` +
          `<code>${bar}</code>${pctLabel}\n` +
          `${sizeLabel}  •  ${speedLabel}${etaLabel}`;

        const now = Date.now();
        if (text !== lastText && now - lastEditTime > 1500) {
          lastText     = text;
          lastEditTime = now;
          await ctx.editText(state.messageId, text, { parse_mode: 'HTML' }).catch(() => {});
        }
      });

      // ── Final file size ───────────────────────────────────────────────────
      const finalSize  = formatBytes(fs.statSync(tmpPath).size);
      const dlDuration = ((Date.now() - downloadStart) / 1000).toFixed(1);

      // ── Upload stage ─────────────────────────────────────────────────────
      let uploadFrame = 0;
      const uploadFrames = ['⬆️', '📤', '🔼', '📤'];
      const stopUploadAnim = startLoadingAnimation(
        ctx, state.messageId,
        () => {
          const f = uploadFrames[uploadFrame++ % uploadFrames.length];
          return (
            `${f} <b>Uploading to Telegram…</b>\n\n` +
            `${formatIcon} <b>${escapeHtml(titleShort)}</b>\n` +
            `📁 <code>${action.toUpperCase()}</code>  •  📦 ${finalSize}\n` +
            `<i>Downloaded in ${dlDuration}s — uploading…</i>`
          );
        },
        700, 'dots'
      );

      const telegramType = action === 'mp4' ? 'video' : 'audio';
      const caption = `${formatIcon} ${state.title}\n📁 ${action.toUpperCase()}  •  📦 ${finalSize}\n🤖 MJL Bot`;

      fs.renameSync(tmpPath, renamedPath);

      const sendOpts = action === 'mp4'
        ? { caption, parse_mode: 'HTML', supports_streaming: true }
        : { caption, parse_mode: 'HTML' };

      try {
        await Promise.race([
          ctx.sendMediaFile(renamedPath, telegramType, sendOpts),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Upload timed out after 5 minutes')), 300_000)
          ),
        ]);
      } finally {
        stopUploadAnim();
      }

      await ctx.editText(
        state.messageId,
        `✅ <b>Done!</b>  ${formatIcon} ${escapeHtml(titleShort)}\n📦 ${finalSize}  •  ⏱ ${dlDuration}s`,
        { parse_mode: 'HTML' }
      );

    } catch (err) {
      console.error('[ytdl] Error:', err.message);
      await ctx.editText(
        state.messageId,
        `❌ <b>Failed</b>\n${escapeHtml(err.message)}\n\n<i>Try again or use a different video.</i>`,
        { parse_mode: 'HTML' }
      ).catch(() => {});
    } finally {
      processing.delete(requestId);

      for (const p of [tmpPath, renamedPath]) {
        try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch {}
      }
    }
  },
};
