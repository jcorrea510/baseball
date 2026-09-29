// Real-game check of fly-ball catches (especially near the wall): force fly balls in the running game and look at the PICTURE just
// before each catch - is the ball where his glove is, is he on the ground unless he is leaping, and is he inside the park?
//   npm run dev (another window)  then  CHROME_PATH=... node scripts/wallqa.mjs [url] [flies=60]
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const URL = process.argv[2] || 'http://localhost:5173/';
const N = +(process.argv[3] || 60);
const WALL = process.argv.includes('--wall'); // aim the flies at the wall (deep drives)
// deep drives that make an outfielder leave the ground when the pitch is dead-centre and the swing on time (found with the planner)
const LEAPS = process.argv.includes('--leaps') ? [[98.9, 34.5, -4], [99.6, 38.5, 5.4], [100, 29.9, -1.2], [101.5, 44, -8.3], [90.3, 26.9, 17.6], [92.3, 42.9, 29.7], [90.1, 33.9, 20.1], [95.1, 28.6, 8.5]] : null;
const launch = { args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] };
if (process.env.CHROME_PATH) launch.executablePath = process.env.CHROME_PATH;
const browser = await chromium.launch(launch);
const rows = [];
for (let chunk = 0; chunk < N; chunk += 20) {
  const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
  await page.goto(`${URL}?mode=quick&bot=1&sd=${LEAPS ? 2 : 12}&seed=${60 + chunk}`, { waitUntil: 'load' });
  await page.waitForFunction(() => document.documentElement.getAttribute('data-boot') === 'ready', null, { timeout: 90000 });
  const got = await page.evaluate(({ count, off, wall, leaps }) => {
    const a = window.__app, e = a.engine, out = [];
    let seed = 31 + off; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
    for (let n = 0; n < count; n++) {
      for (let i = 0; i < 3000 && !(e.phase === 'ready' || e.phase === 'windup'); i++) a.tick(1 / 30, false);
      // fly balls: most of them deep, so many come down near the wall
      const L = leaps ? leaps[n % leaps.length] : null;
      if (leaps) e.pitchOverride = () => ({ type: 'fastball', speedMph: 78, target: { x: 0, y: 2.6 }, intendedStrike: true, tell: { slot: 0, lag: 0 }, announce: false });
      const c = L ? { exitVelocity: L[0], launchAngle: L[1], sprayAngle: L[2], backspin: 900 + 55 * L[1], hook: 0 } : wall
        ? { exitVelocity: 93 + rnd() * 9, launchAngle: 27 + rnd() * 14, sprayAngle: -30 + rnd() * 60, backspin: 2500, hook: 0 }
        : { exitVelocity: 72 + rnd() * 34, launchAngle: 22 + rnd() * 30, sprayAngle: -38 + rnd() * 76, backspin: 2500, hook: 0 };
      e.contactOverride = () => c;
      let plan = null, before = null, at = null, prevBall = null, jump = null, shot = null;
      const off1 = e.on('contact', (ct) => { plan = ct.plan; });
      for (let i = 0; i < 6000 && e.phase !== 'result'; i++) {
        a.tick(1 / 240, false);
        if (plan && plan.caught && e.play) {
          const t = e.time - e.play.t0;
          const person = a.actors.fielders[plan.fielder];
          if (!before && t >= plan.catchT - 0.03) {
            person.root.updateMatrixWorld(true);
            const hl = person.handWorld('L'), hr = person.handWorld('R'), b = a.actors.ballPos;
            before = { dh: Math.min(Math.hypot(hl.x - b.x, hl.y - b.y, hl.z - b.z), Math.hypot(hr.x - b.x, hr.y - b.y, hr.z - b.z)), ballY: b.y, rootY: person.root.position.y };
          }
          const bb = a.actors.ballPos;
          if (plan.leap && !shot && t >= plan.catchT) { a.S.renderer.render(a.S.scene, a.S.camera); shot = a.S.renderer.domElement.toDataURL('image/png'); }
          if (!at && t >= plan.catchT) { at = { rootY: person.root.position.y, leap: plan.leap ? plan.leap.height : 0, catchY: plan.catchPos.y }; if (prevBall) jump = Math.hypot(bb.x - prevBall.x, bb.y - prevBall.y, bb.z - prevBall.z); }
          prevBall = { x: bb.x, y: bb.y, z: bb.z };
        }
      }
      off1();
      if (before && at) out.push({ ...before, ...at, jump, shot, dive: !!(plan.fielderMoves[0] && plan.fielderMoves[0].dive) });
    }
    return out;
  }, { count: Math.min(20, N - chunk), off: chunk, wall: WALL, leaps: LEAPS });
  rows.push(...got);
  await page.close();
}
await browser.close();
const med = (a) => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)];
const dh = rows.map((r) => r.dh);
const leaps = rows.filter((r) => r.leap > 0);
const flat = rows.filter((r) => !r.leap && !r.dive);
console.log(`${rows.length} fly-ball catches in the real game (${leaps.length} leaps, ${rows.filter((r) => r.dive).length} dives)`);
console.log(`ball-to-glove distance just before the catch: median ${med(dh).toFixed(2)} ft, worst ${Math.max(...dh).toFixed(2)} ft`);
console.log(`catch heights: ${rows.map((r) => r.catchY.toFixed(1)).join(' ')}`);
console.log(`glove distances: ${rows.map((r) => r.dh.toFixed(1)).join(' ')}`);
let shots = 0;
fs.mkdirSync('qa-output', { recursive: true });
for (const r of rows) if (r.shot && shots < 3) fs.writeFileSync(`qa-output/leap-${shots++}.png`, Buffer.from(r.shot.split(',')[1], 'base64'));
const jumps = rows.map((r) => r.jump ?? 0);
console.log(`how far the ball jumps in the one frame (1/240 s) at the catch: median ${med(jumps).toFixed(2)} ft, worst ${Math.max(...jumps).toFixed(2)} ft (a ball in flight moves ~0.3 ft per frame)`);
let bad = 0;
if (med(dh) > 1.2) { console.log('  FAIL the ball is not in his glove'); bad++; }
if (Math.max(...dh) > 2.6) { console.log('  FAIL some ball was more than 2.6 ft from his glove'); bad++; }
if (Math.max(...jumps) > 1.2) { console.log('  FAIL the ball snaps more than 1.2 ft into the glove at a catch'); bad++; }
for (const r of flat) if (r.rootY > 0.05) { console.log(`  FAIL a fielder is off the ground (${r.rootY.toFixed(2)} ft) on a catch that needs no jump`); bad++; break; }
for (const r of leaps) if (Math.abs(r.rootY - r.leap) > 0.35) { console.log(`  FAIL a leap of ${r.leap.toFixed(2)} ft is drawn ${r.rootY.toFixed(2)} ft high at the catch`); bad++; break; }
console.log(leaps.length ? `leaps: ${leaps.map((r) => `${r.leap.toFixed(1)} ft jump (root ${r.rootY.toFixed(1)})`).join(', ')}` : '(no leaps in this sample)');
console.log(bad ? `\n${bad} problem(s)` : '\nthe ball is in the glove at every catch, and he leaps only when he has to');
process.exit(bad ? 1 : 0);
