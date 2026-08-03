// ============================================================
//  COMMAND  —  kick  (Admin only)
//  /kick  (reply to a message)  [reason]
//  Kicks a user (bans then immediately unbans — they can rejoin).
// ============================================================

module.exports = {
  name:        'kick',
  version:     '1.0.0',
  description: 'Kick a user from the chat (they can rejoin). Reply to their message.',
  usage:       '/kick  (reply to message)  [reason]',
  category:    'Admin',
  permission:  2,
  cooldown:    0,
  aliases:     ['k'],

  async execute(ctx) {
    const msg    = ctx.raw;
    const target = msg?.reply_to_message?.from;

    if (!target) {
      return ctx.replyWithHTML(
        '👢 <b>Usage:</b> Reply to a message, then run <code>/kick [reason]</code>.'
      );
    }

    if (ctx.isAdminUser(target.id)) {
      return ctx.replyWithHTML('⚠️ Cannot kick another bot admin.');
    }

    if (target.is_bot) {
      return ctx.replyWithHTML('⚠️ Cannot kick a bot through this command. Remove it via chat settings.');
    }

    const reason   = ctx.args.join(' ').trim() || 'No reason provided';
    const name     = escapeHtml(getDisplayName(target));
    const username = target.username ? ` (@${escapeHtml(target.username)})` : '';

    try {
      // Ban then immediately unban = kick (user can rejoin via invite link)
      await ctx.ban(target.id);
      await ctx.unban(target.id, { only_if_banned: true });

      if (msg.message_id) await ctx.deleteMessage(msg.message_id).catch(() => {});

      await ctx.replyWithHTML(
        `👢 <b>User Kicked</b>\n` +
        `${'─'.repeat(28)}\n\n` +
        `👤 <b>User:</b> ${name}${username}\n` +
        `🆔 <b>ID:</b> <code>${target.id}</code>\n` +
        `📝 <b>Reason:</b> ${escapeHtml(reason)}\n\n` +
        `<i>They can rejoin via an invite link.</i>`
      );
    } catch (err) {
      await ctx.replyWithHTML(
        `❌ <b>Failed to kick</b>\n<code>${escapeHtml(err.message)}</code>\n\n` +
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
