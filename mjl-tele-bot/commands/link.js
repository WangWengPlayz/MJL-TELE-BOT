const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { audioToMp4, toMp3 } = require('../lib/ffmpeg');

const TMP_DIR = path.join(__dirname, 'cache', 'tmp');
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

// In-memory state for pending requests, keyed by requestId
const pending = new Map();
// Prevent duplicate processing of the same source message
const processingMessages = new Set();

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let val = bytes / 1024;
  let i = 0;
  while (val >= 1024 && i < units.length - 1) {
    val /= 1024;
    i++;
  }
  return `${val.toFixed(2)} ${units[i]}`;
}

function detectMedia(msg) {
  if (msg.video) return { type: 'video', file: msg.video };
  if (msg.video_note) return { type: 'video_note', file: msg.video_note };
  if (msg.audio) return { type: 'audio', file: msg.audio };
  if (msg.voice) return { type: 'voice', file: msg.voice };
  if (msg.document) {
    const mime = msg.document.mime_type || '';
    if (mime.startsWith('video/') || mime.startsWith('audio/')) {
      return { type: 'document', file: msg.document, mime };
    }
  }
  return null;
}

module.exports = {
  name: 'link',
  version: '2.0.0',
  description: 'Convert replied media to MP4 or MP3 and send it back.',
  usage: '/link (reply to a video, audio, voice, music, or document)',
  aliases: [],
  callbackPrefix: 'link:',

  async execute(ctx) {
    const msg = ctx.raw;
    const replied = msg.reply_to_message;

    if (!replied) {
      return ctx.reply(
        '❌ Please reply to a video, audio, voice, music, or supported document before using /link.'
      );
    }

    const media = detectMedia(replied);
    if (!media) {
      return ctx.reply(
        '❌ Please reply to a video, audio, voice, music, or supported document before using /link.'
      );
    }

    const sourceKey = `${msg.chat.id}:${replied.message_id}`;
    if (processingMessages.has(sourceKey)) {
      return ctx.reply('⏳ This media is already being processed. Please wait.');
    }

    const requestId = crypto.randomBytes(6).toString('hex');
    pending.set(requestId, {
      initiatorId: msg.from.id,
      chatId: msg.chat.id,
      media,
      sourceKey,
      createdAt: Date.now(),
    });

    const sent = await ctx.reply('📁 Choose the output format:', {
      reply_markup: {
        inline_keyboard: [
          [
            { text: '🎥 MP4', callback_data: `link:mp4:${requestId}` },
            { text: '🎵 MP3', callback_data: `link:mp3:${requestId}` },
          ],
          [{ text: '❌ Cancel', callback_data: `link:cancel:${requestId}` }],
        ],
      },
    });

    pending.get(requestId).messageId = sent.message_id;
  },

  async onCallback(ctx, cq) {
    const [, action, requestId] = cq.data.split(':');
    const state = pending.get(requestId);

    if (!state) {
      return ctx.answerCallback(cq.id, 'This request has expired.', true);
    }

    if (cq.from.id !== state.initiatorId) {
      return ctx.answerCallback(cq.id, 'Only the person who ran /link can use this.', true);
    }

    if (action === 'cancel') {
      pending.delete(requestId);
      await ctx.answerCallback(cq.id);
      return ctx.editText(state.messageId, '❌ Operation cancelled.');
    }

    if (action !== 'mp4' && action !== 'mp3') {
      return ctx.answerCallback(cq.id, 'Unknown action.', true);
    }

    if (processingMessages.has(state.sourceKey)) {
      return ctx.answerCallback(cq.id, 'Already processing.', true);
    }

    processingMessages.add(state.sourceKey);
    pending.delete(requestId);
    await ctx.answerCallback(cq.id);

    let downloadPath;
    try {
      await ctx.editText(
        state.messageId,
        '⏳ Processing...\n\n• Downloading media...\n• Converting...\n• Uploading...'
      );

      const { type, file } = state.media;
      const ext = path.extname(file.file_name || '') || '';
      downloadPath = path.join(TMP_DIR, `${requestId}_src${ext || '.bin'}`);

      // Download step
      await ctx.downloadFile(file.file_id, downloadPath);

      await ctx.editText(
        state.messageId,
        '⏳ Processing...\n\n✅ Downloaded\n• Converting...\n• Uploading...'
      );

      let outputPath;
      let outputFormat;
      const originalName = file.file_name || `${type}_${requestId}`;

      if (action === 'mp4') {
        if (type === 'video' || type === 'video_note') {
          outputPath = downloadPath;
          outputFormat = 'mp4';
        } else if (type === 'document' && state.media.mime && state.media.mime.startsWith('video/')) {
          outputPath = downloadPath;
          outputFormat = 'mp4';
        } else {
          outputPath = path.join(TMP_DIR, `${requestId}_out.mp4`);
          await convertWithErrorHandling(() => audioToMp4(downloadPath, outputPath));
          outputFormat = 'mp4';
        }
      } else {
        if (type === 'audio' && /\.mp3$/i.test(originalName)) {
          outputPath = downloadPath;
          outputFormat = 'mp3';
        } else {
          outputPath = path.join(TMP_DIR, `${requestId}_out.mp3`);
          await convertWithErrorHandling(() => toMp3(downloadPath, outputPath));
          outputFormat = 'mp3';
        }
      }

      const finalName = `${path.parse(originalName).name || requestId}.${outputFormat}`;
      const fileSize = fs.statSync(outputPath).size;

      await ctx.editText(
        state.messageId,
        '⏳ Processing...\n\n✅ Downloaded\n✅ Converted\n• Uploading to Telegram...'
      );

      const telegramType = outputFormat === 'mp4' ? 'video' : 'audio';
      await ctx.sendMediaFile(outputPath, telegramType, {
        caption: [
          '✅ Conversion Complete!',
          '',
          `Format: ${outputFormat.toUpperCase()}`,
          '',
          'Filename:',
          finalName,
          '',
          'File Size:',
          formatBytes(fileSize),
        ].join('\n'),
      });

      await ctx.editText(state.messageId, '✅ Done! File sent above.');
    } catch (err) {
      console.error(`[link] Error processing ${state.sourceKey}:`, err.message);
      const userMessage = mapErrorToUserMessage(err);
      await ctx.editText(state.messageId, `❌ ${userMessage}`).catch(() => {});
    } finally {
      processingMessages.delete(state.sourceKey);
      cleanupTmpFiles(requestId);
    }
  },
};

async function convertWithErrorHandling(fn) {
  try {
    await fn();
  } catch (err) {
    throw new Error(`FFmpeg conversion failed: ${err.message}`);
  }
}

function mapErrorToUserMessage(err) {
  const msg = err.message || '';
  if (msg.includes('FFmpeg conversion failed')) return 'Failed to convert the media. It may be corrupted or in an unsupported format.';
  if (msg.includes('Failed to download')) return 'Failed to download the media from Telegram.';
  if (msg.includes('ENOENT') && msg.includes('ffmpeg')) return 'Server is missing FFmpeg. Please contact the bot admin.';
  if (msg.toLowerCase().includes('too large')) return 'The file is too large to process or upload (Telegram limits apply).';
  if (msg.includes('Telegram API error')) return 'Telegram rejected the upload. The file may be too large or in an unsupported format.';
  return 'Something went wrong while processing your media. Please try again.';
}

function cleanupTmpFiles(requestId) {
  try {
    const files = fs.readdirSync(TMP_DIR).filter((f) => f.startsWith(requestId));
    for (const f of files) {
      fs.unlinkSync(path.join(TMP_DIR, f));
    }
  } catch (err) {
    console.error('Cleanup error:', err.message);
  }
}