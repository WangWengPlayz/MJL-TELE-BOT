module.exports = {
  name:        'ping',
  version:     '1.1.0',
  description: 'Check if the bot is responsive and measure round-trip latency.',
  usage:       '/ping',
  category:    'Utility',
  aliases:     [],

  async execute(ctx) {
    const start = Date.now();
    const sent  = await ctx.reply('🏓 Pinging…');
    const ms    = Date.now() - start;

    const bar   = ms < 100 ? '🟢' : ms < 300 ? '🟡' : '🔴';
    await ctx.editText(
      sent.message_id,
      `🏓 <b>Pong!</b>\n${bar} Latency: <code>${ms} ms</code>`,
      { parse_mode: 'HTML' }
    );
  },
};
