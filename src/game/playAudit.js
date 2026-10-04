// A referee for a fielding plan: is every out a real out? (Pure logic, used by tests and by scripts/groundcheck.mjs.)
//
// The rules it enforces - an out at a base only counts when:
//   1. a fielder is standing on that base (his planned path really takes him there) when the out is made - or, for a tag up the
//      line (a rundown: `between`), he is right there next to the runner when the tag goes on,
//   2. he has the ball: he carried it there himself, or a throw ended in his glove at that moment - and the thrower had the ball,
//   3. the throw was aimed at the base (not at wherever a teammate happened to be standing),
//   4. and it all happens before the runner gets there.
import { CONFIG } from '../config.js';
import { BASE_XZ } from '../physics/field.js';
import { samplePath } from './fielderMotion.js';
import { runnerArrival, retreatArrival, moveArrival, runnerState } from './runnerMotion.js';

const dist = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);
const BAG_TOL = 2.6; // ft: "on the bag" (his foot is on it; the glove stretches a little further)
const HOME_TOL = 4.6; // the catcher squats a few feet behind the plate, so at home the tolerance is wider

/** Where is this fielder at time t of the plan? */
export function fielderAt(plan, defense, pos, t) {
  const runs = plan.paths && plan.paths[pos];
  if (runs && runs.length) { const q = samplePath(runs, t); return { x: q.x, z: q.z }; }
  return { x: defense[pos].x, z: defense[pos].z };
}

/**
 * @returns {string[]} problems (empty = every out is legitimate and every throw goes to a base that is covered)
 */
export function auditPlan(plan, defense, cfg = CONFIG) {
  const problems = [];
  if (!plan || plan.homer) return problems;
  const F = cfg.fielding;
  const tol = (base) => (base === 4 || base === 0 ? HOME_TOL : BAG_TOL);
  const baseXZ = (base) => BASE_XZ[base === 0 ? 4 : base];

  // every throw at a base is aimed at that base, and somebody is there to take it
  for (const th of plan.throws) {
    if (!(th.toBase >= 1 && th.toBase <= 4)) continue;
    const [bx, bz] = baseXZ(th.toBase);
    if (dist(th.bx, th.bz, bx, bz) > 1.5) problems.push(`throw ${th.from}->${th.to} at base ${th.toBase} is aimed ${dist(th.bx, th.bz, bx, bz).toFixed(1)} ft from the bag`);
    const at = fielderAt(plan, defense, th.to, th.t1);
    if (dist(at.x, at.z, bx, bz) > tol(th.toBase)) problems.push(`throw ${th.from}->${th.to} at base ${th.toBase}: ${th.to} is ${dist(at.x, at.z, bx, bz).toFixed(1)} ft from the bag when it arrives`);
  }

  const outs = plan.events.filter((e) => e.type === 'out' && e.base >= 1 && e.base <= 4);
  for (const e of outs) {
    const [bx, bz] = baseXZ(e.base);
    // 1. a fielder on the bag (or, tagging up the line, where the tag goes on - and the runner next to him)
    const at = fielderAt(plan, defense, e.pos, e.t);
    if (e.between) {
      if (dist(at.x, at.z, e.x, e.z) > BAG_TOL) problems.push(`tag up the line toward base ${e.base}: ${e.pos} is ${dist(at.x, at.z, e.x, e.z).toFixed(1)} ft from the tag`);
      const mv = plan.moves.find((m) => m.out && m.outBase === e.base && Math.abs((m.outAt ?? -1) - e.t) < 0.06);
      if (mv) { const q = runnerState({ ...mv, walkOff: false }, e.t, cfg, {}); const d = dist(q.x, q.z, at.x, at.z); if (d > cfg.runner.walkUp.reach + 1.5) problems.push(`tag up the line toward base ${e.base}: the runner is ${d.toFixed(1)} ft from ${e.pos}`); }
    } else if (dist(at.x, at.z, bx, bz) > tol(e.base)) problems.push(`out at base ${e.base}: ${e.pos} is ${dist(at.x, at.z, bx, bz).toFixed(1)} ft from the bag`);
    // 2. holding the ball
    // (the throw that got him there: it may have arrived a moment before the tag - he waits for the runner with the ball)
    const th = plan.throws.filter((q) => q.to === e.pos && q.toBase === e.base && q.t1 <= e.t + 0.06).sort((a, b) => b.t1 - a.t1)[0];
    if (th) {
      if (th.t0 > th.t1) problems.push(`out at base ${e.base}: the throw arrives before it is thrown`);
      const gaveBall = th.from === plan.fielder || plan.throws.some((q) => q.to === th.from && q.t1 <= th.t0 + 1e-6);
      if (!gaveBall) problems.push(`out at base ${e.base}: ${th.from} throws a ball he never had`);
    } else if (e.pos !== plan.fielder) problems.push(`out at base ${e.base}: ${e.pos} has no ball (no throw reaches him)`);
    else if (e.t < plan.pickupT - 1e-6) problems.push(`out at base ${e.base}: ${e.pos} touches the bag before he has fielded the ball`);
    // 4. before the runner
    const mv = plan.moves.find((m) => m.out && m.outBase === e.base && Math.abs((m.outAt ?? -1) - e.t) < 0.06);
    if (!mv) problems.push(`out at base ${e.base} has no runner who is out`);
    else {
      const from = mv.from;
      // (a runner doubled off is going back to the base he left)
      const arrive = mv.back ? retreatArrival(cfg, from, mv.tStart, mv.backAt, mv.spd || 1) : mv.legs || mv.round ? moveArrival(cfg, mv, e.base) : runnerArrival(cfg, from, e.base, mv.tStart, 'run', mv.spd || 1);
      if (arrive === undefined) problems.push(`out at base ${e.base}: the runner's run never takes him there`);
      else if (!(e.t + F.outMargin * 0.5 <= arrive)) problems.push(`out at base ${e.base}: the runner arrives at ${arrive.toFixed(2)} s, the out is made at ${e.t.toFixed(2)} s`);
    }
  }
  const outMoves = plan.moves.filter((m) => m.out).length;
  const byCatch = plan.caught || (plan.infieldFly && plan.dropped) ? 1 : 0; // (the batter caught out - or out on a dropped infield fly - is not a runner)
  if (outMoves + byCatch !== plan.outsMade) problems.push(`${outMoves} runners are out but outsMade is ${plan.outsMade}`);
  return problems;
}
