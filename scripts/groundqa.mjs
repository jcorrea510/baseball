// Real-game check of groundouts: force ground balls to every infielder in the running game (headless Chrome, the real renderer) and
// look at the PICTURE at the moment the umpire calls the out: is a fielder standing on the bag, and is the ball there?
//   npm run dev  (in another window)   then   CHROME_PATH=... node scripts/groundqa.mjs [url=http://localhost:5173/]
import { chromium } from 'playwright-core';
import { BASE_XZ } from '../src/physics/field.js';

const URL = process.argv[2] || 'http://localhost:5173/';
const CASES = [
  ['P', 0, 50], ['P', 3, 60], ['1B', 38, 45], ['1B', 33, 52], ['1B', 22, 48], ['2B', 22, 50], ['2B', 14, 58], ['SS', -22, 50], ['SS', -14, 60],
  ['3B', -38, 52], ['3B', -44, 60], ['3B', -30, 45],
];
const launch = { args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] };
if (process.env.CHROME_PATH) launch.executablePath = process.env.CHROME_PATH;
const browser = await chromium.launch(launch);
const rows = [];
for (let chunk = 0; chunk < CASES.length; chunk += 3) {
  const page = await browser.newPage({ viewport: { width: 800, height: 450 } });
  await page.goto(`${URL}?mode=quick&bot=1&sd=15&seed=${11 + chunk}`, { waitUntil: 'load' });
  await page.waitForFunction(() => document.documentElement.getAttribute('data-boot') === 'ready', null, { timeout: 90000 });
  const got = await page.evaluate(async ({ cases, bases }) => {
    const a = window.__app, e = a.engine, out = [];
    for (const [want, spray, ev] of cases) {
      for (let i = 0; i < 1200 && !(e.phase === 'ready' || e.phase === 'windup'); i++) a.tick(1 / 30, false);
      let cur = { exitVelocity: ev, launchAngle: -3, sprayAngle: spray, backspin: 900, hook: 0 };
      e.contactOverride = () => cur;
      let snap = null, pending = null, result = null, fielder = null, plan = null;
      const offP = e.on('playEvent', (p) => { if (p.type === 'out' && !pending && !snap) pending = p; });
      const offR = e.on('result', (r) => { if (r.kind === 'pa' || r.kind === 'play') result = r; });
      const offC = e.on('contact', (c) => { plan = c.plan; fielder = c.plan && c.plan.fielder; });
      for (let i = 0; i < 4000 && !result; i++) {
        a.tick(1 / 60, false);
        if (pending && !snap) {
          const ev1 = pending;
          const person = a.actors.fielders[ev1.pos];
          const p = person.root.position, b = a.actors.ballPos;
          snap = { pos: ev1.pos, base: ev1.base, fx: p.x, fz: p.z, bx: b.x, bz: b.z, t: ev1.t, throws: e.play && e.play.plan ? e.play.plan.throws.map((t) => `${t.from}>${t.to}@${t.toBase}`) : [], fielder: e.play && e.play.plan ? e.play.plan.fielder : null };
        }
      }
      for (let i = 0; i < 300; i++) a.tick(1 / 30, false); // let the play finish, move on
      out.push({ want, spray, ev, fielder: snap ? snap.fielder : fielder, result: result && result.result, snap, throws: snap ? snap.throws : [] });
      offP && offP(); offR && offR(); offC && offC();
      // wait until the next pitch can be thrown
      for (let i = 0; i < 1200 && !(e.phase === 'ready' || e.phase === 'windup'); i++) a.tick(1 / 30, false);
    }
    return out;
  }, { cases: CASES.slice(chunk, chunk + 3), bases: BASE_XZ });
  rows.push(...got);
  await page.close();
}
await browser.close();
let bad = 0;
for (const r of rows) {
  if (!r.snap) { console.log(`${r.want.padEnd(3)} spray ${String(r.spray).padStart(3)} ev ${r.ev}: fielded by ${r.fielder}, result ${r.result} (no out)`); continue; }
  const bag = BASE_XZ[r.snap.base];
  const fd = Math.hypot(r.snap.fx - bag[0], r.snap.fz - bag[1]), bd = Math.hypot(r.snap.bx - bag[0], r.snap.bz - bag[1]);
  const ok = fd < 3.2 && bd < 3.5;
  if (!ok) bad++;
  console.log(`${r.want.padEnd(3)} spray ${String(r.spray).padStart(3)} ev ${r.ev}: fielded by ${String(r.fielder).padEnd(2)} -> out at ${r.snap.base} by ${r.snap.pos.padEnd(2)} (${r.throws.join(' ') || 'carried it himself'})   receiver ${fd.toFixed(1)} ft from the bag, ball ${bd.toFixed(1)} ft   ${ok ? 'OK' : 'BAD'}`);
}
console.log(bad ? `\n${bad} BAD` : '\nevery out in the picture has the receiver and the ball on the bag');
process.exit(bad ? 1 : 0);
