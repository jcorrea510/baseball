// Batting must feel fair to a person: a simulated player follows the pitch guide with a human reaction delay, a shaky hand and human
// timing (scripts/feel.mjs). Not so hard that a new player whiffs most of the time, not so easy that a good one homers at will.
import { describe, it, expect } from 'vitest';
import { feel } from '../scripts/feel.mjs';

const N = 900;
const rate = (r, k) => r[k] / r.swings;
const miss = (r) => 1 - r.contact / r.swings;

describe('how batting feels to a person', () => {
  it('Pro: a new player gets the bat on most hittable pitches, an average one on nearly all', () => {
    expect(miss(feel({ difficulty: 'pro', player: 'new', n: N }))).toBeLessThan(0.38);
    const avg = feel({ difficulty: 'pro', player: 'average', n: N });
    expect(miss(avg)).toBeLessThan(0.2);
    expect(miss(avg)).toBeGreaterThan(0.02); // (still a skill: timing counts)
  }, 60000);

  it('...but it is not a home run derby: hits and home runs stay earned', () => {
    const good = feel({ difficulty: 'pro', player: 'good', n: N });
    expect(rate(good, 'hr')).toBeLessThan(0.14);
    const avg = feel({ difficulty: 'pro', player: 'average', n: N });
    expect(rate(avg, 'hr')).toBeLessThan(0.08);
    expect(rate(avg, 'hit') + rate(avg, 'hr')).toBeLessThan(0.55);
  }, 60000);

  it('most balls you hit stay fair (a foul is a mistimed or glancing swing, not the usual result)', () => {
    const share = (r) => r.foul / r.contact;
    expect(share(feel({ difficulty: 'rookie', player: 'new', n: N }))).toBeLessThan(0.2);
    expect(share(feel({ difficulty: 'pro', player: 'new', n: N }))).toBeLessThan(0.32);
    expect(share(feel({ difficulty: 'pro', player: 'average', n: N }))).toBeLessThan(0.24);
  }, 60000);

  it('the levels stay in order: Rookie easiest, All-Star clearly hardest', () => {
    const m = ['rookie', 'pro', 'allstar'].map((d) => miss(feel({ difficulty: d, player: 'average', n: N })));
    expect(m[0]).toBeLessThan(m[1]);
    expect(m[1]).toBeLessThan(m[2] - 0.1);
    expect(m[0]).toBeLessThan(0.08);
  }, 60000);
});
