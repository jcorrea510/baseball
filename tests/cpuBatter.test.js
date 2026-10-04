// The computer's batter (game/cpuBatter.js): who he swings at, how his timing follows the pitch, and that he never gets the player's help.
import { describe, it, expect } from 'vitest';
import { CONFIG } from '../src/config.js';
import { createRng } from '../src/util/rng.js';
import { buildPitch, zoneRatio } from '../src/physics/pitch.js';
import { contactPoint, computeSwing } from '../src/game/contact.js';
import { resolveSwingTimes } from '../src/game/timing.js';
import { pitchWindowScale } from '../src/game/pitcherAI.js';
import { decideSwing, startSpot, perceivedSpot, cpuSwingInputs } from '../src/game/cpuBatter.js';

const SEEDS = 2000;

// a real pitch (pace 1) wrapped like the engine's pitch object
function makePitch(type, target, o = {}) {
  const speedMph = o.speedMph ?? (type === 'changeup' ? 82 : type === 'slider' ? 86 : 94);
  const flight = buildPitch({ type, speedMph, target, pace: 1, movementScale: o.movementScale ?? 1 }, CONFIG);
  return { flight, target, type, speedMph, tRelease: 0, tCross: flight.T, grade: o.grade ?? 'ok', wildKind: o.wildKind };
}
const base = { count: { balls: 0, strikes: 0 }, recent: [], batter: { con: 50, pow: 50, spd: 50 }, level: 'pro', strength: 0 };
const run = (pitch, over = {}, n = SEEDS) => {
  const out = [];
  for (let s = 1; s <= n; s++) out.push(decideSwing({ ...base, ...over, pitch, rng: createRng(s) }, CONFIG));
  return out;
};
const rate = (rs) => rs.filter((r) => r.swing).length / rs.length;
// target at a given zoneRatio straight out from the middle of the zone (to the right)
const outRight = (ratio) => ({ x: ratio * CONFIG.pitch.zoneHalfWidth, y: CONFIG.timing.zoneCenterY });

describe('the computer batter', () => {
  it('3-0 is a take unless he is a power hitter and it is down the middle', () => {
    const heart = makePitch('fastball', { x: 0, y: CONFIG.timing.zoneCenterY });
    const take = rate(run(heart, { count: { balls: 3, strikes: 0 }, batter: { con: 50, pow: 50, spd: 50 } }));
    const power = rate(run(heart, { count: { balls: 3, strikes: 0 }, batter: { con: 50, pow: 80, spd: 50 } }));
    expect(take).toBeLessThan(0.02);
    expect(power).toBeGreaterThan(0.2);
    expect(power).toBeLessThan(0.4);
  }, 60000);

  it('two strikes widen the zone and the swing is a protect swing', () => {
    const edge = makePitch('fastball', outRight(1.15));
    const early = rate(run(edge));
    const two = run(edge, { count: { balls: 0, strikes: 2 } });
    expect(rate(two)).toBeGreaterThan(1.5 * early);
    expect(two.filter((r) => r.swing).every((r) => r.protect)).toBe(true);
    expect(run(edge).filter((r) => r.swing).every((r) => !r.protect)).toBe(true);
  }, 60000);

  it('pitches that fade out of the zone get chased', () => {
    const target = outRight(1.5);
    const slider = makePitch('slider', target);
    const fast = makePitch('fastball', target);
    const s0 = startSpot(slider.flight, CONFIG);
    expect(zoneRatio(s0.x, s0.y, CONFIG)).toBeLessThan(1); // it starts as a strike
    expect(zoneRatio(target.x, target.y, CONFIG)).toBeGreaterThan(1.4);
    expect(rate(run(slider))).toBeGreaterThan(rate(run(fast)));
  }, 60000);

  it('a changeup after two fastballs is swung at early', () => {
    const heart = { x: 0, y: CONFIG.timing.zoneCenterY };
    const change = makePitch('changeup', heart);
    const fb = { type: 'fastball', speedMph: 94 }, ch = { type: 'changeup', speedMph: 82 };
    const mean = (rs) => { const e = rs.filter((r) => r.swing).map((r) => r.errorMs); return e.reduce((a, b) => a + b, 0) / e.length; };
    expect(mean(run(change, { recent: [fb, fb] }))).toBeLessThan(-25);
    expect(Math.abs(mean(run(change, { recent: [ch, ch] })))).toBeLessThan(8);
  }, 60000);

  it('a perfect pitch on the edge is squared up less than a hang', () => {
    const target = outRight(1.05);
    const perfect = makePitch('fastball', target, { grade: 'perfect' });
    const hang = makePitch('fastball', target, { grade: 'wild', wildKind: 'hang', movementScale: 0.3 });
    const squaredShare = (pitch) => {
      const inp = cpuSwingInputs('pro', base.batter, 0, CONFIG);
      let swings = 0, good = 0;
      for (let s = 1; s <= SEEDS; s++) {
        const rng = createRng(s);
        const d = decideSwing({ ...base, pitch, rng }, CONFIG);
        if (!d.swing) continue;
        swings++;
        const tPress = pitch.tCross + d.errorMs / 1000 - CONFIG.timing.swingDelay;
        const times = resolveSwingTimes(tPress, pitch.tCross, CONFIG);
        const { ball, vBall, wBall } = contactPoint(pitch.flight, times.hitTime - pitch.tRelease, times.barrelTime - pitch.tRelease, CONFIG);
        const c = computeSwing({
          errorMs: times.errorMs, ball, aim: d.aim, window: inp.window, vBall, wBall, windowScale: inp.windowScale,
          speedScale: pitchWindowScale(pitch.type), batterHand: 'R', batBonus: inp.batBonus, aimAssist: inp.aimAssist, evBonus: inp.evBonus, rng,
        }, CONFIG);
        if (c.made && (c.grade === 'perfect' || c.grade === 'good')) good++;
      }
      return good / swings;
    };
    expect(squaredShare(perfect)).toBeLessThan(0.6 * squaredShare(hang));
  }, 120000);

  it('stars chase less', () => {
    const chase = makePitch('fastball', outRight(1.6));
    const star = rate(run(chase, { batter: { con: 90, pow: 50, spd: 50 } }));
    const weak = rate(run(chase, { batter: { con: 30, pow: 50, spd: 50 } }));
    expect(star).toBeLessThan(0.75 * weak);
  }, 60000);

  it('the player\'s batting help is never used', () => {
    const inp = cpuSwingInputs('rookie', null, 0, CONFIG);
    expect(inp.batBonus).toBe(0);
    expect(inp.aimAssist).toBe(0);
    expect(inp.window).toEqual(CONFIG.difficulty.rookie.cpuBat.window);
    expect(inp.window).not.toEqual(CONFIG.difficulty.rookie.contactWindow);
  });

  it('helpers: the no-break spot, a perceived spot near the real one, ratings and strength change his inputs', () => {
    const p = makePitch('curveball', { x: 0, y: 2.4 }, { speedMph: 78 });
    const s0 = startSpot(p.flight, CONFIG);
    expect(s0.y).toBeGreaterThan(p.target.y); // a curve drops: it starts higher than it ends
    const spots = [];
    for (let s = 1; s <= 500; s++) spots.push(perceivedSpot(p, 0.2, 'pro', createRng(s), CONFIG));
    const mx = spots.reduce((a, b) => a + b.x, 0) / spots.length, my = spots.reduce((a, b) => a + b.y, 0) / spots.length;
    expect(Math.hypot(mx - p.target.x, my - p.target.y)).toBeLessThan(0.1);
    const star = cpuSwingInputs('pro', { con: 90, pow: 90, spd: 50 }, 0, CONFIG);
    const plain = cpuSwingInputs('pro', { con: 50, pow: 50, spd: 50 }, 0, CONFIG);
    expect(star.windowScale).toBeGreaterThan(plain.windowScale);
    expect(star.evBonus).toBeGreaterThan(plain.evBonus);
    const strong = cpuSwingInputs('pro', null, 1.5, CONFIG), weakT = cpuSwingInputs('pro', null, -1.5, CONFIG);
    expect(strong.evBonus).toBeGreaterThan(weakT.evBonus);
    expect(strong.windowScale).toBeGreaterThan(weakT.windowScale);
  });
});
