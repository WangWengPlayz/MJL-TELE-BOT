// ============================================================
//  COMMAND TEMPLATE  —  MJL Bot  v2.0
//  Copy this file into commands/, rename it, fill in the blanks.
//  Delete any section you don't need.
//
//  QUICK CHECKLIST
//  ✅ Set disabled: false (or remove the line entirely)
//  ✅ Set a unique name (lowercase, no spaces, no slash)
//  ✅ Set permission (1 = members, 2 = admin only)
//  ✅ Set cooldown in seconds (0 = no cooldown)
//  ✅ Implement execute()
//  ✅ Remove callbackPrefix / onCallback if you have no buttons
// ============================================================

module.exports = {

  // ── Loader control ───────────────────────────────────────
  // Set to true to prevent this file from being loaded as a command.
  // Remove or set false when turning this into a real command.
  disabled: true,

  // ── Required ─────────────────────────────────────────────
  name:    'example',           // /example  (lowercase, no slash, must be unique)
  execute,                      // main handler  — always required

  // ── Metadata (shown in /help) ─────────────────────────────
  version:     '1.0.0',
  description: 'A short description of what this command does.',
  usage:       '/example [optional-arg]',
  category:    'General',       // group label shown in /help
                                //   General | Fun | Media | Utility | Admin

  // ── Access control ────────────────────────────────────────
  permission:  1,               // 1 = any member can use
                                // 2 = admin only (enforced by bot.js)

  // ── Rate limiting ─────────────────────────────────────────
  cooldown:    5,               // seconds between uses per user (default: 5)
                                // 0 = no cooldown
                                // Admins always bypass cooldown

  // ── Aliases ───────────────────────────────────────────────
  aliases: ['ex', 'demo'],      // /ex and /demo also trigger this command

  // ── Inline-button callbacks ───────────────────────────────
  // Remove these two lines if your command has no inline buttons.
  callbackPrefix: 'example:',   // must be globally unique across all commands
  onCallback,

};

// ============================================================
//  MAIN HANDLER
// ============================================================
// ctx  — bot helper object (full API reference at the bottom)
// ctx.args    — string[] of words after the command
// ctx.raw     — full Telegram Message object
// ctx.config  — config.json contents  { prefix, adminId, botName, … }
//
async function execute(ctx) {
  const { args, raw: msg } = ctx;
  const username = msg.from?.username ? `@${msg.from.username}` : msg.from?.first_name;
  const isAdmin  = ctx.isAdminUser(msg.from?.id);  // check if caller is bot admin

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

  // ── Maintenance mode check (if you need it inside a command) ─
  // const inMaintenance = ctx.getMaintenance();
  // ctx.setMaintenance(true);   // enable maintenance mode
  // ctx.setMaintenance(false);  // disable

  // ── Send a photo by URL or file_id ───────────────────────
  // await ctx.sendPhoto('https://example.com/image.jpg', { caption: 'Look at this!' });

  // ── Send a local file ────────────────────────────────────
  // await ctx.sendMediaFile('/tmp/video.mp4', 'video', { caption: 'Here' });
  // await ctx.sendMediaFile('/tmp/audio.mp3', 'audio', { caption: 'Here' });
  // await ctx.sendMediaFile('/tmp/image.jpg', 'photo', { caption: 'Here' });

  // ── Send a Telegram Dice ─────────────────────────────────
  // await ctx.sendDice('🎲');   // also: '🎯' '🏀' '⚽' '🎰' '🎳'

  // ── Send a poll ──────────────────────────────────────────
  // await ctx.sendPoll('Favourite color?', ['Red', 'Blue', 'Green']);

  // ── Delete the command message ────────────────────────────
  // await ctx.deleteMessage(msg.message_id);

  // ── React to a message ───────────────────────────────────
  // Supported emoji reactions (partial list):
  //   👍 👎 ❤ 🔥 🤣 😢 😱 🎉 🤔 🤩 💯 🔥 🥱 🤬 ❤
  // await ctx.react(msg.message_id, [{ type: 'emoji', emoji: '👍' }]);
}

// ============================================================
//  CALLBACK HANDLER  (inline button presses)
// ============================================================
// Called when a user presses a button whose callback_data starts
// with callbackPrefix ('example:').
//
// ctx.messageId — message_id of the message that contains the button
// cq.data       — full callback_data string, e.g. 'example:yes'
// cq.from       — Telegram user who pressed the button
// cq.id         — must be answered to clear the loading spinner
//
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
//  EVENT HANDLER TEMPLATE  (auto-fires on every message)
// ============================================================
// Create a file in commands/events/<name>.js to make an event handler.
// Events are NOT commands — they fire automatically on every message,
// without the user typing a prefix.
//
// commands/events/myevent.js:
// ─────────────────────────────────────────────────────────────
// module.exports = {
//   name: 'my-event',
//   async execute(ctx, msg) {
//     // ctx  — same helper object as commands
//     // msg  — full Telegram Message object
//     const text = (msg.text || '').toLowerCase();
//     if (text.includes('hello')) {
//       await ctx.react(msg.message_id, [{ type: 'emoji', emoji: '👋' }]);
//     }
//   },
// };
// ─────────────────────────────────────────────────────────────

// ============================================================
//  FULL ctx API REFERENCE
// ============================================================
//
//  ACCESS CONTROL
//    ctx.isAdminUser(userId)           → boolean — is this user the bot admin?
//    ctx.getMaintenance()              → boolean — is maintenance mode on?
//    ctx.setMaintenance(true|false)    → toggle maintenance mode
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
//    Supported: 👍 👎 ❤ 🔥 🥰 👏 😁 🤔 🤯 😱 🤬 😢 🎉 🤩 🤮
//              💩 🙏 👌 🕊 🤡 🥱 🥴 😍 💯 🤣 ⚡ 🏆 💔 🤨 😈
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
//    ctx.chatAction('typing'|'upload_photo'|'upload_video'|'upload_document'|...)
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
//    ctx.config        — config.json  { prefix, adminId, adminName, botName, … }
