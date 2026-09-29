// QA: do fielders ever leave the field? Plays thousands of batted balls (deep drives, wall balls, gappers,
// foul balls) through the real planner and checks every fielder's path against the outfield wall and the
// foul-ball limits. usage: node scripts/wallcheck.mjs [samples=3000]
import { CONFIG } from '../src/config.js';
import { createRng } from '../src/util/rng.js';
import { simulateBattedBall } from '../src/physics/ballistics.js';
import { createDefense, planPlay } from '../src/game/fielding.js';
import { samplePath } from '../src/game/fielderMotion.js';
import { isInsideField, clampToField, wallClearance } from '../src/physics/field.js';

const N = +(process.argv[2] || 3000);
const rng = createRng(77);
const defense = createDefense(CONFIG, createRng(5));
const POS = ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'];
// how far outside the ballpark (feet) is this spot? -1 = inside. Uses the whole outline: outfield wall, foul-territory
// walls and the backstop.
export function excessBeyondWall(x, z) {
  if (isInsideField(x, z)) return -1;
  const [cx, cz] = clampToField(x, z, 0);
  return Math.hypot(x - cx, z - cz);
}
let worst = 0, worstCase = null, bad = 0, plays = 0, wallPlays = 0;
const nearWallSpeeds = [], minClear = [], decels = [];
let wallPlaysFielded = 0;
const byKind = {};
for (let i = 0; i < N; i++) {
  const params = {
    exitVelocity: rng.range(88, 112), launchAngle: rng.range(6, 42), sprayAngle: rng.range(-48, 48),
    backspin: rng.range(800, 3200), hook: rng.range(-1, 1), start: { x: 0, y: 2.6, z: -1 },
  };
  const sim = simulateBattedBall(params);
  const bases = [rng.next() < 0.5 ? {} : null, rng.next() < 0.3 ? {} : null, rng.next() < 0.2 ? {} : null];
  const plan = planPlay({ sim, contact: { grade: 'good', ...params }, bases, outs: rng.int(0, 2), defense, simple: false }, CONFIG);
  plays++;
  if (sim.wallHit) wallPlays++;
  if (sim.wallHit && !plan.homer && plan.pickupT !== undefined) wallPlaysFielded++;
  let playWorst = -99;
  for (const pos of POS) {
    const runs = plan.paths[pos];
    if (!runs || !runs.length) continue;
    const tEnd = Math.max(...runs.map((r) => r.tStop ?? r.tEnd ?? 0)) + 0.3;
    let prevV = null, clear = Infinity, vAtClear = 0;
    for (let t = 0; t <= tEnd; t += 1 / 60) {
      const p = samplePath(runs, t);
      if (!p) continue;
      const ex = excessBeyondWall(p.x, p.z);
      if (ex > playWorst) playWorst = ex;
      const c = wallClearance(p.x, p.z);
      if (c < clear) { clear = c; vAtClear = p.speed; }
      if (prevV !== null && c < 6) { const dc = (prevV - p.speed) * 60; decels.push(dc); if (dc > 200 && process.env.DEBUG_WALL) console.log('abrupt stop', pos, dc.toFixed(0), 'v', prevV.toFixed(1), '->', p.speed.toFixed(1), 'phase', p.phase, 'clear', c.toFixed(2), 'run', JSON.stringify({ D: runs[runs.length-1].D, limitS: runs[runs.length-1].limitS, sStop: runs[runs.length-1].sStop, vArr: runs[runs.length-1].vArrive, n: runs.length }), JSON.stringify(params)); }
      prevV = p.speed;
    }
    if (clear < 6) { minClear.push(clear); nearWallSpeeds.push(vAtClear); }
  }
  const kind = plan.homer ? 'homer' : plan.result;
  (byKind[kind] ||= { n: 0, worst: -99, over: 0 });
  byKind[kind].n++; byKind[kind].worst = Math.max(byKind[kind].worst, playWorst);
  if (playWorst > 0.05) { bad++; byKind[kind].over++; }
  if (playWorst > worst) { worst = playWorst; worstCase = { params, kind, playWorst }; }
}
console.log(`plays ${plays}, hit the wall ${wallPlays}, plays where a fielder went past the wall: ${bad}`);
console.log(`balls played off the wall by a fielder: ${wallPlaysFielded}`);
console.log('worst penetration (ft past the wall):', worst.toFixed(2), worstCase ? JSON.stringify(worstCase) : '');
const q = (a, p) => { const b = [...a].sort((x, y) => x - y); return b.length ? b[Math.min(b.length - 1, Math.floor(p * b.length))] : NaN; };
console.log(`fielders who got within 6 ft of a wall: ${minClear.length}; closest approach p05/p50 ${q(minClear, 0.05).toFixed(2)} / ${q(minClear, 0.5).toFixed(2)} ft; speed at closest approach p50/p95 ${q(nearWallSpeeds, 0.5).toFixed(1)} / ${q(nearWallSpeeds, 0.95).toFixed(1)} ft/s; hardest braking near a wall ${q(decels, 0.9999).toFixed(0)} ft/s^2 (p99 ${q(decels, 0.99).toFixed(0)})`);
console.log(JSON.stringify(byKind));
process.exitCode = bad ? 1 : 0;
