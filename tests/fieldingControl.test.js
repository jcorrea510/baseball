// The planner takes the result from the live fielder (fielding.planPlay with `i.control`): the outfielder you steer (fieldControl.js)
// decides the catch / the pickup, and everything after it - outs, tag-ups, the runners, the throw - is the planner's own code.
import { describe, it, expect } from 'vitest';
import { CONFIG } from '../src/config.js';
import { simulateBattedBall } from '../src/physics/ballistics.js';
import { createDefense, planPlay, runnerPosition, pendingPickupTime, sampleBall } from '../src/game/fielding.js';
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
  // Captured from the planner before i.control existed (commit db865df): with no control the plan must not change at all.
  const GOLDEN = [
    { name: 'air catch', ball: [84, 32, 0], bases: [0, 0, 0], outs: 0, extra: {}, want: { result: 'flyout', outsMade: 1, catchT: 4.254167, pickupT: null, endTime: 5.154167, throws: 0, moves: [] } },
    { name: 'dropped fly', ball: [84, 32, 0], bases: [1, 0, 0], outs: 0, extra: { errorRoll: 0 }, want: { result: 'error', outsMade: 0, catchT: 4.254167, pickupT: 4.254167, endTime: 8.572692, throws: 1, moves: [[0, 1, false], [1, 2, false]] } },
    { name: 'grounder, runner on first', ball: [85, -5, -20], bases: [1, 0, 0], outs: 0, extra: {}, want: { result: 'fieldersChoice', outsMade: 1, catchT: null, pickupT: 1.566667, endTime: 4.94, throws: 1, moves: [[0, 1, false], [1, 0, true]] } },
    { name: 'grounder to the right side, two outs', ball: [78, -8, 25], bases: [0, 1, 0], outs: 2, extra: {}, want: { result: 'groundout', outsMade: 1, catchT: null, pickupT: 1.816667, endTime: 3.428566, throws: 1, moves: [[0, 0, true], [2, 2, false]] } },
    { name: 'wall ball, runners on first and second', ball: [104, 20, -30], bases: [1, 1, 0], outs: 1, extra: {}, want: { result: 'single', outsMade: 0, catchT: null, pickupT: 4.308333, endTime: 8.350793, throws: 2, moves: [[0, 1, false], [1, 2, false], [2, 3, false]] } },
    { name: 'gap hit, runner sent home', ball: [96, 24, 18], bases: [1, 1, 0], outs: 0, extra: { orders: [{ base: 4, t: 1.2 }] }, want: { result: 'single', outsMade: 0, catchT: null, pickupT: 5.466667, endTime: 10.658586, throws: 2, moves: [[0, 1, false], [1, 2, false], [2, 4, false]] } },
    { name: 'sac fly', ball: [88, 35, 10], bases: [0, 0, 1], outs: 1, extra: {}, want: { result: 'sacFly', outsMade: 1, catchT: 4.783333, pickupT: null, endTime: 8.540833, throws: 1, moves: [[3, 4, false]] } },
    { name: 'line drive single, runner going with the pitch', ball: [92, 14, 5], bases: [1, 0, 0], outs: 0, extra: { running: { 1: -0.6 } }, want: { result: 'single', outsMade: 0, catchT: null, pickupT: 2.7375, endTime: 5.781667, throws: 1, moves: [[0, 1, false], [1, 2, false]] } },
    { name: 'ground-rule double', ball: [78, 46, -44], bases: [1, 0, 1], outs: 0, extra: {}, want: { result: 'double', outsMade: 0, catchT: null, pickupT: null, endTime: 8.119167, throws: 0, moves: [[0, 2, false], [1, 3, false], [3, 4, false]] } },
    { name: 'bobbled grounder', ball: [70, -4, -10], bases: [0, 0, 0], outs: 0, extra: { errorRoll: 0 }, want: { result: 'error', outsMade: 0, catchT: null, pickupT: 1.65, endTime: 6.353871, throws: 1, moves: [[0, 1, false]] } },
  ];
  it('without control nothing changes: plans match the ones the planner made before i.control existed', () => {
    const r = (x) => (x === undefined ? null : +x.toFixed(6));
    for (const g of GOLDEN) {
      const { contact, sim } = ballOf(...g.ball);
      const plan = planPlay({ sim, contact, bases: g.bases.map((x) => (x ? {} : null)), outs: g.outs, defense: createDefense(), ...g.extra }, CONFIG);
      const got = { result: plan.result, outsMade: plan.outsMade, catchT: r(plan.catchT), pickupT: r(plan.pickupT), endTime: r(plan.endTime), throws: plan.throws.length,
        moves: plan.moves.map((m) => [m.from, m.to, !!m.out]).sort((p, q) => p[0] - q[0]) };
      expect({ name: g.name, ...got }).toEqual({ name: g.name, ...g.want });
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
    const T = pendingPickupTime(sim, defense.CF, CONFIG);
    expect(T).toBeGreaterThan(sim.duration + F.control.autoAfter);
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

  // The runners' paths of two plans up to time tEnd: the problems (none = the same).
  // (runnersOnly: leave the batter out - on a catch he is out and has no move; up to the catch he is drawn the same either way)
  function prefixProblems(a, b, tEnd, what, runnersOnly = false) {
    const problems = [];
    const mine = (p) => p.moves.filter((m) => !runnersOnly || m.from >= 1);
    const froms = (p) => mine(p).map((m) => m.from).sort().join(',');
    if (froms(a) !== froms(b)) return [`${what}: runners ${froms(a)} vs ${froms(b)}`];
    for (const m of mine(a)) {
      const q = b.moves.find((x) => x.from === m.from);
      for (let t = 0; t <= tEnd - 0.01; t += 0.02) {
        const p1 = runnerPosition(m, t), p2 = runnerPosition(q, t);
        if (Math.hypot(p1.x - p2.x, p1.z - p2.z) > 1e-6) { problems.push(`${what}: runner from ${m.from} at ${t.toFixed(2)} s (until ${tEnd.toFixed(2)}): ${p1.x.toFixed(2)},${p1.z.toFixed(2)} vs ${p2.x.toFixed(2)},${p2.z.toFixed(2)}`); break; }
      }
    }
    return problems;
  }
  const randomBases = (rng) => [rng.next() < 0.5 ? {} : null, rng.next() < 0.5 ? {} : null, rng.next() < 0.5 ? {} : null];
  const randomOrders = (rng, tMax) => {
    const o = [];
    if (rng.next() < 0.5) o.push({ base: 1 + Math.floor(rng.next() * 4), t: rng.range(0.2, tMax) });
    if (rng.next() < 0.25) o.push({ base: 1 + Math.floor(rng.next() * 4), t: rng.range(0.2, tMax), back: rng.next() < 0.4 });
    return o.sort((p, q) => p.t - q.t);
  };

  it('(d) the runners\' paths before the pickup are the same in the pending plan and the pickup plan (80 balls, any bases, orders)', () => {
    const rng = createRng(31);
    const defense = createDefense();
    const problems = [];
    let n = 0, forcedPair = 0;
    while (n < 80) {
      const { contact, sim } = ballOf(rng.range(60, 108), rng.range(-5, 45), rng.range(-44, 44));
      const bases = n < 10 ? [{}, {}, null] : randomBases(rng), outs = Math.floor(rng.next() * 3);
      const old = planPlay({ sim, contact, bases, outs, defense }, CONFIG);
      if (!old.fair || old.homer || old.groundRule || !OF.includes(old.fielder)) continue;
      const pos = old.fielder;
      const fc = new FieldControl({ sim, defense, pos, cfg: CONFIG, level: 'pro' });
      const early = rng.next() < 0.5; // (half run after it from contact, half leave him and let the safety net take over)
      drive(fc, sim.duration + F.control.autoAfter + 40, (k, t) => { if (early || k.auto) k.autoSteer(t); });
      if (!fc.outcome || fc.outcome.kind !== 'pickup') continue;
      n++;
      const tP = fc.outcome.t;
      const i = { sim, contact, bases, outs, defense, orders: randomOrders(rng, tP) };
      const pending = planPlay({ ...i, control: { pos, runs: new FieldControl({ sim, defense, pos, cfg: CONFIG, level: 'pro' }).runs, outcome: { kind: 'pending' } } }, CONFIG);
      const plan = planPlay({ ...i, control: { pos, runs: fc.runs, outcome: fc.outcome }, prev: { paths: pending.paths, t: tP } }, CONFIG);
      expect(pending.pending).toBe(true);
      expect(plan.pending).toBeFalsy();
      expect(plan.pickupT).toBe(tP);
      expect(pending.pickupT).toBeGreaterThan(tP);
      problems.push(...prefixProblems(pending, plan, tP, `ball ${n}`));
      problems.push(...auditPlan(plan, defense));
      if (bases[0] && bases[1] && !i.orders.length) { forcedPair++; expect(plan.moves.find((m) => m.from === 1).to).toBe(2); expect(plan.moves.find((m) => m.from === 2).to).toBe(3); }
    }
    expect(forcedPair).toBeGreaterThan(0);
    expect(problems).toEqual([]);
  });

  it('pending then catch: the runners\' paths before the catch are the same in both plans (60 balls, tag-ups, two outs, orders)', () => {
    const rng = createRng(77);
    const defense = createDefense();
    const BASES = [[{}, null, null], [{}, {}, null], [null, {}, {}], [null, null, {}], [{}, {}, {}], [null, {}, null]];
    const problems = [];
    let n = 0, tagUps = 0, thirdOuts = 0;
    while (n < 60) {
      const { contact, sim } = ballOf(rng.range(70, 106), rng.range(12, 50), rng.range(-44, 44));
      const bases = BASES[n % BASES.length], outs = n % 3;
      const old = planPlay({ sim, contact, bases, outs, defense }, CONFIG);
      if (!old.fair || old.homer || !old.caught || !OF.includes(old.fielder)) continue;
      const pos = old.fielder;
      const fc = new FieldControl({ sim, defense, pos, cfg: CONFIG, level: 'pro' });
      drive(fc, sim.duration + 1, (k, t) => k.autoSteer(t));
      if (!fc.outcome || fc.outcome.kind !== 'catch') continue;
      n++;
      const tC = fc.outcome.t;
      const i = { sim, contact, bases, outs, defense, orders: n % 2 ? randomOrders(rng, tC - 0.05) : [] };
      const pending = planPlay({ ...i, control: { pos, runs: fc.runs, outcome: null } }, CONFIG);
      const plan = planPlay({ ...i, control: { pos, runs: fc.runs, outcome: fc.outcome }, prev: { paths: pending.paths, t: tC } }, CONFIG);
      expect(plan.caught).toBe(true);
      if (plan.moves.some((m) => m.tag)) tagUps++;
      if (outs === 2) thirdOuts++;
      problems.push(...prefixProblems(pending, plan, tC, `catch ${n}`, true));
      problems.push(...auditPlan(plan, defense));
    }
    console.log(`pending -> catch: ${n} balls, ${tagUps} with a tag-up, ${thirdOuts} third outs`);
    expect(tagUps).toBeGreaterThan(0);
    expect(problems).toEqual([]);
  });

  it('the pending pickup is later than any real one: a fielder steered away from the ball until the safety net, then the auto-pilot', () => {
    const rng = createRng(5);
    const defense = createDefense();
    let n = 0, smallest = Infinity;
    while (n < 16) {
      const { contact, sim } = ballOf(rng.range(70, 104), rng.range(10, 40), rng.range(-40, 40));
      const old = planPlay({ sim, contact, bases: [null, null, null], outs: 0, defense }, CONFIG);
      if (!old.fair || old.homer || old.groundRule || old.caught || !OF.includes(old.fielder)) continue;
      const rest = sampleBall(sim, sim.duration);
      const pos = rest.x < 0 ? 'RF' : 'LF'; // (the outfielder on the far side, sent the wrong way)
      const fc = new FieldControl({ sim, defense, pos, cfg: CONFIG, level: 'pro' });
      const pending = planPlay({ sim, contact, bases: [null, null, null], outs: 0, defense, control: { pos, runs: fc.runs, outcome: null } }, CONFIG);
      drive(fc, 200, (k, t) => { if (k.auto) k.autoSteer(t); else k.setInput(k.state.x - rest.x, k.state.z - rest.z); });
      expect(fc.outcome.kind).toBe('pickup');
      n++;
      smallest = Math.min(smallest, pending.pickupT - fc.outcome.t);
      expect(fc.outcome.t).toBeLessThan(pending.pickupT);
    }
    console.log(`steered away: the pending pickup is at least ${smallest.toFixed(2)} s after the real one`);
  });

  it('no outcome yet, pending, or down (still after it): a pending plan, never a final one', () => {
    const { contact, sim } = gapBall();
    const defense = createDefense();
    const fc = new FieldControl({ sim, defense, pos: 'CF', cfg: CONFIG, level: 'pro' });
    for (const outcome of [null, undefined, { kind: 'pending' }, { kind: 'down', t: sim.firstBounce.t }]) {
      const plan = planPlay({ sim, contact, bases: [{}, null, null], outs: 0, defense, control: { pos: 'CF', runs: fc.runs, outcome } }, CONFIG);
      expect(plan.pending).toBe(true);
      expect(plan.caught).toBeFalsy();
      expect(plan.pickupT).toBeCloseTo(pendingPickupTime(sim, defense.CF, CONFIG), 9);
    }
  });

  it('a ground-rule ball you steer for: pending until it comes down, then the ground-rule double with the same runners before it', () => {
    const { contact, sim } = ballOf(78, 46, -44); // (comes down in the left-field corner and kicks up over the wall)
    expect(sim.groundRule).toBeTruthy();
    const defense = createDefense();
    const fc = new FieldControl({ sim, defense, pos: 'LF', cfg: CONFIG, level: 'pro' });
    for (let t = F.control.step; !fc.outcome; t += F.control.step) fc.advance(t); // (left alone until it comes down)
    expect(fc.outcome.kind).toBe('down');
    for (const [bases, orders] of [[[{}, null, {}], []], [[{}, {}, null], [{ base: 4, t: 1 }]], [[null, {}, null], [{ base: 3, t: 2 }]]]) {
      const i = { sim, contact, bases, outs: 0, defense, orders };
      const pending = planPlay({ ...i, control: { pos: 'LF', runs: fc.runs, outcome: null } }, CONFIG);
      expect(pending.pending).toBe(true);
      expect(pending.groundRule).toBeFalsy();
      const plan = planPlay({ ...i, control: { pos: 'LF', runs: fc.runs, outcome: fc.outcome }, prev: { paths: pending.paths, t: fc.outcome.t } }, CONFIG);
      expect(plan.pending).toBeFalsy();
      expect(plan.groundRule).toBe(true);
      expect(plan.result).toBe('double');
      for (const m of plan.moves) expect(m.to).toBe(m.from === 0 ? 2 : Math.min(4, m.from + 2));
      expect(prefixProblems(pending, plan, fc.outcome.t, 'ground rule')).toEqual([]);
    }
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
