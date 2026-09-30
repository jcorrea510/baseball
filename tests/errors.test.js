// Fielding errors: rare, repeatable (decided by a roll the engine passes in), and never an out that breaks the rules.
import { describe, it, expect } from 'vitest';
import { CONFIG } from '../src/config.js';
import { simulateBattedBall } from '../src/physics/ballistics.js';
import { createDefense, planPlay } from '../src/game/fielding.js';
import { auditPlan } from '../src/game/playAudit.js';
import * as rules from '../src/game/rules.js';
import { simulateHalf } from '../src/game/aiHalf.js';
import { createRng } from '../src/util/rng.js';
import { isInsideField } from '../src/physics/field.js';

const contactOf = (ev, la, spray) => ({ exitVelocity: ev, launchAngle: la, sprayAngle: spray, backspin: 900, hook: 0 });
const play = (ev, la, spray, o = {}) => {
  const c = contactOf(ev, la, spray);
  const sim = simulateBattedBall({ ...c, start: { x: 0, y: 2.6, z: -1 } });
  const defense = createDefense();
  const plan = planPlay({ sim, contact: c, bases: o.bases || [null, null, null], outs: o.outs ?? 0, defense, errorRoll: o.roll, errorScale: o.scale, simple: o.simple }, CONFIG);
  return { plan, defense };
};
const GROUNDER = [48, -2, -18]; // routine grounder to short
const FLY = [88, 34, 4]; // routine fly to center

describe('fielding errors', () => {
  it('no roll = no errors (tests, practice, the Derby)', () => {
    expect(play(...GROUNDER).plan.result).toBe('groundout');
    expect(play(...GROUNDER, { roll: 0, simple: true }).plan.result).toBe('hitSimple');
    expect(play(...FLY).plan.result).toBe('flyout');
  });

  it('a high roll is a clean play, a roll under the chance is an error', () => {
    expect(play(...GROUNDER, { roll: 0.5 }).plan.result).toBe('groundout');
    expect(play(...GROUNDER, { roll: CONFIG.fielding.errors.ground * 0.5 }).plan.result).toBe('error');
    expect(play(...FLY, { roll: 0.5 }).plan.result).toBe('flyout');
    expect(play(...FLY, { roll: CONFIG.fielding.errors.fly * 0.5 }).plan.result).toBe('error');
  });

  it('a bobbled grounder: the ball squirts loose, he picks it up later, the batter is safe, and the referee is happy', () => {
    const { plan, defense } = play(...GROUNDER, { roll: 0.001, bases: [1, null, null] });
    expect(plan.result).toBe('error');
    expect(plan.error.kind).toBe('bobble');
    expect(plan.outsMade).toBe(0);
    expect(plan.batterDest).toBeGreaterThanOrEqual(1);
    expect(plan.looses.length).toBe(1);
    const lo = plan.looses[0];
    expect(lo.t1).toBeGreaterThan(lo.t0 + 0.5);
    expect(Math.hypot(lo.bx - lo.ax, lo.bz - lo.az)).toBeCloseTo(CONFIG.fielding.errors.looseDist, 0);
    // the ball is in his hands again only once he has run to it
    const pick = plan.carries.find((c) => c.t0 >= lo.t1 - 1e-6);
    expect(pick).toBeTruthy();
    expect(plan.events.some((e) => e.type === 'error')).toBe(true);
    expect(plan.moves.find((m) => m.from === 1).to).toBeGreaterThanOrEqual(2); // the forced runner moves up
    expect(auditPlan(plan, defense)).toEqual([]);
  });

  it('a dropped fly: no catch, the ball comes out of his glove, everyone takes what the delay gives', () => {
    const { plan } = play(...FLY, { roll: 0.001, bases: [null, 1, null] });
    expect(plan.result).toBe('error');
    expect(plan.dropped).toBe(true);
    expect(plan.caught).toBe(false);
    expect(plan.events.some((e) => e.type === 'catch')).toBe(false);
    expect(plan.outsMade).toBe(0);
    expect(plan.batterDest).toBeGreaterThanOrEqual(1);
    expect(plan.looses[0].t0).toBeCloseTo(plan.catchT, 5);
  });

  it('the same roll always gives the same play', () => {
    const a = play(...GROUNDER, { roll: 0.004 }).plan, b = play(...GROUNDER, { roll: 0.004 }).plan;
    expect(a.looses).toEqual(b.looses);
    expect(a.batterDest).toBe(b.batterDest);
  });

  it('happens at about the configured rate on routine grounders', () => {
    const rng = createRng(11);
    let n = 0, errs = 0;
    for (let k = 0; k < 2000; k++) { n++; if (play(...GROUNDER, { roll: rng.next() }).plan.result === 'error') errs++; }
    expect(errs / n).toBeGreaterThan(CONFIG.fielding.errors.ground * 0.6);
    expect(errs / n).toBeLessThan(CONFIG.fielding.errors.ground * 1.5);
  });

  it('forced errors on all kinds of batted balls, runners and outs: every play stays legal', () => {
    const rng = createRng(5);
    const problems = [];
    let errs = 0;
    for (let k = 0; k < 1500; k++) {
      const c = contactOf(rng.range(35, 105), rng.range(-15, 55), rng.range(-44, 44));
      const sim = simulateBattedBall({ ...c, start: { x: 0, y: 2.6, z: -1 } });
      const bases = [rng.chance(0.4) ? 1 : null, rng.chance(0.3) ? 2 : null, rng.chance(0.25) ? 3 : null];
      const defense = createDefense();
      const plan = planPlay({ sim, contact: c, bases, outs: Math.floor(rng.next() * 3), defense, errorRoll: 0.0005 }, CONFIG);
      if (plan.result !== 'error') continue;
      errs++;
      problems.push(...auditPlan(plan, defense));
      if (plan.outsMade !== 0 || plan.batterDest < 1) problems.push('an error that made an out');
      for (const lo of plan.looses) if (!isInsideField(lo.bx, lo.bz)) problems.push('loose ball outside the park');
      if (!(plan.endTime > 0 && plan.endTime < 20)) problems.push('bad end time ' + plan.endTime);
    }
    expect(errs).toBeGreaterThan(800);
    expect(problems).toEqual([]);
  }, 30000);

  it('the scorebook: an error is an at-bat, not a hit, and is charged to the team in the field', () => {
    const g = rules.createGame();
    const res = rules.applyPlay(g, { result: 'error', batterDest: 1, moves: [], outsMade: 0 }, 'B1');
    expect(res.runs).toBe(0);
    expect(g.hits.top).toBe(0);
    expect(g.errors).toEqual({ top: 0, bottom: 1 });
    expect(g.bases[0]).toBe('B1');
    expect(rules.RESULT_TEXT.error).toBe('ERROR');
  });

  it('the computer can reach on your errors too', () => {
    const rng = createRng(3);
    let seen = 0;
    for (let k = 0; k < 400 && !seen; k++) {
      const g = rules.createGame();
      g.half = 'bottom';
      const s = simulateHalf(g, { difficulty: 'pro', rng }, CONFIG);
      if (s.events.some((e) => e.kind === 'error')) { seen++; expect(g.errors.top).toBeGreaterThan(0); }
    }
    expect(seen).toBe(1);
  });
});
