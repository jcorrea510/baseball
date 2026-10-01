// HUD overlap check in the real game: every pop-up (pitch pill, exit-speed readout, timing meter, banner, score bug, aim
// controls, practice drawer; and, as a second state, the base diamond you send runners with during a play) forced on at once, in each mode, at each screen size; prints any two that overlap or leave the screen.
//   npm run dev  then  node scripts/hudqa.mjs [sizes e.g. 568x320,844x390] [url]      (screenshots in qa-output/)
import fs from 'node:fs';
import { chromium } from 'playwright-core';
const BROWSER = process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : fs.existsSync('/opt/pw-browsers/chromium') ? { executablePath: '/opt/pw-browsers/chromium' } : {};
fs.mkdirSync('qa-output', { recursive: true });
const browser = await chromium.launch({ ...BROWSER, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const sizes = (process.argv[2] || '568x320,844x390,1280x720,390x844').split(',');
const report = [];
for (const sz of sizes) {
  const [w, h] = sz.split('x').map(Number);
  const touch = w < 900;
  for (const [mode, state] of [['quick', 'pitch'], ['derby', 'pitch'], ['practice', 'pitch'], ['quick', 'play'], ['practice', 'play']]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: touch, isMobile: touch });
    const page = await ctx.newPage();
    await page.goto(`${process.argv[3] || 'http://localhost:5173/'}?mode=${mode}&seed=4`, { waitUntil: 'load' });
    await page.waitForFunction(() => document.documentElement.getAttribute('data-boot') === 'ready', null, { timeout: 90000 });
    await page.addStyleTag({ content: '*,*::before,*::after{transition:none!important;animation:none!important}' });
    const r = await page.evaluate((state) => {
      const a = window.__app, ui = a.ui;
      if (ui.rotateEl) ui.rotateEl.style.display = 'none';
      for (let i = 0; i < 60; i++) a.tick(1 / 30, false);
      ui.showPitchInfo('Curveball', 84, false, 99999);
      ui.callout([{ v: 104, u: 'mph', l: 'Exit velo' }, { v: 412, u: 'ft', l: 'Distance' }, { v: 28, u: '°', l: 'Launch' }], 99999);
      ui.timing(-12, 'good', { perfect: 20, good: 42 }, 'GOOD · 12 ms early');
      ui.banner('DOUBLE', '98 mph · 2 runs', 'good');
      if (a.engine.mode === 'quick' && state === 'pitch') ui.showBatterUp({ number: 12, name: 'J. Delgado-Whitfield', pos: 'SS' }, { pa: 2, ab: 2, h: 1, hr: 1, rbi: 2, bb: 0 }, ['.312 AVG', '14 HR', 'Contact 62 · Power 70 · Speed 55']);
      if (a.engine.mode === 'quick') { ui.setSteal(true, true); a.refreshLineup(); }
      if (state === 'pitch') ui.setSwingButton(true); // (the Steal button next to Bunt)
      else ui.setBasePad({ targets: [2, 3, 4], dots: [{ x: 0, z: 0 }, { x: 60, z: -60, sent: true }] }); // (during a play: the base diamond, no Swing button)
      ui.q.banner.style.opacity = '1';
      a.tick(0.001, true);
      // overlap check between visible HUD boxes
      const sel = ['.lineup', '.pitchinfo', '.callout', '.meter', '.batterup', '.bugwrap', '.derbybox', '.practbox', '.practice', '.hudbtns', '.acts', '.swingbtn', '.basepad'];
      const boxes = [];
      for (const s of sel) { const e = document.querySelector('.hud ' + s); if (!e) continue; const cs = getComputedStyle(e); if (cs.display === 'none' || +cs.opacity === 0) continue; const b = e.getBoundingClientRect(); if (b.width && b.height) boxes.push({ s, b }); }
      const hits = [];
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
        const A = boxes[i].b, B = boxes[j].b;
        const ox = Math.min(A.right, B.right) - Math.max(A.left, B.left), oy = Math.min(A.bottom, B.bottom) - Math.max(A.top, B.top);
        if (ox > 2 && oy > 2) hits.push(`${boxes[i].s} x ${boxes[j].s} (${Math.round(ox)}x${Math.round(oy)})`);
      }
      const off = boxes.filter(({ b }) => b.left < -1 || b.top < -1 || b.right > innerWidth + 1 || b.bottom > innerHeight + 1).map(({ s }) => s + ' off-screen');
      return hits.concat(off);
    }, state);
    report.push(`${sz} ${mode}${state === 'play' ? ' (play)' : ''}: ${r.length ? r.join('; ') : 'no overlaps'}`);
    await page.screenshot({ path: `qa-output/hud-${sz}-${mode}${state === 'play' ? '-play' : ''}.png` });
    await ctx.close();
  }
}
console.log(report.join('\n'));
await browser.close();
