// The swing: the bat-ball collision (physics/bat.js) and how a timed, aimed swing becomes a batted ball (game/contact.js).
import { describe, it, expect } from 'vitest';
import { CONFIG, MPH } from '../src/config.js';
import { collide, hitBall } from '../src/physics/bat.js';
import { computeSwing, computeBunt, contactWindow, contactPoint, batOffset } from '../src/game/contact.js';
import { buildPitch } from '../src/physics/pitch.js';
import { simulateBattedBall, projectDistance } from '../src/physics/ballistics.js';
import { createRng } from '../src/util/rng.js';

const IN = 1 / 12;
const B = CONFIG.bat, R = CONFIG.physics.ballRadius;
const pitchIn = (mph = 90) => ({ x: 0, y: -0.12 * mph * MPH, z: mph * MPH * 0.99 }); // a pitch coming in, dropping a little
const hit = (offsetIn, o = {}) => hitBall({ offset: offsetIn * IN, batSpeed: (o.bat ?? 72) * MPH, heading: (o.heading ?? 0) * Math.PI / 180, attack: (o.attack ?? 10) * Math.PI / 180, vBall: o.vBall ?? pitchIn(o.pitch ?? 90), wBall: o.wBall });

describe('the collision (physics/bat.js)', () => {
  it('head on, square: exit speed = q x pitch speed + (1 + q) x bat speed, with q = (e - r) / (1 + r)', () => {
    const vp = 90 * MPH, vb = 70 * MPH;
    const r = collide({ vBat: { x: 0, y: 0, z: -vb }, vBall: { x: 0, y: 0, z: vp }, n: { x: 0, y: 0, z: -1 }, e: 0.5, r: 0.25, mu: 0.5, slipKeep: 0.7, R });
    const q = (0.5 - 0.25) / 1.25;
    expect(-r.v.z / MPH).toBeCloseTo(q * 90 + (1 + q) * 70, 6);
    expect(Math.abs(r.v.x) + Math.abs(r.v.y)).toBeLessThan(1e-9);
    expect(Math.hypot(r.w.x, r.w.y, r.w.z)).toBeLessThan(1e-9); // square on: no spin
  });

  it('a perfectly bouncy collision with an immovable bat sends the ball back as fast as it came, relative to the bat', () => {
    const r = collide({ vBat: { x: 0, y: 0, z: -50 }, vBall: { x: 0, y: 0, z: 130 }, n: { x: 0, y: 0, z: -1 }, e: 1, r: 0, mu: 0, slipKeep: 1, R });
    expect(r.v.z).toBeCloseTo(-50 - 180, 6);
  });

  it('friction never takes more than mu x the normal impulse', () => {
    const n = { x: 0, y: Math.sin(0.6), z: -Math.cos(0.6) };
    const r = collide({ vBat: { x: 0, y: 0, z: -100 }, vBall: { x: 0, y: 0, z: 130 }, n, e: 0.5, r: 0.25, mu: 0.1, slipKeep: 0, R });
    const Jn = -(1.5 * ((130 + 100) * -Math.cos(0.6))) / 1.25;
    const dv = { x: r.v.x, y: r.v.y, z: r.v.z - 130 };
    const along = dv.x * n.x + dv.y * n.y + dv.z * n.z;
    const across = Math.hypot(dv.x - along * n.x, dv.y - along * n.y, dv.z - along * n.z);
    expect(along).toBeCloseTo(Jn, 6);
    expect(across).toBeLessThanOrEqual(0.1 * Jn + 1e-9);
  });

  it('the bat under the ball sends it up with backspin; on top of it, down with topspin; square, a flat line drive', () => {
    const under = hit(1), square = hit(0), top = hit(-1);
    expect(under.launchAngle).toBeGreaterThan(25);
    expect(under.launchAngle).toBeLessThan(42);
    expect(under.backspin).toBeGreaterThan(1500);
    expect(square.launchAngle).toBeGreaterThan(2);
    expect(square.launchAngle).toBeLessThan(16);
    expect(top.launchAngle).toBeLessThan(-5);
    expect(top.backspin).toBeLessThan(-1000); // topspin
  });

  it('launch angle and backspin climb steadily the further under the ball the bat is', () => {
    let la = -Infinity, sp = -Infinity;
    for (let d = -1.5; d <= 2; d += 0.25) {
      const h = hit(d);
      expect(h.launchAngle).toBeGreaterThan(la);
      expect(h.backspin).toBeGreaterThan(sp - 1);
      la = h.launchAngle; sp = h.backspin;
    }
  });

  it('the hardest-hit ball is the squared-up one; the more glancing the contact, the softer', () => {
    const ev = (d) => hit(d).exitVelocity;
    expect(ev(0)).toBeGreaterThan(ev(0.75));
    expect(ev(0.75)).toBeGreaterThan(ev(1.5));
    expect(ev(0)).toBeGreaterThan(ev(-0.75));
    expect(ev(1.5)).toBeGreaterThan(ev(2.25));
  });

  it('matches the measured bat-ball numbers: ~1 in under the middle is a ~30 deg, ~2,500 rpm, ~380+ ft drive', () => {
    const h = hit(1, { bat: 72, pitch: 90 });
    expect(h.exitVelocity).toBeGreaterThan(94);
    expect(h.exitVelocity).toBeLessThan(102);
    expect(h.backspin).toBeGreaterThan(1800);
    expect(h.backspin).toBeLessThan(3400);
    const d = projectDistance({ exitVelocity: h.exitVelocity, launchAngle: h.launchAngle, sprayAngle: 0, backspin: h.backspin, hook: 0, start: { x: 0, y: 3, z: -1 } }).distance;
    expect(d).toBeGreaterThan(355);
    expect(d).toBeLessThan(420);
  });

  it('backspin carries: the same ball with its spin goes further than without it', () => {
    const h = hit(0.9);
    const p = { exitVelocity: h.exitVelocity, launchAngle: h.launchAngle, sprayAngle: 0, hook: 0, start: { x: 0, y: 3, z: -1 } };
    expect(projectDistance({ ...p, backspin: h.backspin }).distance).toBeGreaterThan(projectDistance({ ...p, backspin: 0 }).distance + 15);
  });

  it('a faster swing and a faster pitch both hit it harder', () => {
    expect(hit(0, { bat: 76 }).exitVelocity).toBeGreaterThan(hit(0, { bat: 70 }).exitVelocity + 6);
    expect(hit(0, { pitch: 96 }).exitVelocity).toBeGreaterThan(hit(0, { pitch: 80 }).exitVelocity + 2);
  });

  it('the barrel facing left field sends the ball to left field', () => {
    expect(hit(0.5, { heading: -25 }).sprayAngle).toBeLessThan(-18);
    expect(hit(0.5, { heading: 25 }).sprayAngle).toBeGreaterThan(18);
  });

  it('the pitch\'s own spin only nudges the batted ball\'s spin (the grip on the bat decides it, as measured)', () => {
    const fb = hit(0.5, { wBall: { x: -230, y: 0, z: 0 } }), cb = hit(0.5, { wBall: { x: 260, y: 0, z: 0 } }), none = hit(0.5);
    expect(Math.abs(cb.backspin - fb.backspin)).toBeLessThan(900);
    expect(Math.abs(cb.launchAngle - none.launchAngle)).toBeLessThan(6);
  });
});

// ---------------------------------------------------------------------------------------------------------------
const win = contactWindow('pro');
const flight = buildPitch({ type: 'fastball', speedMph: 88, hand: 'R', target: { x: 0, y: 2.5 } });
const pt = contactPoint(flight, flight.T, flight.T);
const swing = (o = {}) => {
  const rng = createRng(o.seed ?? 3);
  const u = o.u ?? 0.3, w = o.w ?? 0;
  const ball = o.ball ?? pt.ball;
  const hand = o.hand ?? 'R';
  const aim = o.aim ?? { x: ball.x - (w >= 0 ? w * win.tip : w * win.handle) * (hand === 'L' ? -1 : 1), y: ball.y - u * win.up };
  return computeSwing({ errorMs: o.err ?? 0, aim, ball, vBall: o.vBall ?? pt.vBall, wBall: pt.wBall, window: o.window ?? win, windowScale: 1, batterHand: hand, evBonus: o.evBonus, rng }, CONFIG);
};
const flightOf = (c, y = 2.5) => simulateBattedBall({ exitVelocity: c.exitVelocity, launchAngle: c.launchAngle, sprayAngle: c.sprayAngle, backspin: c.backspin, hook: c.hook, start: { x: 0, y, z: -1 } });

describe('the swing (game/contact.js)', () => {
  it('where the bat is against the ball: under / over and toward the end of the bat or the hands, for both sides', () => {
    expect(batOffset({ x: 0, y: 2.6 }, { x: 0, y: 2.5 }, 'R', win).u).toBeCloseTo(0.1 / win.up, 9);
    expect(batOffset({ x: 0.3, y: 2.5 }, { x: 0, y: 2.5 }, 'R', win).w).toBeGreaterThan(0); // a right-hander's bat reaches toward +x
    expect(batOffset({ x: 0.3, y: 2.5 }, { x: 0, y: 2.5 }, 'L', win).w).toBeLessThan(0);
  });

  it('a perfect swing a little under the ball is a long fly ball', () => {
    const c = swing({ u: 0.3 });
    expect(c.made).toBe(true);
    expect(c.grade).toBe('perfect');
    expect(c.launchAngle).toBeGreaterThan(22);
    expect(c.launchAngle).toBeLessThan(40);
    expect(c.exitVelocity).toBeGreaterThan(98);
    const s = flightOf(c);
    expect(Math.hypot(s.firstBounce?.x ?? s.homerun.x, s.firstBounce?.z ?? s.homerun.z)).toBeGreaterThan(330);
  });

  it('square in the middle: the hardest-hit ball, a line drive', () => {
    const c = swing({ u: 0 });
    expect(c.launchAngle).toBeGreaterThan(0);
    expect(c.launchAngle).toBeLessThan(17);
    expect(c.exitVelocity).toBeGreaterThan(swing({ u: 0.3 }).exitVelocity);
  });

  it('on top of the ball: a grounder with topspin', () => {
    const c = swing({ u: -0.5 });
    expect(c.made).toBe(true);
    expect(c.launchAngle).toBeLessThan(-5);
    expect(c.backspin).toBeLessThan(0);
  });

  it('too far under: a pop-up; too far under or over the window: a swing and a miss', () => {
    expect(swing({ u: 0.7 }).launchAngle).toBeGreaterThan(50);
    const under = swing({ u: 1.1 }), over = swing({ u: -1.1 });
    expect(under.made).toBe(false); expect(under.reason).toBe('under');
    expect(over.made).toBe(false); expect(over.reason).toBe('over');
  });

  it('past the end of the bat or in behind the hands is a miss; off the sweet spot is softer', () => {
    expect(swing({ w: 1.1 }).made).toBe(false);
    expect(swing({ w: -1.1 }).made).toBe(false);
    expect(swing({ u: 0, w: 0.85 }).exitVelocity).toBeLessThan(swing({ u: 0, w: 0 }).exitVelocity - 8);
    expect(swing({ u: 0, w: -0.85 }).exitVelocity).toBeLessThan(swing({ u: 0, w: 0 }).exitVelocity - 8);
    expect(swing({ u: 0.2, w: 0.85 }).grade).not.toBe('perfect');
  });

  it('way off timing is a miss, whatever the aim', () => {
    expect(swing({ err: 200 }).made).toBe(false);
    expect(swing({ err: -200 }).made).toBe(false);
    expect(swing({ err: 200 }).reason).toBe('timing');
  });

  it('early swings are pulled, late ones go the other way (right-handed: early to left field; left-handed: mirrored)', () => {
    expect(swing({ err: -40 }).sprayAngle).toBeLessThan(-15);
    expect(swing({ err: 40 }).sprayAngle).toBeGreaterThan(5);
    expect(swing({ err: -40, hand: 'L' }).sprayAngle).toBeGreaterThan(15);
    expect(swing({ err: 40, hand: 'L' }).sprayAngle).toBeLessThan(-5);
  });

  it('a perfect swing is hit a little toward the pull side, and harder than a mistimed one', () => {
    const p = swing({ u: 0.2 });
    expect(p.sprayAngle).toBeLessThan(0);
    expect(p.sprayAngle).toBeGreaterThan(-26);
    expect(p.exitVelocity).toBeGreaterThan(swing({ u: 0.2, err: 35 }).exitVelocity + 3);
    expect(swing({ u: 0.2, err: 35 }).exitVelocity).toBeGreaterThan(swing({ u: 0.2, err: -70 }).exitVelocity + 5);
  });

  it('more power (a Power rating, the Derby) is more exit speed', () => {
    expect(swing({ u: 0, evBonus: 6 }).exitVelocity).toBeGreaterThan(swing({ u: 0 }).exitVelocity + 4);
  });

  it('reaching for a pitch well out of the zone costs a lot of power, and is never graded perfect', () => {
    const far = buildPitch({ type: 'fastball', speedMph: 88, hand: 'R', target: { x: 1.45, y: 2.5 } });
    const fp = contactPoint(far, far.T, far.T);
    const c = swing({ u: 0, ball: fp.ball, vBall: fp.vBall });
    expect(c.made).toBe(true);
    expect(c.exitVelocity).toBeLessThan(swing({ u: 0 }).exitVelocity - 10);
    expect(c.grade).not.toBe('perfect');
  });

  it('a low pitch gets an uppercut, a high one a flatter swing', () => {
    expect(swing({ u: 0.2, ball: { x: 0, y: 1.8 } }).attack).toBeGreaterThan(swing({ u: 0.2, ball: { x: 0, y: 3.3 } }).attack + 5);
  });

  it('the same swing on the same pitch always does the same thing (one random source)', () => {
    expect(swing({ seed: 9 })).toEqual(swing({ seed: 9 }));
  });

  it('stays inside physical limits over thousands of random swings', () => {
    const rng = createRng(11);
    for (let k = 0; k < 3000; k++) {
      const c = swing({ u: rng.range(-1, 1), w: rng.range(-1, 1), err: rng.range(-90, 70), seed: k });
      if (!c.made) continue;
      expect(c.exitVelocity).toBeLessThanOrEqual(125);
      expect(c.exitVelocity).toBeGreaterThan(5);
      expect(c.launchAngle).toBeGreaterThanOrEqual(-80);
      expect(c.launchAngle).toBeLessThanOrEqual(85);
      expect(Number.isFinite(c.sprayAngle) && Number.isFinite(c.backspin) && Number.isFinite(c.hook)).toBe(true);
    }
  });

  it('an early swing meets the ball higher, but the swing is on plane: only a little of that counts', () => {
    const early = contactPoint(flight, flight.T - 0.03, flight.T - 0.06);
    const exact = flight.at(flight.T - 0.06).y - flight.at(flight.T).y;
    expect(early.ball.y - pt.ball.y).toBeGreaterThan(0);
    expect(early.ball.y - pt.ball.y).toBeLessThan(exact * 0.3);
  });
});

describe('bunting', () => {
  const bunt = (u, err = 0, seed = 1) => computeBunt({ errorMs: err, ball: pt.ball, aim: { x: pt.ball.x, y: pt.ball.y - u * win.up * CONFIG.bunt.windowScale }, window: win, batterHand: 'R', rng: createRng(seed) });
  it('the bat on top of the ball pushes it down into the grass; under it, it pops up', () => {
    let down = 0, up = 0;
    for (let s = 1; s <= 40; s++) { down += bunt(-0.4, 0, s).launchAngle; up += bunt(0.6, 0, s).launchAngle; }
    expect(down / 40).toBeLessThan(-3);
    expect(up / 40).toBeGreaterThan(15);
  });
  it('a bunt is soft, and misses when the bat is nowhere near the ball or way off in time', () => {
    const b = bunt(-0.2);
    expect(b.made).toBe(true);
    expect(b.exitVelocity).toBeLessThan(55);
    expect(bunt(1.3).made).toBe(false);
    expect(bunt(0, 400).made).toBe(false);
  });
});
