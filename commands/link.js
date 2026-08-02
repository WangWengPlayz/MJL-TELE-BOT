// ============================================================
//  /link — detect a replied file's type and convert it
//  (debug mode: verbose errors/warnings sent to chat)
// ============================================================

const { exec } = require('child_process');
const util = require('util');
const path = require('path');
const fs = require('fs');
const os = require('os');
const execAsync = util.promisify(exec);

// Shared cache module (per your note) instead of a local Map.
const cache = require('../commands/cache');

const CACHE_PREFIX = 'link:';
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 min

// Toggle this (or wire it to a config/env var) to turn debug output on/off.
let DEBUG = false;

module.exports = {
  name:        'link',
  execute,

  version:     '2.1.0',
  description: 'Reply to a file to detect its type, then convert it to another format.',
  usage:       '/link (as a reply to a file) | /link debug on|off',
  category:    'Utility',
  aliases:     ['detect', 'ftype', 'convert'],

  callbackPrefix: 'link:',
  onCallback,
};

// ── Main handler ─────────────────────────────────────────────────────────
async function execute(ctx) {
  const { args, raw: msg } = ctx;

  // ── /link debug on|off ────────────────────────────────────
  if (args[0] === 'debug') {
    DEBUG = args[1] === 'on';
    await ctx.reply(`🐞 Debug mode ${DEBUG ? 'enabled ✅' : 'disabled ❌'}`);
    return;
  }

  const target = msg.reply_to_message;

  if (!target) {
    if (DEBUG) {
      await ctx.reply('⚠️ [debug] /link used without a reply — nothing to detect. Deleting message.');
    }
    await safe(ctx, () => ctx.deleteMessage(msg.message_id));
    return;
  }

  await ctx.chatAction('typing');

  const detected = detectFileType(target);
  if (!detected) {
    await warn(ctx, 'No recognizable file found in the replied message.', { messageKeys: Object.keys(target) });
    await ctx.reply('❌ No recognizable file found in that message.');
    return;
  }

  const { type, file, extra, kind } = detected;
  const options = getConversionOptions(kind);

  const cacheId = makeId();
  await safe(ctx, () => cache.set(CACHE_PREFIX + cacheId, {
    kind,
    file,
    chatId: msg.chat.id,
    messageId: target.message_id,
  }, CACHE_TTL_MS), 'cache.set failed while storing file entry');

  const lines = [
    `📁 <b>Detected type:</b> ${type}`,
    file.file_name ? `📝 <b>Name:</b> ${file.file_name}` : null,
    file.mime_type  ? `🧩 <b>MIME:</b> ${file.mime_type}` : null,
    file.file_size  ? `📦 <b>Size:</b> ${formatBytes(file.file_size)}` : null,
    extra || null,
  ].filter(Boolean);

  if (DEBUG) {
    lines.push(`\n🐞 <b>[debug]</b> kind=<code>${kind}</code> cacheId=<code>${cacheId}</code> options=<code>${options.map(o => o.format).join(',') || 'none'}</code>`);
  }

  if (!options.length) {
    lines.push('\nℹ️ No conversions available for this file type.');
    await ctx.replyWithHTML(lines.join('\n'));
    return;
  }

  const buttons = options.map(opt => ([{
    text: opt.label,
    callback_data: `link:${cacheId}:${opt.format}`,
  }]));
  buttons.push([{ text: '❌ Cancel', callback_data: `link:${cacheId}:cancel` }]);

  await ctx.reply(lines.join('\n'), {
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: buttons },
  });
}

// ── Callback handler ────────────────────────────────────────────────────
async function onCallback(ctx, cq) {
  const [, cacheId, format] = cq.data.split(':');
  const entry = await safe(ctx, () => cache.get(CACHE_PREFIX + cacheId), 'cache.get failed in onCallback');

  if (!entry) {
    await ctx.answerCallback(cq.id, '⚠️ This request expired, run /link again.', true);
    if (DEBUG) await ctx.reply(`🐞 [debug] cache miss for cacheId=${cacheId}`);
    return;
  }

  if (format === 'cancel') {
    await ctx.answerCallback(cq.id, 'Cancelled.');
    await ctx.deleteMessage(ctx.messageId);
    await safe(ctx, () => cache.delete(CACHE_PREFIX + cacheId));
    return;
  }

  await ctx.answerCallback(cq.id, `Converting to ${format}...`);
  await ctx.editText(ctx.messageId, `⏳ Converting to <b>${format}</b>...`, { parse_mode: 'HTML' });

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'link-'));
  const inputPath = path.join(tmpDir, `input${extOf(entry.file.file_name) || ''}`);
  const outputPath = path.join(tmpDir, `output.${format}`);

  try {
    await ctx.downloadFile(entry.file.file_id, inputPath);

    const ffmpegCmd = `ffmpeg -y -i "${inputPath}" "${outputPath}"`;
    if (DEBUG) await ctx.reply(`🐞 [debug] running: <code>${escapeHtml(ffmpegCmd)}</code>`, { parse_mode: 'HTML' });

    const { stdout, stderr } = await execAsync(ffmpegCmd);

    if (DEBUG && stderr) {
      await sendChunked(ctx, `🐞 [debug] ffmpeg stderr (usually just progress/log, not fatal):\n<code>${escapeHtml(stderr)}</code>`);
    }

    const sendType = guessSendType(format);
    await ctx.sendMediaFile(outputPath, sendType, {
      caption: `✅ Converted to .${format}`,
    });

    await ctx.editText(ctx.messageId, `✅ Done — converted to <b>${format}</b>.`, { parse_mode: 'HTML' });
  } catch (err) {
    await ctx.editText(ctx.messageId, `❌ Conversion failed: <code>${escapeHtml(err.message)}</code>`, { parse_mode: 'HTML' });

    if (DEBUG) {
      const details = [
        `🐞 <b>[debug] Conversion error</b>`,
        `<b>Message:</b> <code>${escapeHtml(err.message)}</code>`,
        err.cmd ? `<b>Command:</b> <code>${escapeHtml(err.cmd)}</code>` : null,
        err.code !== undefined ? `<b>Exit code:</b> <code>${err.code}</code>` : null,
        err.stderr ? `<b>stderr:</b>\n<code>${escapeHtml(String(err.stderr).slice(0, 1500))}</code>` : null,
      ].filter(Boolean).join('\n');
      await sendChunked(ctx, details);
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    await safe(ctx, () => cache.delete(CACHE_PREFIX + cacheId));
  }
}

// ── Debug helpers ────────────────────────────────────────────────────────

// Wrap a step; on failure, log to chat if DEBUG, otherwise swallow/log to console.
async function safe(ctx, fn, label = '') {
  try {
    return await fn();
  } catch (err) {
    console.error(`[link] ${label}:`, err);
    if (DEBUG) {
      await ctx.reply(
        `🐞 <b>[debug] ${escapeHtml(label || 'Error')}</b>\n<code>${escapeHtml(err.message)}</code>`,
        { parse_mode: 'HTML' }
      ).catch(() => {}); // never let debug logging itself crash the handler
    }
    return null;
  }
}

// Log a non-fatal warning — only visible in chat when DEBUG is on.
async function warn(ctx, message, meta) {
  console.warn(`[link] WARN: ${message}`, meta || '');
  if (DEBUG) {
    const extra = meta ? `\n<code>${escapeHtml(JSON.stringify(meta))}</code>` : '';
    await ctx.reply(`⚠️ <b>[debug warn]</b> ${escapeHtml(message)}${extra}`, { parse_mode: 'HTML' }).catch(() => {});
  }
}

// Telegram messages cap at 4096 chars — split long debug dumps.
async function sendChunked(ctx, text, limit = 3500) {
  for (let i = 0; i < text.length; i += limit) {
    await ctx.reply(text.slice(i, i + limit), { parse_mode: 'HTML' }).catch(() => {});
  }
}

// ── Helper: walk the replied message and find the file ────────────────────
function detectFileType(msg) {
  if (msg.photo && msg.photo.length) {
    const largest = msg.photo[msg.photo.length - 1];
    return { type: 'Photo 🖼', file: largest, kind: 'photo' };
  }
  if (msg.video) return { type: 'Video 🎥', file: msg.video, kind: 'video' };
  if (msg.video_note) return { type: 'Video Note ⭕', file: msg.video_note, kind: 'video' };
  if (msg.animation) return { type: 'GIF/Animation 🎞', file: msg.animation, kind: 'animation' };
  if (msg.audio) {
    return {
      type: 'Audio 🎵',
      file: msg.audio,
      kind: 'audio',
      extra: msg.audio.performer || msg.audio.title
        ? `🎤 <b>Track:</b> ${[msg.audio.performer, msg.audio.title].filter(Boolean).join(' - ')}`
        : null,
    };
  }
  if (msg.voice) return { type: 'Voice Note 🎙', file: msg.voice, kind: 'audio' };
  if (msg.sticker) {
    return {
      type: msg.sticker.is_animated ? 'Animated Sticker 🌀' : 'Sticker 🏷',
      file: msg.sticker,
      kind: 'sticker',
      extra: msg.sticker.emoji ? `😀 <b>Emoji:</b> ${msg.sticker.emoji}` : null,
    };
  }
  if (msg.document) {
    const kind = guessDocKind(msg.document);
    return { type: `Document 📄 (${kind})`, file: msg.document, kind };
  }
  return null;
}

// ── Helper: what conversions to offer per detected kind ────────────────────
function getConversionOptions(kind) {
  switch (kind) {
    case 'photo':     return [
      { label: '🖼 JPG', format: 'jpg' },
      { label: '🖼 PNG', format: 'png' },
      { label: '🖼 WebP', format: 'webp' },
    ];
    case 'video':      return [
      { label: '🎬 MP4', format: 'mp4' },
      { label: '🎵 MP3 (extract audio)', format: 'mp3' },
      { label: '🎞 GIF', format: 'gif' },
    ];
    case 'animation':  return [
      { label: '🎬 MP4', format: 'mp4' },
      { label: '🎞 GIF', format: 'gif' },
    ];
    case 'audio':      return [
      { label: '🎵 MP3', format: 'mp3' },
      { label: '🎵 OGG', format: 'ogg' },
      { label: '🎬 MP4 (audio-only)', format: 'mp4' },
    ];
    case 'image':      return [
      { label: '🖼 JPG', format: 'jpg' },
      { label: '🖼 PNG', format: 'png' },
    ];
    default: return [];
  }
}

function guessDocKind(doc) {
  const mime = doc.mime_type || '';
  const name = doc.file_name || '';
  const ext = name.split('.').pop()?.toLowerCase();

  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime === 'application/pdf' || ext === 'pdf') return 'pdf';
  if (mime.includes('zip') || ['zip', 'rar', '7z'].includes(ext)) return 'archive';
  if (mime.includes('word') || ['doc', 'docx'].includes(ext)) return 'word doc';
  if (mime.includes('sheet') || ['xls', 'xlsx', 'csv'].includes(ext)) return 'spreadsheet';
  if (['js', 'py', 'json', 'ts', 'html', 'css'].includes(ext)) return 'code';
  if (ext === 'txt') return 'text';
  return ext ? ext.toUpperCase() : 'unknown';
}

function guessSendType(format) {
  if (['jpg', 'jpeg', 'png', 'webp'].includes(format)) return 'photo';
  if (['mp4', 'gif'].includes(format)) return 'video';
  if (['mp3', 'ogg', 'wav', 'm4a'].includes(format)) return 'audio';
  return 'document';
}

function extOf(filename) {
  if (!filename) return '';
  const i = filename.lastIndexOf('.');
  return i >= 0 ? filename.slice(i) : '';
}

function makeId() {
  return Math.random().toString(36).slice(2, 8);
}

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${units[i]}`;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}