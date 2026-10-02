// How plays come out compared with real baseball. Thousands of batted balls in every base / out situation go through the real
// planner (fielding.js) and this prints the things a real game shows - who fields, who covers, who takes the out, double-play
// pivots, sac flies, runners scoring from third, who catches pop-ups, extra bases - next to rough big-league numbers.
//   node scripts/realism.mjs [balls=6000] [seed=3]
import { CONFIG } from '../src/config.js';
import { createRng } from '../src/util/rng.js';
import { simulateBattedBall } from '../src/physics/ballistics.js';
import { createDefense, planPlay, alignDefense } from '../src/game/fielding.js';
import { auditPlan } from '../src/game/playAudit.js';

const N = +(process.argv[2] || 6000);
const rng = createRng(+(process.argv[3] || 3));
const pct = (a = 0, b = 0) => (b ? `${((100 * a) / b).toFixed(0)}%` : '-').padStart(4);
const tally = {};
const add = (k, v = 1) => { tally[k] = (tally[k] || 0) + v; };
const IF = new Set(['P', 'C', '1B', '2B', '3B', 'SS']);
const problems = [];

for (let k = 0; k < N; k++) {
  // a spread of batted balls like a real game's: mostly grounders and fly balls, some liners and pop-ups
  const kind = rng.next();
  const la = kind < 0.44 ? rng.range(-18, 8) : kind < 0.66 ? rng.range(8, 22) : kind < 0.92 ? rng.range(22, 48) : rng.range(48, 70);
  const ev = Math.max(35, Math.min(112, rng.gauss(89, 12)));
  const c = { exitVelocity: ev, launchAngle: la, sprayAngle: rng.range(-44, 44), backspin: 900 + 55 * Math.max(la, 0), hook: 0 };
  const bases = [rng.chance(0.45) ? 'r1' : null, rng.chance(0.3) ? 'r2' : null, rng.chance(0.22) ? 'r3' : null];
  const outs = rng.int(0, 2);
  const sim = simulateBattedBall({ ...c, start: { x: 0, y: 2.6, z: -1 } });
  const defense = alignDefense(createDefense(CONFIG, createRng(k + 9)), bases, outs);
  const plan = planPlay({ sim, contact: c, bases, outs, defense }, CONFIG);
  const bad = auditPlan(plan, defense);
  if (bad.length && problems.length < 10) problems.push(`${plan.result}: ${bad[0]}`);
  if (!plan.fair || plan.result === 'foul' || plan.result === 'foulOut') continue;
  const ground = la < 8 && !plan.caught;
  const outEvents = plan.events.filter((e) => e.type === 'out');
  add('balls');
  // --- ground balls fielded by an infielder
  if (ground && IF.has(plan.fielder)) {
    add('gb.if');
    // nobody on: who takes the out at first on a ball the first baseman fields
    if (!bases.some(Boolean) && plan.fielder === '1B' && plan.result === 'groundout') { add('gb.1b.out'); const o = outEvents.find((e) => e.base === 1); if (o && o.pos === '1B') add('gb.1b.self'); if (o && o.pos === 'P') add('gb.1b.pitcher'); }
    // runner on first, fewer than two outs: double plays and who covers second
    if (bases[0] && outs < 2) {
      add('dp.chance');
      if (plan.result === 'doublePlay') add('dp');
      const at2 = outEvents.find((e) => e.base === 2);
      if (at2) {
        add('fo2');
        const right = plan.fielder === '1B' || plan.fielder === '2B' || (plan.fielder === 'P' && plan.pickupPos && plan.pickupPos.x > 0);
        if (right) { add('fo2.right'); if (at2.pos === 'SS') add('fo2.right.SS'); }
        else { add('fo2.left'); if (at2.pos === '2B') add('fo2.left.2B'); }
      }
    }
    // runner on third, fewer than two outs, infield back: does he score on the grounder?
    if (bases[2] && !bases[0] && outs < 2) { add('r3gb'); const m = plan.moves.find((q) => q.from === 3); if (m && m.to === 4 && !m.out) add('r3gb.scored'); if (m && m.out) add('r3gb.out'); }
    // runner on second, nobody on first: does he take third on a grounder to the right side?
    if (bases[1] && !bases[0] && !bases[2] && outs < 2 && plan.pickupPos && plan.pickupPos.x > 10) { add('r2gbR'); const m = plan.moves.find((q) => q.from === 2); if (m && m.to >= 3 && !m.out) add('r2gbR.adv'); }
    if (plan.result === 'single' || plan.result === 'error') add('gb.if.safe');
    // backups on an infield ground ball thrown to first: the right fielder and (nobody on) the catcher
    if (plan.result === 'groundout' && outEvents.some((e) => e.base === 1 && e.pos !== plan.fielder)) {
      add('thr1');
      const roles = (pos) => plan.fielderMoves.filter((m) => m.pos === pos).map((m) => m.role);
      if (roles('RF').includes('backup')) add('thr1.RF');
      if (!bases.some(Boolean) && roles('C').includes('backup')) add('thr1.C');
      if (!bases.some(Boolean)) add('thr1.empty');
    }
  }
  if (ground && !IF.has(plan.fielder)) add('gb.through');
  // --- fly balls and pop-ups caught
  if (plan.caught) {
    add('caught');
    const apexHigh = sim.apex.y >= 45 && Math.hypot(plan.catchPos.x, plan.catchPos.z) < 150;
    if (apexHigh) { add('pop'); add('pop.' + plan.fielder); }
    // sac flies by how deep it was caught (runner on third, fewer than two outs)
    if (bases[2] && outs < 2 && !IF.has(plan.fielder)) {
      const d = Math.hypot(plan.catchPos.x, plan.catchPos.z);
      const band = d < 250 ? 'short' : d < 300 ? 'medium' : 'deep';
      add('sf.' + band); const m = plan.moves.find((q) => q.from === 3); if (m && m.to === 4 && !m.out) add('sf.' + band + '.scored'); if (m && m.out) add('sf.' + band + '.out');
    }
  }
  // --- singles to the outfield: runner on second scores? runner on first to third?
  if (plan.result === 'single' && !IF.has(plan.fielder)) {
    if (bases[1]) { add('s.r2'); const m = plan.moves.find((q) => q.from === 2); if (m && m.to === 4 && !m.out) add('s.r2.scored'); if (m && m.out) add('s.r2.out'); }
    if (bases[0] && !bases[1]) { add('s.r1'); const m = plan.moves.find((q) => q.from === 1); if (m && m.to >= 3 && !m.out) add('s.r1.third'); }
  }
  if (plan.result === 'double' && bases[0]) { add('d.r1'); const m = plan.moves.find((q) => q.from === 1); if (m && m.to === 4 && !m.out) add('d.r1.scored'); }
  add('r.' + plan.result);
}

const t = tally;
console.log(`${t.balls} fair balls in play (${N} batted balls). Problems found by the referee: ${problems.length ? problems.join(' | ') : 'none'}`);
console.log('\nGROUND BALLS');
console.log(`  fielded by an infielder ${pct(t['gb.if'], t['gb.if'] + (t['gb.through'] || 0))}  (MLB: ~75% of grounders); infield hits+errors ${pct(t['gb.if.safe'], t['gb.if'])} of those (MLB ~8%)`);
console.log(`  double play with a runner on first, <2 outs: ${pct(t.dp, t['dp.chance'])}  (MLB ~45-50% of DP-situation grounders to infielders)`);
console.log(`  force at second - ball to the right side, the shortstop covers: ${pct(t['fo2.right.SS'], t['fo2.right'])}; to the left side, the second baseman covers: ${pct(t['fo2.left.2B'], t['fo2.left'])}  (real: ~100% each)`);
console.log(`  grounder to the first baseman, nobody on: he takes it himself ${pct(t['gb.1b.self'], t['gb.1b.out'])}, pitcher covering ${pct(t['gb.1b.pitcher'], t['gb.1b.out'])}  (MLB roughly 60 / 40)`);
console.log(`  runner on third, <2 outs, grounder: scores ${pct(t['r3gb.scored'], t.r3gb)}, out ${pct(t['r3gb.out'], t.r3gb)}  (MLB, infield back: scores ~55-65%)`);
console.log(`  runner on second (third open, <2 outs), grounder to the right side: takes third ${pct(t['r2gbR.adv'], t.r2gbR)}  (real: nearly always)`);
console.log(`  throws to first from an infielder: right fielder backing up ${pct(t['thr1.RF'], t.thr1)}; catcher running down the line (bases empty) ${pct(t['thr1.C'], t['thr1.empty'])}  (real: both, nearly always)`);
console.log('\nFLY BALLS');
const popBy = Object.keys(t).filter((k) => k.startsWith('pop.')).map((k) => `${k.slice(4)} ${pct(t[k], t.pop)}`).join(', ');
console.log(`  high pop-ups on the infield caught by: ${popBy}  (real: middle infielders and corners; the pitcher almost never; the catcher near the plate)`);
for (const b of ['short', 'medium', 'deep']) console.log(`  runner on third, <2 outs, ${b} fly caught: scores ${pct(t[`sf.${b}.scored`], t[`sf.${b}`])}, thrown out ${pct(t[`sf.${b}.out`], t[`sf.${b}`])}  (MLB: short ~25%, medium ~75%, deep ~98%)`);
console.log('\nHITS');
console.log(`  single to the outfield, runner on second scores ${pct(t['s.r2.scored'], t['s.r2'])} (out ${pct(t['s.r2.out'], t['s.r2'])})  (MLB ~60%)`);
console.log(`  single to the outfield, runner on first to third ${pct(t['s.r1.third'], t['s.r1'])}  (MLB ~28%)`);
console.log(`  double, runner on first scores ${pct(t['d.r1.scored'], t['d.r1'])}  (MLB ~40%)`);
const res = Object.keys(t).filter((k) => k.startsWith('r.')).sort((a, b) => t[b] - t[a]).map((k) => `${k.slice(2)} ${pct(t[k], t.balls)}`).join(', ');
console.log(`\nresults of balls in play: ${res}`);
