// ============================================================
//  COMMAND  —  roll
//  /roll [NdN | number | blank]
//  Rolls dice. Supports standard RPG notation: /roll 2d6, /roll d20, /roll 100
// ============================================================

module.exports = {
  name:        'roll',
  version:     '1.0.0',
  description: 'Roll dice. Supports RPG notation like 2d6, d20, or a plain number.',
  usage:       '/roll [NdN | max | blank for d6]',
  category:    'Fun',
  aliases:     ['dice', 'r'],

  async execute(ctx) {
    const input = (ctx.args[0] || '').trim().toLowerCase();

    let rolls = [];
    let sides = 6;
    let count = 1;
    let label = '';

    if (!input) {
      // Default: 1d6
      sides = 6; count = 1;
    } else if (/^\d+d\d+$/.test(input)) {
      // NdN format
      [count, sides] = input.split('d').map(Number);
    } else if (/^d\d+$/.test(input)) {
      // dN format
      sides = Number(input.slice(1)); count = 1;
    } else if (/^\d+$/.test(input)) {
      // Plain number = 1 to N
      sides = Number(input); count = 1;
    } else {
      return ctx.replyWithHTML('❌ Invalid format. Try <code>/roll 2d6</code>, <code>/roll d20</code>, or <code>/roll 100</code>.');
    }

    // Sanity limits
    if (sides < 2 || sides > 1000)  return ctx.reply('⚠️ Sides must be between 2 and 1000.');
    if (count < 1 || count > 20)    return ctx.reply('⚠️ Dice count must be between 1 and 20.');

    for (let i = 0; i < count; i++) {
      rolls.push(Math.floor(Math.random() * sides) + 1);
    }

    const total = rolls.reduce((a, b) => a + b, 0);
    const diceIcon = sides <= 6 ? '🎲' : sides <= 12 ? '🎯' : '🎰';

    let reply = `${diceIcon} <b>Rolling ${count}d${sides}…</b>\n\n`;

    if (count === 1) {
      reply += `Result: <b>${total}</b> / ${sides}`;
    } else {
      reply += `Rolls: ${rolls.map((r) => `<code>${r}</code>`).join(' + ')}\n`;
      reply += `Total: <b>${total}</b>  (min ${count}, max ${count * sides})`;
    }

    // Special outcomes
    if (count === 1 && total === sides) reply += '\n\n🎉 <i>Critical hit! Max roll!</i>';
    if (count === 1 && total === 1)     reply += '\n\n💀 <i>Critical fail! Minimum roll!</i>';

    await ctx.replyWithHTML(reply);
  },
};
