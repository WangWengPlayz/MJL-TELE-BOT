// ============================================================
//  COMMAND  —  /c
//  Shows a log message directly in the chat
// ============================================================

module.exports = {
  
  // ── Required ─────────────────────────────────────────────
  name: 'c',
  execute,
  
  // ── Metadata (shown in /help) ─────────────────────────────
  version:     '1.0.0',
  description: 'Logs a debug message server-side and echoes it in chat.',
  usage:       '/c [message]',
  category:    'Admin',
  permission:  2,
  aliases:     [],
  
};

// ── Main handler ────────────────────────────────────────────
async function execute(ctx) {
  const { args, raw: msg } = ctx;
  const username = msg.from?.username ? `@${msg.from.username}` : msg.from?.first_name;
  const timestamp = new Date().toISOString();
  
  const logLine = `[LOG] ${timestamp} | user: ${username} | chat: ${ctx.chatId} | args: ${args.join(', ') || '(none)'}`;
  
  // Print to console (server-side)
  console.log(logLine);
  
  // Also send it back in the chat, wrapped in a code block for readability
  await ctx.replyWithHTML(`<pre>${logLine}</pre>`);
}