// Real-browser smoke test: "does the published game actually start, and does a failure show a readable message?"
//
//   npm run build && npm run smoke
//
// It serves the finished site (dist/) exactly the way GitHub Pages does - under the /<repo>/ sub-path, with a 404 for
// everything outside it - and opens it in headless Chrome. Three scenarios:
//   1. the built game        -> must reach the title screen with no console errors and no failed downloads
//   2. built game, no WebGL  -> must show the "couldn't start 3D graphics" screen (never a spinner that never ends)
//   3. raw source files      -> what GitHub publishes if Pages is set to "Deploy from a branch" instead of "GitHub
//                               Actions"; must show the "game files didn't load" screen
// Scenario 3 is the exact failure that once left the live site stuck on "Warming up the ballpark" forever.
//
// Browser: CHROME_PATH=/path/to/chrome overrides; on CI the preinstalled Google Chrome is used; otherwise Playwright's own.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = (process.env.BASE_PATH || '/baseball/').replace(/\/?$/, '/');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.md': 'text/markdown',
};

// A tiny static server that behaves like GitHub Pages: files exist only under BASE, everything else is an HTML 404.
function serve(dir, { skip = /(^|\/)(node_modules|\.git)(\/|$)/ } = {}) {
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0]);
    let file = null;
    if (url.startsWith(BASE)) {
      const rel = url.slice(BASE.length) || 'index.html';
      const p = path.join(dir, rel);
      if (p.startsWith(dir) && !skip.test(rel) && fs.existsSync(p) && fs.statSync(p).isFile()) file = p;
    }
    if (!file) { res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' }); res.end('<!doctype html><h1>404 File not found</h1>'); return; }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}${BASE}` })));
}

const LAUNCH_ARGS = ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
function launch() {
  const opts = { args: LAUNCH_ARGS };
  if (process.env.CHROME_PATH) opts.executablePath = process.env.CHROME_PATH;
  else if (process.env.CI) opts.channel = 'chrome';
  return chromium.launch(opts);
}

async function open(browser, url, { noWebGL = false } = {}) {
  const page = await browser.newPage({ viewport: { width: 1000, height: 560 } });
  const problems = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') problems.push(`${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => problems.push(`uncaught: ${e.message}`));
  page.on('response', (r) => { if (r.status() >= 400) problems.push(`HTTP ${r.status()}: ${r.url()}`); });
  if (noWebGL) {
    await page.addInitScript(() => {
      const real = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (type, ...rest) { return /webgl/i.test(type) ? null : real.call(this, type, ...rest); };
    });
  }
  await page.goto(url, { waitUntil: 'load' });
  return { page, problems };
}

const bootState = (page) => page.evaluate(() => document.documentElement.getAttribute('data-boot'));
async function waitFor(page, pred, ms, what) {
  try { await page.waitForFunction(pred, null, { timeout: ms }); } catch { throw new Error(`timed out after ${ms / 1000}s waiting for ${what} (boot state: ${await bootState(page)})`); }
}

const scenarios = [
  {
    name: 'built game reaches the title screen',
    dir: path.join(ROOT, 'dist'),
    async run({ page, problems }) {
      await waitFor(page, () => document.documentElement.getAttribute('data-boot') === 'ready', 90000, 'the game to start');
      await waitFor(page, () => { const b = document.querySelector('#ui .screen.show button[data-a="play"]'); return b && b.offsetParent !== null; }, 10000, 'the Play Ball button');
      await page.waitForTimeout(700); // splash fade-out
      if (await page.$('#boot')) throw new Error('the loading splash is still on screen');
      if (await page.isVisible('#boot-error')) throw new Error('the error screen is showing');
      if (problems.length) throw new Error('console/network problems:\n    ' + problems.join('\n    '));
    },
  },
  {
    name: 'menus work with real clicks (play, settings, pause, resume)',
    dir: path.join(ROOT, 'dist'),
    async run({ page, problems }) {
      const click = (sel) => page.click(sel, { timeout: 20000 });
      const visible = (sel) => page.evaluate((q) => { const e = document.querySelector(q); return !!e && e.offsetParent !== null && getComputedStyle(e).visibility !== 'hidden'; }, sel);
      await waitFor(page, () => document.documentElement.getAttribute('data-boot') === 'ready', 90000, 'the game to start');
      await click('#ui .screen.show button[data-a="play"]');
      // first time only: the short how-to screen
      if (await page.waitForSelector('#ui .screen.show button[data-a="howtoDone"]', { timeout: 5000 }).catch(() => null)) await click('#ui .screen.show button[data-a="howtoDone"]');
      await click('#ui .screen.show .seg[data-set="tod"] button[data-v="night"]');
      await waitFor(page, () => document.querySelector('#ui .screen.show .seg[data-set="tod"] button[data-v="night"]')?.classList.contains('on'), 5000, 'the Night setting to stay selected');
      await click('#ui .screen.show .card[data-mode="quick"]');
      await waitFor(page, () => document.querySelector('.hud')?.dataset.mode === 'quick' && document.querySelector('.hud').classList.contains('show'), 20000, 'the game HUD');
      if (!(await visible('.hud .bug'))) throw new Error('the score bug is not showing in Quick Game');
      if (await visible('.hud .derbybox')) throw new Error('the Derby scoreboard is showing in Quick Game');
      await click('.hud .hudbtns [data-a="pause"]');
      await click('#ui .screen.show .switch[data-set="zone"]');
      if (await page.evaluate(() => document.querySelector('#ui .screen.show .switch[data-set="zone"]').classList.contains('on'))) throw new Error('the strike-zone switch did not turn off');
      await click('#ui .screen.show button[data-a="resume"]');
      await waitFor(page, () => !document.querySelector('#ui .screen.show'), 5000, 'the pause menu to close');
      if (problems.length) throw new Error('console/network problems:\n    ' + problems.join('\n    '));
    },
  },
  {
    name: 'no WebGL -> readable error, not a hang',
    dir: path.join(ROOT, 'dist'),
    noWebGL: true,
    async run({ page }) {
      await waitFor(page, () => (document.documentElement.getAttribute('data-boot') || '').startsWith('failed'), 30000, 'the error screen');
      const title = await page.textContent('#boot-error-title');
      if (!/3D graphics/i.test(title)) throw new Error(`unexpected error title: "${title}"`);
      if (!(await page.isVisible('#boot-error'))) throw new Error('error screen is not visible');
    },
  },
  {
    name: 'raw source published as-is -> readable error, not a hang',
    dir: ROOT, // what GitHub Pages serves when it is set to "Deploy from a branch"
    async run({ page }) {
      await waitFor(page, () => (document.documentElement.getAttribute('data-boot') || '').startsWith('failed'), 30000, 'the error screen');
      const title = await page.textContent('#boot-error-title');
      if (!/game files/i.test(title)) throw new Error(`unexpected error title: "${title}"`);
      const body = await page.textContent('#boot-error-body');
      if (!/GitHub Actions/.test(body)) throw new Error('the message does not tell the site owner about the "GitHub Actions" setting');
    },
  },
];

if (!fs.existsSync(path.join(ROOT, 'dist', 'index.html'))) { console.error('dist/ is missing - run "npm run build" first.'); process.exit(2); }

const browser = await launch();
let failed = 0;
for (const sc of scenarios) {
  const { server, url } = await serve(sc.dir);
  const started = Date.now();
  try {
    await sc.run(await open(browser, url, { noWebGL: sc.noWebGL }));
    console.log(`  ok    ${sc.name} (${((Date.now() - started) / 1000).toFixed(1)}s)`);
  } catch (err) {
    failed++;
    console.log(`  FAIL  ${sc.name}\n    ${err.message}`);
  }
  server.close();
}
await browser.close();
console.log(failed ? `\n${failed} smoke check(s) failed` : '\nsmoke checks passed');
process.exit(failed ? 1 : 0);
