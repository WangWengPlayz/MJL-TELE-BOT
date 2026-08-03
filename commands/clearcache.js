// ============================================================
//  COMMAND  —  clearcache
//  /clearcache  or  /cl
//  Deletes everything inside commands/cache/
// ============================================================

const fs   = require('fs');
const path = require('path');

const CACHE_DIR = path.join(__dirname, 'cache');

module.exports = {
  name:    'clearcache',
  execute,

  version:     '1.0.0',
  description: 'Clear all files and folders inside the cache directory.',
  usage:       '/clearcache',
  category:    'Admin',
  permission:  2,
  aliases:     ['cl'],
};

// ── Main handler ──────────────────────────────────────────────────────────────
async function execute(ctx) {
  await ctx.chatAction('typing');

  if (!fs.existsSync(CACHE_DIR)) {
    return ctx.reply('ℹ️ Cache folder does not exist yet. Nothing to clear.');
  }

  try {
    const items = fs.readdirSync(CACHE_DIR);

    if (items.length === 0) {
      return ctx.reply('✅ Cache is already empty.');
    }

    let deleted = 0;

    for (const item of items) {
      const fullPath = path.join(CACHE_DIR, item);
      fs.rmSync(fullPath, { recursive: true, force: true });
      deleted++;
    }

    await ctx.reply(`🧹 Cache cleared!\nDeleted <b>${deleted}</b> item${deleted === 1 ? '' : 's'}.`, {
      parse_mode: 'HTML',
    });
  } catch (err) {
    console.error('[clearcache]', err);
    await ctx.reply(`❌ Failed to clear cache: ${err.message || err}`);
  }
}