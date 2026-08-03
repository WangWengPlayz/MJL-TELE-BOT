module.exports = {
  name: 'groupid',
  execute,
  version: '1.0.0',
  description: 'Get current chat / group / thread ID',
  usage: '/thread',
  category: 'Utility',
  permission: 1,
  cooldown: 3,
  aliases: ['chatid', 'gid', 'gd'],
};

async function execute(ctx) {
  const { raw: msg } = ctx;
  const chat = msg.chat;
  const threadId = msg.message_thread_id;

  if (!chat?.id) {
    return ctx.reply('Could not retrieve chat ID.');
  }

  let text =
    `<b>Chat ID</b>\n` +
    `<code>${chat.id}</code>\n\n` +
    `<b>Type:</b> ${chat.type}\n` +
    `<b>Title:</b> ${chat.title || chat.first_name || 'None'}`;

  if (chat.username) {
    text += `\n<b>Username:</b> @${chat.username}`;
  }

  if (threadId) {
    text += `\n\n<b>Thread ID</b>\n<code>${threadId}</code>`;
  }

  await ctx.replyWithHTML(text);
}