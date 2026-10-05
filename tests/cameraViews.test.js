// The camera that follows the ball after the computer's contact while you pitch (pure maths, no three.js).
import { describe, it, expect } from 'vitest';
import { CONFIG } from '../src/config.js';
import { pitchHitView } from '../src/render/cameraViews.js';

const DEG = Math.PI / 180;
const balls = [
  { name: 'grounder', ball: { x: 0, y: 1, z: -30 }, plan: { homer: false, ballLandDistance: 30, ballHitEnd: 4 } },
  { name: 'liner', ball: { x: 60, y: 40, z: -150 }, plan: { homer: false, ballLandDistance: 220, ballHitEnd: 4 } },
  { name: 'fly', ball: { x: 0, y: 120, z: -260 }, plan: { homer: false, ballLandDistance: 330, ballHitEnd: 6 } },
  { name: 'homer', ball: { x: 0, y: 60, z: -420 }, plan: { homer: true, ballLandDistance: 0, ballHitEnd: 5 } },
];
const angleFromAxis = (v, ball) => {
  const a = [ball.x - v.pos[0], ball.y - v.pos[1], ball.z - v.pos[2]];
  const b = [v.look[0] - v.pos[0], v.look[1] - v.pos[1], v.look[2] - v.pos[2]];
  const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  return Math.acos(Math.min(1, dot / (Math.hypot(...a) * Math.hypot(...b)))) / DEG;
};

describe('pitchHitView', () => {
  it('keeps the ball inside the picture (4 degrees to spare)', () => {
    const bad = [];
    for (const b of balls) for (const t of [0.2, 1, 3]) for (const hand of ['R', 'L']) {
      const v = pitchHitView(b.ball, t, b.plan, hand, CONFIG);
      const off = angleFromAxis(v, b.ball);
      if (!(off < v.fov / 2 - 4)) bad.push(`${b.name} t=${t} ${hand}: ${off.toFixed(1)} deg of ${v.fov.toFixed(1)}`);
    }
    expect(bad).toEqual([]);
  });

  it('never goes behind home plate', () => {
    for (const b of balls) for (const t of [0, 0.2, 1, 2, 3, 6]) {
      expect(pitchHitView(b.ball, t, b.plan, 'R', CONFIG).pos[2]).toBeLessThan(0);
    }
  });

  it('starts exactly where the pitching view is (no jump) and rises from there', () => {
    const P = CONFIG.camera.pitcher.pos;
    const R = pitchHitView(balls[0].ball, 0, balls[0].plan, 'R', CONFIG);
    expect(R.pos).toEqual([P[0], P[1], P[2]]);
    const L = pitchHitView(balls[0].ball, 0, balls[0].plan, 'L', CONFIG);
    expect(L.pos).toEqual([-P[0], P[1], P[2]]);
    const later = pitchHitView(balls[0].ball, 3, balls[0].plan, 'R', CONFIG);
    expect(later.pos[1]).toBeGreaterThan(P[1] + 10);
    expect(later.pos[2]).toBeLessThan(P[2]);
  });

  it('is the mirror image for a left-hander', () => {
    const ball = { x: 50, y: 30, z: -140 };
    const R = pitchHitView(ball, 1, balls[1].plan, 'R', CONFIG);
    const L = pitchHitView({ ...ball, x: -ball.x }, 1, balls[1].plan, 'L', CONFIG); // (the same play seen from the other side)
    expect(L.look[0]).toBeCloseTo(-R.look[0], 6);
    expect(L.pos[0]).toBeCloseTo(-R.pos[0], 6);
    expect(L.pos[1]).toBeCloseTo(R.pos[1], 6);
    expect(L.pos[2]).toBeCloseTo(R.pos[2], 6);
    expect(L.fov).toBeCloseTo(R.fov, 6);
  });

  it('widens near and narrows far, and a home run in the seats looks up', () => {
    const near = pitchHitView({ x: 0, y: 2, z: -40 }, 0.5, balls[0].plan, 'R', CONFIG);
    const far = pitchHitView({ x: 0, y: 40, z: -400 }, 3, balls[2].plan, 'R', CONFIG);
    expect(near.fov).toBeGreaterThan(far.fov);
    const seats = { x: 10, y: 30, z: -420 };
    const up = pitchHitView(seats, 6, { homer: true, ballHitEnd: 5 }, 'R', CONFIG);
    const flying = pitchHitView(seats, 4, { homer: true, ballHitEnd: 5 }, 'R', CONFIG);
    expect(up.look[1]).toBeGreaterThan(flying.look[1] + 10);
  });
});
