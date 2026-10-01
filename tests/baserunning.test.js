// Runners read the ball, gamble for extra bases (and are tagged out or just safe), and hold on caught balls.
import { describe, it, expect } from 'vitest';
import { CONFIG } from '../src/config.js';
import { simulateBattedBall } from '../src/physics/ballistics.js';
import { createDefense, planPlay } from '../src/game/fielding.js';
import { auditPlan } from '../src/game/playAudit.js';
import * as rules from '../src/game/rules.js';
import { createRng } from '../src/util/rng.js';

const plan = (c, o = {}) => {
  const sim = simulateBattedBall({ ...c, start: { x: 0, y: 2.6, z: -1 } });
  const defense = createDefense();
  return { plan: planPlay({ sim, contact: c, bases: o.bases || [null, null, null], outs: o.outs ?? 0, defense, advRoll: o.roll }, CONFIG), defense };
};
const C = (ev, la, spray) => ({ exitVelocity: ev, launchAngle: la, sprayAngle: spray, backspin: 900, hook: 0 });

describe('gambling for an extra base', () => {
  it('no roll, no gamble (the old, careful runners)', () => {
    const rng = createRng(2);
    for (let k = 0; k < 400; k++) {
      const { plan: p } = plan(C(rng.range(55, 100), rng.range(-4, 30), rng.range(-40, 40)), { bases: [1, null, 3] });
      expect(p.gambleOut).toBeFalsy();
    }
  });

  it('across thousands of plays: some runners are tagged out, many are just safe, and the referee finds nothing wrong', () => {
    const rng = createRng(9);
    let outs = 0, safes = 0;
    const problems = [];
    for (let k = 0; k < 3000; k++) {
      const c = C(rng.range(50, 105), rng.range(-6, 40), rng.range(-44, 44));
      const bases = [rng.chance(0.4) ? 1 : null, rng.chance(0.3) ? 2 : null, rng.chance(0.25) ? 3 : null];
      const { plan: p, defense } = plan(c, { bases, outs: Math.floor(rng.next() * 3), roll: rng.next() });
      if (p.gambleOut) {
        outs++;
        const e = p.events.find((x) => x.tag);
        expect(e.type).toBe('out');
        expect(p.moves.some((m) => m.out && m.outBase === e.base)).toBe(true);
      }
      if (p.events.some((x) => x.type === 'safe')) safes++;
      problems.push(...auditPlan(p, defense));
      if (!(p.endTime > 0 && p.endTime < 25)) problems.push('bad end time');
    }
    expect(problems).toEqual([]);
    expect(outs).toBeGreaterThan(10);
    expect(safes).toBeGreaterThan(outs);
  }, 60000);

  it('a time play: a run that crossed the plate before the third-out tag still counts', () => {
    const g = rules.createGame();
    g.outs = 2; g.bases = ['a', 'b', null];
    const res = rules.applyPlay(g, { result: 'single', batterDest: 0, moves: [{ from: 2, to: 4, out: false, before: true }, { from: 1, to: 3, out: false, before: false }], outsMade: 1, timePlay: true }, 'bat');
    expect(res.runs).toBe(1);
    expect(g.score.top).toBe(1);
    const h = rules.createGame();
    h.outs = 2; h.bases = ['a', null, null];
    expect(rules.applyPlay(h, { result: 'groundout', batterDest: 0, moves: [{ from: 1, to: 4, out: false, before: true }], outsMade: 1 }, 'bat').runs).toBe(0); // (a force / batter out: no run)
  });
});

describe('reading the ball', () => {
  it('on a ball in the air the runners wait before going; on a grounder they go at once', () => {
    const rng = createRng(4);
    let fly = 0, ground = 0;
    for (let k = 0; k < 300; k++) {
      const spray = rng.range(-30, 30);
      const a = plan(C(rng.range(75, 95), rng.range(26, 38), spray), { bases: [null, 2, null] }).plan;
      const m = a.moves.find((q) => q.from === 2 && !q.back);
      if (m && m.to > 2 && !a.caught && !a.homer) { fly++; expect(m.tStart).toBeGreaterThan(CONFIG.runner.startDelay + 0.3); }
      const b = plan(C(rng.range(60, 90), rng.range(-8, 2), spray), { bases: [null, 2, null] }).plan;
      const g = b.moves.find((q) => q.from === 2 && !q.back);
      if (g && g.to > 2) { ground++; expect(g.tStart === undefined || g.tStart <= CONFIG.runner.startDelay + 1e-9).toBe(true); }
    }
    expect(fly).toBeGreaterThan(5);
    expect(ground).toBeGreaterThan(5);
  });

  it('a caught fly ball: runners who were not sent take a step and get back to the bag', () => {
    const { plan: p } = plan(C(85, 34, 4), { bases: [1, 2, null] });
    expect(p.caught).toBe(true);
    for (const b of [1, 2]) {
      const m = p.moves.find((q) => q.from === b);
      expect(m).toBeTruthy();
      expect(m.back).toBe(true);
      expect(m.to).toBe(b);
    }
  });
});
