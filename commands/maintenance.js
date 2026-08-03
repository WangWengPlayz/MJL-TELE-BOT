// ============================================================
//  COMMAND  —  maintenance  (Admin only)
//  /maintenance [on | off]
//  Toggle maintenance mode — blocks all non-admin commands.
// ============================================================

module.exports = {
  name:        'maintenance',
  version:     '1.0.0',
  description: 'Toggle maintenance mode (blocks non-admin commands).',
  usage:       '/maintenance [on | off]',
  category:    'Admin',
  permission:  2,
  cooldown:    0,
  aliases:     ['maint', 'mt'],

  async execute(ctx) {
    const arg     = (ctx.args[0] || '').toLowerCase();
    const current = ctx.getMaintenance();

    // No argument — show current status
    if (!arg) {
      const status = current ? '🔧 ON (members are blocked)' : '✅ OFF (normal operation)';
      return ctx.replyWithHTML(
        `🔧 <b>Maintenance Mode</b>\n\n` +
        `Current status: <b>${status}</b>\n\n` +
        `Toggle:\n` +
        `  <code>/maintenance on</code>\n` +
        `  <code>/maintenance off</code>`
      );
    }

    if (arg !== 'on' && arg !== 'off') {
      return ctx.replyWithHTML('❌ Invalid option. Use <code>/maintenance on</code> or <code>/maintenance off</code>.');
    }

    const enable = arg === 'on';

    if (enable === current) {
      return ctx.replyWithHTML(`ℹ️ Maintenance mode is already <b>${arg.toUpperCase()}</b>.`);
    }

    ctx.setMaintenance(enable);

    if (enable) {
      await ctx.replyWithHTML(
        `🔧 <b>Maintenance Mode — ENABLED</b>\n\n` +
        `All member commands are now blocked.\n` +
        `Only admins can use the bot.\n\n` +
        `Disable with: <code>/maintenance off</code>`
      );
    } else {
      await ctx.replyWithHTML(
        `✅ <b>Maintenance Mode — DISABLED</b>\n\n` +
        `The bot is back online for all members.`
      );
    }
  },
};
