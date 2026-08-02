const fs = require('fs');
const path = require('path');

const API_BASE = (token) => `https://api.telegram.org/bot${token}`;
const FILE_BASE = (token) => `https://api.telegram.org/file/bot${token}`;
const POLL_TIMEOUT = 30;
const MAX_BACKOFF = 30000;
const COMMANDS_DIR = path.join(__dirname, 'commands');
const CONFIG_FILE = path.join(__dirname, 'config.json');

let offset = 0;
let running = true;
let backoff = 1000;
const commands = new Map();
let commandsLoaded = false;
let config = null;

// ---- Load config ----
function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
      config = JSON.parse(raw);
      console.log('[config] Loaded successfully');
      return config;
    }
  } catch (err) {
    console.warn('[config] Error loading config.json:', err.message);
  }
  // Fallback to defaults
  config = {
    prefix: '/',
    adminId: null,
    adminName: 'Admin',
    logAdminNotifications: true,
    botName: 'Bot'
  };
  return config;
}

// ---- Command loader ----
function loadCommands() {
  commands.clear();
  if (!fs.existsSync(COMMANDS_DIR)) {
    console.warn(`No commands folder found at ${COMMANDS_DIR}`);
    return;
  }

  const files = fs.readdirSync(COMMANDS_DIR).filter((f) => f.endsWith('.js'));

  for (const file of files) {
    const fullPath = path.join(COMMANDS_DIR, file);
    try {
      delete require.cache[require.resolve(fullPath)];
      const cmd = require(fullPath);

      if (!cmd.name || typeof cmd.execute !== 'function') {
        console.warn(`Skipping ${file}: missing "name" or "execute()"`);
        continue;
      }

      const entry = {
        name: cmd.name,
        description: cmd.description || 'No description provided.',
        version: cmd.version || '1.0.0',
        usage: cmd.usage || `/${cmd.name}`,
        aliases: cmd.aliases || [],
        callbackPrefix: cmd.callbackPrefix || null,
        execute: cmd.execute,
        onCallback: typeof cmd.onCallback === 'function' ? cmd.onCallback : null,
      };

      commands.set(entry.name, entry);
      for (const alias of entry.aliases) commands.set(alias, entry);

      console.log(`Loaded command: /${entry.name} (v${entry.version})`);
    } catch (err) {
      console.error(`Failed to load ${file}:`, err.message);
    }
  }
}

function findCommandByCallbackPrefix(data) {
  for (const cmd of commands.values()) {
    if (cmd.callbackPrefix && data.startsWith(cmd.callbackPrefix)) return cmd;
  }
  return null;
}

// ---- Telegram API helpers ----
async function apiCall(token, method, params = {}) {
  const res = await fetch(`${API_BASE(token)}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  const data = await res.json();
  if (!data.ok) {
    throw new Error(`Telegram API error (${method}): ${data.description || 'unknown'}`);
  }
  return data.result;
}

function getUpdates(token) {
  return apiCall(token, 'getUpdates', {
    offset,
    timeout: POLL_TIMEOUT,
    allowed_updates: ['message', 'callback_query'],
  });
}

function sendMessage(token, chatId, text, extra = {}) {
  return apiCall(token, 'sendMessage', { chat_id: chatId, text, ...extra });
}

function editMessageText(token, chatId, messageId, text, extra = {}) {
  return apiCall(token, 'editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text,
    ...extra,
  });
}

function editMessageReplyMarkup(token, chatId, messageId, reply_markup) {
  return apiCall(token, 'editMessageReplyMarkup', {
    chat_id: chatId,
    message_id: messageId,
    reply_markup,
  });
}

function answerCallbackQuery(token, callbackQueryId, text = '', showAlert = false) {
  return apiCall(token, 'answerCallbackQuery', {
    callback_query_id: callbackQueryId,
    text,
    show_alert: showAlert,
  });
}

function sendChatAction(token, chatId, action) {
  return apiCall(token, 'sendChatAction', { chat_id: chatId, action });
}

// Download a file from Telegram servers to a local path
async function downloadTelegramFile(token, fileId, destPath) {
  const fileInfo = await apiCall(token, 'getFile', { file_id: fileId });
  const url = `${FILE_BASE(token)}/${fileInfo.file_path}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download file: ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(destPath, buffer);
  return { size: buffer.length, filePath: destPath, remoteFileName: path.basename(fileInfo.file_path) };
}

// Upload a local file to Telegram as video or audio
async function sendMediaFile(token, chatId, filePath, type, extra = {}) {
  const TYPE_MAP = {
    video:      { method: 'sendVideo',     field: 'video'      },
    audio:      { method: 'sendAudio',     field: 'audio'      },
    photo:      { method: 'sendPhoto',     field: 'photo'      },
    document:   { method: 'sendDocument',  field: 'document'   },
    voice:      { method: 'sendVoice',     field: 'voice'      },
    video_note: { method: 'sendVideoNote', field: 'video_note' },
  };

  const mapped = TYPE_MAP[type];
  if (!mapped) throw new Error(`Unsupported media type for sendMediaFile: "${type}". Supported: ${Object.keys(TYPE_MAP).join(', ')}`);

  const { method, field: fieldName } = mapped;
  const fileBuffer = fs.readFileSync(filePath);
  const fileName = path.basename(filePath);

  const form = new FormData();
  form.append('chat_id', String(chatId));
  form.append(fieldName, new Blob([fileBuffer]), fileName);

  for (const [key, value] of Object.entries(extra)) {
    form.append(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
  }

  const res = await fetch(`${API_BASE(token)}/${method}`, {
    method: 'POST',
    body: form,
  });

  const data = await res.json();
  if (!data.ok) {
    throw new Error(`Telegram API error (${method}): ${data.description || 'unknown'}`);
  }
  return data.result;
}

// ---- Additional Telegram API helpers ----
function deleteMessage(token, chatId, messageId) {
  return apiCall(token, 'deleteMessage', { chat_id: chatId, message_id: messageId });
}

function forwardMessage(token, toChatId, fromChatId, messageId, extra = {}) {
  return apiCall(token, 'forwardMessage', {
    chat_id: toChatId, from_chat_id: fromChatId, message_id: messageId, ...extra,
  });
}

function copyMessage(token, toChatId, fromChatId, messageId, extra = {}) {
  return apiCall(token, 'copyMessage', {
    chat_id: toChatId, from_chat_id: fromChatId, message_id: messageId, ...extra,
  });
}

function pinChatMessage(token, chatId, messageId, disableNotification = false) {
  return apiCall(token, 'pinChatMessage', {
    chat_id: chatId, message_id: messageId, disable_notification: disableNotification,
  });
}

function unpinChatMessage(token, chatId, messageId) {
  return apiCall(token, 'unpinChatMessage', { chat_id: chatId, message_id: messageId });
}

function unpinAllChatMessages(token, chatId) {
  return apiCall(token, 'unpinAllChatMessages', { chat_id: chatId });
}

function sendPhoto(token, chatId, photo, extra = {}) {
  return apiCall(token, 'sendPhoto', { chat_id: chatId, photo, ...extra });
}

function sendDocument(token, chatId, document, extra = {}) {
  return apiCall(token, 'sendDocument', { chat_id: chatId, document, ...extra });
}

function sendAudio(token, chatId, audio, extra = {}) {
  return apiCall(token, 'sendAudio', { chat_id: chatId, audio, ...extra });
}

function sendVideo(token, chatId, video, extra = {}) {
  return apiCall(token, 'sendVideo', { chat_id: chatId, video, ...extra });
}

function sendVoice(token, chatId, voice, extra = {}) {
  return apiCall(token, 'sendVoice', { chat_id: chatId, voice, ...extra });
}

function sendVideoNote(token, chatId, videoNote, extra = {}) {
  return apiCall(token, 'sendVideoNote', { chat_id: chatId, video_note: videoNote, ...extra });
}

function sendSticker(token, chatId, sticker, extra = {}) {
  return apiCall(token, 'sendSticker', { chat_id: chatId, sticker, ...extra });
}

function sendLocation(token, chatId, latitude, longitude, extra = {}) {
  return apiCall(token, 'sendLocation', { chat_id: chatId, latitude, longitude, ...extra });
}

function sendContact(token, chatId, phoneNumber, firstName, extra = {}) {
  return apiCall(token, 'sendContact', { chat_id: chatId, phone_number: phoneNumber, first_name: firstName, ...extra });
}

function sendPoll(token, chatId, question, options, extra = {}) {
  return apiCall(token, 'sendPoll', { chat_id: chatId, question, options, ...extra });
}

function sendDice(token, chatId, emoji = '🎲', extra = {}) {
  return apiCall(token, 'sendDice', { chat_id: chatId, emoji, ...extra });
}

function sendMediaGroup(token, chatId, media, extra = {}) {
  return apiCall(token, 'sendMediaGroup', { chat_id: chatId, media, ...extra });
}

function editMessageCaption(token, chatId, messageId, caption, extra = {}) {
  return apiCall(token, 'editMessageCaption', { chat_id: chatId, message_id: messageId, caption, ...extra });
}

function editMessageMedia(token, chatId, messageId, media, extra = {}) {
  return apiCall(token, 'editMessageMedia', { chat_id: chatId, message_id: messageId, media, ...extra });
}

function getChat(token, chatId) {
  return apiCall(token, 'getChat', { chat_id: chatId });
}

function getChatMember(token, chatId, userId) {
  return apiCall(token, 'getChatMember', { chat_id: chatId, user_id: userId });
}

function getChatMemberCount(token, chatId) {
  return apiCall(token, 'getChatMemberCount', { chat_id: chatId });
}

function banChatMember(token, chatId, userId, extra = {}) {
  return apiCall(token, 'banChatMember', { chat_id: chatId, user_id: userId, ...extra });
}

function unbanChatMember(token, chatId, userId, extra = {}) {
  return apiCall(token, 'unbanChatMember', { chat_id: chatId, user_id: userId, ...extra });
}

function restrictChatMember(token, chatId, userId, permissions, extra = {}) {
  return apiCall(token, 'restrictChatMember', { chat_id: chatId, user_id: userId, permissions, ...extra });
}

function promoteChatMember(token, chatId, userId, extra = {}) {
  return apiCall(token, 'promoteChatMember', { chat_id: chatId, user_id: userId, ...extra });
}

function leaveChat(token, chatId) {
  return apiCall(token, 'leaveChat', { chat_id: chatId });
}

function setMessageReaction(token, chatId, messageId, reaction, extra = {}) {
  return apiCall(token, 'setMessageReaction', { chat_id: chatId, message_id: messageId, reaction, ...extra });
}

function getUserProfilePhotos(token, userId, extra = {}) {
  return apiCall(token, 'getUserProfilePhotos', { user_id: userId, ...extra });
}

// ---- Update handling ----
async function handleMessage(token, msg) {
  const chatId = msg.chat.id;
  const text = (msg.text || '').trim();
  const prefix = config.prefix || '/';

  if (!text.startsWith(prefix)) return;

  const ctx = buildCtx(token, chatId);
  ctx.raw = msg;

  // User typed bare prefix — acknowledge it
  if (text === prefix) {
    return ctx.reply(
      `👋 Yes! <b>${prefix}</b> is my command prefix.\n\nUse ${prefix}help to see all available commands.`,
      { parse_mode: 'HTML' }
    ).catch(() => {});
  }

  const [rawCmd, ...args] = text.split(/\s+/);
  const cmdName = rawCmd.slice(prefix.length).split('@')[0].toLowerCase();

  console.log(`[${new Date().toISOString()}] [msg][${chatId}] ${text}`);

  ctx.args = args;

  const handler = commands.get(cmdName);

  // Unknown command — suggest help
  if (!handler) {
    return ctx.reply(
      `❓ Unknown command: <code>${prefix}${cmdName}</code>\n\nUse ${prefix}help to see all available commands.`,
      { parse_mode: 'HTML' }
    ).catch(() => {});
  }

  try {
    await handler.execute(ctx);
  } catch (err) {
    console.error(`Error running /${cmdName}:`, err.message);
    await ctx.reply('⚠️ Something went wrong processing that command. Please try again.').catch(() => {});
  }
}

async function handleCallbackQuery(token, cq) {
  const data = cq.data || '';
  console.log(`[${new Date().toISOString()}] [cb][${cq.from.id}] ${data}`);

  const cmd = findCommandByCallbackPrefix(data);
  if (!cmd || !cmd.onCallback) {
    return answerCallbackQuery(token, cq.id).catch(() => {});
  }

  const chatId = cq.message.chat.id;
  const ctx = buildCtx(token, chatId);
  ctx.messageId = cq.message.message_id;

  try {
    await cmd.onCallback(ctx, cq);
  } catch (err) {
    console.error(`Error in callback for ${cmd.name}:`, err.message);
    await answerCallbackQuery(token, cq.id, 'An error occurred.', true).catch(() => {});
  }
}

function buildCtx(token, chatId) {
  return {
    chatId,
    commands,

    // ---- Send ----
    reply:             (text, extra)              => sendMessage(token, chatId, text, extra),
    replyWithHTML:     (text, extra = {})         => sendMessage(token, chatId, text, { parse_mode: 'HTML', ...extra }),
    replyWithMarkdown: (text, extra = {})         => sendMessage(token, chatId, text, { parse_mode: 'MarkdownV2', ...extra }),
    sendPhoto:         (photo, extra)             => sendPhoto(token, chatId, photo, extra),
    sendDocument:      (document, extra)          => sendDocument(token, chatId, document, extra),
    sendAudio:         (audio, extra)             => sendAudio(token, chatId, audio, extra),
    sendVideo:         (video, extra)             => sendVideo(token, chatId, video, extra),
    sendVoice:         (voice, extra)             => sendVoice(token, chatId, voice, extra),
    sendVideoNote:     (videoNote, extra)         => sendVideoNote(token, chatId, videoNote, extra),
    sendSticker:       (sticker, extra)           => sendSticker(token, chatId, sticker, extra),
    sendLocation:      (lat, lng, extra)          => sendLocation(token, chatId, lat, lng, extra),
    sendContact:       (phone, firstName, extra)  => sendContact(token, chatId, phone, firstName, extra),
    sendPoll:          (question, options, extra) => sendPoll(token, chatId, question, options, extra),
    sendDice:          (emoji, extra)             => sendDice(token, chatId, emoji, extra),
    sendMediaGroup:    (media, extra)             => sendMediaGroup(token, chatId, media, extra),
    sendMediaFile:     (filePath, type, extra)    => sendMediaFile(token, chatId, filePath, type, extra),

    // ---- Edit ----
    editText:          (messageId, text, extra)   => editMessageText(token, chatId, messageId, text, extra),
    editReplyMarkup:   (messageId, markup)        => editMessageReplyMarkup(token, chatId, messageId, markup),
    editCaption:       (messageId, caption, extra)=> editMessageCaption(token, chatId, messageId, caption, extra),
    editMedia:         (messageId, media, extra)  => editMessageMedia(token, chatId, messageId, media, extra),

    // ---- Delete / Pin ----
    deleteMessage:     (messageId)                => deleteMessage(token, chatId, messageId),
    pin:               (messageId, silent)        => pinChatMessage(token, chatId, messageId, silent),
    unpin:             (messageId)                => unpinChatMessage(token, chatId, messageId),
    unpinAll:          ()                         => unpinAllChatMessages(token, chatId),

    // ---- Forward / Copy ----
    forwardTo:         (toChatId, messageId, extra)           => forwardMessage(token, toChatId, chatId, messageId, extra),
    forwardFrom:       (fromChatId, messageId, extra)         => forwardMessage(token, chatId, fromChatId, messageId, extra),
    copyTo:            (toChatId, messageId, extra)           => copyMessage(token, toChatId, chatId, messageId, extra),
    copyFrom:          (fromChatId, messageId, extra)         => copyMessage(token, chatId, fromChatId, messageId, extra),

    // ---- Reactions ----
    react:             (messageId, reaction, extra) => setMessageReaction(token, chatId, messageId, reaction, extra),

    // ---- Chat actions & info ----
    chatAction:        (action)                   => sendChatAction(token, chatId, action),
    getChat:           ()                         => getChat(token, chatId),
    getChatMember:     (userId)                   => getChatMember(token, chatId, userId),
    getChatMemberCount:()                         => getChatMemberCount(token, chatId),
    leaveChat:         ()                         => leaveChat(token, chatId),

    // ---- Moderation ----
    ban:               (userId, extra)            => banChatMember(token, chatId, userId, extra),
    unban:             (userId, extra)            => unbanChatMember(token, chatId, userId, extra),
    restrict:          (userId, permissions, extra) => restrictChatMember(token, chatId, userId, permissions, extra),
    promote:           (userId, extra)            => promoteChatMember(token, chatId, userId, extra),

    // ---- Callbacks ----
    answerCallback:    (callbackQueryId, text, showAlert) =>
                         answerCallbackQuery(token, callbackQueryId, text, showAlert),

    // ---- Files ----
    downloadFile:      (fileId, destPath)         => downloadTelegramFile(token, fileId, destPath),
    getUserPhotos:     (userId, extra)            => getUserProfilePhotos(token, userId, extra),
  };
}

// ---- Main polling loop ----
async function poll(token) {
  while (running) {
    try {
      const updates = await getUpdates(token);
      backoff = 1000;

      for (const update of updates) {
        offset = update.update_id + 1;

        // Fire-and-forget: do NOT await each update's handler here.
        // Awaiting would block getUpdates() from being called again until
        // the current update (e.g. a multi-minute ffmpeg conversion in
        // link.js) finishes, causing any callback queries that arrive in
        // the meantime to sit unprocessed until they expire on Telegram's
        // side ("query is too old").
        if (update.message) {
          handleMessage(token, update.message).catch((err) => {
            console.error('Unhandled error in handleMessage:', err.message);
          });
        } else if (update.callback_query) {
          handleCallbackQuery(token, update.callback_query).catch((err) => {
            console.error('Unhandled error in handleCallbackQuery:', err.message);
          });
        }
      }
    } catch (err) {
      // 409 Conflict = another instance (e.g. Render deployment) is already polling.
      // Stop this instance immediately rather than fighting in a retry loop.
      if (err.message && err.message.includes('Conflict:')) {
        console.error('[bot] Polling conflict — another instance is already running. Stopping local polling.');
        running = false;
        return;
      }
      console.error('Polling error:', err.message);
      console.log(`Retrying in ${backoff / 1000}s...`);
      await sleep(backoff);
      backoff = Math.min(backoff * 2, MAX_BACKOFF);
    }
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---- Graceful shutdown ----
function setupShutdown() {
  const shutdown = (signal) => {
    console.log(`Received ${signal}, shutting down...`);
    running = false;
    setTimeout(() => process.exit(0), 500);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

function ensureCommandsLoaded() {
  if (!commandsLoaded) {
    loadCommands();
    commandsLoaded = true;
  }
}

async function startBot(token) {
  setupShutdown();
  loadConfig();
  ensureCommandsLoaded();

  // Clear any registered webhook before polling.
  // Telegram rejects getUpdates with a conflict error if a webhook is active.
  try {
    await apiCall(token, 'deleteWebhook', { drop_pending_updates: false });
    console.log('[bot] Webhook cleared — polling mode active.');
  } catch (err) {
    console.warn('[bot] Could not clear webhook (continuing anyway):', err.message);
  }

  console.log(`[bot] Polling started with ${commands.size} command(s) loaded.`);
  console.log(`[bot] Using prefix: "${config.prefix}"`);

  // Notify admin that bot is online
  if (config.adminId && config.logAdminNotifications) {
    const timestamp = new Date().toISOString();
    const adminMsg = `🟢 <b>${config.botName}</b> is online!\n\n` +
      `⏰ <code>${timestamp}</code>\n` +
      `📋 Commands loaded: <b>${commands.size}</b>\n` +
      `🔧 Prefix: <code>${config.prefix}</code>\n` +
      `🌐 Mode: <b>polling</b>`;

    try {
      await sendMessage(token, config.adminId, adminMsg, { parse_mode: 'HTML' });
      console.log(`[bot] Admin notification sent to ${config.adminId}`);
    } catch (err) {
      console.warn(`[bot] Could not notify admin (${config.adminId}):`, err.message);
    }
  }

  poll(token);
}

// Single-update handler for serverless/webhook environments.
async function handleUpdate(token, update) {
  ensureCommandsLoaded();
  if (!config) loadConfig();
  if (update.message) await handleMessage(token, update.message);
  else if (update.callback_query) await handleCallbackQuery(token, update.callback_query);
}

module.exports = { startBot, handleUpdate };