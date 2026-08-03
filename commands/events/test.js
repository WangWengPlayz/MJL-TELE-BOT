// ============================================================
//  EVENT  —  Emotion Auto-Reactor
//  Automatically reacts to messages based on detected emotion.
//  No command needed — fires on every incoming message.
// ============================================================

// Telegram supports a limited set of emoji reactions.
// Each entry: { emoji, keywords[], minScore }
// Keywords are matched case-insensitively against the message text.
// The emotion with the highest hit-count wins; ties go to the first match.

const EMOTION_RULES = [
  {
    emoji:    '🤣',
    keywords: [
      'lol', 'lmao', 'lmfao', 'rofl', 'haha', 'hahaha', 'hehe',
      'hilarious', 'dying', 'im dead', "i'm dead", '😂', '🤣',
    ],
  },
  {
    emoji:    '🎉',
    keywords: [
      'congrats', 'congratulations', 'happy birthday', 'hbd', 'bday',
      'celebrate', 'party', 'woohoo', 'yay', 'lets go', "let's go",
      '🎉', '🥳', '🎊',
    ],
  },
  {
    emoji:    '😢',
    keywords: [
      'sad', 'cry', 'crying', 'sobbing', 'tears', 'miss you', 'lonely',
      'depressed', 'heartbroken', 'rip', 'rest in peace', '😭', '😢', '💔',
    ],
  },
  {
    emoji:    '🤬',
    keywords: [
      'angry', 'mad', 'furious', 'rage', 'i hate', 'wtf', 'what the hell',
      'shut up', 'idiot', 'stupid', 'dumb', '😡', '🤬',
    ],
  },
  {
    emoji:    '🔥',
    keywords: [
      'fire', 'lit', 'hot', 'spicy', 'insane', 'goated', 'goat',
      'legendary', 'absolute unit', '🔥',
    ],
  },
  {
    emoji:    '🤩',
    keywords: [
      'wow', 'amazing', 'awesome', 'incredible', 'mind blown', 'unbelievable',
      'no way', 'omg', 'oh my god', 'whoa', '🤩', '😮', '🙌',
    ],
  },
  {
    emoji:    '❤',
    keywords: [
      'love', 'i love', 'ilove', 'adore', 'sweet', 'precious',
      'beautiful', 'gorgeous', 'cute', '❤', '🥰', '😍', '💕',
    ],
  },
  {
    emoji:    '🤔',
    keywords: [
      'hmm', 'idk', 'i dont know', "i don't know", 'maybe', 'perhaps',
      'wonder', 'curious', 'interesting', 'what do you think', '🤔',
    ],
  },
  {
    emoji:    '🥱',
    keywords: [
      'bored', 'boring', 'yawn', 'sleepy', 'tired', 'exhausted',
      'zzz', 'cant sleep', "can't sleep", '😴', '💤', '🥱',
    ],
  },
  {
    emoji:    '😱',
    keywords: [
      'scary', 'terrifying', 'frightening', 'horror', 'omg', 'holy',
      'shocked', 'shocked me', 'wait what', 'no way', '😱', '👻',
    ],
  },
  {
    emoji:    '👍',
    keywords: [
      'good job', 'well done', 'great job', 'nice one', 'approved',
      'agreed', 'exactly', 'perfect', 'correct', 'right', 'true that',
    ],
  },
  {
    emoji:    '💯',
    keywords: [
      'facts', 'real talk', 'absolutely', 'totally', 'definitely',
      '100', '100%', 'periodt', 'period', 'no cap', '💯',
    ],
  },
];

// Minimum keyword hits before a reaction fires (avoids false positives)
const MIN_HITS = 1;

// Do NOT react to command messages (starting with prefix)
const COMMAND_PREFIXES = ['/', '!', '.', '?'];

// Cooldown per chat to avoid spamming reactions (ms)
const REACTION_COOLDOWN = 4000;
const lastReacted = new Map(); // chatId → timestamp

module.exports = {
  name: 'emotion-reactor',

  async execute(ctx, msg) {
    const text = (msg.text || msg.caption || '').trim();
    if (!text) return;

    // Skip commands
    if (COMMAND_PREFIXES.some((p) => text.startsWith(p))) return;

    // Cooldown check
    const now = Date.now();
    const last = lastReacted.get(ctx.chatId) || 0;
    if (now - last < REACTION_COOLDOWN) return;

    const lower = text.toLowerCase();

    // Score each emotion
    let best = null;
    let bestScore = 0;

    for (const rule of EMOTION_RULES) {
      let score = 0;
      for (const kw of rule.keywords) {
        if (lower.includes(kw)) score++;
      }
      if (score > bestScore) {
        bestScore = score;
        best = rule;
      }
    }

    if (!best || bestScore < MIN_HITS) return;

    // Apply reaction
    lastReacted.set(ctx.chatId, now);
    await ctx.react(msg.message_id, [{ type: 'emoji', emoji: best.emoji }]);
  },
};
