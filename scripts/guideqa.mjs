// Real-game check of the pitch guide: is the circle there during the flight, where the pitch really goes, fading in, and gone
// when the setting is off? (The Derby shows it too, since round seven.) Saves screenshots to qa-output/.
//   npm run dev (another window)  then  CHROME_PATH=... node scripts/guideqa.mjs [url]
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const URL = process.argv[2] || 'http://localhost:5173/';
fs.mkdirSync('qa-output', { recursive: true });
const launch = { args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] };
if (process.env.CHROME_PATH) launch.executablePath = process.env.CHROME_PATH;
const browser = await chromium.launch(launch);
let bad = 0;
const check = (ok, msg) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) bad++; };

async function session(query, fn) {
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  const errors = []; page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`${URL}?${query}`, { waitUntil: 'load' });
  await page.waitForFunction(() => document.documentElement.getAttribute('data-boot') === 'ready', null, { timeout: 90000 });
  await fn(page);
  check(errors.length === 0, `no console errors ${errors.slice(0, 2).join(' | ')}`);
  await page.close();
}

// step the real game to a chosen moment of the next pitch; returns what the guide looks like there
const sample = (page, fractions, shots = null) => page.evaluate(({ fractions, shots }) => {
  const a = window.__app, e = a.engine, out = [];
  e.swingPressed = () => false; // (never swing: we only look)
  // (a game starts with the computer's half, which you pitch - Sim it - and the Ready card: press that)
  for (let i = 0; i < 8000 && e.phase !== 'windup'; i++) { if (e.pitching && !e.simming && !a.bot) e.simHalf(); if (e.awaitingBatter) e.batterReady(); a.tick(1 / 60, false); }
  for (let i = 0; i < 4000 && e.phase !== 'pitch'; i++) a.tick(1 / 120, false);
  const p = e.pitch;
  for (const f of fractions) {
    const want = p.tRelease + f * p.flight.T;
    for (let i = 0; i < 4000 && e.time < want && e.phase === 'pitch'; i++) a.tick(1 / 240, false);
    a.tick(1 / 240, false);
    const m = a.guide.mesh;
    if (shots && shots[f]) { a.S.renderer.render(a.S.scene, a.S.camera); out.shot = out.shot || {}; out.shot[f] = a.S.renderer.domElement.toDataURL('image/png'); }
    out.push({ f, visible: m.visible, alpha: +m.material.opacity.toFixed(3), x: +m.position.x.toFixed(2), y: +m.position.y.toFixed(2), r: +m.scale.x.toFixed(2), tx: +p.target.x.toFixed(2), ty: +p.target.y.toFixed(2), type: p.type, strike: p.isStrike, phase: e.phase });
  }
  return { rows: out, shot: out.shot || null };
}, { fractions, shots });

for (const level of ['rookie', 'pro', 'allstar']) {
  console.log(`\n${level}`);
  await session(`mode=quick&diff=${level}&seed=5&tod=day`, async (page) => {
    const res = await sample(page, [0.01, 0.2, 0.35, 0.55, 0.75, 0.95], { 0.75: true }); // (it fades in from 2-4.5% of the flight)
    const rows = res.rows;
    fs.writeFileSync(`qa-output/guide-${level}.png`, Buffer.from(res.shot[0.75].split(',')[1], 'base64'));
    for (const r of rows) console.log(`   ${String(r.f).padEnd(5)} ${r.visible ? 'shown' : 'hidden'} alpha ${r.alpha} at (${r.x}, ${r.y}) radius ${r.r}    real spot (${r.tx}, ${r.ty}) ${r.type} ${r.strike ? 'strike' : 'ball'}`);
    check(!rows[0].visible, 'not shown right after release');
    check(rows[5].visible && rows[5].alpha > 0.15, 'shown and clearly visible just before the plate');
    check(Math.hypot(rows[5].x - rows[5].tx, rows[5].y - rows[5].ty) < 2.6 * (level === 'rookie' ? 0.3 : level === 'pro' ? 0.6 : 1.2), 'points near where the pitch really goes');
    let up = true; for (let i = 1; i < rows.length; i++) if (rows[i].alpha < rows[i - 1].alpha - 1e-3) up = false;
    check(up, 'fades in (never dims) through the flight');
  });
}

console.log('\nsetting off');
await session('mode=quick&diff=pro&seed=5&guide=0', async (page) => {
  const rows = (await sample(page, [0.5, 0.8])).rows;
  check(rows.every((r) => !r.visible), 'nothing shown with the Pitch guide switched off');
});
console.log('\nturned off from the pause menu, then back on');
await session('mode=quick&diff=pro&seed=6', async (page) => {
  await page.evaluate(() => { const a = window.__app; a.setPaused(true); });
  await page.click('#ui .screen.show .switch[data-set="pitchGuide"]');
  check(await page.evaluate(() => window.__app.settings.pitchGuide === false), 'the switch turned it off');
  await page.click('#ui .screen.show .switch[data-set="pitchGuide"]');
  check(await page.evaluate(() => window.__app.settings.pitchGuide === true), 'and back on');
});
console.log('\nDerby');
await session('mode=derby&diff=pro&seed=5', async (page) => {
  const rows = (await sample(page, [0.6, 0.9])).rows;
  check(rows.some((r) => r.visible), 'the Derby shows the guide too (round seven)');
});
await browser.close();
console.log(bad ? `\n${bad} problem(s)` : '\nthe pitch guide behaves in the real game');
process.exit(bad ? 1 : 0);
