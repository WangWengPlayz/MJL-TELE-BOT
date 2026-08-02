// ============================================================
//  COMMAND TEMPLATE
//  Copy this file, rename it, and fill in the blanks.
//  Delete any section you don't need.
// ============================================================

module.exports = {

  // ── Required ─────────────────────────────────────────────
  name:    'example',                   // /example  (lowercase, no slash)
  execute,                              // main handler — always required

  // ── Metadata (shown in /help) ─────────────────────────────
  version:     '1.0.0',
  description: 'A short description of what this command does.',
  usage:       '/example [optional-arg]',
  category:    'General',              // group label for /help
  aliases:     ['ex', 'demo'],         // /ex and /demo also trigger this

  // ── Inline-button callbacks ───────────────────────────────
  // Remove these two lines if your command has no buttons.
  callbackPrefix: 'example:',          // must be unique across all commands
  onCallback,

};

// ── Main handler ──────────────────────────────────────────
// ctx  — all bot helpers (see list below)
// ctx.args — array of words after the command
// ctx.raw  — full Telegram message object
async function execute(ctx) {
  const { args, raw: msg } = ctx;
  const userId   = msg.from?.id;
  const username = msg.from?.username ? `@${msg.from.username}` : msg.from?.first_name;

  // ── Show typing indicator while working ──────────────────
  await ctx.chatAction('typing');

  // ── Basic reply ──────────────────────────────────────────
  await ctx.reply(`Hello ${username}! You passed: ${args.join(', ') || 'nothing'}`);

  // ── HTML reply ───────────────────────────────────────────
  // await ctx.replyWithHTML(`<b>Bold</b>, <i>italic</i>, <code>code</code>`);

  // ── Reply with inline buttons ────────────────────────────
  // await ctx.reply('Pick an option:', {
  //   reply_markup: {
  //     inline_keyboard: [
  //       [
  //         { text: '✅ Confirm', callback_data: 'example:confirm' },
  //         { text: '❌ Cancel',  callback_data: 'example:cancel'  },
  //       ],
  //     ],
  //   },
  // });

  // ── Send a photo (file_id or public URL) ─────────────────
  // await ctx.sendPhoto('https://example.com/image.jpg', { caption: 'Look at this!' });

  // ── Send a file ──────────────────────────────────────────
  // await ctx.sendDocument('file_id_here', { caption: 'Here is your file.' });

  // ── Send a poll ──────────────────────────────────────────
  // await ctx.sendPoll('Favourite color?', ['Red', 'Blue', 'Green']);

  // ── Delete the command message ────────────────────────────
  // await ctx.deleteMessage(msg.message_id);
}

// ── Callback handler (inline button presses) ─────────────
// Called when a user presses a button whose callback_data
// starts with callbackPrefix ('example:').
//
// ctx.messageId — the message that contained the button
// cq.data       — full callback_data string  e.g. 'example:confirm'
// cq.from       — Telegram user who pressed the button
// cq.id         — must be answered to clear the loading spinner
async function onCallback(ctx, cq) {
  const [, action] = cq.data.split(':');

  await ctx.answerCallback(cq.id);   // always answer first

  if (action === 'confirm') {
    await ctx.editText(ctx.messageId, '✅ Confirmed!');
  } else if (action === 'cancel') {
    await ctx.editText(ctx.messageId, '❌ Cancelled.');
  }
}

// ============================================================
//  FULL ctx REFERENCE
// ============================================================
//
//  SEND
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
//    ctx.sendDice('🎲'|'🎯'|'🏀'|'⚽'|'🎰', extra?)
//    ctx.sendMediaGroup(mediaArray, extra?)
//    ctx.sendMediaFile(localPath, 'video'|'audio', extra?)
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
