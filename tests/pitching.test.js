import { describe, it, expect } from 'vitest';
import { CONFIG } from '../src/config.js';
import { gradeTap, ringTiming, throwPitch, fatigue, pitchCost, staminaMax } from '../src/game/pitching.js';
import { createRng } from '../src/util/rng.js';

const P = (o = {}) => ({ id: 'x', name: 'A B', hand: 'R', role: 'SP', vel: 50, ctl: 50, stf: 50, sta: 50, pitches: ['fastball', 'slider'], ...o });
const many = (n, f) => Array.from({ length: n }, (_, i) => f(createRng(1000 + i)));

describe('your pitch', () => {
  it('grades the tap by ms from the moment the ring meets the dot', () => {
    expect(gradeTap(0)).toBe('perfect'); expect(gradeTap(-40)).toBe('perfect'); expect(gradeTap(41)).toBe('good');
    expect(gradeTap(90)).toBe('good'); expect(gradeTap(-91)).toBe('ok'); expect(gradeTap(160)).toBe('ok');
    expect(gradeTap(161)).toBe('wild'); expect(gradeTap(null)).toBe('wild');
  });
  it('rings run faster for harder pitches, worse control and a tired arm', () => {
    const base = ringTiming(P(), 'fastball').time;
    expect(base).toBeCloseTo(0.9, 5);
    expect(ringTiming(P(), 'curveball').time).toBeLessThan(base);
    expect(ringTiming(P({ ctl: 99 }), 'fastball').time).toBeGreaterThan(base);
    expect(ringTiming(P(), 'fastball', 1).time).toBeCloseTo(base / 1.35, 5);
    expect(ringTiming(P(), 'fastball').hitAt).toBeCloseTo(0.75 * base, 5);
  });
  it('a perfect pitch is full speed and lands near the dot; ok is slower and misses further', () => {
    const aim = { x: 0.5, y: 2.2 };
    const perf = many(400, (rng) => throwPitch({ pitcher: P({ vel: 99 }), type: 'fastball', aim, errMs: 0, fatigueF: 0, rng }));
    const ok = many(400, (rng) => throwPitch({ pitcher: P({ vel: 99 }), type: 'fastball', aim, errMs: 150, fatigueF: 0, rng }));
    const miss = (a) => a.reduce((s, p) => s + Math.hypot(p.target.x - aim.x, p.target.y - aim.y), 0) / a.length;
    expect(perf[0].speedMph).toBeCloseTo(100, 5);
    expect(ok[0].speedMph).toBeCloseTo(94, 5);
    expect(miss(perf)).toBeLessThan(0.1);
    expect(miss(ok)).toBeGreaterThan(miss(perf) * 3);
  });
  it('early taps miss up and to the arm side, late ones down and glove side - mirrored for a lefty', () => {
    for (const hand of ['R', 'L']) {
      const arm = hand === 'R' ? -1 : 1; // arm side in x as the catcher sees it
      const early = many(300, (rng) => throwPitch({ pitcher: P({ hand }), type: 'fastball', aim: { x: 0, y: 2.5 }, errMs: -70, fatigueF: 0, rng }));
      const late = many(300, (rng) => throwPitch({ pitcher: P({ hand }), type: 'fastball', aim: { x: 0, y: 2.5 }, errMs: 70, fatigueF: 0, rng }));
      const avg = (a, k) => a.reduce((s, p) => s + p.target[k], 0) / a.length;
      expect(Math.sign(avg(early, 'x'))).toBe(arm); expect(avg(early, 'y')).toBeGreaterThan(2.5);
      expect(Math.sign(avg(late, 'x'))).toBe(-arm); expect(avg(late, 'y')).toBeLessThan(2.5);
    }
  });
  it('a wild pitch either sails or hangs over the middle with little break', () => {
    const w = many(600, (rng) => throwPitch({ pitcher: P(), type: 'slider', aim: { x: 0.8, y: 1.8 }, errMs: 250, fatigueF: 0, rng }));
    const hangs = w.filter((p) => p.wildKind === 'hang'), sails = w.filter((p) => p.wildKind === 'sail');
    expect(hangs.length / w.length).toBeGreaterThan(0.4); expect(sails.length / w.length).toBeGreaterThan(0.4);
    for (const p of hangs) { expect(Math.abs(p.target.x)).toBeLessThan(0.8); expect(p.movementScale).toBeLessThan(0.4); }
    expect(w.every((p) => p.grade === 'wild')).toBe(true);
  });
  it('Velocity and Stuff map onto speed and break; fatigue costs speed and break', () => {
    const t = (o, f = 0) => throwPitch({ pitcher: P(o), type: 'fastball', aim: { x: 0, y: 2.5 }, errMs: 0, fatigueF: f, rng: createRng(3) });
    expect(t({ vel: 1 }).speedMph).toBeCloseTo(86, 5); expect(t({ vel: 99 }).speedMph).toBeCloseTo(100, 5);
    expect(t({ stf: 1 }).movementScale).toBeCloseTo(0.8, 5); expect(t({ stf: 99 }).movementScale).toBeCloseTo(1.2, 5);
    expect(t({ vel: 99 }, 1).speedMph).toBeCloseTo(96, 5); expect(t({}, 1).movementScale).toBeCloseTo(0.8, 5);
  });
  it('stamina: fatigue starts below 40%, costs rise with traffic and the heater', () => {
    expect(fatigue(100, 100)).toBe(0); expect(fatigue(40, 100)).toBe(0); expect(fatigue(20, 100)).toBeCloseTo(0.5, 5); expect(fatigue(0, 100)).toBe(1);
    expect(pitchCost({ type: 'fastball', balls: 0, risp: false })).toBe(1);
    expect(pitchCost({ type: 'heater', balls: 3, risp: true })).toBeCloseTo(1.3 * 1.15 * 1.2, 5);
    expect(staminaMax(P({ role: 'SP', sta: 1 }))).toBe(60); expect(staminaMax(P({ role: 'RP', sta: 99 }))).toBe(35);
  });
  it('the config carries the starting numbers', () => {
    expect(CONFIG.pitching.ring.perfect).toBe(40);
  });
});
