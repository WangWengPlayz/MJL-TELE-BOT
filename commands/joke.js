// ============================================================
//  COMMAND  —  joke
//  /joke [category]
//  Sends a random joke. Categories: general, programming, dark, dad
// ============================================================

const JOKES = {
  general: [
    ['Why don\'t scientists trust atoms?', 'Because they make up everything!'],
    ['I told my wife she was drawing her eyebrows too high.', 'She looked surprised.'],
    ['Why can\'t you give Elsa a balloon?', 'Because she\'ll let it go.'],
    ['What do you call a fake noodle?', 'An impasta!'],
    ['Why did the scarecrow win an award?', 'Because he was outstanding in his field!'],
    ['I\'m reading a book about anti-gravity.', 'It\'s impossible to put down!'],
    ['Why did the bicycle fall over?', 'Because it was two-tired!'],
    ['What do you call cheese that isn\'t yours?', 'Nacho cheese!'],
    ['I only know 25 letters of the alphabet.', 'I don\'t know y.'],
    ['Why do cows wear bells?', 'Because their horns don\'t work!'],
  ],
  programming: [
    ['Why do programmers prefer dark mode?', 'Because light attracts bugs!'],
    ['A SQL query walks into a bar, walks up to two tables and asks...', '"Can I join you?"'],
    ['Why did the developer go broke?', 'Because he used up all his cache!'],
    ['How many programmers does it take to change a light bulb?', 'None — that\'s a hardware problem!'],
    ['What\'s a programmer\'s favourite hangout spot?', 'Foo Bar!'],
    ['Why do Java developers wear glasses?', 'Because they don\'t C#!'],
    ['!false', 'It\'s funny because it\'s true!'],
    ['Why was the JavaScript developer sad?', 'Because he didn\'t know how to null his feelings.'],
    ['A programmer\'s partner says: "Go to the store, get a gallon of milk, and if they have eggs get a dozen."', 'The programmer returns with 12 gallons of milk.'],
    ['What\'s the object-oriented way to become wealthy?', 'Inheritance!'],
  ],
  dad: [
    ['I\'m afraid for the calendar.', 'Its days are numbered!'],
    ['Why can\'t a nose be 12 inches long?', 'Because then it would be a foot!'],
    ['I used to hate facial hair...', 'But then it grew on me.'],
    ['I ordered a chicken and an egg online.', "I'll let you know."],
    ['Did you hear about the guy who invented Lifesavers?', 'He made a mint!'],
    ['I thought about going on an all-almond diet.', "But that's just nuts!"],
    ['What do you call a bear with no teeth?', 'A gummy bear!'],
    ['Why don\'t eggs tell jokes?', "They'd crack each other up!"],
    ['What do you call a dinosaur that crashes their car?', 'Tyrannosaurus wrecks!'],
    ['Why couldn\'t the leopard play hide and seek?', 'Because he was always spotted!'],
  ],
  dark: [
    ['I have a lot of jokes about unemployed people.', 'Sadly, none of them work.'],
    ['My therapist says I have trouble accepting things I can\'t change.', "I'm not paying for that."],
    ['The cemetery is so overcrowded.', 'People are just dying to get in.'],
    ['Why don\'t cannibals eat clowns?', 'Because they taste funny!'],
    ['I told a joke about paper...', 'It was tearable.'],
  ],
};

const ALL_CATEGORIES = Object.keys(JOKES);

module.exports = {
  name:        'joke',
  version:     '1.0.0',
  description: 'Get a random joke. Categories: general, programming, dad, dark.',
  usage:       '/joke [general | programming | dad | dark]',
  category:    'Fun',
  aliases:     ['j', 'lol'],

  async execute(ctx) {
    await ctx.chatAction('typing');

    const input = (ctx.args[0] || '').toLowerCase();
    const category = JOKES[input] ? input : ALL_CATEGORIES[Math.floor(Math.random() * ALL_CATEGORIES.length)];

    const pool = JOKES[category];
    const [setup, punchline] = pool[Math.floor(Math.random() * pool.length)];

    await ctx.replyWithHTML(
      `😂 <b>Joke — ${capitalise(category)}</b>\n\n` +
      `${escapeHtml(setup)}\n\n` +
      `<tg-spoiler>${escapeHtml(punchline)}</tg-spoiler>\n\n` +
      `<i>Tap the spoiler to reveal the punchline!</i>`
    );
  },
};

function capitalise(str) { return str.charAt(0).toUpperCase() + str.slice(1); }
function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
