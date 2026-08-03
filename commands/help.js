// ============================================================
//  COMMAND  —  help  v2.0
//  /help [command]
//  Paginated command list (10 per page), prev/next buttons,
//  admin-only filtering, auto-delete timer.
// ============================================================

const PAGE_SIZE      = 10;
const DELETE_AFTER   = 120_000; // 2 minutes in ms
const DELETE_NOTICE  = '2 min';

const CATEGORY_ICONS = {
  Fun:     '🎮',
  Media:   '🎬',
  Utility: '🔧',
  Admin:   '🛡️',
  General: '💬',
};
const DEFAULT_ICON = '📌';

// ── Helpers ───────────────────────────────────────────────────────────────────

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function isAdmin(userId, cfg) {
  return cfg && cfg.adminId && Number(userId) === Number(cfg.adminId);
}

/**
 * Build a deduplicated, permission-filtered, sorted command list.
 * Admins see everything; members only see permission === 1.
 */
function buildCommandList(commands, userIsAdmin) {
  const seen = new Set();
  const list = [];

  for (const cmd of commands.values()) {
    if (seen.has(cmd.name)) continue;
    seen.add(cmd.name);
    const perm = cmd.permission || 1;
    if (!userIsAdmin && perm === 2) continue;
    list.push(cmd);
  }

  // Sort: category a→z, then name a→z
  list.sort((a, b) => {
    const ca = a.category || 'General';
    const cb = b.category || 'General';
    if (ca !== cb) return ca.localeCompare(cb);
    return a.name.localeCompare(b.name);
  });

  return list;
}

/**
 * Render a single page of the help list.
 * Returns { text, reply_markup }.
 */
function buildHelpPage(list, page, callerId, userIsAdmin) {
  const total    = Math.ceil(list.length / PAGE_SIZE) || 1;
  const safePage = Math.max(0, Math.min(page, total - 1));
  const start    = safePage * PAGE_SIZE;
  const slice    = list.slice(start, start + PAGE_SIZE);

  // Group slice by category
  const byCategory = {};
  for (const cmd of slice) {
    const cat = cmd.category || 'General';
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push(cmd);
  }

  // Header
  let text = `🤖 <b>MJL Bot — Commands</b>`;
  if (total > 1) text += `  <code>[${safePage + 1} / ${total}]</code>`;
  if (userIsAdmin) text += `  🛡️`;
  text += `\n${'─'.repeat(30)}\n\n`;

  // Command sections
  for (const [cat, cmds] of Object.entries(byCategory)) {
    const icon = CATEGORY_ICONS[cat] || DEFAULT_ICON;
    text += `${icon} <b>${escapeHtml(cat)}</b>\n`;
    for (const cmd of cmds) {
      const permTag = cmd.permission === 2 ? ' <i>[admin]</i>' : '';
      text += `  /<code>${escapeHtml(cmd.name)}</code> — ${escapeHtml(cmd.description)}${permTag}\n`;
    }
    text += '\n';
  }

  text += `${'─'.repeat(30)}\n`;
  text += `💡 <code>/help &lt;command&gt;</code> for details\n`;
  text += `⏱ <i>Auto-deletes in ${DELETE_NOTICE}</i>`;

  // Navigation buttons
  const navRow = [];
  if (safePage > 0) {
    navRow.push({ text: '← Previous', callback_data: `help:nav:${safePage - 1}:${callerId}` });
  }
  if (safePage < total - 1) {
    navRow.push({ text: 'Next →', callback_data: `help:nav:${safePage + 1}:${callerId}` });
  }

  const reply_markup = navRow.length > 0 ? { inline_keyboard: [navRow] } : undefined;

  return { text, reply_markup };
}

// ── Module export ─────────────────────────────────────────────────────────────

module.exports = {
  name:           'help',
  version:        '2.0.0',
  description:    'Show all commands with pagination. Use /help <command> for details.',
  usage:          '/help [command]',
  category:       'General',
  permission:     1,
  aliases:        ['commands', 'h'],
  callbackPrefix: 'help:',
  onCallback,
  execute,
};

// ── Main handler ──────────────────────────────────────────────────────────────
async function execute(ctx) {
  const { args, config: cfg, commands } = ctx;
  const callerId   = ctx.raw?.from?.id;
  const userIsAdmin = isAdmin(callerId, cfg);

  // ── /help <command> — detail view ──
  if (args && args.length > 0) {
    const cmdName = args[0].replace(/^\//, '').toLowerCase();
    const cmd = commands.get(cmdName);

    if (!cmd) {
      return ctx.replyWithHTML(
        `❌ Unknown command: <code>${escapeHtml(cmdName)}</code>\n\nUse <code>/help</code> to see all commands.`
      );
    }

    // Members can't see admin command details
    if (!userIsAdmin && cmd.permission === 2) {
      return ctx.replyWithHTML('🔒 <b>Admin only.</b> You don\'t have permission to view this command.');
    }

    const aliases = cmd.aliases?.length
      ? `\n🔗 <b>Aliases:</b> ${cmd.aliases.map((a) => `<code>${escapeHtml(a)}</code>`).join(', ')}`
      : '';
    const permLabel = cmd.permission === 2 ? '\n🛡️ <b>Permission:</b> Admin only' : '\n👥 <b>Permission:</b> Members';

    return ctx.replyWithHTML(
      `📖 <b>/${escapeHtml(cmd.name)}</b>  <code>v${escapeHtml(cmd.version)}</code>\n\n` +
      `📝 ${escapeHtml(cmd.description)}\n\n` +
      `<b>Usage:</b> <code>${escapeHtml(cmd.usage || `/${cmd.name}`)}</code>` +
      aliases + permLabel
    );
  }

  // ── /help — full paginated list ──
  const list = buildCommandList(commands, userIsAdmin);
  const { text, reply_markup } = buildHelpPage(list, 0, callerId, userIsAdmin);

  const sent = await ctx.replyWithHTML(text, reply_markup ? { reply_markup } : {});

  // Auto-delete after timeout
  setTimeout(() => {
    ctx.deleteMessage(sent.message_id).catch(() => {});
  }, DELETE_AFTER);
}

// ── Callback handler (pagination buttons) ────────────────────────────────────
async function onCallback(ctx, cq) {
  // Callback data: help:nav:<page>:<originalCallerId>
  const parts          = cq.data.split(':');
  const page           = parseInt(parts[2], 10) || 0;
  const originalCaller = parts[3];
  const presserId      = String(cq.from.id);

  // Only the person who called /help can navigate
  if (originalCaller && presserId !== String(originalCaller)) {
    return ctx.answerCallback(cq.id, '⚠️ Start your own /help to navigate.', true);
  }

  await ctx.answerCallback(cq.id);

  const { config: cfg, commands } = ctx;
  const userIsAdmin = isAdmin(presserId, cfg);
  const list = buildCommandList(commands, userIsAdmin);
  const { text, reply_markup } = buildHelpPage(list, page, presserId, userIsAdmin);

  await ctx.editText(ctx.messageId, text, {
    parse_mode:   'HTML',
    reply_markup: reply_markup || { inline_keyboard: [] },
  });
}
