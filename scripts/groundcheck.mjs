// Ground balls to every fielder: is every out a real out? Plays thousands of grounders through the fielding planner and the
// referee (src/game/playAudit.js).
//   node scripts/groundcheck.mjs [plays=4000]
import { CONFIG } from '../src/config.js';
import { simulateBattedBall } from '../src/physics/ballistics.js';
import { createDefense, planPlay } from '../src/game/fielding.js';
import { auditPlan } from '../src/game/playAudit.js';
import { createRng } from '../src/util/rng.js';

export function groundballs(n = 4000, seed = 21) {
  const rng = createRng(seed);
  const defense = createDefense();
  const BASE_SETS = [[null, null, null], [1, null, null], [null, 1, null], [1, 1, null], [null, null, 1], [1, null, 1], [1, 1, 1]];
  const res = { plays: 0, outs: 0, hits: 0, problems: {}, byFielder: {}, byResult: {}, examples: [] };
  for (let i = 0; i < n; i++) {
    const c = { exitVelocity: rng.range(38, 100), launchAngle: rng.range(-12, 9), sprayAngle: rng.range(-44, 44), backspin: rng.range(500, 1500), hook: rng.range(-300, 300) };
    const sim = simulateBattedBall({ ...c, start: { x: 0, y: 2.6, z: -1 } });
    const bases = BASE_SETS[Math.floor(rng.next() * BASE_SETS.length)];
    const outs = Math.floor(rng.next() * 3);
    const plan = planPlay({ sim, contact: c, bases, outs, defense }, CONFIG);
    if (!plan.fair || plan.caught || plan.homer) continue;
    res.plays++;
    res.byResult[plan.result] = (res.byResult[plan.result] || 0) + 1;
    if (plan.outsMade) res.outs++; else res.hits++;
    const key = plan.fielder || '?';
    const rec = (res.byFielder[key] = res.byFielder[key] || { plays: 0, outs: 0 });
    rec.plays++; rec.outs += plan.outsMade ? 1 : 0;
    for (const p of auditPlan(plan, defense, CONFIG)) {
      const k = p.replace(/[\d.]+/g, '#');
      res.problems[k] = (res.problems[k] || 0) + 1;
      if (res.examples.length < 6) res.examples.push({ p, fielder: plan.fielder, result: plan.result, c });
    }
  }
  return res;
}

if (process.argv[1] && process.argv[1].endsWith('groundcheck.mjs')) {
  const r = groundballs(+(process.argv[2] || 4000));
  console.log(`${r.plays} ground balls: ${r.outs} with an out, ${r.hits} hits`);
  console.log('by result:', JSON.stringify(r.byResult));
  console.log('by fielder (plays / share that were outs):');
  for (const [k, v] of Object.entries(r.byFielder).sort()) console.log(`  ${k.padEnd(3)} ${String(v.plays).padStart(5)}  ${(100 * v.outs / v.plays).toFixed(0)}% outs`);
  const total = Object.values(r.problems).reduce((a, b) => a + b, 0);
  console.log(total ? `\n${total} PROBLEMS:` : '\nno problems: every out is a real out');
  for (const [k, v] of Object.entries(r.problems).sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(5)} x ${k}`);
  for (const e of r.examples.slice(0, 3)) console.log('  e.g.', e.fielder, e.result, JSON.stringify({ ev: +e.c.exitVelocity.toFixed(0), la: +e.c.launchAngle.toFixed(1), spray: +e.c.sprayAngle.toFixed(0) }), '->', e.p);
}
