// The computer's base running: the send judgement the test bot uses (shared), and when a runner steals.
import { describe, it, expect } from 'vitest';
import { CONFIG } from '../src/config.js';
import { simulateBattedBall } from '../src/physics/ballistics.js';
import { createDefense, planPlay, tapOptions } from '../src/game/fielding.js';
import { chooseSend, stealDecision } from '../src/game/cpuRunner.js';
import { createRng } from '../src/util/rng.js';

const NEVER = { chance: () => false };
const ALWAYS = { chance: () => true };

// A real ball in play with the given runners, planned the way the engine does it.
const play = (c, bases) => {
  const sim = simulateBattedBall({ ...c, start: { x: 0, y: 2.6, z: -1 } });
  const planIn = { sim, contact: c, bases, outs: 0, defense: createDefense(), orders: [] };
  const plan = planPlay(planIn, CONFIG);
  const S = plan.send;
  const t = S ? (S.res !== undefined ? S.res : S.from) + 0.05 : 0;
  return { planIn, plan, t, targets: S ? tapOptions(plan, t) : [] };
};
const verdict = (planIn, t, tg) => {
  const hyp = planPlay({ ...planIn, orders: [...planIn.orders, { base: tg.base, t, from: tg.from }] }, CONFIG);
  const goes = hyp.moves.some((m) => m.from === tg.from && m.sent && !m.out && m.to === tg.base);
  return { goes, sentOut: !!hyp.sentOut };
};

describe('chooseSend', () => {
  it('sends a runner who makes it, never one who is doomed (unless it gambles), and a gamble sends the doomed one', () => {
    const rng = createRng(11);
    let safe = 0, doomed = 0;
    for (let k = 0; k < 400 && (safe < 5 || doomed < 5); k++) {
      const c = { exitVelocity: rng.range(70, 105), launchAngle: rng.range(5, 28), sprayAngle: rng.range(-40, 40), backspin: 900, hook: 0 };
      const p = play(c, [1, rng.chance(0.4) ? 2 : null, null]);
      if (!p.targets.length) continue;
      // what the rule should say, from the same hypothetical re-plans, lead runner first
      const order = [...p.targets].reverse();
      let expectNever = null, expectAlways = null;
      for (const tg of order) {
        const v = verdict(p.planIn, p.t, tg);
        if (v.goes && !v.sentOut) { expectNever = tg.base; expectAlways = tg.base; break; }
        if (v.sentOut) { expectAlways = tg.base; break; }
      }
      const a = chooseSend({ planIn: p.planIn, t: p.t, targets: p.targets, rng: NEVER, gamble: 0.015 }, CONFIG);
      const b = chooseSend({ planIn: p.planIn, t: p.t, targets: p.targets, rng: ALWAYS, gamble: 0.015 }, CONFIG);
      expect(a).toBe(expectNever);
      expect(b).toBe(expectAlways);
      if (expectNever !== null) safe++;
      if (expectNever === null && expectAlways !== null) { doomed++; expect(a).toBeNull(); }
    }
    expect(safe).toBeGreaterThan(0);
    expect(doomed).toBeGreaterThan(0);
  }, 120000);

  it('does not change the targets it is given and returns null with none', () => {
    const p = play({ exitVelocity: 90, launchAngle: 14, sprayAngle: 0, backspin: 900, hook: 0 }, [1, 2, null]);
    const copy = p.targets.map((x) => ({ ...x }));
    chooseSend({ planIn: p.planIn, t: p.t, targets: p.targets, rng: NEVER }, CONFIG);
    expect(p.targets).toEqual(copy);
    expect(chooseSend({ planIn: p.planIn, t: p.t, targets: [], rng: ALWAYS }, CONFIG)).toBeNull();
  });
});

describe('stealDecision', () => {
  const fair = { 1: 1, 2: 1, 3: 1 };
  const go = (o, rng) => stealDecision({ bases: [1, null, null], count: { balls: 0, strikes: 0 }, outs: 0, speeds: fair, rng, ...o }, CONFIG);
  const rate = (o, n = 5000, seed = 3) => { const rng = createRng(seed); let k = 0; for (let i = 0; i < n; i++) if (go(o, rng)) k++; return k / n; };

  it('never with nobody on, nobody who can go, or two outs and two strikes', () => {
    expect(rate({ bases: [null, null, null] })).toBe(0);
    expect(rate({ bases: [null, null, 3] })).toBe(0); // (nobody steals home)
    expect(rate({ bases: [1, 2, 3] })).toBe(0); // (every base ahead is taken)
    expect(rate({ bases: [null, 2, 3] })).toBe(0);
    expect(rate({ outs: 2, count: { balls: 1, strikes: 2 } })).toBe(0);
    expect(rate({ outs: 3 })).toBe(0);
    expect(rate({})).toBeGreaterThan(0);
  });

  it('a runner on first can go when the man on second goes too; a runner on second needs third empty', () => {
    expect(rate({ bases: [1, 2, null] })).toBeGreaterThan(0);
    expect(rate({ bases: [null, 2, null] })).toBeGreaterThan(0);
  });

  it('a fast runner goes much more often than a slow one', () => {
    const fast = rate({ speeds: { 1: 1.08, 2: 1, 3: 1 } });
    const slow = rate({ speeds: { 1: 0.92, 2: 1, 3: 1 } });
    expect(fast).toBeGreaterThan(slow * 3);
  });

  it('a runner on second is judged by his own speed', () => {
    const fast = rate({ bases: [null, 2, null], speeds: { 1: 1, 2: 1.08, 3: 1 } });
    const slow = rate({ bases: [null, 2, null], speeds: { 1: 1.08, 2: 0.92, 3: 1 } });
    expect(fast).toBeGreaterThan(slow * 3);
  });

  it('1-0 and 2-1 counts raise the chance by a half', () => {
    const base = rate({}, 20000);
    for (const count of [{ balls: 1, strikes: 0 }, { balls: 2, strikes: 1 }]) {
      const r = rate({ count }, 20000);
      expect(r / base).toBeGreaterThan(1.3);
      expect(r / base).toBeLessThan(1.7);
    }
  });

  it('the average runner goes about the configured share of the time', () => {
    expect(rate({}, 20000)).toBeGreaterThan(CONFIG.cpuRun.steal * 0.8);
    expect(rate({}, 20000)).toBeLessThan(CONFIG.cpuRun.steal * 1.2);
  });
});
