// How fielding by hand feels: a simulated PERSON steers the outfielder (game/fieldControl.js) on fly balls and liners the automatic
// fielding catches, and we count how many he catches. The person reacts late (`react`), waits for the landing ring and steers toward
// it with a shaky hand (`noiseDeg`, wandering slowly) - a liner with no ring he judges by eye (`judge`: share of its distance he is
// off) - and dives a dive's flight before the ball is low when he will not quite get there, a little early or late (`diveSd`).
//   node scripts/fieldfeel.mjs [balls=400] [casual|average|expert|all] [rookie|pro|allstar|all]
import { CONFIG } from '../src/config.js';
import { simulateBattedBall } from '../src/physics/ballistics.js';
import { createDefense, planPlay, sampleBall } from '../src/game/fielding.js';
import { FieldControl } from '../src/game/fieldControl.js';
import { landingSpot } from '../src/game/landing.js';
import { createRng } from '../src/util/rng.js';

export const PEOPLE = {
  casual: { react: 0.35, noiseDeg: 12, wander: 1.2, diveSd: 0.12, stopAt: 1.5, judge: 0.06 },
  average: { react: 0.25, noiseDeg: 7, wander: 1.5, diveSd: 0.08, stopAt: 1.2, judge: 0.04 },
  expert: { react: 0.15, noiseDeg: 3, wander: 2, diveSd: 0.04, stopAt: 0.8, judge: 0.02 },
};
const OF = ['LF', 'CF', 'RF'];
const FRAME = 1 / 60;

// The balls: seeded fly balls and liners to the outfield that the automatic fielding catches with an outfielder.
export function catchableBalls(n, seed = 9, cfg = CONFIG) {
  const rng = createRng(seed), defense = createDefense(), out = [];
  for (let guard = 0; out.length < n && guard < n * 40; guard++) {
    const la = rng.range(8, 50), ev = rng.range(70, 104), spray = rng.range(-44, 44);
    const contact = { exitVelocity: ev, launchAngle: la, sprayAngle: spray, backspin: 900 + 55 * Math.max(la, 0), hook: 0 };
    const sim = simulateBattedBall({ ...contact, start: { x: 0, y: 2.6, z: -1 } }, cfg);
    const plan = planPlay({ sim, contact, bases: [null, null, null], outs: 0, defense }, cfg);
    if (!plan.fair || plan.homer || !plan.caught || !OF.includes(plan.fielder)) continue;
    out.push({ sim, pos: plan.fielder, catchT: plan.catchT, dive: !!plan.fielderMoves[0].dive });
  }
  return { balls: out, defense };
}

// One ball played by one person: { caught, why } (why: 'late' - he got there after it, 'dive' - a dive that missed, 'short' - never close)
export function playBall({ sim, pos }, defense, person, level, rng, cfg = CONFIG) {
  const F = cfg.fielding;
  const fc = new FieldControl({ sim, defense, pos, cfg, level });
  // where it comes down: the landing ring, or - a low liner gets no ring - where he judges it by eye (its first bounce, a little off)
  const ringed = landingSpot(sim, null, cfg, true);
  const fb = sim.firstBounce || { x: sampleBall(sim, sim.duration).x, z: sampleBall(sim, sim.duration).z, t: sim.duration };
  const eye = person.judge * rng.gauss(0, 1);
  const land = ringed || { x: fb.x * (1 + eye), z: fb.z * (1 + eye), tLand: fb.t };
  // when the ball gets down to diving height (5 ft) on its way down
  let tLow = land.tLand;
  for (let q = sim.apex.t; q <= land.tLand; q += 1 / 240) if (sampleBall(sim, q).y <= 5) { tLow = q; break; }
  let wobble = rng.gauss(0, person.noiseDeg), dived = false, diveAt = null, closest = Infinity;
  const k = Math.exp(-FRAME * person.wander);
  for (let t = FRAME; t <= sim.duration + 2 && !fc.finished && fc.outcome?.kind !== 'down'; t += FRAME) {
    if (t >= person.react) {
      // aim at the ring (where it comes down); once the ball is low and near, at the ball itself
      const s = fc.state, b = sampleBall(sim, t);
      const near = b.y < 12 && Math.hypot(b.x - s.x, b.z - s.z) < 15;
      // (before the ring shows he waits for it; a liner with no ring he reads by eye at once)
      const ring = !ringed || t >= ringed.tStart + person.react;
      const tx = near ? b.x : land.x, tz = near ? b.z : land.z;
      const dx = tx - s.x, dz = tz - s.z, d = Math.hypot(dx, dz);
      wobble = wobble * k + rng.gauss(0, person.noiseDeg * Math.sqrt(1 - k * k));
      const a = Math.atan2(dx, dz) + (wobble * Math.PI) / 180;
      const mag = d < person.stopAt || (!ring && !near) ? 0 : Math.min(1, d / 6);
      fc.setInput(Math.sin(a) * mag, Math.cos(a) * mag);
      closest = Math.min(closest, Math.hypot(b.x - s.x, b.z - s.z));
      // a dive: he will not quite get there running, the ball is coming down - he leaves his feet a dive's flight before it is low,
      // a little early or late
      if (!dived && diveAt === null && t >= tLow - F.dive.airTime - 0.05 && t < tLow) {
        const pl = sampleBall(sim, tLow), gap = Math.hypot(pl.x - s.x, pl.z - s.z);
        if (gap > F.glove + 1 && gap < F.glove + F.diveExtra + 3) diveAt = tLow - F.dive.airTime + rng.gauss(0, person.diveSd);
      }
      if (!dived && diveAt !== null && t >= diveAt) { fc.pressDive(t); dived = true; }
    }
    fc.advance(t);
  }
  const caught = fc.outcome && fc.outcome.kind === 'catch';
  return { caught, why: caught ? null : dived ? 'dive' : closest < F.glove + F.diveExtra + 4 ? 'late' : 'short' };
}

export function catchRate(n, who, level, seed = 9, cfg = CONFIG) {
  const { balls, defense } = catchableBalls(n, seed, cfg);
  const rng = createRng(seed * 7 + 1);
  const why = { late: 0, dive: 0, short: 0 };
  let caught = 0;
  for (const b of balls) {
    const r = playBall(b, defense, PEOPLE[who], level, rng, cfg);
    if (r.caught) caught++; else why[r.why]++;
  }
  return { n: balls.length, caught, rate: caught / balls.length, why };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const n = +(process.argv[2] || 400);
  const whoArg = process.argv[3] || 'all', levelArg = process.argv[4] || 'all';
  const people = whoArg === 'all' ? Object.keys(PEOPLE) : [whoArg];
  const levels = levelArg === 'all' ? ['rookie', 'pro', 'allstar'] : [levelArg];
  console.log(`catches on ${n} catchable balls (the automatic fielding catches all of them)`);
  for (const who of people) for (const level of levels) {
    const r = catchRate(n, who, level);
    console.log(`  ${who.padEnd(8)} ${level.padEnd(8)} ${(100 * r.rate).toFixed(1)}%   missed: got there late ${r.why.late}, dive missed ${r.why.dive}, never close ${r.why.short}`);
  }
}
