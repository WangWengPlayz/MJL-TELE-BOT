// ============================================================
//  COMMAND  —  rps
//  /rps [rock | paper | scissors]
//  Rock, Paper, Scissors against the bot.
// ============================================================

const CHOICES = ['rock', 'paper', 'scissors'];
const ICONS   = { rock: '🪨', paper: '📄', scissors: '✂️' };

// result[player][bot] → outcome
const RESULT = {
  rock:     { rock: 'draw', paper: 'lose', scissors: 'win'  },
  paper:    { rock: 'win',  paper: 'draw', scissors: 'lose' },
  scissors: { rock: 'lose', paper: 'win',  scissors: 'draw' },
};

module.exports = {
  name:        'rps',
  version:     '1.0.0',
  description: 'Play Rock, Paper, Scissors against the bot.',
  usage:       '/rps [rock | paper | scissors]',
  category:    'Fun',
  permission:  1,
  aliases:     ['rockpaperscissors'],

  async execute(ctx) {
    const input = (ctx.args[0] || '').toLowerCase();

    if (!CHOICES.includes(input)) {
      return ctx.replyWithHTML(
        '🪨📄✂️ <b>Rock, Paper, Scissors</b>\n\nPick one:\n' +
        CHOICES.map((c) => `• <code>/rps ${c}</code>`).join('\n')
      );
    }

    await ctx.chatAction('typing');

    const botPick    = CHOICES[Math.floor(Math.random() * CHOICES.length)];
    const outcome    = RESULT[input][botPick];

    const playerIcon = ICONS[input];
    const botIcon    = ICONS[botPick];

    const OUTCOME_LINES = {
      win:  '🎉 <b>You win!</b> Nice one!',
      lose: '😈 <b>Bot wins!</b> Better luck next time!',
      draw: '🤝 <b>It\'s a draw!</b> Try again?',
    };

    await ctx.replyWithHTML(
      `🪨📄✂️ <b>Rock, Paper, Scissors</b>\n\n` +
      `You:  ${playerIcon} <b>${capitalise(input)}</b>\n` +
      `Bot:  ${botIcon} <b>${capitalise(botPick)}</b>\n\n` +
      OUTCOME_LINES[outcome]
    );
  },
};

function capitalise(str) { return str.charAt(0).toUpperCase() + str.slice(1); }
