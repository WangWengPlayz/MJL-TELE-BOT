function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

module.exports = {
  name:        'help',
  version:     '1.2.0',
  description: 'Shows help for all commands or a specific command.',
  usage:       '/help [command]',
  aliases:     ['commands', 'h'],

  async execute(ctx) {
    const { args } = ctx;

    // Show help for specific command
    if (args && args.length > 0) {
      const cmdName = args[0].toLowerCase();
      const cmd = ctx.commands.get(cmdName);

      if (!cmd) {
        return ctx.replyWithHTML(
          `❌ Command not found: <code>${escapeHtml(cmdName)}</code>\n\nUse <code>/help</code> to see all available commands.`
        );
      }

      const aliases = cmd.aliases && cmd.aliases.length > 0
        ? `\n🔗 Aliases: <code>${cmd.aliases.map(escapeHtml).join('</code>, <code>')}</code>`
        : '';

      const usage = escapeHtml(cmd.usage || `/${cmd.name}`);

      await ctx.replyWithHTML(
        `<b>${escapeHtml(cmd.name)}</b> (v${cmd.version})\n\n` +
        `📝 ${escapeHtml(cmd.description)}\n\n` +
        `<b>Usage:</b>\n<code>${usage}</code>` +
        aliases
      );
      return;
    }

    // Show all commands
    const seen = new Set();
    const byCategory = {};

    for (const cmd of ctx.commands.values()) {
      if (seen.has(cmd.name)) continue;
      seen.add(cmd.name);
      const cat = cmd.category || 'General';
      if (!byCategory[cat]) byCategory[cat] = [];
      byCategory[cat].push(escapeHtml(cmd.usage || `/${cmd.name}`) + ' — ' + escapeHtml(cmd.description));
    }

    const sections = Object.entries(byCategory)
      .map(([cat, lines]) => `<b>${escapeHtml(cat)}</b>\n${lines.join('\n')}`)
      .join('\n\n');

    await ctx.replyWithHTML(
      `${sections}\n\n<i>Use <code>/help &lt;command&gt;</code> for more details about a command.</i>\n\n` +
      `<i>🤖 MJL Bot — by WangWengPlayz</i>`
    );
  },
};
