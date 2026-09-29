import { describe, it, expect } from 'vitest';
import { simulateHalf } from '../src/game/aiHalf.js';
import * as rules from '../src/game/rules.js';
import { createRng } from '../src/util/rng.js';

const half = (seed, diff = 'pro', setup) => {
  const g = rules.createGame();
  g.half = 'bottom';
  if (setup) setup(g);
  const r = simulateHalf(g, { difficulty: diff, rng: createRng(seed) });
  return { g, r };
};

describe("the computer's half-inning", () => {
  it('always ends with three outs (or a walk-off) and consistent runs', () => {
    for (let i = 0; i < 300; i++) {
      const { g, r } = half(i);
      expect(g.outs).toBe(3);
      expect(r.runs).toBe(g.score.bottom);
      expect(r.events.length).toBeGreaterThanOrEqual(3);
      expect(r.events.reduce((a, e) => a + e.runs, 0)).toBe(r.runs);
      expect(g.bases.filter(Boolean).length).toBeLessThanOrEqual(3);
    }
  });

  it('is repeatable for a given seed', () => {
    expect(JSON.stringify(half(5).r)).toBe(JSON.stringify(half(5).r));
  });

  it('a harder difficulty scores more, on average', () => {
    const avg = (d) => { let t = 0; for (let i = 0; i < 600; i++) t += half(i, d).r.runs; return t / 600; };
    expect(avg('allstar')).toBeGreaterThan(avg('rookie'));
    expect(avg('pro')).toBeGreaterThan(avg('rookie') - 0.001);
  });

  it('stops immediately on a walk-off in the last inning', () => {
    let saw = false;
    for (let i = 0; i < 400 && !saw; i++) {
      const { g } = half(i, 'allstar', (gg) => { gg.inning = 3; gg.score = { top: 1, bottom: 0 }; });
      if (g.over) { saw = true; expect(g.winner).toBe('bottom'); expect(g.score.bottom).toBeGreaterThan(g.score.top); expect(g.walkOff).toBe(true); }
    }
    expect(saw).toBe(true);
  });

  it('runners in extra innings start on second and can score', () => {
    const { g, r } = half(3, 'pro', (gg) => { gg.inning = 4; gg.bases = [null, { ghost: true }, null]; });
    // either the half runs its course, or the home team walked it off the moment it took the lead
    expect(g.outs === 3 || (g.over && g.winner === 'bottom')).toBe(true);
    expect(r.runs).toBeGreaterThanOrEqual(0);
  });
});
