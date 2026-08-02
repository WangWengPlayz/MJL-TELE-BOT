// ============================================================
//  COMMAND  —  /c
//  Logs to the console whenever a user types /c
// ============================================================

module.exports = {

  // ── Required ─────────────────────────────────────────────
  name:    'c',
  execute,

  // ── Metadata (shown in /help) ─────────────────────────────
  version:     '1.0.0',
  description: 'Logs a message to the console.',
  usage:       '/c [optional-arg]',
  category:    'General',
  aliases:     [],

};

// ── Main handler ────────────────────────────────────────────
async function execute(ctx) {
  const { args, raw: msg } = ctx;
  const username = msg.from?.username ? `@${msg.from.username}` : msg.from?.first_name;

  console.log(`[/c] triggered by ${username} in chat ${ctx.chatId} with args: ${args.join(', ') || '(none)'}`);

  await ctx.reply('Logged to console ✅');
}