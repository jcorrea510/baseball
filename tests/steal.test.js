// Stealing bases, the hit-and-run and runners who have to get back: real timing, legal outs, repeatable.
import { describe, it, expect } from 'vitest';
import { CONFIG } from '../src/config.js';
import { Engine } from '../src/game/engine.js';
import * as rules from '../src/game/rules.js';
import { simulateBattedBall } from '../src/physics/ballistics.js';
import { createDefense, planPlay, planSteal } from '../src/game/fielding.js';
import { auditPlan } from '../src/game/playAudit.js';
import { runnerState, retreatArrival, leadSpot, runnerArrival, moveArrival } from '../src/game/runnerMotion.js';
import { BASE_XZ } from '../src/physics/field.js';
import { createRng } from '../src/util/rng.js';
const untilPhase = (e, phase, max = 20) => { for (let t = 0; t < max && e.phase !== phase; t += 1 / 120) e.update(1 / 120); return e.phase === phase; };

const contactOf = (ev, la, spray) => ({ exitVelocity: ev, launchAngle: la, sprayAngle: spray, backspin: 900, hook: 0 });
const play = (ev, la, spray, o = {}) => {
  const c = contactOf(ev, la, spray);
  const sim = simulateBattedBall({ ...c, start: { x: 0, y: 2.6, z: -1 } });
  const defense = createDefense();
  return { plan: planPlay({ sim, contact: c, bases: o.bases, outs: o.outs ?? 0, defense, running: o.running }, CONFIG), defense };
};

// a quick game with runners placed, the steal on, and nobody swinging: returns the steal result
function stealAttempt(bases, { seed = 1, difficulty = 'pro' } = {}) {
  const e = new Engine({ mode: 'quick', playerSide: 'top', difficulty, seed });
  e.start();
  e.game.bases = bases;
  let res = null;
  e.on('result', (r) => { if (r.kind === 'steal') res = r; });
  e.batterReady();
  const armed = e.setSteal(true);
  for (let i = 0; i < 6000 && !res && !(e.phase === 'result' && !e.play); i++) e.update(1 / 120);
  return { e, res, armed };
}

describe('who can steal', () => {
  const eng = (bases) => { const e = new Engine({ mode: 'quick', playerSide: 'top', seed: 3 }); e.start(); e.game.bases = bases; return e; };
  it('a runner with an open base ahead; both on a double steal; nobody steals home', () => {
    expect(eng([1, null, null]).stealBases()).toEqual([1]);
    expect(eng([null, 2, null]).stealBases()).toEqual([2]);
    expect(eng([1, 2, null]).stealBases()).toEqual([2, 1]);
    expect(eng([1, null, 3]).stealBases()).toEqual([1]);
    expect(eng([null, null, 3]).stealBases()).toEqual([]);
    expect(eng([1, 2, 3]).stealBases()).toEqual([]);
    expect(eng([null, null, null]).stealBases()).toEqual([]);
  });
  it('not in the Derby or practice', () => {
    const e = new Engine({ mode: 'derby', seed: 3 }); e.start();
    expect(e.setSteal(true)).toBe(false);
  });
});

describe('a steal attempt', () => {
  it('ends with the runner on second or out, the count untouched but for the pitch', () => {
    let safe = 0, out = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const { e, res, armed } = stealAttempt([{ id: 'r' }, null, null], { seed });
      expect(armed).toBe(true);
      expect(res).toBeTruthy();
      if (res.result === 'stolenBase') { safe++; expect(e.game.bases[1]).toEqual({ id: 'r' }); expect(e.game.bases[0]).toBe(null); }
      else { out++; expect(e.game.bases.every((b) => !b)).toBe(true); expect(e.game.outs).toBe(1); }
      expect(auditPlan(res.plan, e.defense)).toEqual([]);
    }
    // on Pro most steals of second work, but not all
    expect(safe).toBeGreaterThan(out);
    expect(out).toBeGreaterThan(0);
  });

  it('is repeatable: same seed, same result', () => {
    const a = stealAttempt([{ id: 'r' }, null, null], { seed: 9 }).res, b = stealAttempt([{ id: 'r' }, null, null], { seed: 9 }).res;
    expect(a.result).toBe(b.result);
    expect(a.plan.margin).toBeCloseTo(b.plan.margin, 9);
  });

  it('a caught stealing: the man covering is on the bag with the ball before the runner gets there', () => {
    const defense = createDefense();
    const plan = planSteal({ bases: [1, null, null], outs: 0, defense, running: { 1: -1.0 }, transfer: 0.6, coverStart: -0.8 }, CONFIG);
    expect(plan.result).toBe('caughtStealing');
    const out = plan.events.find((ev) => ev.type === 'out');
    expect(out.base).toBe(2);
    expect(out.tag).toBe(true); // (a steal is a tag play: the fielder has to put the glove on him)
    expect(out.t).toBeLessThan(runnerArrival(CONFIG, 1, 2, -1.0));
    expect(auditPlan(plan, defense)).toEqual([]);
  });

  it('a great jump beats the throw; a hopeless one is not even thrown', () => {
    const defense = createDefense();
    const safe = planSteal({ bases: [1, null, null], outs: 0, defense, running: { 1: -1.9 }, transfer: 0.8, coverStart: -1.5 }, CONFIG);
    expect(safe.result).toBe('stolenBase');
    expect(safe.moves[0].to).toBe(2);
    const easy = planSteal({ bases: [1, null, null], outs: 0, defense, running: { 1: -2.5 }, transfer: 1.4, coverStart: -2 }, CONFIG);
    expect(easy.throws.length).toBe(0);
  });

  it('the rules: runners move up, an out is an out, nothing else changes', () => {
    const g = rules.createGame();
    g.bases = ['a', 'b', null]; g.balls = 1; g.strikes = 1;
    const r = rules.applySteal(g, [{ from: 2, to: 0, out: true }, { from: 1, to: 2 }]);
    expect(g.bases).toEqual([null, 'a', null]);
    expect(g.outs).toBe(1);
    expect([g.balls, g.strikes]).toEqual([1, 1]);
    expect(r.halfOver).toBe(false);
  });

  it('success rate by level: easiest on Rookie, hardest on All-Star', () => {
    const rate = (difficulty) => {
      let s = 0, n = 0;
      for (let seed = 1; seed <= 60; seed++) {
        const { res } = stealAttempt([{ id: 'r' }, null, null], { seed, difficulty });
        if (!res) continue; // (the pitch hit the batter: he takes first and the runner is waved on - no steal)
        n++; if (res.result === 'stolenBase') s++;
      }
      return s / n;
    };
    const r = rate('rookie'), p = rate('pro'), a = rate('allstar');
    expect(r).toBeGreaterThan(p - 0.05);
    expect(p).toBeGreaterThan(a - 0.05);
    expect(r).toBeGreaterThan(0.7);
    expect(a).toBeGreaterThan(0.3);
    expect(a).toBeLessThan(0.85);
  }, 60000);
});

describe('going with the pitch and the ball is hit', () => {
  it('hit-and-run: the head start gets the runner there sooner (still one base on his own), and every out is still legal', () => {
    const rng = createRng(21);
    const problems = [];
    let further = 0, n = 0;
    for (let k = 0; k < 800; k++) {
      const c = [rng.range(40, 104), rng.range(-12, 40), rng.range(-42, 42)];
      const bases = [1, rng.chance(0.4) ? 2 : null, null];
      const running = bases[1] ? { 1: -0.9, 2: -0.9 } : { 1: -0.9 };
      const a = play(...c, { bases, running });
      const b = play(...c, { bases });
      problems.push(...auditPlan(a.plan, a.defense));
      if (!a.plan.fair || a.plan.homer || a.plan.groundRule) continue; // (a ground-rule double awards two bases to everybody)
      const mA = a.plan.moves.find((m) => m.from === 1), mB = b.plan.moves.find((m) => m.from === 1);
      if (mA && mB && !mA.out && !mB.out && !mA.back && mA.to === mB.to && mA.to > 1) {
        n++;
        expect(mA.to).toBeLessThanOrEqual(2);
        if (moveArrival(CONFIG, mA, mA.to) < moveArrival(CONFIG, mB, mB.to) - 0.3) further++;
      }
      for (const m of a.plan.moves) if (m.from >= 1 && !m.trot) expect(m.tStart).toBeLessThan(0);
    }
    expect(problems).toEqual([]);
    expect(n).toBeGreaterThan(100);
    expect(further).toBeGreaterThan(0);
  }, 60000);

  it('a foul ball: runners who were going pull up and go back', () => {
    const { plan } = play(70, 20, -60, { bases: [1, null, null], running: { 1: -0.8 } });
    expect(plan.result).toBe('foul');
    const m = plan.moves.find((q) => q.from === 1);
    expect(m.back).toBe(true);
    expect(m.to).toBe(1);
  });

  it('a line drive caught with the runner going: he is doubled off if the ball beats him back - legally', () => {
    let doubled = 0;
    const problems = [];
    for (const spray of [-30, -20, -10, 0, 10, 20, 30]) {
      for (const ev of [75, 85, 95]) {
        const { plan, defense } = play(ev, 12, spray, { bases: [1, null, null], running: { 1: -1.1 } });
        if (!plan.caught) continue;
        problems.push(...auditPlan(plan, defense));
        if (plan.doubledOff) {
          doubled++;
          expect(plan.outsMade).toBe(2);
          expect(plan.result).toBe('doublePlay');
          const out = plan.events.find((e) => e.type === 'out' && e.base === 1);
          const mv = plan.moves.find((m) => m.out && m.from === 1);
          expect(out.t).toBeLessThan(retreatArrival(CONFIG, 1, mv.tStart, mv.backAt));
        }
      }
    }
    expect(problems).toEqual([]);
    expect(doubled).toBeGreaterThan(0);
  });
});

describe('a runner going back', () => {
  it('follows his run out, pulls up, and ends on the bag he left - without jumping', () => {
    const move = { from: 1, to: 1, back: true, tStart: -0.8, backAt: 0.5 };
    const o = {};
    let prev = null, worst = 0;
    for (let t = -0.8; t < 4; t += 1 / 60) {
      runnerState(move, t, CONFIG, o);
      if (prev) worst = Math.max(worst, Math.hypot(o.x - prev[0], o.z - prev[1]));
      prev = [o.x, o.z];
    }
    expect(worst).toBeLessThan(CONFIG.runner.speed / 60 + 0.1);
    expect(o.done).toBe(true);
    expect(Math.hypot(o.x - BASE_XZ[1][0], o.z - BASE_XZ[1][1])).toBeLessThan(0.1);
    // before he turns he is exactly where a runner going to second would be
    const fwd = runnerState({ from: 1, to: 2, tStart: -0.8 }, 0.3, CONFIG, {});
    const bk = runnerState(move, 0.3, CONFIG, {});
    expect(Math.hypot(fwd.x - bk.x, fwd.z - bk.z)).toBeLessThan(1e-6);
    const [lx, lz] = leadSpot(1);
    expect(Math.hypot(lx - BASE_XZ[1][0], lz - BASE_XZ[1][1])).toBeGreaterThan(5);
  });
});

describe('wild pitches', () => {
  it('a pitch in the dirt that gets past the catcher: the runners move up a base, the man on third scores if he beats the throw home', async () => {
    const { planWildPitch, createDefense: cd } = await import('../src/game/fielding.js');
    const rules = await import('../src/game/rules.js');
    const p = planWildPitch({ bases: ['a', null, 'c'], defense: cd(), roll: 0.3 }, CONFIG);
    expect(p).toBeTruthy();
    expect(p.moves.find((m) => m.from === 1).to).toBe(2);
    const m3 = p.moves.find((m) => m.from === 3);
    expect([3, 4]).toContain(m3.to);
    expect(p.outsMade).toBe(0);
    const g = rules.createGame();
    g.bases = ['a', null, 'c'];
    const r = rules.applyAdvance(g, p.moves.filter((m) => m.to > m.from));
    expect(g.bases[1]).toBe('a');
    expect(r.runs).toBe(m3.to === 4 ? 1 : 0);
    expect(g.score.top).toBe(r.runs);
  });
  it('in a game: now and then a pitch in the dirt with runners on is a wild pitch (never one that ends the at-bat)', () => {
    const e = new Engine({ mode: 'quick', playerSide: 'top', seed: 12 });
    e.pitchOverride = () => ({ type: 'curveball', speedMph: 76, target: { x: 0.2, y: 0.3 }, intendedStrike: false, tell: { slot: 0, lag: 0 } });
    e.cfg = { ...e.cfg, wildPitch: { ...e.cfg.wildPitch, chance: { rookie: 1, pro: 1, allstar: 1 } } };
    e.start();
    expect(untilPhase(e, 'ready')).toBe(true);
    e.game.bases[1] = e.lineup[5];
    let wp = null;
    e.on('result', (r) => { if (r.result === 'wildPitch') wp = r; });
    expect(untilPhase(e, 'play', 30)).toBe(true);
    expect(e.play.plan.wildPitch).toBe(true);
    expect(untilPhase(e, 'result', 30)).toBe(true);
    expect(wp).toBeTruthy();
    expect(e.game.bases[2]).toBe(e.lineup[5]); // (second to third)
    expect(e.game.balls).toBe(1);
  });
});
