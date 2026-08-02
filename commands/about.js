module.exports = {
  name:        'about',
  version:     '1.0.0',
  description: 'About this bot and its creator.',
  usage:       '/about',
  aliases:     ['info', 'credits'],

  async execute(ctx) {
    await ctx.replyWithHTML(
      `<b>MJL Telegram Bot</b>\n\n` +
      `A lightweight, extensible Telegram bot built with a clean command-based architecture — no heavy frameworks, just pure Node.js.\n\n` +
      `<b>Features</b>\n` +
      `• YouTube downloader (MP4 / MP3)\n` +
      `• Media converter (/link)\n` +
      `• Modular command system — drop a .js file into /commands to add new commands\n\n` +
      `<b>Credits</b>\n` +
      `👤 Created by <b>MJL</b> (<a href="https://github.com/WangWengPlayz">@WangWengPlayz</a>)\n` +
      `📦 Source: <a href="https://github.com/WangWengPlayz/MJL-TELE-BOT">github.com/WangWengPlayz/MJL-TELE-BOT</a>\n\n` +
      `Use /help to see all commands.`
    );
  },
};
