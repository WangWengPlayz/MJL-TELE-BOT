// ============================================================
//  COMMAND  —  unmute  (Admin only)
//  /unmute  (reply to a message)
//  Restores a muted user's ability to send messages.
// ============================================================

module.exports = {
  name:        'unmute',
  version:     '1.0.0',
  description: 'Unmute a restricted user (reply to their message).',
  usage:       '/unmute  (reply to message)',
  category:    'Admin',
  permission:  2,
  cooldown:    0,
  aliases:     ['um'],

  async execute(ctx) {
    const msg    = ctx.raw;
    const target = msg?.reply_to_message?.from;

    if (!target) {
      return ctx.replyWithHTML(
        '🔊 <b>Usage:</b> Reply to a muted user\'s message, then run <code>/unmute</code>.'
      );
    }

    const name     = escapeHtml(getDisplayName(target));
    const username = target.username ? ` (@${escapeHtml(target.username)})` : '';

    const FULL_PERMISSIONS = {
      can_send_messages:         true,
      can_send_audios:           true,
      can_send_documents:        true,
      can_send_photos:           true,
      can_send_videos:           true,
      can_send_video_notes:      true,
      can_send_voice_notes:      true,
      can_send_polls:            true,
      can_send_other_messages:   true,
      can_add_web_page_previews: true,
    };

    try {
      await ctx.restrict(target.id, FULL_PERMISSIONS);

      if (msg.message_id) await ctx.deleteMessage(msg.message_id).catch(() => {});

      await ctx.replyWithHTML(
        `🔊 <b>User Unmuted</b>\n` +
        `${'─'.repeat(28)}\n\n` +
        `👤 <b>User:</b> ${name}${username}\n` +
        `🆔 <b>ID:</b> <code>${target.id}</code>\n\n` +
        `<i>They can now send messages again.</i>`
      );
    } catch (err) {
      await ctx.replyWithHTML(
        `❌ <b>Failed to unmute</b>\n<code>${escapeHtml(err.message)}</code>\n\n` +
        `<i>Make sure the bot is an admin with restrict permissions.</i>`
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
