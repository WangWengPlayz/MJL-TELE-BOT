// ============================================================
//  COMMAND  —  fact
//  /fact [category]
//  Sends a random fun fact. Categories: science, history, animals, space, tech
// ============================================================

const FACTS = {
  science: [
    'Honey never spoils. Archaeologists have found 3,000-year-old honey in Egyptian tombs that was still edible.',
    'A group of flamingos is called a "flamboyance."',
    'Hot water can freeze faster than cold water under certain conditions. This is known as the Mpemba effect.',
    'Humans share about 60% of their DNA with bananas.',
    'The human brain generates about 20 watts of electrical power — enough to power a dim light bulb.',
    'Oxygen is actually a pale blue liquid when cooled below −183 °C.',
    'There are more possible iterations of a game of chess than there are atoms in the known universe.',
    'A day on Venus is longer than a year on Venus.',
    'The shortest war in history lasted 38–45 minutes — the Anglo-Zanzibar War of 1896.',
    'Sound travels about four times faster through water than through air.',
  ],
  history: [
    'Cleopatra lived closer in time to the Moon landing than to the construction of the Great Pyramid.',
    'Oxford University is older than the Aztec Empire.',
    'The fax machine was invented in 1843 — before the telephone.',
    'Nintendo was founded in 1889 — originally as a playing card company.',
    'The Great Wall of China was not built in one go; construction spanned over 2,000 years.',
    'Ancient Romans used crushed mouse brains as toothpaste.',
    'The shortest president in U.S. history was James Madison at 5 ft 4 in (163 cm).',
    'There are more public libraries in the US than McDonald\'s restaurants.',
    'Vikings never actually wore helmets with horns.',
    'The first computer bug was an actual bug — a moth found in a relay of the Harvard Mark II in 1947.',
  ],
  animals: [
    'Otters hold hands while sleeping so they don\'t drift apart.',
    'A snail can sleep for up to three years.',
    'Crows can recognize and remember human faces.',
    'Octopuses have three hearts, nine brains, and blue blood.',
    'A group of crows is called a murder.',
    'Elephants are the only animals that can\'t jump.',
    'Butterflies taste with their feet.',
    'Wombat poop is cube-shaped — the only known animal to produce cubic feces.',
    'Cats can\'t taste sweetness because they lack the taste receptor for it.',
    'A blue whale\'s heartbeat can be detected from up to 2 miles away.',
  ],
  space: [
    'There are more stars in the universe than grains of sand on all of Earth\'s beaches.',
    'One million Earths could fit inside the Sun.',
    'Neutron stars are so dense that a teaspoon of their material would weigh about 10 million tonnes.',
    'The footprints left on the Moon by Apollo astronauts will last for at least 100 million years.',
    'Saturn\'s rings are mostly made of ice and rock, and are only about 10 metres thick on average.',
    'The Milky Way galaxy is estimated to be 13.6 billion years old.',
    'Light from the Sun takes about 8 minutes and 20 seconds to reach Earth.',
    'There is a giant cloud of alcohol in space — the Sagittarius B2 cloud contains over a billion billion billion litres of ethanol.',
    'A year on Mercury lasts just 88 Earth days.',
    'The International Space Station travels at roughly 28,000 km/h (17,500 mph).',
  ],
  tech: [
    'The first computer mouse was made of wood.',
    'The average smartphone today is more powerful than all of NASA\'s combined computing in 1969.',
    'The first domain name ever registered was Symbolics.com, on 15 March 1985.',
    '"E" is the most commonly used letter in the English language — and also the most commonly used letter in most programming languages.',
    'The QWERTY keyboard layout was designed to slow typists down to prevent typewriter jams.',
    'About 90% of the world\'s currency exists only digitally.',
    'The first text message was sent on December 3, 1992. It said "Merry Christmas."',
    'Google was originally called "Backrub."',
    'The first 1GB hard drive, released in 1980, weighed over 500 lbs and cost $40,000.',
    'There are over 700 programming languages in existence.',
  ],
};

const ALL_CATEGORIES = Object.keys(FACTS);

module.exports = {
  name:        'fact',
  version:     '1.0.0',
  description: 'Get a random fun fact. Categories: science, history, animals, space, tech.',
  usage:       '/fact [science | history | animals | space | tech]',
  category:    'Fun',
  aliases:     ['trivia', 'funfact'],

  async execute(ctx) {
    await ctx.chatAction('typing');

    const input    = (ctx.args[0] || '').toLowerCase();
    const category = FACTS[input] ? input : ALL_CATEGORIES[Math.floor(Math.random() * ALL_CATEGORIES.length)];

    const pool = FACTS[category];
    const fact = pool[Math.floor(Math.random() * pool.length)];

    const ICONS = { science: '🔬', history: '📜', animals: '🐾', space: '🚀', tech: '💻' };

    await ctx.replyWithHTML(
      `${ICONS[category]} <b>Fun Fact — ${capitalise(category)}</b>\n\n` +
      `${escapeHtml(fact)}\n\n` +
      `<i>Use /fact [category] for a specific topic</i>`
    );
  },
};

function capitalise(str) { return str.charAt(0).toUpperCase() + str.slice(1); }
function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
