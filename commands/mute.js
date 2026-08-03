// ============================================================
//  COMMAND  —  mute  (Admin only)
//  /mute [duration]  (reply to a message)
//  Restricts a user from sending messages.
//  Duration examples: 10m  2h  1d  (omit = forever)
// ============================================================

module.exports = {
  name:        'mute',
  version:     '1.0.0',
  description: 'Mute a user (reply to message). Duration: 10m, 2h, 1d, or forever.',
  usage:       '/mute [duration]  (reply to message)',
  category:    'Admin',
  permission:  2,
  cooldown:    0,
  aliases:     ['m', 'silence'],

  async execute(ctx) {
    const msg    = ctx.raw;
    const target = msg?.reply_to_message?.from;

    if (!target) {
      return ctx.replyWithHTML(
        '🔇 <b>Usage:</b> Reply to a message, then run <code>/mute [duration]</code>.\n\n' +
        '<b>Duration examples:</b>\n' +
        '  <code>/mute 10m</code> — 10 minutes\n' +
        '  <code>/mute 2h</code>  — 2 hours\n' +
        '  <code>/mute 1d</code>  — 1 day\n' +
        '  <code>/mute</code>     — permanent'
      );
    }

    if (ctx.isAdminUser(target.id)) {
      return ctx.replyWithHTML('⚠️ Cannot mute another bot admin.');
    }

    // Parse duration
    const durationArg = ctx.args[0] || '';
    const { seconds, label } = parseDuration(durationArg);
    const untilDate = seconds > 0 ? Math.floor(Date.now() / 1000) + seconds : 0;

    const name     = escapeHtml(getDisplayName(target));
    const username = target.username ? ` (@${escapeHtml(target.username)})` : '';

    const NO_PERMISSIONS = {
      can_send_messages:       false,
      can_send_audios:         false,
      can_send_documents:      false,
      can_send_photos:         false,
      can_send_videos:         false,
      can_send_video_notes:    false,
      can_send_voice_notes:    false,
      can_send_polls:          false,
      can_send_other_messages: false,
      can_add_web_page_previews: false,
    };

    try {
      await ctx.restrict(target.id, NO_PERMISSIONS, untilDate ? { until_date: untilDate } : {});

      if (msg.message_id) await ctx.deleteMessage(msg.message_id).catch(() => {});

      await ctx.replyWithHTML(
        `🔇 <b>User Muted</b>\n` +
        `${'─'.repeat(28)}\n\n` +
        `👤 <b>User:</b> ${name}${username}\n` +
        `🆔 <b>ID:</b> <code>${target.id}</code>\n` +
        `⏱ <b>Duration:</b> ${label}\n\n` +
        `Use <code>/unmute</code> (reply) to undo.`
      );
    } catch (err) {
      await ctx.replyWithHTML(
        `❌ <b>Failed to mute</b>\n<code>${escapeHtml(err.message)}</code>\n\n` +
        `<i>Make sure the bot is an admin with restrict permissions.</i>`
      );
    }
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseDuration(str) {
  if (!str) return { seconds: 0, label: 'Permanent' };
  const match = str.match(/^(\d+)(s|m|h|d|w)$/i);
  if (!match) return { seconds: 0, label: 'Permanent' };
  const value = parseInt(match[1], 10);
  const unit  = match[2].toLowerCase();
  const UNIT_SECONDS = { s: 1, m: 60, h: 3600, d: 86400, w: 604800 };
  const seconds = value * UNIT_SECONDS[unit];
  const UNIT_LABELS = { s: 'second', m: 'minute', h: 'hour', d: 'day', w: 'week' };
  const label = `${value} ${UNIT_LABELS[unit]}${value !== 1 ? 's' : ''}`;
  return { seconds, label };
}

function getDisplayName(user) {
  return [user.first_name, user.last_name].filter(Boolean).join(' ') || 'Unknown';
}

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
