module.exports = {
  name: 'uid',
  execute,
  version: '1.0.0',
  description: 'Get your Telegram user ID',
  usage: '/uid',
  category: 'Utility',
  permission: 1,
  cooldown: 3,
  aliases: ['id', 'userid'],
};

async function execute(ctx) {
  const { raw: msg } = ctx;
  const user = msg.from;
  const uid = user?.id;

  if (!uid) {
    return ctx.reply('Could not retrieve user ID.');
  }

  await ctx.replyWithHTML(
    `<b>User ID</b>\n` +
    `<code>${uid}</code>\n\n` +
    `<b>Username:</b> ${user.username ? '@' + user.username : 'None'}\n` +
    `<b>Name:</b> ${[user.first_name, user.last_name].filter(Boolean).join(' ') || 'None'}`
  );
}