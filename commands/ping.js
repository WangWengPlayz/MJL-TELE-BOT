module.exports = {
  name: 'ping',
  version: '1.0.0',
  description: 'Checks if the bot is responsive.',
  usage: '/ping',
  aliases: [],

  async execute(ctx) {
    await ctx.reply('pong');
  },
};