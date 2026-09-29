// Real-browser smoke test: "does the published game actually start, and does a failure show a readable message?"
//
//   npm run build && npm run smoke
//
// It serves the finished site (dist/) exactly the way GitHub Pages does - under the /<repo>/ sub-path, with a 404 for
// everything outside it - and opens it in headless Chrome. It also builds the game the way Vercel does (base "/",
// served at the site root) and the plain default way (served from some other folder). Scenarios:
//   1. the built game        -> must reach the title screen with no console errors and no failed downloads
//   2. menus                 -> a real click-through of the menus
//   3. Vercel-style build    -> served at the site root, must reach the title screen
//   4. default build         -> served from a folder it was not told about, must reach the title screen
//   5. wrong base path       -> a build made for /baseball/ served at the root of a non-GitHub host must show a
//                               readable message that does NOT talk about GitHub settings
//   6. built game, no WebGL  -> must show the "couldn't start 3D graphics" screen (never a spinner that never ends)
//   7. raw source files      -> what GitHub publishes if Pages is set to "Deploy from a branch" instead of "GitHub
//                               Actions"; must show the "game files didn't load" screen
// Scenario 7 is the exact failure that once left the live site stuck on "Warming up the ballpark" forever; scenarios
// 3-5 guard the Vercel deployment that once showed a GitHub-only message because the build assumed /baseball/.
//
// Browser: CHROME_PATH=/path/to/chrome overrides; on CI the preinstalled Google Chrome is used; otherwise Playwright's own.
import http from 'node:http';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
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
function serve(dir, { skip = /(^|\/)(node_modules|\.git)(\/|$)/, base = BASE } = {}) {
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0]);
    let file = null;
    if (url.startsWith(base)) {
      const rel = url.slice(base.length) || 'index.html';
      const p = path.join(dir, rel);
      if (p.startsWith(dir) && !skip.test(rel) && fs.existsSync(p) && fs.statSync(p).isFile()) file = p;
    }
    if (!file) { res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' }); res.end('<!doctype html><h1>404 File not found</h1>'); return; }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}${base}` })));
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

// Builds the game into a temp folder the way a given host would (its environment variables only).
const tempDirs = [];
function buildTo(name, env) {
  const out = path.join(os.tmpdir(), `sandlot-smoke-${process.pid}-${name}`);
  tempDirs.push(out);
  const clean = { ...process.env };
  for (const k of ['BASE_PATH', 'VERCEL', 'VERCEL_ENV', 'NETLIFY', 'CF_PAGES', 'RENDER', 'GITHUB_ACTIONS', 'GITHUB_REPOSITORY']) delete clean[k];
  execFileSync(process.execPath, [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--outDir', out, '--emptyOutDir'], { cwd: ROOT, env: { ...clean, ...env }, stdio: 'ignore' });
  return out;
}
const titleReached = async ({ page, problems }) => {
  await waitFor(page, () => document.documentElement.getAttribute('data-boot') === 'ready', 90000, 'the game to start');
  await waitFor(page, () => { const b = document.querySelector('#ui .screen.show button[data-a="play"]'); return b && b.offsetParent !== null; }, 10000, 'the Play Ball button');
  if (problems.length) throw new Error('console/network problems:\n    ' + problems.join('\n    '));
};

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
    name: 'Vercel-style build (base "/") served at the site root reaches the title screen',
    dir: () => buildTo('vercel', { VERCEL: '1' }),
    base: '/',
    run: titleReached,
  },
  {
    name: 'default build works from a folder it was not told about',
    dir: () => buildTo('default', {}),
    base: '/some/other/folder/',
    run: titleReached,
  },
  {
    name: 'wrong base path on a non-GitHub host -> readable message with no GitHub instructions',
    dir: () => buildTo('wrongbase', { BASE_PATH: '/baseball/' }),
    base: '/',
    async run({ page }) {
      await waitFor(page, () => (document.documentElement.getAttribute('data-boot') || '').startsWith('failed'), 30000, 'the error screen');
      const title = await page.textContent('#boot-error-title');
      if (!/game files/i.test(title)) throw new Error(`unexpected error title: "${title}"`);
      const body = await page.textContent('#boot-error-body');
      if (/GitHub|Pages|Actions/i.test(body)) throw new Error(`players are shown GitHub instructions: "${body}"`);
      const detail = await page.textContent('#boot-error-detail');
      if (/GitHub Actions/.test(detail)) throw new Error('a non-GitHub host is told to switch a GitHub setting');
      if (!/assets\//.test(detail)) throw new Error('the technical details do not say which file failed');
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
      if (/GitHub Actions/.test(body)) throw new Error('players are shown GitHub instructions');
      if (!/whoever runs this site/i.test(await page.textContent('#boot-error-detail'))) throw new Error('the technical details have no hint for the site owner');
    },
  },
];

if (!fs.existsSync(path.join(ROOT, 'dist', 'index.html'))) { console.error('dist/ is missing - run "npm run build" first.'); process.exit(2); }

const browser = await launch();
let failed = 0;
for (const sc of scenarios) {
  let server, url;
  try {
    ({ server, url } = await serve(typeof sc.dir === 'function' ? sc.dir() : sc.dir, { base: sc.base || BASE }));
  } catch (err) { failed++; console.log(`  FAIL  ${sc.name}\n    could not set up: ${err.message}`); continue; }
  const started = Date.now();
  let opened = null;
  try {
    opened = await open(browser, url, { noWebGL: sc.noWebGL });
    await sc.run(opened);
    console.log(`  ok    ${sc.name} (${((Date.now() - started) / 1000).toFixed(1)}s)`);
  } catch (err) {
    failed++;
    console.log(`  FAIL  ${sc.name}\n    ${err.message}`);
  }
  // close the page: a finished scenario must not keep drawing the 3D scene and slow the next one down
  if (opened) await opened.page.close().catch(() => {});
  server.close();
}
await browser.close();
for (const d of tempDirs) fs.rmSync(d, { recursive: true, force: true });
console.log(failed ? `\n${failed} smoke check(s) failed` : '\nsmoke checks passed');
process.exit(failed ? 1 : 0);
