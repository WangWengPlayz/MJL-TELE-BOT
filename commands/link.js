// ============================================================
//  /link — detect a replied file's type and convert it
// ============================================================

const { exec } = require('child_process');
const util = require('util');
const path = require('path');
const fs = require('fs');
const execAsync = util.promisify(exec);

// Short-lived cache so callback_data stays under Telegram's 64-byte limit.
// key: short id → { type, file, chatId, messageId, expires }
const fileCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 min

module.exports = {
  name:        'link',
  execute,

  version:     '2.0.0',
  description: 'Reply to a file to detect its type, then convert it to another format.',
  usage:       '/link (as a reply to a photo/video/document/audio/voice/animation)',
  category:    'Utility',
  aliases:     ['detect', 'ftype', 'convert'],

  callbackPrefix: 'link:',
  onCallback,
};

// ── Main handler ─────────────────────────────────────────────────────────
async function execute(ctx) {
  const { raw: msg } = ctx;
  const target = msg.reply_to_message;

  // No reply → nothing to do, just clean the chat up.
  if (!target) {
    await ctx.deleteMessage(msg.message_id);
    return;
  }

  await ctx.chatAction('typing');

  const detected = detectFileType(target);
  if (!detected) {
    await ctx.reply('❌ No recognizable file found in that message.');
    return;
  }

  const { type, file, extra, kind } = detected;
  const options = getConversionOptions(kind);

  const cacheId = makeId();
  fileCache.set(cacheId, {
    kind,
    file,
    chatId: msg.chat.id,
    messageId: target.message_id,
    expires: Date.now() + CACHE_TTL_MS,
  });
  cleanupCache();

  const lines = [
    `📁 <b>Detected type:</b> ${type}`,
    file.file_name ? `📝 <b>Name:</b> ${file.file_name}` : null,
    file.mime_type  ? `🧩 <b>MIME:</b> ${file.mime_type}` : null,
    file.file_size  ? `📦 <b>Size:</b> ${formatBytes(file.file_size)}` : null,
    extra || null,
  ].filter(Boolean);

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
  const entry = fileCache.get(cacheId);

  if (!entry || entry.expires < Date.now()) {
    await ctx.answerCallback(cq.id, '⚠️ This request expired, run /link again.', true);
    return;
  }

  if (format === 'cancel') {
    await ctx.answerCallback(cq.id, 'Cancelled.');
    await ctx.deleteMessage(ctx.messageId);
    fileCache.delete(cacheId);
    return;
  }

  await ctx.answerCallback(cq.id, `Converting to ${format}...`);
  await ctx.editText(ctx.messageId, `⏳ Converting to <b>${format}</b>...`, { parse_mode: 'HTML' });

  const tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'link-'));
  const inputPath = path.join(tmpDir, `input${extOf(entry.file.file_name) || ''}`);
  const outputPath = path.join(tmpDir, `output.${format}`);

  try {
    await ctx.downloadFile(entry.file.file_id, inputPath);

    // Requires ffmpeg installed on the host.
    await execAsync(`ffmpeg -y -i "${inputPath}" "${outputPath}"`);

    const sendType = guessSendType(format);
    await ctx.sendMediaFile(outputPath, sendType, {
      caption: `✅ Converted to .${format}`,
    });

    await ctx.editText(ctx.messageId, `✅ Done — converted to <b>${format}</b>.`, { parse_mode: 'HTML' });
  } catch (err) {
    await ctx.editText(ctx.messageId, `❌ Conversion failed: <code>${escapeHtml(err.message)}</code>`, { parse_mode: 'HTML' });
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fileCache.delete(cacheId);
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
    default: return []; // e.g. archives, code, unknown docs — no conversion offered
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

function cleanupCache() {
  const now = Date.now();
  for (const [id, entry] of fileCache) {
    if (entry.expires < now) fileCache.delete(id);
  }
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