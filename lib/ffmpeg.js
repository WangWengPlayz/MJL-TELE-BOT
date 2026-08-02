const { spawn } = require('child_process');

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', args);
    let stderr = '';
    proc.stderr.on('data', (d) => (stderr += d.toString()));
    proc.on('error', (err) => reject(new Error(`FFmpeg failed to start: ${err.message}`)));
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`FFmpeg exited with code ${code}: ${stderr.slice(-600)}`));
    });
  });
}

// ── Audio formats ──────────────────────────────────────────────────────────────

const AUDIO_CODEC_ARGS = {
  mp3:  ['-c:a', 'libmp3lame', '-b:a', '320k', '-ac', '2'],
  aac:  ['-c:a', 'aac',        '-b:a', '256k', '-ac', '2'],
  m4a:  ['-c:a', 'aac',        '-b:a', '256k', '-ac', '2'],
  ogg:  ['-c:a', 'libvorbis',  '-q:a', '6'],
  wav:  ['-c:a', 'pcm_s16le'],
  flac: ['-c:a', 'flac'],
};

/**
 * Convert any audio/video source to a target audio format.
 * Strips video streams automatically (-vn).
 * format: 'mp3' | 'aac' | 'm4a' | 'ogg' | 'wav' | 'flac'
 */
async function convertAudio(inputPath, outputPath, format) {
  const codecArgs = AUDIO_CODEC_ARGS[format];
  if (!codecArgs) throw new Error(`Unsupported audio output format: ${format}`);
  await runFfmpeg(['-y', '-i', inputPath, '-vn', ...codecArgs, outputPath]);
}

/**
 * Convert audio to MP4 with a solid black 1080p background.
 * Useful for platforms that require a video container.
 */
async function audioToMp4(inputPath, outputPath) {
  await runFfmpeg([
    '-y',
    '-f', 'lavfi',
    '-i', 'color=c=black:s=1920x1080:r=25',
    '-i', inputPath,
    '-shortest',
    '-c:v', 'libx264',
    '-preset', 'fast',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-movflags', '+faststart',
    outputPath,
  ]);
}

/**
 * Re-encode any video to MP4 (H.264 + AAC).
 * Use when the source container is not MP4 or needs re-encoding.
 */
async function videoToMp4(inputPath, outputPath) {
  await runFfmpeg([
    '-y',
    '-i', inputPath,
    '-c:v', 'libx264',
    '-preset', 'fast',
    '-crf', '23',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-movflags', '+faststart',
    outputPath,
  ]);
}

/**
 * Fast-copy video to MP4 without re-encoding (stream copy).
 * Only works when the source is already H.264/AAC — falls back to re-encode on error.
 */
async function videoToMp4Fast(inputPath, outputPath) {
  try {
    await runFfmpeg([
      '-y',
      '-i', inputPath,
      '-c:v', 'copy',
      '-c:a', 'copy',
      '-movflags', '+faststart',
      outputPath,
    ]);
  } catch {
    // Codec mismatch — fall back to full re-encode
    await videoToMp4(inputPath, outputPath);
  }
}

// Legacy alias kept for backwards-compat
async function toMp3(inputPath, outputPath) {
  return convertAudio(inputPath, outputPath, 'mp3');
}

module.exports = { runFfmpeg, convertAudio, audioToMp4, videoToMp4, videoToMp4Fast, toMp3 };
