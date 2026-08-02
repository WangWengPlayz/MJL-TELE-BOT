// ============================================================
//  COMMAND  —  link
//  /link <url>  →  convert MP3↔MP4 and send the result
// ============================================================

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);

// Cache lives next to this command file
const CACHE_DIR = path.join(__dirname, 'cache');

module.exports = {
  name: 'link',
  execute,
  
  version: '1.0.0',
  description: 'Convert MP3 ↔ MP4 from a direct link',
  usage: '/link <url>',
  category: 'Media',
  aliases: ['convert', 'cv'],
};

// ── Main handler ──────────────────────────────────────────────────────────────
async function execute(ctx) {
  const { args, raw: msg } = ctx;
  const url = args[0];
  
  if (!url || !/^https?:\/\//i.test(url)) {
    return ctx.reply('Usage: `/link <direct-url>`\nExample: `/link https://example.com/song.mp3`');
  }
  
  // Ensure cache folder exists
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
  
  await ctx.chatAction('typing');
  
  // Unique temp names
  const stamp = Date.now();
  const inputPath = path.join(CACHE_DIR, `in_${stamp}`);
  const outputPath = path.join(CACHE_DIR, `out_${stamp}`);
  
  try {
    // 1. Download
    await ctx.reply('⬇️ Downloading…');
    await downloadFile(url, inputPath);
    
    // 2. Probe
    const probe = await ffprobe(inputPath);
    const isAudio = probe.streams.some(s => s.codec_type === 'audio') &&
      !probe.streams.some(s => s.codec_type === 'video');
    const isVideo = probe.streams.some(s => s.codec_type === 'video');
    
    let finalOutput;
    let sendType;
    let caption;
    
    if (isAudio) {
      // MP3 → MP4
      finalOutput = outputPath + '.mp4';
      await ctx.reply('🔄 Converting MP3 → MP4…');
      await convertMp3ToMp4(inputPath, finalOutput, probe);
      sendType = 'video';
      caption = '✅ Converted to MP4';
    } else if (isVideo) {
      // MP4 → MP3
      finalOutput = outputPath + '.mp3';
      await ctx.reply('🔄 Converting MP4 → MP3…');
      await convertMp4ToMp3(inputPath, finalOutput);
      sendType = 'audio';
      caption = '✅ Converted to MP3';
    } else {
      throw new Error('Unsupported file – needs audio or video stream');
    }
    
    // 3. Send result
    await ctx.chatAction(sendType === 'video' ? 'upload_video' : 'upload_audio');
    await ctx.sendMediaFile(finalOutput, sendType, { caption });
    
  } catch (err) {
    console.error('[link]', err);
    await ctx.reply(`❌ Failed: ${err.message || err}`);
  } finally {
    // Cleanup
    safeUnlink(inputPath);
    safeUnlink(outputPath + '.mp3');
    safeUnlink(outputPath + '.mp4');
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function downloadFile(url, dest) {
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
  // Get duration (fallback 30 s if missing)
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