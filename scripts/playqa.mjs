// Full playthroughs in the real game: every mode at each screen size, starting from the title with real clicks / taps, one real
// swing (key or tap), then the test bot plays to the end. Prints the results and any console error, warning or failed download.
//   npm run dev  then  node scripts/playqa.mjs [url] [sizes]      (results-screen screenshots in qa-output/)
import fs from 'node:fs';
import { chromium } from 'playwright-core';
const BROWSER = process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : fs.existsSync('/opt/pw-browsers/chromium') ? { executablePath: '/opt/pw-browsers/chromium' } : {};
fs.mkdirSync('qa-output', { recursive: true });
const URL = process.argv[2] || 'http://localhost:5173/';
const browser = await chromium.launch({ ...BROWSER, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const sizes = (process.argv[3] || '1280x720,844x390,390x844').split(',');
const out = [];
for (const sz of sizes) {
  const [w, h] = sz.split('x').map(Number);
  const touch = w < 900;
  for (const mode of ['quick', 'derby', 'practice']) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: touch, isMobile: touch });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text()); });
    page.on('response', (r) => { if (r.status() >= 400) errors.push('HTTP ' + r.status() + ' ' + r.url()); });
    await page.goto(URL, { waitUntil: 'load' });
    await page.waitForFunction(() => document.documentElement.getAttribute('data-boot') === 'ready', null, { timeout: 90000 });
    if (touch && w < h) { const b = page.locator('[data-a=dismissRotate]'); if (await b.isVisible()) await b.tap(); }
    // real input: Play -> how-to -> mode card
    const press = (sel) => (touch ? page.tap(sel) : page.click(sel));
    await press('.screen.show [data-a=play]');
    await page.waitForTimeout(400);
    if (await page.evaluate(() => window.__app.ui.current) === 'howto') { await press('.screen.show [data-a=howtoDone]'); await page.waitForTimeout(400); }
    await press(`.screen.show [data-mode=${mode}]`);
    await page.waitForTimeout(300);
    // one real tap / key press during a pitch must swing
    const swung = await (async () => {
      await page.evaluate(() => { const a = window.__app, e = a.engine; for (let i = 0; i < 2000 && !(e.phase === 'pitch' && e.time > e.pitch.tCross - 0.25); i++) a.tick(1 / 120, false); });
      if (touch) await page.touchscreen.tap(w / 2, h / 2); else await page.keyboard.press('Space');
      return page.evaluate(() => !!window.__app.engine.swing);
    })();
    // then let the bot play it out
    const res = await page.evaluate(async (mode) => {
      const a = window.__app, e = a.engine;
      const { createBot } = await import('/src/game/bot.js');
      a.bot = createBot(e, { errSd: 28, seed: 11 });
      const seen = {};
      e.on('result', (r) => { const k = r.result || r.call; seen[k] = (seen[k] || 0) + 1; });
      let homerShot = false;
      const limit = mode === 'practice' ? 60 * 45 : 60 * 60 * 12;
      for (let i = 0; i < limit && !e.over; i++) {
        a.tick(1 / 60, false);
        if (a.screen === 'over') break;
      }
      for (let i = 0; i < 120; i++) a.tick(1 / 60, false); // results screen appears ~0.9 s after the end
      a.tick(0.001, true);
      return { over: e.over, screen: a.ui.current, seen, score: e.game ? e.game.score : null, derby: e.mode === 'derby' ? { hr: e.derby.hr, outs: e.derby.outs } : null, time: Math.round(e.time) };
    }, mode);
    await page.waitForTimeout(1500);
    await page.addStyleTag({ content: '*,*::before,*::after{transition:none!important;animation:none!important}' });
    await page.evaluate(() => window.__app.tick(0.001, true));
    res.screen = await page.evaluate(() => window.__app.ui.current);
    await page.screenshot({ path: `qa-output/play-${sz}-${mode}.png` });
    out.push(`${sz} ${mode}: real ${touch ? 'tap' : 'key'} swung=${swung}; over=${res.over} screen=${res.screen} t=${res.time}s ${res.score ? 'score ' + res.score.top + '-' + res.score.bottom : ''}${res.derby ? 'derby ' + res.derby.hr + ' HR' : ''} results=${JSON.stringify(res.seen)} errors=${errors.length ? errors.join(' | ') : 'none'}`);
    await ctx.close();
  }
}
console.log(out.join('\n'));
await browser.close();
