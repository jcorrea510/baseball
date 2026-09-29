// Home run rate in the Derby: a perfectly timed swing should usually leave the park, a good one sometimes,
// and pulling the ball helps. Runs the real pitch, contact and ball-flight code (same as `node scripts/hrrate.mjs`).
import { describe, it, expect } from 'vitest';
import { CONFIG, DIFFICULTIES } from '../src/config.js';
import { hrRate } from '../scripts/hrrate.mjs';

const N = 1200;

describe('Derby home run rate', () => {
  for (const d of DIFFICULTIES) {
    it(`${d}: perfect swings are mostly homers, good swings some`, () => {
      const perfect = hrRate({ mode: 'derby', difficulty: d, kind: 'perfect', n: N });
      const good = hrRate({ mode: 'derby', difficulty: d, kind: 'good', n: N });
      expect(perfect.hr).toBeGreaterThan(0.68);
      expect(perfect.hr).toBeLessThan(0.87);
      expect(good.hr).toBeGreaterThan(0.22);
      expect(good.hr).toBeLessThan(0.42);
    });
  }

  it('pulling a perfect swing helps', () => {
    const straight = hrRate({ mode: 'derby', difficulty: 'pro', kind: 'perfect', aim: 0, n: N });
    const pulled = hrRate({ mode: 'derby', difficulty: 'pro', kind: 'perfect', aim: -1, n: N });
    expect(pulled.hr).toBeGreaterThan(straight.hr);
  });

  it('Quick game numbers are untouched: a good swing there is almost never a homer', () => {
    const good = hrRate({ mode: 'quick', difficulty: 'pro', kind: 'good', n: N });
    expect(good.hr).toBeLessThan(0.06);
  });

  it('a Derby swing through the engine gets the Derby help (same numbers as the model)', () => {
    expect(CONFIG.modes.derby.goodQuality[0]).toBeGreaterThan(CONFIG.contact.qualityGood[0]);
    expect(CONFIG.modes.derby.goodLaunch.center).toBeGreaterThan(CONFIG.contact.launch.good.center);
  });
});
