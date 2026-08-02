// ============================================================
//  COMMAND  —  link
//  Reply to a media file  OR  /link <url>
//  Shows conversion buttons (MP3 ↔ MP4)
// ============================================================

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);

const CACHE_DIR = path.join(__dirname, 'cache');

module.exports = {
  name: 'link',
  execute,
  
  version: '1.1.0',
  description: 'Convert MP3 ↔ MP4 (reply to file or give URL)',
  usage: '/link  (reply to media)   or   /link <url>',
  category: 'Media',
  aliases: ['convert', 'cv'],
  
  callbackPrefix: 'link:',
  onCallback,
};

// ── Main handler ──────────────────────────────────────────────────────────────
async function execute(ctx) {
  const { args, raw: msg } = ctx;
  
  // Ensure cache folder
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
  
  await ctx.chatAction('typing');
  
  // ── Case 1: user replied to a media message ───────────────────────────────
  const reply = msg.reply_to_message;
  if (reply) {
    const media = getMediaInfo(reply);
    if (!media) {
      return ctx.reply('❌ Please reply to an audio, video or document file.');
    }
    
    const stamp = Date.now();
    const inputPath = path.join(CACHE_DIR, `in_${stamp}`);
    
    try {
      await ctx.reply('⬇️ Downloading media…');
      await ctx.downloadFile(media.fileId, inputPath);
      
      const probe = await ffprobe(inputPath);
      const kind = detectKind(probe);
      
      if (!kind) {
        safeUnlink(inputPath);
        return ctx.reply('❌ Unsupported file (no audio/video stream found).');
      }
      
      // Keep the file for the callback (rename so we know the stamp)
      const storedPath = path.join(CACHE_DIR, `stored_${stamp}`);
      fs.renameSync(inputPath, storedPath);
      
      // Build buttons according to type
      const buttons = [];
      if (kind === 'audio') {
        buttons.push([
          { text: '🎬 Convert to MP4', callback_data: `link:to_mp4:${stamp}` },
        ]);
      } else if (kind === 'video') {
        buttons.push([
          { text: '🎵 Convert to MP3', callback_data: `link:to_mp3:${stamp}` },
        ]);
      }
      
      // Also offer both if the file has both streams (rare but possible)
      if (kind === 'both') {
        buttons.push(
          [{ text: '🎵 Convert to MP3', callback_data: `link:to_mp3:${stamp}` }],
          [{ text: '🎬 Convert to MP4', callback_data: `link:to_mp4:${stamp}` }],
        );
      }
      
      await ctx.reply(
        `✅ Detected: <b>${kind.toUpperCase()}</b>\nChoose conversion:`,
        {
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: buttons },
        }
      );
    } catch (err) {
      console.error('[link]', err);
      safeUnlink(inputPath);
      await ctx.reply(`❌ Failed: ${err.message || err}`);
    }
    return;
  }
  
  // ── Case 2: classic URL usage ─────────────────────────────────────────────
  const url = args[0];
  if (!url || !/^https?:\/\//i.test(url)) {
    return ctx.reply(
      'Usage:\n' +
      '• Reply to a media file with `/link`\n' +
      '• Or: `/link <direct-url>`'
    );
  }
  
  // URL flow (same as before – auto convert)
  const stamp = Date.now();
  const inputPath = path.join(CACHE_DIR, `in_${stamp}`);
  const outputBase = path.join(CACHE_DIR, `out_${stamp}`);
  
  try {
    await ctx.reply('⬇️ Downloading…');
    await downloadUrl(url, inputPath);
    
    const probe = await ffprobe(inputPath);
    const kind = detectKind(probe);
    
    let finalOutput, sendType, caption;
    
    if (kind === 'audio') {
      finalOutput = outputBase + '.mp4';
      await ctx.reply('🔄 Converting MP3 → MP4…');
      await convertMp3ToMp4(inputPath, finalOutput, probe);
      sendType = 'video';
      caption = '✅ Converted to MP4';
    } else if (kind === 'video' || kind === 'both') {
      finalOutput = outputBase + '.mp3';
      await ctx.reply('🔄 Converting MP4 → MP3…');
      await convertMp4ToMp3(inputPath, finalOutput);
      sendType = 'audio';
      caption = '✅ Converted to MP3';
    } else {
      throw new Error('Unsupported file');
    }
    
    await ctx.chatAction(sendType === 'video' ? 'upload_video' : 'upload_audio');
    await ctx.sendMediaFile(finalOutput, sendType, { caption });
  } catch (err) {
    console.error('[link]', err);
    await ctx.reply(`❌ Failed: ${err.message || err}`);
  } finally {
    safeUnlink(inputPath);
    safeUnlink(outputBase + '.mp3');
    safeUnlink(outputBase + '.mp4');
  }
}

// ── Callback handler (button presses) ────────────────────────────────────────
async function onCallback(ctx, cq) {
  const parts = cq.data.split(':'); // link : action : stamp
  const action = parts[1];
  const stamp = parts[2];
  
  await ctx.answerCallback(cq.id);
  
  if (!stamp || !['to_mp3', 'to_mp4'].includes(action)) {
    return ctx.editText(ctx.messageId, '❌ Invalid action.');
  }
  
  const storedPath = path.join(CACHE_DIR, `stored_${stamp}`);
  if (!fs.existsSync(storedPath)) {
    return ctx.editText(ctx.messageId, '❌ File expired or already processed. Please try again.');
  }
  
  const outputBase = path.join(CACHE_DIR, `out_${stamp}`);
  let finalOutput, sendType, caption;
  
  try {
    await ctx.editText(ctx.messageId, '🔄 Converting… please wait');
    
    const probe = await ffprobe(storedPath);
    
    if (action === 'to_mp4') {
      finalOutput = outputBase + '.mp4';
      await convertMp3ToMp4(storedPath, finalOutput, probe);
      sendType = 'video';
      caption = '✅ Converted to MP4';
    } else {
      finalOutput = outputBase + '.mp3';
      await convertMp4ToMp3(storedPath, finalOutput);
      sendType = 'audio';
      caption = '✅ Converted to MP3';
    }
    
    // Send the result as a new message
    await ctx.chatAction(sendType === 'video' ? 'upload_video' : 'upload_audio');
    await ctx.sendMediaFile(finalOutput, sendType, { caption });
    
    // Update the button message
    await ctx.editText(ctx.messageId, caption);
  } catch (err) {
    console.error('[link callback]', err);
    await ctx.editText(ctx.messageId, `❌ Conversion failed: ${err.message || err}`);
  } finally {
    // Cleanup
    safeUnlink(storedPath);
    safeUnlink(outputBase + '.mp3');
    safeUnlink(outputBase + '.mp4');
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getMediaInfo(msg) {
  if (msg.audio) return { fileId: msg.audio.file_id, type: 'audio' };
  if (msg.voice) return { fileId: msg.voice.file_id, type: 'voice' };
  if (msg.video) return { fileId: msg.video.file_id, type: 'video' };
  if (msg.video_note) return { fileId: msg.video_note.file_id, type: 'video_note' };
  if (msg.document) return { fileId: msg.document.file_id, type: 'document' };
  if (msg.animation) return { fileId: msg.animation.file_id, type: 'animation' };
  return null;
}

function detectKind(probe) {
  const hasAudio = probe.streams?.some(s => s.codec_type === 'audio');
  const hasVideo = probe.streams?.some(s => s.codec_type === 'video');
  if (hasAudio && hasVideo) return 'both';
  if (hasAudio) return 'audio';
  if (hasVideo) return 'video';
  return null;
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

async function convertMp3ToMp4(input, output, probe) {
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
    output,
  ]);
}

async function convertMp4ToMp3(input, output) {
  await execFileAsync('ffmpeg', [
    '-y',
    '-i', input,
    '-vn',
    '-c:a', 'libmp3lame',
    '-b:a', '192k',
    output,
  ]);
}

function safeUnlink(p) {
  try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch {}
}