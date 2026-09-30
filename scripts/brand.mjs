// Makes the game's icons and its link-preview picture from the logo drawn in src/ui/logo.js - nothing is drawn by hand.
//
//   npm run dev            (in another window: the share picture is a screenshot of the real title screen)
//   node scripts/brand.mjs [dev-server url]
//
// Writes into public/:  favicon.svg, favicon-32.png, apple-touch-icon.png (180), icon-192.png, icon-512.png,
// og-image.jpg (1200x630, what Messages / Slack / X / Facebook show when someone shares a link) and site.webmanifest.
// Re-run it after changing the logo, then commit the files.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { badgeSVG, logoSVG } from '../src/ui/logo.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUB = path.join(ROOT, 'public');
const URL = process.argv[2] || 'http://localhost:5173/';
const launch = { args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] };
if (process.env.CHROME_PATH) launch.executablePath = process.env.CHROME_PATH;
else if (fs.existsSync('/opt/pw-browsers/chromium')) launch.executablePath = '/opt/pw-browsers/chromium';

fs.writeFileSync(path.join(PUB, 'favicon.svg'), badgeSVG({ size: 64 }).replace(/\n/g, '') + '\n');

const browser = await chromium.launch(launch);
// square icons: the badge, drawn at each size (a phone's home-screen icon has no rounded corners of its own on Android)
for (const [file, size, round] of [['favicon-32.png', 32, 14], ['apple-touch-icon.png', 180, 0], ['icon-192.png', 192, 0], ['icon-512.png', 512, 0]]) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(`<body style="margin:0;background:transparent">${badgeSVG({ size, round })}</body>`);
  await page.screenshot({ path: path.join(PUB, file), omitBackground: true });
  await page.close();
}

// the share picture: the real ballpark behind the logo and a one-line pitch
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.goto(`${URL}?shot=1&tod=day`, { waitUntil: 'load' });
await page.waitForFunction(() => document.documentElement.getAttribute('data-boot') === 'ready', null, { timeout: 120000 });
await page.evaluate((logo) => {
  const a = window.__app;
  for (let i = 0; i < 90; i++) a.tick(1 / 30, false);
  a.tick(1 / 30, true);
  const ui = document.getElementById('ui');
  ui.innerHTML = `<div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:26px;background:radial-gradient(ellipse at center, rgba(4,8,18,.15), rgba(4,8,18,.6));font-family:system-ui,sans-serif">
    <div style="width:820px;filter:drop-shadow(0 20px 34px rgba(0,0,0,.6))">${logo}</div>
    <div style="padding:12px 30px;border-radius:999px;background:rgba(10,16,32,.82);border:1px solid rgba(255,255,255,.18);color:#f5f7fc;font-weight:800;font-size:30px;letter-spacing:.12em;text-transform:uppercase">Time your swing · Crush it</div></div>`;
  const svg = ui.querySelector('svg'); svg.style.width = '100%'; svg.style.height = 'auto'; svg.style.display = 'block';
}, logoSVG({ id: 'og' }));
await page.waitForTimeout(300);
await page.screenshot({ path: path.join(PUB, 'og-image.jpg'), type: 'jpeg', quality: 86 });
await browser.close();

const manifest = {
  name: 'Sandlot - Baseball Batting Game',
  short_name: 'Sandlot',
  description: 'Time your swing, aim your hits and crush home runs.',
  start_url: './',
  scope: './',
  display: 'fullscreen',
  orientation: 'landscape',
  background_color: '#05080c',
  theme_color: '#0b1a12',
  icons: [
    { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
    { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
  ],
};
fs.writeFileSync(path.join(PUB, 'site.webmanifest'), JSON.stringify(manifest, null, 2) + '\n');
console.log('wrote public/favicon.svg, favicon-32.png, apple-touch-icon.png, icon-192.png, icon-512.png, og-image.jpg, site.webmanifest');
