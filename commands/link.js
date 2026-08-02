// ============================================================
//  /filetype — detect the file type of a replied-to message
// ============================================================

module.exports = {
  name: 'filetype',
  execute,
  
  version: '1.0.0',
  description: 'Reply to a message containing a file to auto-detect its type.',
  usage: '/filetype (as a reply to a photo/video/document/audio/voice/sticker)',
  category: 'Utility',
  aliases: ['detect', 'ftype'],
};

async function execute(ctx) {
  const { raw: msg } = ctx;
  const target = msg.reply_to_message;
  
  if (!target) {
    return ctx.reply('⚠️ Reply to a message that contains a file, then send /filetype.');
  }
  
  await ctx.chatAction('typing');
  
  const detected = detectFileType(target);
  
  if (!detected) {
    return ctx.reply('❌ No recognizable file found in that message.');
  }
  
  const { type, file, extra } = detected;
  
  const lines = [
    `📁 <b>Detected type:</b> ${type}`,
    file.file_name ? `📝 <b>Name:</b> ${file.file_name}` : null,
    file.mime_type ? `🧩 <b>MIME:</b> ${file.mime_type}` : null,
    file.file_size ? `📦 <b>Size:</b> ${formatBytes(file.file_size)}` : null,
    file.width && file.height ? `📐 <b>Dimensions:</b> ${file.width}x${file.height}` : null,
    file.duration ? `⏱ <b>Duration:</b> ${file.duration}s` : null,
    extra || null,
    `🆔 <b>file_id:</b> <code>${file.file_id}</code>`,
  ].filter(Boolean);
  
  await ctx.replyWithHTML(lines.join('\n'));
}

// ── Helper: walk the replied message and find the file ────────────────────
function detectFileType(msg) {
  if (msg.photo && msg.photo.length) {
    // photo is an array of sizes — take the largest
    const largest = msg.photo[msg.photo.length - 1];
    return { type: 'Photo 🖼', file: largest };
  }
  
  if (msg.video) {
    return { type: 'Video 🎥', file: msg.video };
  }
  
  if (msg.video_note) {
    return { type: 'Video Note ⭕', file: msg.video_note };
  }
  
  if (msg.animation) {
    return { type: 'GIF/Animation 🎞', file: msg.animation };
  }
  
  if (msg.audio) {
    return {
      type: 'Audio 🎵',
      file: msg.audio,
      extra: msg.audio.performer || msg.audio.title ?
        `🎤 <b>Track:</b> ${[msg.audio.performer, msg.audio.title].filter(Boolean).join(' - ')}` :
        null,
    };
  }
  
  if (msg.voice) {
    return { type: 'Voice Note 🎙', file: msg.voice };
  }
  
  if (msg.sticker) {
    return {
      type: msg.sticker.is_animated ? 'Animated Sticker 🌀' : 'Sticker 🏷',
      file: msg.sticker,
      extra: msg.sticker.emoji ? `😀 <b>Emoji:</b> ${msg.sticker.emoji}` : null,
    };
  }
  
  if (msg.document) {
    return { type: `Document 📄 (${guessDocKind(msg.document)})`, file: msg.document };
  }
  
  return null;
}

// ── Helper: guess a friendlier label for generic documents ────────────────
function guessDocKind(doc) {
  const mime = doc.mime_type || '';
  const name = doc.file_name || '';
  const ext = name.split('.').pop()?.toLowerCase();
  
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime === 'application/pdf' || ext === 'pdf') return 'PDF';
  if (mime.includes('zip') || ['zip', 'rar', '7z'].includes(ext)) return 'archive';
  if (mime.includes('word') || ['doc', 'docx'].includes(ext)) return 'Word doc';
  if (mime.includes('sheet') || ['xls', 'xlsx', 'csv'].includes(ext)) return 'spreadsheet';
  if (['js', 'py', 'json', 'ts', 'html', 'css'].includes(ext)) return 'code';
  if (ext === 'txt') return 'text';
  
  return ext ? ext.toUpperCase() : 'unknown';
}

// ── Helper: human-readable file size ───────────────────────────────────────
function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${units[i]}`;
}