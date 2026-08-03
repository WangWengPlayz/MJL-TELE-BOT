// ============================================================
//  COMMAND  —  8ball
//  /8ball [question]
//  Ask the magic 8-ball a yes/no question.
// ============================================================

const ANSWERS = [
  // Positive
  { text: 'It is certain.',             type: 'positive' },
  { text: 'It is decidedly so.',        type: 'positive' },
  { text: 'Without a doubt.',           type: 'positive' },
  { text: 'Yes, definitely.',           type: 'positive' },
  { text: 'You may rely on it.',        type: 'positive' },
  { text: 'As I see it, yes.',          type: 'positive' },
  { text: 'Most likely.',               type: 'positive' },
  { text: 'Outlook good.',              type: 'positive' },
  { text: 'Yes.',                       type: 'positive' },
  { text: 'Signs point to yes.',        type: 'positive' },
  // Neutral
  { text: 'Reply hazy, try again.',     type: 'neutral'  },
  { text: 'Ask again later.',           type: 'neutral'  },
  { text: 'Better not tell you now.',   type: 'neutral'  },
  { text: 'Cannot predict now.',        type: 'neutral'  },
  { text: 'Concentrate and ask again.', type: 'neutral'  },
  // Negative
  { text: "Don't count on it.",         type: 'negative' },
  { text: 'My reply is no.',            type: 'negative' },
  { text: 'My sources say no.',         type: 'negative' },
  { text: 'Outlook not so good.',       type: 'negative' },
  { text: 'Very doubtful.',             type: 'negative' },
];

const TYPE_ICON = {
  positive: '🟢',
  neutral:  '🟡',
  negative: '🔴',
};

module.exports = {
  name:        '8ball',
  version:     '1.0.0',
  description: 'Ask the magic 8-ball a yes/no question.',
  usage:       '/8ball [question]',
  category:    'Fun',
  aliases:     ['ask', 'eightball'],

  async execute(ctx) {
    const question = ctx.args.join(' ').trim();
    if (!question) {
      return ctx.replyWithHTML('🎱 <b>Magic 8-Ball</b>\n\nAsk me something! Try: <code>/8ball Will I win today?</code>');
    }

    await ctx.chatAction('typing');

    const answer = ANSWERS[Math.floor(Math.random() * ANSWERS.length)];
    const icon   = TYPE_ICON[answer.type];

    await ctx.replyWithHTML(
      `🎱 <b>Magic 8-Ball</b>\n\n` +
      `❓ <i>${escapeHtml(question)}</i>\n\n` +
      `${icon} <b>${answer.text}</b>`
    );
  },
};

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
