// ============================================================
//  COMMAND TEMPLATE  —  MJL Bot
//  Copy this file, rename it, fill in the blanks.
//  Delete any section you don't need.
// ============================================================

module.exports = {

  // ── Required ─────────────────────────────────────────────
  name:    'example',           // /example  (lowercase, no slash)
  execute,                      // main handler — always required

  // ── Metadata (shown in /help) ─────────────────────────────
  version:     '1.0.0',
  description: 'A short description of what this command does.',
  usage:       '/example [optional-arg]',
  category:    'General',       // group label shown in /help
  aliases:     ['ex', 'demo'],  // /ex and /demo also trigger this

  // ── Inline-button callbacks ───────────────────────────────
  // Remove these two lines if your command has no buttons.
  callbackPrefix: 'example:',   // must be unique across all commands
  onCallback,

};

// ── Main handler ──────────────────────────────────────────────────────────────
// ctx  — bot helper object (full reference below)
// ctx.args  — string[] of words after the command
// ctx.raw   — full Telegram Message object
async function execute(ctx) {
  const { args, raw: msg } = ctx;
  const username = msg.from?.username ? `@${msg.from.username}` : msg.from?.first_name;

  // Show typing indicator while working
  await ctx.chatAction('typing');

  // ── Plain text reply ──────────────────────────────────────
  await ctx.reply(`Hello ${username}! You passed: ${args.join(', ') || 'nothing'}`);

  // ── HTML reply ────────────────────────────────────────────
  // await ctx.replyWithHTML(`<b>Bold</b>, <i>italic</i>, <code>code</code>`);

  // ── Reply with inline buttons ─────────────────────────────
  // await ctx.reply('Pick an option:', {
  //   reply_markup: {
  //     inline_keyboard: [[
  //       { text: '✅ Yes', callback_data: 'example:yes' },
  //       { text: '❌ No',  callback_data: 'example:no'  },
  //     ]],
  //   },
  // });

  // ── Send a photo by URL or file_id ───────────────────────
  // await ctx.sendPhoto('https://example.com/image.jpg', { caption: 'Look at this!' });

  // ── Send a local photo file ───────────────────────────────
  // await ctx.sendMediaFile('/tmp/image.jpg', 'photo', { caption: 'Generated image' });

  // ── Send a local video file ───────────────────────────────
  // await ctx.sendMediaFile('/tmp/video.mp4', 'video', { caption: 'Here is the video' });

  // ── Send a local audio file ───────────────────────────────
  // await ctx.sendMediaFile('/tmp/audio.mp3', 'audio', { caption: 'Here is the audio' });

  // ── Send a local document (any type) ─────────────────────
  // await ctx.sendMediaFile('/tmp/file.zip', 'document', { caption: 'Your file' });

  // ── Send a document by file_id or URL ────────────────────
  // await ctx.sendDocument('file_id_here', { caption: 'Here is your file.' });

  // ── Send a poll ───────────────────────────────────────────
  // await ctx.sendPoll('Favourite color?', ['Red', 'Blue', 'Green']);

  // ── Send a dice / game emoji ─────────────────────────────
  // await ctx.sendDice('🎲');   // also: '🎯' '🏀' '⚽' '🎰' '🎳'

  // ── Send a location ───────────────────────────────────────
  // await ctx.sendLocation(1.3521, 103.8198);   // lat, lng

  // ── Send a media group (album) ────────────────────────────
  // await ctx.sendMediaGroup([
  //   { type: 'photo', media: 'https://example.com/1.jpg' },
  //   { type: 'photo', media: 'https://example.com/2.jpg' },
  // ]);

  // ── Delete the command message ────────────────────────────
  // await ctx.deleteMessage(msg.message_id);
}

// ── Callback handler (inline button presses) ─────────────────────────────────
// Called when a user presses a button whose callback_data starts with
// callbackPrefix ('example:').
//
// ctx.messageId — message that contained the button
// cq.data       — full callback_data string, e.g. 'example:yes'
// cq.from       — Telegram user who pressed the button
// cq.id         — must be answered to clear the loading spinner
async function onCallback(ctx, cq) {
  const [, action] = cq.data.split(':');

  await ctx.answerCallback(cq.id);   // always answer first

  if (action === 'yes') {
    await ctx.editText(ctx.messageId, '✅ You chose Yes!');
  } else if (action === 'no') {
    await ctx.editText(ctx.messageId, '❌ You chose No.');
  }
}

// ============================================================
//  FULL ctx REFERENCE
// ============================================================
//
//  SEND (URL / file_id)
//    ctx.reply(text, extra?)
//    ctx.replyWithHTML(html, extra?)
//    ctx.replyWithMarkdown(mdv2, extra?)
//    ctx.sendPhoto(fileIdOrUrl, extra?)
//    ctx.sendDocument(fileIdOrUrl, extra?)
//    ctx.sendAudio(fileIdOrUrl, extra?)
//    ctx.sendVideo(fileIdOrUrl, extra?)
//    ctx.sendVoice(fileIdOrUrl, extra?)
//    ctx.sendVideoNote(fileId, extra?)
//    ctx.sendSticker(fileId, extra?)
//    ctx.sendLocation(lat, lng, extra?)
//    ctx.sendContact(phone, firstName, extra?)
//    ctx.sendPoll(question, ['opt1','opt2'], extra?)
//    ctx.sendDice('🎲'|'🎯'|'🏀'|'⚽'|'🎰'|'🎳', extra?)
//    ctx.sendMediaGroup(mediaArray, extra?)
//
//  SEND (local file — multipart upload)
//    ctx.sendMediaFile(localPath, type, extra?)
//      type = 'video' | 'audio' | 'photo' | 'document' | 'voice' | 'video_note'
//      e.g. ctx.sendMediaFile('/tmp/clip.mp4', 'video', { caption: 'here' })
//
//  EDIT
//    ctx.editText(messageId, text, extra?)
//    ctx.editReplyMarkup(messageId, markup)
//    ctx.editCaption(messageId, caption, extra?)
//    ctx.editMedia(messageId, media, extra?)
//
//  DELETE / PIN
//    ctx.deleteMessage(messageId)
//    ctx.pin(messageId, silent?)
//    ctx.unpin(messageId)
//    ctx.unpinAll()
//
//  FORWARD / COPY
//    ctx.forwardTo(toChatId, messageId, extra?)
//    ctx.forwardFrom(fromChatId, messageId, extra?)
//    ctx.copyTo(toChatId, messageId, extra?)
//    ctx.copyFrom(fromChatId, messageId, extra?)
//
//  REACT
//    ctx.react(messageId, [{ type: 'emoji', emoji: '👍' }])
//
//  CHAT INFO
//    ctx.getChat()
//    ctx.getChatMember(userId)
//    ctx.getChatMemberCount()
//    ctx.leaveChat()
//
//  MODERATION
//    ctx.ban(userId, extra?)
//    ctx.unban(userId, extra?)
//    ctx.restrict(userId, permissions, extra?)
//    ctx.promote(userId, extra?)
//
//  MISC
//    ctx.chatAction('typing'|'upload_photo'|'upload_video'|'upload_document'|'record_voice'|...)
//    ctx.answerCallback(callbackQueryId, text?, showAlert?)
//    ctx.downloadFile(fileId, localDestPath)
//    ctx.getUserPhotos(userId, extra?)
//
//  DATA
//    ctx.chatId        — current chat ID
//    ctx.args          — string[] of words after the command
//    ctx.raw           — full Telegram Message object
//    ctx.messageId     — set in onCallback: ID of the button message
//    ctx.commands      — Map of all loaded commands
