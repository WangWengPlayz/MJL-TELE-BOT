// ============================================================
//  COMMAND  —  announce  (Admin only)
//  /announce <message>
//  Sends a styled announcement to the chat.
// ============================================================

module.exports = {
  name:        'announce',
  version:     '1.0.0',
  description: 'Send a styled announcement to the chat.',
  usage:       '/announce <message>',
  category:    'Admin',
  permission:  2,
  cooldown:    0,
  aliases:     ['ann', 'broadcast'],

  async execute(ctx) {
    const text = ctx.args.join(' ').trim();

    if (!text) {
      return ctx.replyWithHTML(
        '📢 <b>Usage:</b> <code>/announce &lt;message&gt;</code>\n\n' +
        'Example: <code>/announce Server will restart in 5 minutes!</code>'
      );
    }

    const botName = ctx.config?.botName || 'Bot';
    const now     = new Date().toLocaleString('en-US', {
      hour: '2-digit', minute: '2-digit',
      day: '2-digit', month: 'short', year: 'numeric',
    });

    // Delete the command message silently
    if (ctx.raw?.message_id) {
      await ctx.deleteMessage(ctx.raw.message_id).catch(() => {});
    }

    await ctx.replyWithHTML(
      `📢 <b>Announcement</b>\n` +
      `${'─'.repeat(30)}\n\n` +
      `${escapeHtml(text)}\n\n` +
      `${'─'.repeat(30)}\n` +
      `<i>🤖 ${escapeHtml(botName)}  •  ${now}</i>`
    );
  },
};

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
