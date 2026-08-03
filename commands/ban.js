// ============================================================
//  COMMAND  —  ban  (Admin only)
//  /ban  (reply to a message)  [reason]
//  Permanently bans a user from the chat.
// ============================================================

module.exports = {
  name:        'ban',
  version:     '1.0.0',
  description: 'Permanently ban a user (reply to their message).',
  usage:       '/ban  (reply to message)  [reason]',
  category:    'Admin',
  permission:  2,
  cooldown:    0,
  aliases:     ['b'],

  async execute(ctx) {
    const msg    = ctx.raw;
    const target = msg?.reply_to_message?.from;

    if (!target) {
      return ctx.replyWithHTML(
        '🚫 <b>Usage:</b> Reply to a message, then run <code>/ban [reason]</code>.'
      );
    }

    if (ctx.isAdminUser(target.id)) {
      return ctx.replyWithHTML('⚠️ Cannot ban another bot admin.');
    }

    if (target.is_bot) {
      return ctx.replyWithHTML('⚠️ Cannot ban a bot through this command. Remove it via chat settings.');
    }

    const reason   = ctx.args.join(' ').trim() || 'No reason provided';
    const name     = escapeHtml(getDisplayName(target));
    const username = target.username ? ` (@${escapeHtml(target.username)})` : '';

    try {
      await ctx.ban(target.id, { revoke_messages: false });

      // Delete command message
      if (msg.message_id) await ctx.deleteMessage(msg.message_id).catch(() => {});

      await ctx.replyWithHTML(
        `🚫 <b>User Banned</b>\n` +
        `${'─'.repeat(28)}\n\n` +
        `👤 <b>User:</b> ${name}${username}\n` +
        `🆔 <b>ID:</b> <code>${target.id}</code>\n` +
        `📝 <b>Reason:</b> ${escapeHtml(reason)}`
      );
    } catch (err) {
      await ctx.replyWithHTML(
        `❌ <b>Failed to ban</b>\n<code>${escapeHtml(err.message)}</code>\n\n` +
        `<i>Make sure the bot is an admin with ban permissions.</i>`
      );
    }
  },
};

function getDisplayName(user) {
  return [user.first_name, user.last_name].filter(Boolean).join(' ') || 'Unknown';
}

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
