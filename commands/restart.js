// ============================================================
//  COMMAND  —  restart  (Admin only)
//  /restart
//  Gracefully restarts the bot process.
//  The Replit workflow manager automatically relaunches main.js.
// ============================================================

module.exports = {
  name:        'restart',
  version:     '1.0.0',
  description: 'Restart the bot process (workflow manager relaunches automatically).',
  usage:       '/restart',
  category:    'Admin',
  permission:  2,
  aliases:     ['reboot', 'rs'],

  async execute(ctx) {
    const { config: cfg } = ctx;
    const botName = cfg?.botName || 'Bot';

    await ctx.replyWithHTML(
      `🔄 <b>Restarting ${botName}…</b>\n\n` +
      `⏳ The bot will be back online in a few seconds.\n` +
      `Use <code>/ping</code> to confirm it's back.`
    );

    // Small delay so the message reaches Telegram before the process exits
    await new Promise((resolve) => setTimeout(resolve, 800));

    console.log('[restart] Admin triggered restart — exiting process.');
    process.exit(0);  // Replit workflow manager relaunches main.js automatically
  },
};
