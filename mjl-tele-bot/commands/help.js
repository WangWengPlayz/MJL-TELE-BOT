module.exports = {
  name: 'help',
  version: '1.0.0',
  description: 'Lists all available commands.',
  usage: '/help',
  aliases: ['commands'],

  async execute(ctx) {
    const seen = new Set();
    const lines = [];

    for (const cmd of ctx.commands.values()) {
      if (seen.has(cmd.name)) continue;
      seen.add(cmd.name);
      lines.push(`${cmd.usage} — ${cmd.description} (v${cmd.version})`);
    }

    await ctx.reply(`Available commands:\n${lines.join('\n')}`);
  },
};