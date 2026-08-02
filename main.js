const path = require('path');
const IS_VERCEL = !!process.env.VERCEL;

// ---- Auto-install (local / Render — skipped on Vercel) ----
if (!IS_VERCEL) {
  const fs                          = require('fs');
  const { execSync, execFileSync }  = require('child_process');
  const NM_DIR                      = path.join(__dirname, 'node_modules');

  // Read declared deps straight from package.json — no hardcoded list needed.
  let declaredDeps = [];
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
    declaredDeps = Object.keys({ ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) });
  } catch {
    console.warn('[setup] Could not read package.json — skipping auto-install.');
  }

  if (declaredDeps.length > 0) {
    // Helper: is a package resolvable right now?
    const isInstalled = (dep) => {
      try { require.resolve(dep); return true; } catch {}
      // Fallback: check node_modules/<dep> folder exists (catches CLI-only tools like flow-bin)
      return fs.existsSync(path.join(NM_DIR, dep));
    };

    // Helper: run npm with safety checks
    const runInstall = (packages) => {
      try { execSync('npm --version', { stdio: 'ignore' }); }
      catch {
        console.error('[setup] npm not found — cannot auto-install packages.');
        process.exit(1);
      }
      const args = packages.length > 0
        ? ['install', '--no-audit', '--no-fund', '--loglevel=error', ...packages]
        : ['install', '--no-audit', '--no-fund', '--loglevel=error'];
      try {
        execFileSync('npm', args, { stdio: 'inherit', cwd: path.resolve(__dirname) });
      } catch (err) {
        console.error(`[setup] npm install failed: ${err.message}`);
        process.exit(1);
      }
    };

    if (!fs.existsSync(NM_DIR)) {
      // node_modules is entirely absent — install everything at once
      console.log('[setup] node_modules missing — running npm install...');
      runInstall([]);
    } else {
      // node_modules exists — only install what's missing
      const missing = declaredDeps.filter((dep) => !isInstalled(dep));
      if (missing.length > 0) {
        console.log(`[setup] Missing packages: ${missing.join(', ')}`);
        runInstall(missing);

        // Verify
        const stillMissing = missing.filter((dep) => !isInstalled(dep));
        if (stillMissing.length > 0) {
          console.error(`[setup] Still missing after install: ${stillMissing.join(', ')}`);
          process.exit(1);
        }
        console.log('[setup] All packages ready.');
      }
    }
  }
}

// ---- Status page HTML ----
const START_TIME = Date.now();

const STATUS_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Bot Status</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #0d0d0d; color: #e8e8e8;
      min-height: 100vh; display: flex; align-items: center; justify-content: center;
    }
    .card {
      background: #161616; border: 1px solid #262626; border-radius: 16px;
      padding: 40px 48px; width: 100%; max-width: 420px; text-align: center;
      box-shadow: 0 8px 40px rgba(0,0,0,0.5);
    }
    .icon { font-size: 48px; margin-bottom: 16px; }
    h1 { font-size: 22px; font-weight: 600; letter-spacing: -0.3px; margin-bottom: 8px; }
    .tagline { font-size: 13px; color: #666; margin-bottom: 32px; }
    .badge {
      display: inline-flex; align-items: center; gap: 8px;
      background: #0f2d1a; border: 1px solid #1a4a28; color: #4ade80;
      font-size: 13px; font-weight: 500; padding: 6px 14px;
      border-radius: 99px; margin-bottom: 32px;
    }
    .dot {
      width: 8px; height: 8px; border-radius: 50%;
      background: #4ade80; box-shadow: 0 0 6px #4ade80;
      animation: pulse 2s ease-in-out infinite;
    }
    @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
    .stats { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 28px; }
    .stat {
      background: #1c1c1c; border: 1px solid #262626;
      border-radius: 10px; padding: 14px 12px;
    }
    .stat-label { font-size: 11px; color: #555; text-transform: uppercase; letter-spacing: 0.6px; margin-bottom: 4px; }
    .stat-value { font-size: 15px; font-weight: 600; color: #d4d4d4; font-variant-numeric: tabular-nums; }
    .footer { font-size: 11px; color: #3a3a3a; }
    .error-msg { color: #f87171; font-size: 13px; margin-top: 8px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">🤖</div>
    <h1>Telegram Bot</h1>
    <p class="tagline">Service status &amp; uptime</p>
    <div class="badge"><span class="dot"></span><span id="status-label">Checking…</span></div>
    <div class="stats">
      <div class="stat"><div class="stat-label">Uptime</div><div class="stat-value" id="uptime">—</div></div>
      <div class="stat"><div class="stat-label">Started</div><div class="stat-value" id="started">—</div></div>
      <div class="stat"><div class="stat-label">Last check</div><div class="stat-value" id="last-check">—</div></div>
      <div class="stat"><div class="stat-label">Mode</div><div class="stat-value" id="mode">—</div></div>
    </div>
    <p id="error" class="error-msg" style="display:none"></p>
    <p class="footer">Auto-refreshes every 30 seconds</p>
  </div>
  <script>
    function formatUptime(s) {
      if (s < 60) return s + 's';
      const m = Math.floor(s/60)%60, h = Math.floor(s/3600)%24, d = Math.floor(s/86400);
      if (d > 0) return d + 'd ' + h + 'h';
      if (h > 0) return h + 'h ' + m + 'm';
      return m + 'm ' + (s%60) + 's';
    }
    function fmt(iso) {
      const d = new Date(iso);
      return d.toLocaleDateString(undefined,{month:'short',day:'numeric'})
        + ' ' + d.toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'});
    }
    async function refresh() {
      try {
        const res = await fetch('/status');
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const d = await res.json();
        document.getElementById('status-label').textContent = 'Online';
        document.getElementById('uptime').textContent = formatUptime(d.uptimeSeconds);
        document.getElementById('started').textContent = fmt(d.startedAt);
        document.getElementById('last-check').textContent =
          new Date(d.timestamp).toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit',second:'2-digit'});
        document.getElementById('mode').textContent = d.mode;
        document.getElementById('error').style.display = 'none';
      } catch(err) {
        document.getElementById('status-label').textContent = 'Unreachable';
        document.getElementById('error').style.display = '';
        document.getElementById('error').textContent = err.message;
      }
    }
    refresh();
    setInterval(refresh, 30000);
  </script>
</body>
</html>`;

// ---- Shared request handler (used by both local HTTP server and Vercel) ----
require('dotenv').config();
const { startBot, handleUpdate } = require('./bot');

async function requestHandler(req, res) {
  const url = req.url ? req.url.split('?')[0] : '/';

  // /status — JSON uptime info
  if (url === '/status') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify({
      status: 'online',
      mode: IS_VERCEL ? 'webhook' : 'polling',
      startedAt: new Date(START_TIME).toISOString(),
      uptimeSeconds: Math.floor((Date.now() - START_TIME) / 1000),
      timestamp: new Date().toISOString(),
    }));
  }

  // POST / or /webhook — Telegram webhook (Vercel mode)
  if (req.method === 'POST') {
    const token = process.env.BOT_TOKEN;
    if (!token) {
      res.writeHead(500);
      return res.end('BOT_TOKEN not configured.');
    }

    // Optional secret token validation
    const incoming = req.headers['x-telegram-bot-api-secret-token'];
    const expected = process.env.WEBHOOK_SECRET;
    if (expected && incoming !== expected) {
      res.writeHead(403);
      return res.end('Forbidden');
    }

    // Vercel pre-parses JSON bodies into req.body; fall back to streaming for local HTTP.
    if (req.body !== undefined) {
      try {
        await handleUpdate(token, req.body);
      } catch (err) {
        console.error('[webhook] Error:', err.message);
      }
      res.writeHead(200);
      res.end('ok');
      return;
    }

    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', async () => {
      try {
        const update = JSON.parse(body);
        await handleUpdate(token, update);
      } catch (err) {
        console.error('[webhook] Error:', err.message);
      }
      res.writeHead(200);
      res.end('ok');
    });
    return;
  }

  // GET / — status HTML page
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(STATUS_HTML);
}

// ---- Vercel: export handler ----
// ---- Local: start HTTP server + polling bot ----
if (IS_VERCEL) {
  module.exports = requestHandler;
} else {
  const http = require('http');
  const PORT = process.env.PORT || 3000;
  const BOT_TOKEN = process.env.BOT_TOKEN;

  if (!BOT_TOKEN) {
    console.error('[main] Missing BOT_TOKEN in .env file');
    process.exit(1);
  }

  http.createServer(requestHandler).listen(PORT, () => {
    console.log(`[web] Status page running on port ${PORT}`);
  });

  console.log('[main] Starting Telegram bot...');
  startBot(BOT_TOKEN);
}
