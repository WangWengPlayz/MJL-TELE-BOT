// ============================================================
//  COMMAND  —  link  v1.2
//  Reply to media  OR  /link <url>
//  Smart buttons + Cancel + edit-based status
// ============================================================

const fs   = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);

const CACHE_DIR = path.join(__dirname, 'cache');

module.exports = {
  name:    'link',
  execute,

  version:     '1.2.0',
  description: 'Convert audio ↔ video (reply to file or give URL)',
  usage:       '/link  (reply to media)   or   /link <url>',
  category:    'Media',
  aliases:     ['convert', 'cv'],

  callbackPrefix: 'link:',
  onCallback,
};

// ── Main handler ──────────────────────────────────────────────────────────────
async function execute(ctx) {
  const { args, raw: msg } = ctx;

  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }

  await ctx.chatAction('typing');

  // ── Case 1: replied to a media message ────────────────────────────────────
  const reply = msg.reply_to_message;
  if (reply) {
    const media = getMediaInfo(reply);
    if (!media) {
      return ctx.reply('❌ Reply to an audio, video, voice or document file.');
    }

    const stamp     = Date.now();
    const inputPath = path.join(CACHE_DIR, `in_${stamp}`);
    let statusMsgId = null;

    try {
      // First status message (will be edited later)
      const status = await ctx.reply('⬇️ Downloading media…');
      statusMsgId = status.message_id;

      await ctx.downloadFile(media.fileId, inputPath);

      const probe = await ffprobe(inputPath);
      const info  = analyse(probe);

      if (!info.hasAudio && !info.hasVideo) {
        safeUnlink(inputPath);
        return ctx.editText(statusMsgId, '❌ Unsupported file – no audio or video stream.');
      }

      // Store for the callback
      const storedPath = path.join(CACHE_DIR, `stored_${stamp}`);
      fs.renameSync(inputPath, storedPath);

      // Build only relevant buttons
      const buttons = [];

      if (info.hasAudio && !info.hasVideo) {
        // Pure audio → can become MP4
        buttons.push([
          { text: '🎬 Convert to MP4', callback_data: `link:to_mp4:${stamp}` },
        ]);
      }

      if (info.hasVideo || (info.hasAudio && info.hasVideo)) {
        // Has video (or both) → extract to MP3
        buttons.push([
          { text: '🎵 Convert to MP3', callback_data: `link:to_mp3:${stamp}` },
        ]);
      }

      // Always add Cancel
      buttons.push([
        { text: '❌ Cancel', callback_data: `link:cancel:${stamp}` },
      ]);

      const typeLabel = info.hasVideo
        ? (info.hasAudio ? 'Video + Audio' : 'Video')
        : 'Audio';

      await ctx.editText(
        statusMsgId,
        `✅ Detected: <b>${typeLabel}</b>\n\nChoose an option:`,
        {
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: buttons },
        }
      );
    } catch (err) {
      console.error('[link]', err);
      safeUnlink(inputPath);
      if (statusMsgId) {
        await ctx.editText(statusMsgId, `❌ Failed: ${err.message || err}`);
      } else {
        await ctx.reply(`❌ Failed: ${err.message || err}`);
      }
    }
    return;
  }

  // ── Case 2: URL ───────────────────────────────────────────────────────────
  const url = args[0];
  if (!url || !/^https?:\/\//i.test(url)) {
    return ctx.reply(
      'Usage:\n' +
      '• Reply to a media file with <code>/link</code>\n' +
      '• Or: <code>/link &lt;direct-url&gt;</code>',
      { parse_mode: 'HTML' }
    );
  }

  const stamp      = Date.now();
  const inputPath  = path.join(CACHE_DIR, `in_${stamp}`);
  const outputBase = path.join(CACHE_DIR, `out_${stamp}`);
  let statusMsgId  = null;

  try {
    const status = await ctx.reply('⬇️ Downloading…');
    statusMsgId = status.message_id;

    await downloadUrl(url, inputPath);

    const probe = await ffprobe(inputPath);
    const info  = analyse(probe);

    let finalOutput, sendType, caption;

    if (info.hasAudio && !info.hasVideo) {
      // Audio → MP4
      await ctx.editText(statusMsgId, '🔄 Converting to MP4…');
      finalOutput = outputBase + '.mp4';
      await convertToMp4(inputPath, finalOutput, probe);
      sendType = 'video';
      caption  = '✅ Converted to MP4';
    } else if (info.hasVideo) {
      // Video → MP3
      await ctx.editText(statusMsgId, '🔄 Converting to MP3…');
      finalOutput = outputBase + '.mp3';
      await convertToMp3(inputPath, finalOutput);
      sendType = 'audio';
      caption  = '✅ Converted to MP3';
    } else {
      throw new Error('Unsupported file');
    }

    await ctx.chatAction(sendType === 'video' ? 'upload_video' : 'upload_audio');
    await ctx.sendMediaFile(finalOutput, sendType, { caption });
    await ctx.editText(statusMsgId, caption);
  } catch (err) {
    console.error('[link]', err);
    if (statusMsgId) {
      await ctx.editText(statusMsgId, `❌ Failed: ${err.message || err}`);
    } else {
      await ctx.reply(`❌ Failed: ${err.message || err}`);
    }
  } finally {
    safeUnlink(inputPath);
    safeUnlink(outputBase + '.mp3');
    safeUnlink(outputBase + '.mp4');
  }
}

// ── Callback handler ─────────────────────────────────────────────────────────
async function onCallback(ctx, cq) {
  const parts  = cq.data.split(':'); // link : action : stamp
  const action = parts[1];
  const stamp  = parts[2];

  await ctx.answerCallback(cq.id);

  if (!stamp) {
    return ctx.editText(ctx.messageId, '❌ Invalid request.');
  }

  const storedPath = path.join(CACHE_DIR, `stored_${stamp}`);
  const outputBase = path.join(CACHE_DIR, `out_${stamp}`);

  // ── Cancel ────────────────────────────────────────────────────────────────
  if (action === 'cancel') {
    safeUnlink(storedPath);
    return ctx.editText(ctx.messageId, '❌ Cancelled.');
  }

  if (!['to_mp3', 'to_mp4'].includes(action)) {
    return ctx.editText(ctx.messageId, '❌ Unknown action.');
  }

  if (!fs.existsSync(storedPath)) {
    return ctx.editText(ctx.messageId, '❌ File expired. Please run the command again.');
  }

  try {
    await ctx.editText(ctx.messageId, '🔄 Converting… please wait');

    const probe = await ffprobe(storedPath);
    let finalOutput, sendType, caption;

    if (action === 'to_mp4') {
      finalOutput = outputBase + '.mp4';
      await convertToMp4(storedPath, finalOutput, probe);
      sendType = 'video';
      caption  = '✅ Converted to MP4';
    } else {
      finalOutput = outputBase + '.mp3';
      await convertToMp3(storedPath, finalOutput);
      sendType = 'audio';
      caption  = '✅ Converted to MP3';
    }

    // Send the finished file
    await ctx.chatAction(sendType === 'video' ? 'upload_video' : 'upload_audio');
    await ctx.sendMediaFile(finalOutput, sendType, { caption });

    // Edit the original status message
    await ctx.editText(ctx.messageId, caption);
  } catch (err) {
    console.error('[link callback]', err);
    await ctx.editText(ctx.messageId, `❌ Conversion failed: ${err.message || err}`);
  } finally {
    safeUnlink(storedPath);
    safeUnlink(outputBase + '.mp3');
    safeUnlink(outputBase + '.mp4');
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getMediaInfo(msg) {
  if (msg.audio)      return { fileId: msg.audio.file_id };
  if (msg.voice)      return { fileId: msg.voice.file_id };
  if (msg.video)      return { fileId: msg.video.file_id };
  if (msg.video_note) return { fileId: msg.video_note.file_id };
  if (msg.animation)  return { fileId: msg.animation.file_id };
  if (msg.document)   return { fileId: msg.document.file_id };
  return null;
}

function analyse(probe) {
  const streams = probe.streams || [];
  return {
    hasAudio: streams.some(s => s.codec_type === 'audio'),
    hasVideo: streams.some(s => s.codec_type === 'video'),
    duration: parseFloat(probe.format?.duration) || 30,
  };
}

async function downloadUrl(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(dest, buf);
}

async function ffprobe(file) {
  const { stdout } = await execFileAsync('ffprobe', [
    '-v', 'error',
    '-show_format',
    '-show_streams',
    '-of', 'json',
    file,
  ]);
  return JSON.parse(stdout);
}

async function convertToMp4(input, output, probe) {
  const duration = parseFloat(probe.format?.duration) || 30;
  await execFileAsync('ffmpeg', [
    '-y',
    '-f', 'lavfi',
    '-i', `color=c=black:s=1280x720:d=${duration}`,
    '-i', input,
    '-c:v', 'libx264',
    '-tune', 'stillimage',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-pix_fmt', 'yuv420p',
    '-shortest',
    '-movflags', '+faststart',
    '-threads', '4',
    output,
  ]);
}

async function convertToMp3(input, output) {
  await execFileAsync('ffmpeg', [
    '-y',
    '-i', input,
    '-vn',
    '-c:a', 'libmp3lame',
    '-b:a', '192k',
    '-threads', '4',
    output,
  ]);
}

function safeUnlink(p) {
  try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch {}
}