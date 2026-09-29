// Real-game check of the landing ring: force fly balls in the running game and compare the ring with what the ball really does.
//   npm run dev (another window)  then  CHROME_PATH=... node scripts/landingqa.mjs [url]
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const URL = process.argv[2] || 'http://localhost:5173/';
fs.mkdirSync('qa-output', { recursive: true });
const launch = { args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] };
if (process.env.CHROME_PATH) launch.executablePath = process.env.CHROME_PATH;
const browser = await chromium.launch(launch);
let bad = 0;
const check = (ok, msg) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) bad++; };

const CASES = [
  { name: 'high fly to center (caught)', ev: 84, la: 38, spray: 2 },
  { name: 'deep fly to left-center (falls in)', ev: 92, la: 27, spray: -14 },
  { name: 'pop-up behind the mound', ev: 58, la: 68, spray: 4 },
  { name: 'ground ball (no ring)', ev: 70, la: -3, spray: 10 },
  { name: 'home run (no ring)', ev: 106, la: 30, spray: 0 },
];
for (const [i, c] of CASES.entries()) {
  console.log(`\n${c.name}`);
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  const errors = []; page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`${URL}?mode=quick&bot=1&sd=12&seed=${20 + i}`, { waitUntil: 'load' });
  await page.waitForFunction(() => document.documentElement.getAttribute('data-boot') === 'ready', null, { timeout: 90000 });
  const r = await page.evaluate((c) => {
    const a = window.__app, e = a.engine, ring = a.landRing.mesh;
    e.contactOverride = () => ({ exitVelocity: c.ev, launchAngle: c.la, sprayAngle: c.spray, backspin: 900 + 55 * Math.max(c.la, 0), hook: 0 });
    const frames = [];
    let shot = null, landed = null, caughtAt = null; const shots = {};
    e.on('playEvent', (ev) => { if (ev.type === 'catch') caughtAt = e.time - e.play.t0; });
    for (let i = 0; i < 9000; i++) {
      a.tick(1 / 120, false);
      if (e.phase === 'play' && e.play) {
        const t = e.time - e.play.t0, b = a.actors.ballPos;
        frames.push({ t, vis: ring.visible, r: ring.visible ? ring.scale.x : 0, a: ring.visible ? ring.material.opacity : 0, x: ring.position.x, z: ring.position.z, by: b.y, bx: b.x, bz: b.z });
        const tl = e.play.sim.firstBounce ? e.play.sim.firstBounce.t : 0;
        for (const k of [0.4, 0.7, 0.92]) if (!shots[k] && ring.visible && t > tl * k) { a.S.renderer.render(a.S.scene, a.S.camera); shots[k] = a.S.renderer.domElement.toDataURL('image/png'); }
        shot = shots[0.7] || null;
        if (landed === null && t > 0.6 && b.y < 0.5 && e.play.sim.firstBounce) landed = { t, x: b.x, z: b.z };
      } else if (frames.length && e.phase !== 'play') break;
    }
    const plan = e.play ? e.play.plan : null;
    return { frames, shot, shots, landed, caughtAt, result: e.lastResult || null };
  }, c);
  const fr = r.frames;
  const shown = fr.filter((f) => f.vis);
  if (i === 3 || i === 4) {
    check(shown.length === 0, 'no ring is ever shown');
  } else {
    check(shown.length > 20, `the ring is shown for ${shown.length ? (shown[shown.length - 1].t - shown[0].t).toFixed(2) : 0} s (from ${shown.length ? shown[0].t.toFixed(2) : '-'} s after contact)`);
    if (shown.length) {
      const last = shown[shown.length - 1];
      const rs = shown.map((f) => f.r);
      let mono = true; for (let k = 1; k < rs.length; k++) if (rs[k] > rs[k - 1] + 0.05) mono = false;
      check(mono, `it only shrinks (${rs[0].toFixed(1)} -> ${last.r.toFixed(1)} ft radius)`);
      check(shown.every((f) => Math.hypot(f.x - last.x, f.z - last.z) < 0.01), 'it stays put on one spot');
      if (r.caughtAt === null && r.landed) {
        check(Math.hypot(last.x - r.landed.x, last.z - r.landed.z) < 2.5, `it was on the spot where the ball landed (off by ${Math.hypot(last.x - r.landed.x, last.z - r.landed.z).toFixed(2)} ft)`);
        check(Math.abs(last.t - r.landed.t) < 0.1, `and it went away as the ball landed (${last.t.toFixed(2)} s vs ${r.landed.t.toFixed(2)} s)`);
      } else if (r.caughtAt !== null) {
        check(Math.abs(last.t - r.caughtAt) < 0.1, `it went away when the ball was caught (${last.t.toFixed(2)} s vs the catch at ${r.caughtAt.toFixed(2)} s)`);
      }
      const after = fr.filter((f) => f.t > last.t + 0.05 && f.t < last.t + 1.5);
      check(after.every((f) => !f.vis), 'and it stays hidden afterwards');
    }
    for (const [k, v] of Object.entries(r.shots || {})) fs.writeFileSync(`qa-output/landing-${i}-${Math.round(k * 100)}.png`, Buffer.from(v.split(',')[1], 'base64'));
  }
  check(errors.length === 0, `no console errors ${errors.slice(0, 2).join(' | ')}`);
  await page.close();
}

console.log('\nsetting off');
{
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  await page.goto(`${URL}?mode=quick&bot=1&sd=12&seed=30&ring=0`, { waitUntil: 'load' });
  await page.waitForFunction(() => document.documentElement.getAttribute('data-boot') === 'ready', null, { timeout: 90000 });
  const shown = await page.evaluate(() => {
    const a = window.__app, e = a.engine; let n = 0;
    e.contactOverride = () => ({ exitVelocity: 84, launchAngle: 38, sprayAngle: 2, backspin: 3000, hook: 0 });
    for (let i = 0; i < 6000; i++) { a.tick(1 / 120, false); if (a.landRing.mesh.visible) n++; }
    return n;
  });
  check(shown === 0, 'the ring never shows with the switch off');
  await page.close();
}
await browser.close();
console.log(bad ? `\n${bad} problem(s)` : '\nthe landing ring behaves in the real game');
process.exit(bad ? 1 : 0);
