// How pitching feels to a PERSON (scripts/pitchfeel.mjs): a simulated person pitches the computer's half-innings through the real
// engine. The referee must find nothing wrong on the computer's balls in play. The balance bands (the spec's "Balance targets") are
// finished in the balance stage: run them with PITCH_BANDS=1.
import { describe, it, expect } from 'vitest';
import { runHalves, targetFor } from '../scripts/pitchfeel.mjs';

const N = 400;

describe('a person pitching the computer\'s half', () => {
  it('the referee finds nothing wrong on the computer\'s balls in play', () => {
    const r = runHalves({ halves: N, player: 'average', level: 'pro', seed: 3 });
    expect(r.audit).toEqual([]);
    expect(r.plays).toBeGreaterThan(N); // (plenty of balls in play were checked)
  }, 240000);
});

describe.skipIf(!process.env.PITCH_BANDS)('pitching balance bands', () => {
  const cache = {};
  const get = (player, level) => (cache[player + level] ||= runHalves({ halves: N, player, level, seed: 5 }));

  for (const level of ['rookie', 'pro', 'allstar']) {
    it(`an average person gives up about today's runs per half on ${level}`, () => {
      const r = get('average', level), t = targetFor(level);
      expect(r.runs).toBeGreaterThanOrEqual(0.8 * t.runs);
      expect(r.runs).toBeLessThanOrEqual(1.2 * t.runs);
      expect(r.bbRate).toBeLessThan(0.12);
      expect(r.audit).toEqual([]);
    }, 240000);
  }

  it('the levels stay in order for the average person: Rookie < Pro < All-Star', () => {
    expect(get('average', 'rookie').runs).toBeLessThan(get('average', 'pro').runs);
    expect(get('average', 'pro').runs).toBeLessThan(get('average', 'allstar').runs);
  }, 480000);

  it('a good pitcher gives up clearly fewer runs, a new one more (Pro)', () => {
    const avg = get('average', 'pro').runs;
    const good = get('good', 'pro'), fresh = get('new', 'pro');
    expect(good.runs).toBeLessThanOrEqual(0.75 * avg);
    expect(fresh.runs).toBeGreaterThanOrEqual(1.15 * avg);
    for (const r of [good, fresh]) { expect(r.bbRate).toBeLessThan(0.12); expect(r.audit).toEqual([]); }
  }, 480000);

  it('strikeouts are 20-35% of batters for the average person on Pro', () => {
    const r = get('average', 'pro');
    expect(r.kRate).toBeGreaterThanOrEqual(0.2);
    expect(r.kRate).toBeLessThanOrEqual(0.35);
  }, 240000);
});
