// Home runs come from the right swing: perfect timing AND the bat a little under the ball. Runs the real pitches, swing model,
// collision and ball flight (the same as `node scripts/hrrate.mjs`).
import { describe, it, expect } from 'vitest';
import { DIFFICULTIES } from '../src/config.js';
import { hrRate } from '../scripts/hrrate.mjs';

const N = 900;

describe('Derby home run rate', () => {
  for (const d of DIFFICULTIES) {
    it(`${d}: a perfect swing a little under the ball is nearly always gone; a good one often; square or on top, never`, () => {
      const perfect = hrRate({ mode: 'derby', difficulty: d, kind: 'perfect', contact: 'power', n: N });
      const good = hrRate({ mode: 'derby', difficulty: d, kind: 'good', contact: 'power', n: N });
      expect(perfect.hr).toBeGreaterThan(0.75);
      expect(good.hr).toBeGreaterThan(0.35);
      expect(good.hr).toBeLessThan(perfect.hr);
      expect(hrRate({ mode: 'derby', difficulty: d, kind: 'perfect', contact: 'square', n: 300 }).hr).toBeLessThan(0.03);
      expect(hrRate({ mode: 'derby', difficulty: d, kind: 'perfect', contact: 'top', n: 300 }).hr).toBe(0);
    }, 60000);
  }
});

describe('game home run rate', () => {
  it('in a game a perfect power swing is a homer some of the time - more than a good one, and far from always', () => {
    for (const d of DIFFICULTIES) {
      const perfect = hrRate({ mode: 'quick', difficulty: d, kind: 'perfect', contact: 'power', n: N });
      const good = hrRate({ mode: 'quick', difficulty: d, kind: 'good', contact: 'power', n: N });
      expect(perfect.hr).toBeGreaterThan(0.12);
      expect(perfect.hr).toBeLessThan(0.7);
      expect(good.hr).toBeLessThan(perfect.hr + 0.02);
    }
  }, 60000);

  it('the Derby gives batting-practice help: the same swing goes out more often than in a game', () => {
    const derby = hrRate({ mode: 'derby', difficulty: 'pro', kind: 'perfect', contact: 'power', n: N });
    const quick = hrRate({ mode: 'quick', difficulty: 'pro', kind: 'perfect', contact: 'power', n: N });
    expect(derby.hr).toBeGreaterThan(quick.hr + 0.2);
  }, 60000);

  it('early swings (pulled) and late swings (the other way) both stay mostly fair when timed well', () => {
    expect(hrRate({ mode: 'quick', difficulty: 'pro', kind: 'perfect', contact: 'square', n: 400 }).fair).toBeGreaterThan(0.95);
  }, 60000);
});
