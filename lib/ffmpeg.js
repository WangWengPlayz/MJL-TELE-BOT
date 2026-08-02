const { spawn } = require('child_process');

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', args);
    let stderr = '';
    proc.stderr.on('data', (d) => (stderr += d.toString()));
    proc.on('error', (err) => reject(new Error(`FFmpeg failed to start: ${err.message}`)));
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`FFmpeg exited with code ${code}: ${stderr.slice(-500)}`));
    });
  });
}

// Audio -> MP4 with a solid black background
async function audioToMp4(inputPath, outputPath) {
  await runFfmpeg([
    '-y',
    '-f', 'lavfi',
    '-i', 'color=c=black:s=1920x1080:r=25',
    '-i', inputPath,
    '-shortest',
    '-c:v', 'libx264',
    '-preset', 'medium',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-movflags', '+faststart',
    outputPath,
  ]);
}

// Video/Audio -> MP3 (320kbps stereo)
async function toMp3(inputPath, outputPath) {
  await runFfmpeg([
    '-y',
    '-i', inputPath,
    '-vn',
    '-ac', '2',
    '-b:a', '320k',
    outputPath,
  ]);
}

module.exports = { audioToMp4, toMp3 };