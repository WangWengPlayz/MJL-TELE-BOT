// ============================================================
//  COMMAND  —  uptime  (Admin only)
//  /uptime
//  Shows bot uptime, memory usage, and system info.
// ============================================================

const os = require('os');

module.exports = {
  name:        'uptime',
  version:     '1.0.0',
  description: 'Show bot uptime, memory usage, and system info.',
  usage:       '/uptime',
  category:    'Admin',
  permission:  2,
  aliases:     ['stats', 'status'],

  async execute(ctx) {
    await ctx.chatAction('typing');

    // ── Uptime ──────────────────────────────────────────────
    const totalSec = Math.floor(process.uptime());
    const days     = Math.floor(totalSec / 86400);
    const hours    = Math.floor((totalSec % 86400) / 3600);
    const mins     = Math.floor((totalSec % 3600) / 60);
    const secs     = totalSec % 60;

    const uptimeParts = [];
    if (days)  uptimeParts.push(`${days}d`);
    if (hours) uptimeParts.push(`${hours}h`);
    if (mins)  uptimeParts.push(`${mins}m`);
    uptimeParts.push(`${secs}s`);
    const uptimeStr = uptimeParts.join(' ');

    // ── Memory ──────────────────────────────────────────────
    const mem        = process.memoryUsage();
    const toMB       = (b) => (b / 1024 / 1024).toFixed(1);
    const heapUsed   = toMB(mem.heapUsed);
    const heapTotal  = toMB(mem.heapTotal);
    const rss        = toMB(mem.rss);
    const heapPct    = Math.round((mem.heapUsed / mem.heapTotal) * 100);

    // Mini heap bar
    const BAR_LEN    = 12;
    const filled     = Math.round((heapPct / 100) * BAR_LEN);
    const heapBar    = '█'.repeat(filled) + '░'.repeat(BAR_LEN - filled);
    const heapColor  = heapPct >= 80 ? '🔴' : heapPct >= 50 ? '🟡' : '🟢';

    // ── System ──────────────────────────────────────────────
    const sysFreeGB  = (os.freemem()  / 1024 / 1024 / 1024).toFixed(2);
    const sysTotalGB = (os.totalmem() / 1024 / 1024 / 1024).toFixed(2);
    const loadAvg    = os.loadavg().map((l) => l.toFixed(2)).join('  ');
    const cpuCount   = os.cpus().length;
    const platform   = `${os.type()} ${os.arch()}`;
    const nodeVer    = process.version;

    // ── Commands & Events ───────────────────────────────────
    const cmdCount   = new Set([...ctx.commands.values()].map((c) => c.name)).size;

    await ctx.replyWithHTML(
      `🤖 <b>Bot Status</b>\n` +
      `${'─'.repeat(30)}\n\n` +

      `⏱ <b>Uptime</b>\n` +
      `  <code>${uptimeStr}</code>\n\n` +

      `💾 <b>Memory (Node.js heap)</b>\n` +
      `  ${heapColor} <code>${heapBar}</code> ${heapPct}%\n` +
      `  Used: <code>${heapUsed} MB</code>  /  Total: <code>${heapTotal} MB</code>\n` +
      `  RSS: <code>${rss} MB</code>\n\n` +

      `🖥 <b>System RAM</b>\n` +
      `  Free: <code>${sysFreeGB} GB</code>  /  Total: <code>${sysTotalGB} GB</code>\n\n` +

      `⚙️ <b>CPU</b>\n` +
      `  Cores: <code>${cpuCount}</code>  •  Load (1/5/15m): <code>${loadAvg}</code>\n\n` +

      `🔧 <b>Runtime</b>\n` +
      `  Node.js: <code>${nodeVer}</code>\n` +
      `  Platform: <code>${platform}</code>\n\n` +

      `📦 <b>Commands loaded:</b> <code>${cmdCount}</code>\n` +

      `${'─'.repeat(30)}\n` +
      `<i>Process uptime since last (re)start</i>`
    );
  },
};
