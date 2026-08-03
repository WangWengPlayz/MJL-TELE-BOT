// ============================================================
//  COMMAND  —  userinfo  (Admin only)
//  /userinfo  (reply to a message)
//  Shows detailed info about a user.
// ============================================================

module.exports = {
  name:        'userinfo',
  version:     '1.0.0',
  description: 'Show info about a user (reply to their message).',
  usage:       '/userinfo  (reply to a message)',
  category:    'Admin',
  permission:  2,
  cooldown:    0,
  aliases:     ['ui', 'whois'],

  async execute(ctx) {
    const msg    = ctx.raw;
    const target = msg?.reply_to_message?.from;

    if (!target) {
      return ctx.replyWithHTML(
        '👤 <b>Usage:</b> Reply to someone\'s message, then run <code>/userinfo</code>.'
      );
    }

    await ctx.chatAction('typing');

    // Basic fields
    const id        = target.id;
    const firstName = escapeHtml(target.first_name || '');
    const lastName  = escapeHtml(target.last_name  || '');
    const username  = target.username ? `@${escapeHtml(target.username)}` : '—';
    const fullName  = [firstName, lastName].filter(Boolean).join(' ');
    const isBot     = target.is_bot ? '🤖 Yes' : '👤 No';
    const langCode  = target.language_code ? target.language_code.toUpperCase() : '—';

    // Chat member info (status in this chat)
    let memberStatus = '—';
    let extraLines   = '';
    try {
      const member = await ctx.getChatMember(id);
      const STATUS_LABELS = {
        creator:       '👑 Owner',
        administrator: '🛡️ Admin',
        member:        '👥 Member',
        restricted:    '🔇 Restricted',
        left:          '🚪 Left',
        kicked:        '🚫 Banned',
      };
      memberStatus = STATUS_LABELS[member.status] || member.status;

      if (member.status === 'administrator' && member.custom_title) {
        extraLines += `\n🏷 <b>Admin title:</b> ${escapeHtml(member.custom_title)}`;
      }
      if (member.status === 'restricted') {
        const until = member.until_date
          ? new Date(member.until_date * 1000).toUTCString()
          : 'forever';
        extraLines += `\n⏳ <b>Restricted until:</b> ${until}`;
      }
    } catch {}

    // Profile photo count
    let photoInfo = '—';
    try {
      const photos = await ctx.getUserPhotos(id, { limit: 1 });
      photoInfo = photos.total_count > 0 ? `📷 ${photos.total_count} photo(s)` : '🚫 None';
    } catch {}

    const isAdminBool = ctx.isAdminUser(id);
    const adminTag    = isAdminBool ? '  🛡️ <i>(Bot Admin)</i>' : '';

    await ctx.replyWithHTML(
      `👤 <b>User Info</b>\n` +
      `${'─'.repeat(30)}\n\n` +
      `🪪 <b>Name:</b> ${fullName}${adminTag}\n` +
      `🔖 <b>Username:</b> ${username}\n` +
      `🆔 <b>ID:</b> <code>${id}</code>\n` +
      `🤖 <b>Is Bot:</b> ${isBot}\n` +
      `🌐 <b>Language:</b> ${langCode}\n` +
      `📊 <b>Chat status:</b> ${memberStatus}` +
      extraLines + '\n' +
      `🖼 <b>Photos:</b> ${photoInfo}\n` +
      `${'─'.repeat(30)}\n` +
      `<i>Tap the ID to copy</i>`
    );
  },
};

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
