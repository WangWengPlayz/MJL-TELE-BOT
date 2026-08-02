const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const { convertAudio, audioToMp4, videoToMp4, videoToMp4Fast } = require('../lib/ffmpeg');

const TMP_DIR = path.join(__dirname, 'cache', 'tmp');
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

// Telegram bot upload limit (50 MB)
const TG_MAX_BYTES = 50 * 1024 * 1024;

// Pending button-state keyed by requestId
const pending = new Map();
// Dedup: prevent two simultaneous jobs on the same source message
const processingMessages = new Set();

// ── Format definitions ────────────────────────────────────────────────────────

/** All supported output formats with their display label. */
const FORMATS = [
  { id: 'mp4',  label: '🎥 MP4',  ext: 'mp4',  kind: 'video' },
  { id: 'mp3',  label: '🎵 MP3',  ext: 'mp3',  kind: 'audio' },
  { id: 'aac',  label: '🎵 AAC',  ext: 'm4a',  kind: 'audio' },
  { id: 'ogg',  label: '🎵 OGG',  ext: 'ogg',  kind: 'audio' },
  { id: 'wav',  label: '🎵 WAV',  ext: 'wav',  kind: 'audio' },
  { id: 'flac', label: '🎵 FLAC', ext: 'flac', kind: 'audio' },
];

const FORMAT_MAP = Object.fromEntries(FORMATS.map(f => [f.id, f]));

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let val = bytes / 1024, i = 0;
  while (val >= 1024 && i < units.length - 1) { val /= 1024; i++; }
  return `${val.toFixed(2)} ${units[i]}`;
}

/**
 * Detect whether the replied-to message contains supported media.
 * Returns { kind: 'video'|'audio', file, mime, srcExt } or null.
 */
function detectMedia(msg) {
  if (msg.video)      return { kind: 'video', file: msg.video,      mime: 'video/mp4',  srcExt: '.mp4'  };
  if (msg.video_note) return { kind: 'video', file: msg.video_note, mime: 'video/mp4',  srcExt: '.mp4'  };
  if (msg.audio)      return { kind: 'audio', file: msg.audio,      mime: 'audio/mpeg', srcExt: extOf(msg.audio.file_name, '.mp3')  };
  if (msg.voice)      return { kind: 'audio', file: msg.voice,      mime: 'audio/ogg',  srcExt: '.ogg'  };

  if (msg.document) {
    const mime = msg.document.mime_type || '';
    const ext  = extOf(msg.document.file_name, '.bin');
    if (mime.startsWith('video/')) return { kind: 'video', file: msg.document, mime, srcExt: ext };
    if (mime.startsWith('audio/')) return { kind: 'audio', file: msg.document, mime, srcExt: ext };

    // Unknown MIME — try to infer from extension
    const audioExts = ['.mp3', '.aac', '.m4a', '.ogg', '.opus', '.flac', '.wav', '.wma', '.alac'];
    const videoExts = ['.mp4', '.mkv', '.mov', '.avi', '.webm', '.flv', '.wmv', '.3gp', '.ts'];
    if (audioExts.includes(ext.toLowerCase())) return { kind: 'audio', file: msg.document, mime: 'audio/*', srcExt: ext };
    if (videoExts.includes(ext.toLowerCase())) return { kind: 'video', file: msg.document, mime: 'video/*', srcExt: ext };
  }

  return null;
}

function extOf(filename, fallback = '') {
  if (!filename) return fallback;
  const e = path.extname(filename);
  return e || fallback;
}

/**
 * Build an inline keyboard for format selection.
 * Puts buttons in rows of 3, cancel at the bottom.
 */
function buildFormatKeyboard(requestId) {
  const rows = [];
  for (let i = 0; i < FORMATS.length; i += 3) {
    rows.push(
      FORMATS.slice(i, i + 3).map(f => ({
        text: f.label,
        callback_data: `link:${f.id}:${requestId}`,
      }))
    );
  }
  rows.push([{ text: '❌ Cancel', callback_data: `link:cancel:${requestId}` }]);
  return { inline_keyboard: rows };
}

function mapErrorToUserMessage(err) {
  const msg = err.message || '';
  if (msg.includes('FFmpeg failed to start') || (msg.includes('ENOENT') && msg.includes('ffmpeg')))
    return 'FFmpeg is not installed on this server. Contact the bot admin.';
  if (msg.includes('FFmpeg exited'))
    return `Conversion failed — the file may be corrupted or in an unsupported format.\n\n<code>${msg.slice(-200)}</code>`;
  if (msg.includes('too large') || msg.includes('50 MB'))
    return 'The output file exceeds Telegram\'s 50 MB upload limit.';
  if (msg.includes('Telegram API error'))
    return 'Telegram rejected the upload. The file may be too large or in an unsupported format.';
  if (msg.includes('Failed to download') || msg.includes('ENOENT'))
    return 'Failed to download the source file from Telegram.';
  return `Something went wrong: ${msg.slice(0, 200)}`;
}

// ── Command export ─────────────────────────────────────────────────────────────

module.exports = {
  name:        'link',
  version:     '3.0.0',
  description: 'Convert replied media to MP4, MP3, AAC, OGG, WAV, or FLAC.',
  usage:       '/link  (reply to a video, audio, voice, or media document)',
  aliases:     [],
  callbackPrefix: 'link:',

  async execute(ctx) {
    const msg     = ctx.raw;
    const replied = msg.reply_to_message;

    if (!replied) {
      return ctx.replyWithHTML(
        '❌ Please <b>reply to a media message</b> before using /link.\n\n' +
        'Supported input: video, audio, voice message, video note, or a document file ' +
        '(mp4, mkv, mov, avi, mp3, aac, ogg, wav, flac, …)'
      );
    }

    const media = detectMedia(replied);
    if (!media) {
      return ctx.replyWithHTML(
        '❌ Unsupported media type.\n\n' +
        'Supported: video, audio, voice note, video note, or document with a recognised video/audio extension.'
      );
    }

    const sourceKey = `${msg.chat.id}:${replied.message_id}`;
    if (processingMessages.has(sourceKey)) {
      return ctx.reply('⏳ This file is already being processed. Please wait.');
    }

    const requestId = crypto.randomBytes(6).toString('hex');
    pending.set(requestId, {
      initiatorId: msg.from.id,
      chatId:      msg.chat.id,
      media,
      sourceKey,
      createdAt:   Date.now(),
    });

    const kindLabel = media.kind === 'video' ? '🎬 Video' : '🎵 Audio';
    const sent = await ctx.replyWithHTML(
      `${kindLabel} detected. Choose an output format:`,
      { reply_markup: buildFormatKeyboard(requestId) }
    );

    pending.get(requestId).messageId = sent.message_id;
  },

  async onCallback(ctx, cq) {
    const parts     = cq.data.split(':');
    const action    = parts[1];  // format id or 'cancel'
    const requestId = parts[2];

    const state = pending.get(requestId);
    if (!state) {
      return ctx.answerCallback(cq.id, '⏱ This request has expired. Run /link again.', true);
    }
    if (cq.from.id !== state.initiatorId) {
      return ctx.answerCallback(cq.id, '🚫 Only the person who ran /link can choose.', true);
    }

    // ── Cancel ──────────────────────────────────────────────────────────────
    if (action === 'cancel') {
      pending.delete(requestId);
      await ctx.answerCallback(cq.id);
      return ctx.editText(state.messageId, '❌ Conversion cancelled.');
    }

    // ── Validate format ──────────────────────────────────────────────────────
    const fmt = FORMAT_MAP[action];
    if (!fmt) {
      return ctx.answerCallback(cq.id, 'Unknown format.', true);
    }

    if (processingMessages.has(state.sourceKey)) {
      return ctx.answerCallback(cq.id, '⏳ Already processing — please wait.', true);
    }

    processingMessages.add(state.sourceKey);
    pending.delete(requestId);
    await ctx.answerCallback(cq.id);

    // Paths
    const { media } = state;
    const srcExt    = media.srcExt || '.bin';
    const srcPath   = path.join(TMP_DIR, `${requestId}_src${srcExt}`);
    const outPath   = path.join(TMP_DIR, `${requestId}_out.${fmt.ext}`);

    const origName  = media.file.file_name || `media_${requestId}${srcExt}`;
    const baseName  = path.parse(origName).name || requestId;
    const finalName = `${baseName}.${fmt.ext}`;

    try {
      // ── Step 1: Download ───────────────────────────────────────────────────
      await ctx.editText(state.messageId,
        '⏳ <b>Processing…</b>\n\n⬇️ Downloading…\n⏸ Converting…\n⏸ Uploading…',
        { parse_mode: 'HTML' }
      );

      await ctx.downloadFile(media.file.file_id, srcPath);

      // ── Step 2: Convert ────────────────────────────────────────────────────
      await ctx.editText(state.messageId,
        `⏳ <b>Processing…</b>\n\n✅ Downloaded\n🔄 Converting to <b>${fmt.ext.toUpperCase()}</b>…\n⏸ Uploading…`,
        { parse_mode: 'HTML' }
      );

      const isNoop = isPassthrough(media, fmt);

      if (!isNoop) {
        if (fmt.id === 'mp4') {
          if (media.kind === 'audio') {
            // Audio → MP4 with black background
            await audioToMp4(srcPath, outPath);
          } else {
            // Video → MP4 (fast copy, falls back to re-encode)
            await videoToMp4Fast(srcPath, outPath);
          }
        } else {
          // Any → audio format
          await convertAudio(srcPath, outPath, fmt.id === 'aac' ? 'aac' : fmt.id);
        }
      }

      const finalPath = isNoop ? srcPath : outPath;
      const fileSize  = fs.statSync(finalPath).size;

      if (fileSize > TG_MAX_BYTES) {
        throw new Error(`Output file is ${formatBytes(fileSize)}, which exceeds Telegram's 50 MB upload limit.`);
      }

      // ── Step 3: Upload ─────────────────────────────────────────────────────
      await ctx.editText(state.messageId,
        `⏳ <b>Processing…</b>\n\n✅ Downloaded\n✅ Converted\n📤 Uploading <b>${formatBytes(fileSize)}</b>…`,
        { parse_mode: 'HTML' }
      );

      const telegramType = fmt.kind === 'video' ? 'video' : 'audio';
      await ctx.sendMediaFile(finalPath, telegramType, {
        caption: [
          `✅ <b>Conversion complete!</b>`,
          ``,
          `📁 Format: <b>${fmt.ext.toUpperCase()}</b>`,
          `📦 Size: ${formatBytes(fileSize)}`,
          `🗂 File: <code>${finalName}</code>`,
          ``,
          `🤖 <i>MJL Bot</i>`,
        ].join('\n'),
        parse_mode: 'HTML',
      });

      await ctx.editText(state.messageId, '✅ Done! File sent above.');

    } catch (err) {
      console.error(`[link] ${state.sourceKey}:`, err.message);
      await ctx.editText(
        state.messageId,
        `❌ <b>Failed:</b>\n${mapErrorToUserMessage(err)}`,
        { parse_mode: 'HTML' }
      ).catch(() => {});
    } finally {
      processingMessages.delete(state.sourceKey);
      // Clean up all temp files for this request
      try {
        fs.readdirSync(TMP_DIR)
          .filter(f => f.startsWith(requestId))
          .forEach(f => { try { fs.unlinkSync(path.join(TMP_DIR, f)); } catch {} });
      } catch {}
    }
  },
};

// ── Passthrough detection ─────────────────────────────────────────────────────
// Returns true when the source file is already the target format and no
// re-encode is needed (we just send the original download).
function isPassthrough(media, fmt) {
  const srcExt = (media.srcExt || '').toLowerCase().replace('.', '');

  const VIDEO_PASSTHROUGH = { mp4: ['mp4'] };
  const AUDIO_PASSTHROUGH = {
    mp3:  ['mp3'],
    aac:  ['aac', 'm4a'],
    ogg:  ['ogg', 'opus'],
    wav:  ['wav'],
    flac: ['flac'],
  };

  if (fmt.id === 'mp4' && media.kind === 'video') {
    return (VIDEO_PASSTHROUGH.mp4 || []).includes(srcExt);
  }
  if (fmt.kind === 'audio') {
    return (AUDIO_PASSTHROUGH[fmt.id] || []).includes(srcExt);
  }
  return false;
}
