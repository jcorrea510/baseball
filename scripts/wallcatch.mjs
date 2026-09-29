// Fly balls that come down in the last 30 feet in front of the wall: how many are caught, and how many of the catchable ones?
//   node scripts/wallcatch.mjs [balls=2000] [bandFeet=30]
// A ball is "catchable" by an independent yardstick (it does not use the planner's own catch search): at some moment while the ball is
// below the highest point a fielder can reach (a leap at the wall included) and still inside the park, some fielder - running by the
// game's own movement model: reaction time, acceleration, slower running back - can be within glove reach of it. Only balls that are
// truly out of reach (over the wall, off the wall, or where nobody can get to) should drop.
import { CONFIG } from '../src/config.js';
import { simulateBattedBall } from '../src/physics/ballistics.js';
import { fenceDistance, sprayOf, isInsideField } from '../src/physics/field.js';
import { sampleBall } from '../src/physics/ballistics.js';
import { createDefense, planPlay, POSITIONS } from '../src/game/fielding.js';
import { covered } from '../src/game/fielderMotion.js';
import { createRng } from '../src/util/rng.js';

const START = { x: 0, y: 2.6, z: -1 };
const dist = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);
const effort = (f, bx, bz) => { const dB = Math.hypot(bx, bz), dF = Math.hypot(f.x, f.z); return dB > dF + 8 ? 0.8 : dB < dF - 8 ? 1.06 : 1; };

/** A fly ball (launch angle la) that first touches the grass about `d` feet from home along `spray` (bisecting the exit speed). */
function ballLandingAt(spray, la, d, cfg = CONFIG) {
  let lo = 55, hi = 115, best = null;
  for (let i = 0; i < 22; i++) {
    const ev = (lo + hi) / 2;
    const c = { exitVelocity: ev, launchAngle: la, sprayAngle: spray, backspin: 900 + 55 * Math.max(la, 0), hook: 0 };
    const sim = simulateBattedBall({ ...c, start: START }, cfg);
    const fb = sim.firstBounce;
    const reach = fb && !sim.homerun && !(sim.wallHit && sim.wallHit.t < fb.t) ? Math.hypot(fb.x, fb.z) : sim.homerun || sim.wallHit ? Infinity : 0;
    if (Math.abs(reach - d) < 0.7 && fb) { best = { c, sim }; break; }
    if (reach > d) hi = ev; else lo = ev;
  }
  return best;
}

export function wallFlies({ n = 2000, band = 30, seed = 11, cfg = CONFIG, defense = createDefense(cfg), laRange = [16, 50] } = {}) {
  const rng = createRng(seed);
  const F = cfg.fielding;
  const res = { n: 0, caught: 0, catchable: 0, caughtOfCatchable: 0, uncatchable: 0, caughtOfUncatchable: 0, missed: [], byDepth: {}, byResult: {}, leaps: 0, catchY: [] };
  let guard = 0;
  while (res.n < n && guard++ < n * 20) {
    const spray = rng.range(-42, 42), la = rng.range(laRange[0], laRange[1]);
    const inFront = rng.range(0.7, band); // how far in front of the wall it comes down
    const target = fenceDistance(spray) - inFront;
    const b = ballLandingAt(spray, la, target, cfg);
    if (!b) continue;
    const { sim, c } = b;
    const plan = planPlay({ sim, contact: c, bases: [null, null, null], outs: 0, defense }, cfg);
    if (!plan.fair || plan.homer) continue;
    const fb = sim.firstBounce;
    res.n++;
    // the yardstick: walk along the ball's flight and ask every fielder whether he can be there
    let catchable = false, who = null;
    const tEnd = Math.min(sim.contactTime, sim.duration);
    for (let t = 0.3; t <= tEnd && !catchable; t += 1 / 120) {
      const b = sampleBall(sim, t);
      if (b.y > F.reachHeight || b.y < 0.5 || !isInsideField(b.x, b.z, -0.5)) continue;
      if (b.z < 0 && Math.abs(sprayOf(b.x, b.z)) <= 45 && Math.hypot(b.x, b.z) > fenceDistance(sprayOf(b.x, b.z)) - 0.5) continue; // over the wall
      for (const pos of POSITIONS) {
        const f = defense[pos];
        const avail = covered(f.speed * effort(f, b.x, b.z), t - f.react, F.accel);
        if (dist(f.x, f.z, b.x, b.z) - F.glove <= avail) { catchable = true; who = pos; break; }
      }
    }
    const caught = !!plan.caught;
    const depthKey = inFront < 10 ? '0-10 ft' : inFront < 20 ? '10-20 ft' : '20-30 ft';
    const dk = (res.byDepth[depthKey] = res.byDepth[depthKey] || { n: 0, catchable: 0, caught: 0, caughtOfCatchable: 0 });
    dk.n++; if (catchable) dk.catchable++; if (caught) dk.caught++; if (caught && catchable) dk.caughtOfCatchable++;
    res.byResult[plan.result] = (res.byResult[plan.result] || 0) + 1;
    if (caught) { res.caught++; res.catchY.push(plan.catchPos.y); if (plan.leap) res.leaps++; }
    if (catchable) { res.catchable++; if (caught) res.caughtOfCatchable++; else if (res.missed.length < 12) res.missed.push({ spray: +spray.toFixed(1), la: +la.toFixed(1), ev: +c.exitVelocity.toFixed(1), inFront: +inFront.toFixed(1), tLand: +fb.t.toFixed(2), who, result: plan.result, fielder: plan.fielder, apex: +sim.apex.y.toFixed(0) }); }
    else { res.uncatchable++; if (caught) res.caughtOfUncatchable++; }
  }
  return res;
}

if (process.argv[1] && process.argv[1].endsWith('wallcatch.mjs')) {
  const n = +(process.argv[2] || 2000), band = +(process.argv[3] || 30);
  const r = wallFlies({ n, band });
  const pct = (a, b) => (100 * a / Math.max(1, b)).toFixed(1) + '%';
  console.log(`${r.n} fly balls that came down 0.7-${band} ft in front of the wall`);
  console.log(`  catchable (a fielder can get there in time): ${r.catchable}   -> caught: ${r.caughtOfCatchable} = ${pct(r.caughtOfCatchable, r.catchable)}`);
  console.log(`  out of reach: ${r.uncatchable}   -> caught anyway: ${r.caughtOfUncatchable}`);
  console.log(`  all balls caught: ${r.caught} (${pct(r.caught, r.n)})`);
  for (const [k, v] of Object.entries(r.byDepth)) console.log(`  lands ${k} from the wall: ${v.n} balls, ${v.catchable} catchable, catch rate on catchable ${pct(v.caughtOfCatchable, v.catchable)}`);
  console.log('  results:', JSON.stringify(r.byResult));
  console.log(`  of the ${r.caught} catches: ${r.leaps} were leaps at the wall; the rest made standing, at a median height of ${r.catchY.filter((_, i) => true).sort((a, b) => a - b)[Math.floor(r.catchY.length / 2)].toFixed(1)} ft`);
  if (r.missed.length) { console.log('  catchable balls that were NOT caught:'); for (const m of r.missed) console.log('   ', JSON.stringify(m)); }
}
