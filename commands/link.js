const { exec } = require('child_process');
const util = require('util');
const path = require('path');
const fs = require('fs');
const os = require('os');
const execAsync = util.promisify(exec);

const cache = require('./cache');

const CACHE_PREFIX = 'link:';
const CACHE_TTL_MS = 5 * 60 * 1000;

let DEBUG = false;

module.exports = {
  name:        'link',
  execute,

  version:     '2.2.0',
  description: 'Reply to a file to detect its type, then convert it to another format.',
  usage:       '/link (as a reply to a file) | /link debug on|off',
  category:    'Utility',
  aliases:     ['detect', 'ftype', 'convert'],

  callbackPrefix: 'link:',
  onCallback,
};

async function execute(ctx) {
  const { args, raw: msg } = ctx;

  if (args[0] === 'debug') {
    DEBUG = args[1] === 'on';
    await ctx.reply(`🐞 Debug mode ${DEBUG ? 'enabled ✅' : 'disabled ❌'}`);
    return;
  }

  const target = msg.reply_to_message;
  if (!target) {
    if (DEBUG) await ctx.reply('⚠️ [debug] /link used without a reply — nothing to detect.');
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
  const options = getConversionOptions(kind, file);

  const cacheId = makeId();
  await safe(ctx, () => cache.set(CACHE_PREFIX + cacheId, {
    kind,
    file,
    chatId: msg.chat.id,
    messageId: target.message_id,
  }, CACHE_TTL_MS), 'cache.set failed');

  const lines = [
    `📁 <b>Detected type:</b> ${escapeHtml(type)}`,
    file.file_name ? `📝 <b>Name:</b> <code>${escapeHtml(file.file_name)}</code>` : null,
    file.mime_type  ? `🧩 <b>MIME:</b> <code>${escapeHtml(file.mime_type)}</code>` : null,
    file.file_size  ? `📦 <b>Size:</b> ${formatBytes(file.file_size)}` : null,
    extra || null,
  ].filter(Boolean);

  if (DEBUG) {
    lines.push(
      `\n🐞 <b>[debug]</b> kind=<code>${escapeHtml(kind)}</code> ` +
      `cacheId=<code>${escapeHtml(cacheId)}</code> ` +
      `options=<code>${options.map(o => o.format).join(',') || 'none'}</code>`
    );
  }

  if (!options.length) {
    lines.push('\nℹ️ No conversions available for this file type.');
    await ctx.replyWithHTML(lines.join('\n'));
    return;
  }

  const buttons = options.map(opt => ([{
    text: opt.label,
    callback_data: `link:\( {cacheId}: \){opt.format}`,
  }]));
  buttons.push([{ text: '❌ Cancel', callback_data: `link:${cacheId}:cancel` }]);

  await ctx.replyWithHTML(lines.join('\n'), {
    reply_markup: { inline_keyboard: buttons },
  });
}

async function onCallback(ctx, cq) {
  const parts = cq.data.split(':');
  const cacheId = parts[1];
  const format  = parts[2];

  const entry = await safe(ctx, () => cache.get(CACHE_PREFIX + cacheId), 'cache.get failed');

  if (!entry) {
    await ctx.answerCallback(cq.id, '⚠️ This request expired — run /link again.', true);
    if (DEBUG) await ctx.reply(`🐞 [debug] cache miss for cacheId=${cacheId}`);
    return;
  }

  if (format === 'cancel') {
    await ctx.answerCallback(cq.id, 'Cancelled.');
    await safe(ctx, () => ctx.deleteMessage(ctx.messageId));
    await safe(ctx, () => cache.delete(CACHE_PREFIX + cacheId));
    return;
  }

  await ctx.answerCallback(cq.id, `Converting to ${format}…`);
  await ctx.editText(ctx.messageId, `⏳ Converting to <b>${escapeHtml(format)}</b>…`, { parse_mode: 'HTML' });

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'link-'));
  const inputExt = extOf(entry.file.file_name) || guessExtFromKind(entry.kind);
  const inputPath  = path.join(tmpDir, `input${inputExt}`);
  const outputPath = path.join(tmpDir, `output.${format}`);

  try {
    await ctx.downloadFile(entry.file.file_id, inputPath);

    const cmd = buildFfmpegCommand(inputPath, outputPath, format, entry.kind);
    if (DEBUG) {
      await ctx.reply(`🐞 [debug] running:\n<code>${escapeHtml(cmd)}</code>`, { parse_mode: 'HTML' });
    }

    const { stderr } = await execAsync(cmd, { maxBuffer: 20 * 1024 * 1024 });

    if (DEBUG && stderr) {
      await sendChunked(ctx, `🐞 [debug] ffmpeg stderr:\n<code>${escapeHtml(stderr.slice(0, 3000))}</code>`);
    }

    if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size === 0) {
      throw new Error('ffmpeg produced an empty file');
    }

    const sendType = guessSendType(format);
    await ctx.sendMediaFile(outputPath, sendType, {
      caption: `✅ Converted to .${format}`,
    });

    await ctx.editText(ctx.messageId, `✅ Done — converted to <b>${escapeHtml(format)}</b>.`, { parse_mode: 'HTML' });
  } catch (err) {
    const msg = err.message || String(err);
    await ctx.editText(
      ctx.messageId,
      `❌ Conversion failed:\n<code>${escapeHtml(msg.slice(0, 500))}</code>`,
      { parse_mode: 'HTML' }
    );

    if (DEBUG) {
      const details = [
        `🐞 <b>[debug] Conversion error</b>`,
        `<b>Message:</b> <code>${escapeHtml(msg)}</code>`,
        err.cmd ? `<b>Command:</b> <code>${escapeHtml(err.cmd)}</code>` : null,
        err.code !== undefined ? `<b>Exit code:</b> <code>${err.code}</code>` : null,
        err.stderr ? `<b>stderr:</b>\n<code>${escapeHtml(String(err.stderr).slice(0, 1500))}</code>` : null,
      ].filter(Boolean).join('\n');
      await sendChunked(ctx, details);
    }
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    await safe(ctx, () => cache.delete(CACHE_PREFIX + cacheId));
  }
}

/* ───────────────────── helpers ───────────────────── */

async function safe(ctx, fn, label = '') {
  try {
    return await fn();
  } catch (err) {
    console.error(`[link] ${label}:`, err);
    if (DEBUG) {
      await ctx.reply(
        `🐞 <b>[debug] \( {escapeHtml(label || 'Error')}</b>\n<code> \){escapeHtml(err.message)}</code>`,
        { parse_mode: 'HTML' }
      ).catch(() => {});
    }
    return null;
  }
}

async function warn(ctx, message, meta) {
  console.warn(`[link] WARN: ${message}`, meta || '');
  if (DEBUG) {
    const extra = meta ? `\n<code>${escapeHtml(JSON.stringify(meta))}</code>` : '';
    await ctx.reply(`⚠️ <b>[debug warn]</b> \( {escapeHtml(message)} \){extra}`, { parse_mode: 'HTML' }).catch(() => {});
  }
}

async function sendChunked(ctx, text, limit = 3500) {
  for (let i = 0; i < text.length; i += limit) {
    await ctx.reply(text.slice(i, i + limit), { parse_mode: 'HTML' }).catch(() => {});
  }
}

function detectFileType(msg) {
  if (msg.photo?.length) {
    const largest = msg.photo[msg.photo.length - 1];
    return { type: 'Photo 🖼', file: largest, kind: 'photo' };
  }
  if (msg.video)      return { type: 'Video 🎥', file: msg.video, kind: 'video' };
  if (msg.video_note) return { type: 'Video Note ⭕', file: msg.video_note, kind: 'video' };
  if (msg.animation)  return { type: 'GIF/Animation 🎞', file: msg.animation, kind: 'animation' };
  if (msg.audio) {
    const track = [msg.audio.performer, msg.audio.title].filter(Boolean).join(' – ');
    return {
      type: 'Audio 🎵',
      file: msg.audio,
      kind: 'audio',
      extra: track ? `🎤 <b>Track:</b> ${escapeHtml(track)}` : null,
    };
  }
  if (msg.voice) return { type: 'Voice Note 🎙', file: msg.voice, kind: 'audio' };
  if (msg.sticker) {
    const isAnim = msg.sticker.is_animated || msg.sticker.is_video;
    return {
      type: isAnim ? 'Animated Sticker 🌀' : 'Sticker 🏷',
      file: msg.sticker,
      kind: isAnim ? 'sticker_anim' : 'sticker',
      extra: msg.sticker.emoji ? `😀 <b>Emoji:</b> ${escapeHtml(msg.sticker.emoji)}` : null,
    };
  }
  if (msg.document) {
    const kind = guessDocKind(msg.document);
    return { type: `Document 📄 (${kind})`, file: msg.document, kind };
  }
  return null;
}

function getConversionOptions(kind, file = {}) {
  switch (kind) {
    case 'photo':
    case 'image':
    case 'sticker':
      return [
        { label: '🖼 JPG',  format: 'jpg'  },
        { label: '🖼 PNG',  format: 'png'  },
        { label: '🖼 WebP', format: 'webp' },
      ];
    case 'video':
    case 'animation':
      return [
        { label: '🎬 MP4',               format: 'mp4' },
        { label: '🎵 MP3 (extract audio)', format: 'mp3' },
        { label: '🎞 GIF',               format: 'gif' },
        { label: '🖼 WebP (animated)',   format: 'webp' },
      ];
    case 'audio':
      return [
        { label: '🎵 MP3',            format: 'mp3' },
        { label: '🎵 OGG',            format: 'ogg' },
        { label: '🎵 M4A',            format: 'm4a' },
        { label: '🎬 MP4 (audio only)', format: 'mp4' },
      ];
    case 'sticker_anim':
      // Animated stickers (.tgs / video stickers) are hard; offer best-effort
      return [
        { label: '🎞 GIF (best effort)', format: 'gif' },
        { label: '🎬 MP4 (best effort)', format: 'mp4' },
      ];
    default:
      return [];
  }
}

function buildFfmpegCommand(input, output, format, kind) {
  // Always start with these
  const parts = ['ffmpeg', '-y', '-i', `"${input}"`];

  switch (format) {
    case 'gif':
      // Reasonable quality GIF that Telegram accepts
      parts.push(
        '-vf', '"fps=12,scale=480:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse"',
        '-loop', '0'
      );
      break;

    case 'mp3':
      parts.push('-vn', '-acodec', 'libmp3lame', '-q:a', '2');
      break;

    case 'ogg':
      parts.push('-vn', '-acodec', 'libvorbis', '-q:a', '4');
      break;

    case 'm4a':
      parts.push('-vn', '-acodec', 'aac', '-b:a', '192k');
      break;

    case 'mp4':
      if (kind === 'audio') {
        // Audio → silent black video container (Telegram plays it as video)
        parts.push(
          '-f', 'lavfi', '-i', 'color=c=black:s=640x360:d=3600',
          '-c:v', 'libx264', '-tune', 'stillimage', '-pix_fmt', 'yuv420p',
          '-c:a', 'aac', '-b:a', '192k',
          '-shortest', '-movflags', '+faststart'
        );
      } else {
        // Normal video re-encode (or copy if already mp4-ish)
        parts.push('-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
                   '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart');
      }
      break;

    case 'webp':
      if (kind === 'video' || kind === 'animation' || kind === 'sticker_anim') {
        parts.push('-vcodec', 'libwebp', '-lossless', '0', '-q:v', '70',
                   '-loop', '0', '-preset', 'default', '-an', '-vsync', '0');
      } else {
        parts.push('-c:v', 'libwebp', '-quality', '80');
      }
      break;

    case 'jpg':
    case 'jpeg':
      parts.push('-q:v', '2');           // high quality
      break;

    case 'png':
      // default is fine
      break;

    default:
      // let ffmpeg guess from extension
      break;
  }

  parts.push(`"${output}"`);
  return parts.join(' ');
}

function guessDocKind(doc) {
  const mime = (doc.mime_type || '').toLowerCase();
  const name = (doc.file_name || '').toLowerCase();
  const ext  = name.split('.').pop();

  if (mime.startsWith('image/') || ['jpg','jpeg','png','webp','gif','bmp'].includes(ext)) return 'image';
  if (mime.startsWith('video/') || ['mp4','mov','mkv','webm','avi'].includes(ext)) return 'video';
  if (mime.startsWith('audio/') || ['mp3','ogg','m4a','wav','flac','aac'].includes(ext)) return 'audio';
  if (mime === 'application/pdf' || ext === 'pdf') return 'pdf';
  if (mime.includes('zip') || ['zip','rar','7z','tar','gz'].includes(ext)) return 'archive';
  if (mime.includes('word') || ['doc','docx'].includes(ext)) return 'word';
  if (mime.includes('sheet') || ['xls','xlsx','csv'].includes(ext)) return 'spreadsheet';
  if (['js','ts','py','json','html','css','md','txt'].includes(ext)) return 'code';
  return ext ? ext.toUpperCase() : 'unknown';
}

function guessSendType(format) {
  if (['jpg','jpeg','png','webp'].includes(format)) return 'photo';
  if (['mp4','gif'].includes(format)) return 'video';   // Telegram treats .gif as video/animation
  if (['mp3','ogg','m4a','wav'].includes(format)) return 'audio';
  return 'document';
}

function guessExtFromKind(kind) {
  switch (kind) {
    case 'photo': case 'image': case 'sticker': return '.jpg';
    case 'video': case 'animation': case 'sticker_anim': return '.mp4';
    case 'audio': return '.ogg';
    default: return '';
  }
}

function extOf(filename) {
  if (!filename) return '';
  const i = filename.lastIndexOf('.');
  return i >= 0 ? filename.slice(i) : '';
}

function makeId() {
  return Math.random().toString(36).slice(2, 10);
}

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, i)).toFixed(i ? 1 : 0)} ${units[i]}`;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}