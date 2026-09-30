// Memory check: starts and quits 12 games and prints the graphics card's shape / texture counts after each. They must stay flat.
//   npm run dev  then  node scripts/leakqa.mjs [url]
import fs from 'node:fs';
import { chromium } from 'playwright-core';
const BROWSER = process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : fs.existsSync('/opt/pw-browsers/chromium') ? { executablePath: '/opt/pw-browsers/chromium' } : {};
fs.mkdirSync('qa-output', { recursive: true });
const browser = await chromium.launch({ ...BROWSER, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = []; page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(process.argv[2] || 'http://localhost:5173/', { waitUntil: 'load' });
await page.waitForFunction(() => document.documentElement.getAttribute('data-boot') === 'ready', null, { timeout: 90000 });
const out = await page.evaluate(() => {
  const a = window.__app, r = [];
  const info = () => ({ ...a.S.renderer.info.memory });
  for (let i = 0; i < 12; i++) {
    a.startGame(i % 3 === 0 ? 'quick' : i % 3 === 1 ? 'derby' : 'practice');
    for (let k = 0; k < 30; k++) a.tick(1 / 30, true);
    a.quitToMenu();
    a.tick(1 / 30, true);
    r.push(info());
  }
  return r;
});
console.log(out.map((m) => `${m.geometries}/${m.textures}`).join(' '));
console.log('errors', errors);
await browser.close();
