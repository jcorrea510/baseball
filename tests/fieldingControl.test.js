// The planner takes the result from the live fielder (fielding.planPlay with `i.control`): the outfielder you steer (fieldControl.js)
// decides the catch / the pickup, and everything after it - outs, tag-ups, the runners, the throw - is the planner's own code.
import { describe, it, expect } from 'vitest';
import { CONFIG } from '../src/config.js';
import { simulateBattedBall } from '../src/physics/ballistics.js';
import { createDefense, planPlay, runnerPosition } from '../src/game/fielding.js';
import { makeTrackRun, samplePath } from '../src/game/fielderMotion.js';
import { FieldControl } from '../src/game/fieldControl.js';
import { auditPlan } from '../src/game/playAudit.js';
import { createRng } from '../src/util/rng.js';

const F = CONFIG.fielding;
const START = { x: 0, y: 2.6, z: -1 };
const OF = ['LF', 'CF', 'RF'];
const HITS = ['single', 'double', 'triple', 'insideParkHomer'];
const contactOf = (ev, la, spray) => ({ exitVelocity: ev, launchAngle: la, sprayAngle: spray, backspin: 900 + 55 * Math.max(la, 0), hook: 0 });
const ballOf = (ev, la, spray) => { const contact = contactOf(ev, la, spray); return { contact, sim: simulateBattedBall({ ...contact, start: START }) }; };

// drive a FieldControl in its own sub-steps to the end (or tEnd), calling each(fc, t) before every sub-step
function drive(fc, tEnd, each = () => {}) {
  const step = F.control.step;
  for (let n = 1; n * step <= tEnd + 1e-9 && !fc.finished; n++) {
    each(fc, (n - 1) * step);
    fc.advance(n * step);
  }
}
// a fly ball the CF goes after that comes down well away from him: standing still he cannot catch it
function gapBall() {
  const b = ballOf(96, 24, 18);
  return b;
}
// the runner moves of a plan, as plain outcomes
const outcomes = (plan) => plan.moves.map((m) => ({ from: m.from, to: m.to, out: !!m.out, outBase: m.outBase, outAt: m.outAt === undefined ? undefined : +m.outAt.toFixed(6), stopAt: m.stopAt === undefined ? undefined : +m.stopAt.toFixed(6) }))
  .sort((a, b) => a.from - b.from);

// The planner's own catch made into a live fielder's runs: his planned path sampled into a track up to the catch (a dive: up to the
// launch, then the planner's own dive run).
function runsFromPlan(plan, pos) {
  const runs = plan.paths[pos];
  const mv = plan.fielderMoves.find((m) => m.pos === pos);
  const tEnd = mv.dive ? mv.run.dive.tL : plan.catchT;
  const samples = [];
  for (let k = 0; ; k++) {
    const t = Math.min(tEnd, k / 60);
    const q = samplePath(runs, t);
    samples.push([t, q.x, q.z, q.ux * q.speed, q.uz * q.speed]);
    if (t >= tEnd) break;
  }
  const out = [makeTrackRun(samples)];
  if (mv.dive) out.push(mv.run);
  return out;
}

describe('planPlay with a live fielder (i.control)', { timeout: 120000 }, () => {
  it('without control nothing changes (the plan is deep-equal to one planned with control: undefined)', () => {
    const rng = createRng(7);
    const defense = createDefense();
    for (let k = 0; k < 25; k++) {
      const { contact, sim } = ballOf(rng.range(60, 108), rng.range(-10, 50), rng.range(-44, 44));
      const bases = [rng.next() < 0.5 ? {} : null, rng.next() < 0.5 ? {} : null, rng.next() < 0.5 ? {} : null];
      const i = { sim, contact, bases, outs: k % 3, defense, errorRoll: rng.next(), orders: [{ base: 3, t: 0.8 }] };
      expect(planPlay({ ...i, control: undefined }, CONFIG)).toEqual(planPlay(i, CONFIG));
    }
  });

  it('(a) pending (planned at contact): no catch searched, a hit picked up by the controlled fielder at the resting spot much later', () => {
    const { contact, sim } = ballOf(84, 32, 0);
    const defense = createDefense();
    const fc = new FieldControl({ sim, defense, pos: 'CF', cfg: CONFIG, level: 'pro' });
    const runs = fc.runs;
    const plan = planPlay({ sim, contact, bases: [null, null, null], outs: 0, defense, control: { pos: 'CF', runs, outcome: { kind: 'pending' } } }, CONFIG);
    expect(plan.pending).toBe(true);
    expect(plan.caught).toBeFalsy();
    expect(plan.fielder).toBe('CF');
    expect(plan.paths.CF.length).toBe(runs.length);
    plan.paths.CF.forEach((r, k) => expect(r).toBe(runs[k]));
    expect(plan.outsMade).toBe(0);
    const T = sim.duration + F.control.autoAfter + 4;
    expect(plan.pickupT).toBeCloseTo(T, 9);
    expect(plan.endTime).toBeCloseTo(T + 1, 9);
    expect(HITS).toContain(plan.result);
    // the controlled move carries his runs (no searched route) and the old automatic plan would have caught it
    expect(plan.fielderMoves[0].pos).toBe('CF');
    const old = planPlay({ sim, contact, bases: [null, null, null], outs: 0, defense }, CONFIG);
    expect(old.caught).toBe(true);
    // the ball was in the air: runners read it when it comes down (the same as on a drop)
    expect(plan.airRes).toBeCloseTo(sim.firstBounce.t, 9);
  });

  it('(b-i) a catch given at the planner\'s own time and spot: the same result, outs and runner outcomes as the automatic plan (100 balls)', () => {
    const rng = createRng(20261005);
    const defense = createDefense();
    const BASES = [[null, null, null], [{}, null, null], [null, {}, null], [null, null, {}], [{}, {}, null], [{}, null, {}], [{}, {}, {}]];
    let n = 0, dives = 0, tagUps = 0;
    const bad = [];
    while (n < 100) {
      const { contact, sim } = ballOf(rng.range(70, 106), rng.range(12, 50), rng.range(-44, 44));
      const bases = BASES[n % BASES.length], outs = n % 3;
      const i = { sim, contact, bases, outs, defense };
      const old = planPlay(i, CONFIG);
      if (!old.fair || old.homer || !old.caught || !OF.includes(old.fielder)) continue;
      n++;
      const mv = old.fielderMoves.find((m) => m.pos === old.fielder);
      if (mv.dive) dives++;
      const runs = runsFromPlan(old, old.fielder);
      const outcome = { kind: 'catch', t: old.catchT, dive: !!mv.dive, ball: { ...old.catchPos } };
      const got = planPlay({ ...i, control: { pos: old.fielder, runs, outcome } }, CONFIG);
      if (old.moves.some((m) => m.tag)) tagUps++;
      const same = got.result === old.result && got.outsMade === old.outsMade && got.caught === old.caught && Math.abs(got.catchT - old.catchT) < 1e-6 &&
        got.fielder === old.fielder && JSON.stringify(outcomes(got)) === JSON.stringify(outcomes(old));
      if (!same) bad.push({ contact, bases, outs, old: [old.result, old.outsMade, outcomes(old)], got: [got.result, got.outsMade, outcomes(got)] });
      expect(got.paths[old.fielder][0]).toBe(runs[0]);
      expect(auditPlan(got, defense)).toEqual([]);
    }
    if (bad.length) console.log('catch parity differences', JSON.stringify(bad.slice(0, 4)));
    console.log(`catch parity: ${100 - bad.length} / 100 (planner dives ${dives}, tag-ups ${tagUps})`);
    expect(bad).toEqual([]);
  });

  it('(b-ii) the auto-pilot, driven every sub-step, makes the planner\'s out on >= 95% of the balls the planner catches', () => {
    const rng = createRng(4242);
    const defense = createDefense();
    let n = 0, ok = 0;
    while (n < 100) {
      const { contact, sim } = ballOf(rng.range(70, 106), rng.range(12, 50), rng.range(-44, 44));
      const i = { sim, contact, bases: [{}, null, null], outs: n % 2, defense };
      const old = planPlay(i, CONFIG);
      if (!old.fair || old.homer || !old.caught || !OF.includes(old.fielder)) continue;
      n++;
      const fc = new FieldControl({ sim, defense, pos: old.fielder, cfg: CONFIG, level: 'pro' });
      drive(fc, sim.duration + F.control.autoAfter + 12, (k, t) => k.autoSteer(t));
      if (!fc.outcome || fc.outcome.kind !== 'catch') continue;
      const got = planPlay({ ...i, control: { pos: old.fielder, runs: fc.runs, outcome: fc.outcome } }, CONFIG);
      if (got.caught && got.outsMade === old.outsMade && got.result === old.result && Math.abs(got.catchT - old.catchT) <= 0.15) ok++;
    }
    console.log(`auto-pilot out parity: ${ok} / ${n}`);
    expect(ok).toBeGreaterThanOrEqual(95);
  });

  it('(c) a fielder who stands still: the ball drops, the safety net picks it up, a hit by the usual rules and the referee is happy', () => {
    const { contact, sim } = gapBall();
    const defense = createDefense();
    const old = planPlay({ sim, contact, bases: [null, null, null], outs: 0, defense }, CONFIG);
    expect(OF).toContain(old.fielder);
    const pos = old.fielder;
    const fc = new FieldControl({ sim, defense, pos, cfg: CONFIG, level: 'pro' });
    const i = { sim, contact, bases: [null, null, null], outs: 0, defense };
    const pending = planPlay({ ...i, control: { pos, runs: fc.runs, outcome: { kind: 'pending' } } }, CONFIG);
    drive(fc, sim.duration + F.control.autoAfter + 20, (k, t) => { if (k.auto) k.autoSteer(t); });
    expect(fc.outcome.kind).toBe('pickup');
    const plan = planPlay({ ...i, control: { pos, runs: fc.runs, outcome: fc.outcome }, prev: { paths: pending.paths, t: fc.outcome.t } }, CONFIG);
    expect(plan.pending).toBeFalsy();
    expect(plan.caught).toBeFalsy();
    expect(HITS).toContain(plan.result);
    expect(plan.outsMade).toBe(0);
    expect(plan.pickupT).toBeCloseTo(fc.outcome.t, 9);
    expect(plan.fielder).toBe(pos);
    expect(auditPlan(plan, defense)).toEqual([]);
    // the throw comes from where he picked it up, after he has it
    const th = plan.throws.find((q) => q.from === pos);
    expect(th).toBeTruthy();
    expect(th.t0).toBeGreaterThanOrEqual(fc.outcome.t);
    expect(Math.hypot(th.ax - fc.outcome.x, th.az - fc.outcome.z)).toBeLessThan(1e-6);
  });

  // pending at contact, then the pickup at the real time with the pending plan as prev: every runner is where he was before the pickup
  function prefixCheck(bases, outs, orders = []) {
    const { contact, sim } = gapBall();
    const defense = createDefense();
    const old = planPlay({ sim, contact, bases, outs, defense }, CONFIG);
    const pos = old.fielder;
    const fc = new FieldControl({ sim, defense, pos, cfg: CONFIG, level: 'pro' });
    const i = { sim, contact, bases, outs, defense, orders };
    const pending = planPlay({ ...i, control: { pos, runs: fc.runs, outcome: { kind: 'pending' } } }, CONFIG);
    drive(fc, sim.duration + F.control.autoAfter + 20, (k, t) => { if (k.auto) k.autoSteer(t); });
    const tP = fc.outcome.t;
    const plan = planPlay({ ...i, control: { pos, runs: fc.runs, outcome: fc.outcome }, prev: { paths: pending.paths, t: tP } }, CONFIG);
    expect(pending.pending).toBe(true);
    expect(plan.pickupT).toBe(tP);
    expect(pending.pickupT).toBeGreaterThan(tP);
    const problems = [];
    expect(pending.moves.map((m) => m.from).sort()).toEqual(plan.moves.map((m) => m.from).sort());
    for (const a of pending.moves) {
      const b = plan.moves.find((m) => m.from === a.from);
      for (let t = 0; t <= tP - 0.01; t += 0.05) {
        const p = runnerPosition(a, t), q = runnerPosition(b, t);
        if (Math.hypot(p.x - q.x, p.z - q.z) > 1e-6) { problems.push(`runner from ${a.from} at ${t.toFixed(2)} s: ${p.x.toFixed(2)},${p.z.toFixed(2)} vs ${q.x.toFixed(2)},${q.z.toFixed(2)}`); break; }
      }
    }
    expect(problems).toEqual([]);
    expect(auditPlan(plan, defense)).toEqual([]);
    return { pending, plan };
  }
  it('(d) the runners\' paths before the pickup are the same in the pending plan and the pickup plan (runners on first and second)', () => {
    const { plan } = prefixCheck([{}, {}, null], 0);
    expect(plan.moves.find((m) => m.from === 1).to).toBe(2);
    expect(plan.moves.find((m) => m.from === 2).to).toBe(3);
    prefixCheck([{}, {}, null], 2);
    prefixCheck([null, {}, null], 1); // (an unforced runner holds)
    prefixCheck([{}, {}, null], 1, [{ base: 4, t: 2.5 }]); // (you sent the man on second home while the ball was in the air)
  });

  it('(e) two outs, a runner on third, a controlled catch: the inning is over and no run scores', () => {
    const { contact, sim } = ballOf(84, 32, 0);
    const defense = createDefense();
    const i = { sim, contact, bases: [null, null, {}], outs: 2, defense };
    const old = planPlay(i, CONFIG);
    expect(old.caught).toBe(true);
    // (the auto-pilot's catch: a moment that is his, not the planner's)
    const fc = new FieldControl({ sim, defense, pos: old.fielder, cfg: CONFIG, level: 'pro' });
    drive(fc, sim.duration + 1, (k, t) => k.autoSteer(t));
    expect(fc.outcome.kind).toBe('catch');
    const tC = fc.outcome.t;
    expect(Math.abs(tC - old.catchT)).toBeGreaterThan(1e-6);
    const plan = planPlay({ ...i, control: { pos: old.fielder, runs: fc.runs, outcome: fc.outcome } }, CONFIG);
    expect(plan.caught).toBe(true);
    expect(plan.catchT).toBe(tC);
    expect(plan.outsMade).toBe(1);
    expect(plan.moves.some((m) => m.to === 4 && !m.out)).toBe(false);
    const r3 = plan.moves.find((m) => m.from === 3);
    expect(r3.to).toBe(3);
    expect(r3.stopAt).toBeCloseTo(tC + CONFIG.runner.easeUpReact, 9);
    expect(plan.send.closeAt).toBeCloseTo(tC, 9);
    expect(auditPlan(plan, defense)).toEqual([]);
  });

  it('a dive: the controlled move carries the dive (for the picture) and the dive / landing events', () => {
    const rng = createRng(99);
    const defense = createDefense();
    for (let k = 0; k < 4000; k++) {
      const { contact, sim } = ballOf(rng.range(70, 106), rng.range(8, 40), rng.range(-44, 44));
      const i = { sim, contact, bases: [null, null, null], outs: 0, defense };
      const old = planPlay(i, CONFIG);
      if (!old.caught || !OF.includes(old.fielder) || !old.fielderMoves[0].dive) continue;
      const runs = runsFromPlan(old, old.fielder);
      const plan = planPlay({ ...i, control: { pos: old.fielder, runs, outcome: { kind: 'catch', t: old.catchT, dive: true, ball: { ...old.catchPos } } } }, CONFIG);
      const mv = plan.fielderMoves[0];
      expect(mv.pos).toBe(old.fielder);
      expect(mv.dive).toBe(true);
      expect(mv.run).toBe(runs[1]);
      expect(plan.events.find((e) => e.type === 'dive' && e.pos === old.fielder).t).toBeCloseTo(runs[1].dive.tL, 9);
      expect(plan.events.some((e) => e.type === 'diveLand' && e.pos === old.fielder)).toBe(true);
      expect(plan.events.find((e) => e.type === 'catch').dive).toBe(true);
      return;
    }
    throw new Error('no diving catch found');
  });
});
