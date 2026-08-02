module.exports = {
  name:        'help',
  version:     '1.1.0',
  description: 'Lists all available commands.',
  usage:       '/help',
  aliases:     ['commands'],

  async execute(ctx) {
    const seen  = new Set();
    const byCategory = {};

    for (const cmd of ctx.commands.values()) {
      if (seen.has(cmd.name)) continue;
      seen.add(cmd.name);
      const cat = cmd.category || 'General';
      if (!byCategory[cat]) byCategory[cat] = [];
      byCategory[cat].push(`${cmd.usage} — ${cmd.description}`);
    }

    const sections = Object.entries(byCategory)
      .map(([cat, lines]) => `<b>${cat}</b>\n${lines.join('\n')}`)
      .join('\n\n');

    await ctx.replyWithHTML(
      `${sections}\n\n` +
      `<i>🤖 MJL Bot — by <a href="https://github.com/WangWengPlayz">@WangWengPlayz</a></i>`
    );
  },
};
