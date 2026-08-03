// ============================================================
//  COMMAND  —  echo  (Admin only)
//  /echo <message>
//  Bot sends the text and deletes the original command.
// ============================================================

module.exports = {
  name:        'echo',
  version:     '1.0.0',
  description: 'Make the bot say something (deletes your command message).',
  usage:       '/echo <message>',
  category:    'Admin',
  permission:  2,
  cooldown:    0,
  aliases:     ['say'],

  async execute(ctx) {
    const text = ctx.args.join(' ').trim();

    if (!text) {
      return ctx.replyWithHTML('💬 <b>Usage:</b> <code>/echo &lt;message&gt;</code>');
    }

    // Delete the command message first
    if (ctx.raw?.message_id) {
      await ctx.deleteMessage(ctx.raw.message_id).catch(() => {});
    }

    await ctx.reply(text);
  },
};
