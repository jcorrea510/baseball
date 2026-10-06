// The camera that follows the ball after the computer's contact while you pitch (pure maths, no three.js).
import { describe, it, expect } from 'vitest';
import { CONFIG } from '../src/config.js';
import { pitchHitView, playView, homerView } from '../src/render/cameraViews.js';
import { BASE_XZ, fenceDistance, sprayOf } from '../src/physics/field.js';
import { createDefense } from '../src/game/fielding.js';

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

  it('a high pop-up over the infield keeps the grass under it in the picture too (not only sky)', () => {
    const bad = [];
    const plan = { homer: false, ballLandDistance: 60, ballHitEnd: 5 };
    for (const ball of [{ x: 0, y: 110, z: -60 }, { x: 10, y: 90, z: -45 }, { x: -15, y: 100, z: -80 }]) {
      for (const t of [1, 2.5]) for (const hand of ['R', 'L']) {
        const v = pitchHitView(ball, t, plan, hand, CONFIG);
        const ground = { x: ball.x, y: 0, z: ball.z };
        for (const [what, pt] of [['ball', ball], ['grass', ground]]) {
          const off = angleFromAxis(v, pt);
          if (!(off < v.fov / 2)) bad.push(`${what} at (${ball.x},${ball.y},${ball.z}) t=${t} ${hand}: ${off.toFixed(1)} deg of ${(v.fov / 2).toFixed(1)}`);
        }
        if (!(v.pos[2] < 0)) bad.push(`behind the plate at t=${t}`);
      }
    }
    expect(bad).toEqual([]);
  });
});

describe('playView (the computer hit it: the play filmed from the outfield side, looking in)', () => {
  const defense = createDefense();
  const bases = [1, 2, 3, 4].map((b) => [BASE_XZ[b][0], 0, BASE_XZ[b][1]]);
  const spots = [
    ...['P', 'C', '1B', '2B', 'SS', '3B', 'LF', 'CF', 'RF'].map((pos) => ({ name: pos, x: defense[pos].x, z: defense[pos].z })),
    { name: 'left-field corner', x: -215, z: -230 }, { name: 'deep center', x: 0, z: -385 }, { name: 'right-field line', x: 200, z: -215 },
    { name: 'bunt up the first-base line', x: 18, z: -28 }, { name: 'foul pop behind home', x: 6, z: 30 }, { name: 'home run to left (where it leaves)', x: -235, z: -270 },
  ];
  it('keeps the spot and every base in the picture, from further out than the spot (looking in), up high', () => {
    const bad = [];
    for (const f of spots) {
      const v = playView(f, [bases[3]], CONFIG, bases.slice(0, 3));
      // (the bases away from the play are kept in only when they fit: always but for a ball at the wall in the deepest part)
      const deep = Math.hypot(f.x, f.z) > fenceDistance(sprayOf(f.x, f.z)) - 25;
      const must = [['spot', { x: f.x, y: 3, z: f.z }], ['home', { x: 0, y: 0, z: 0 }], ...(deep ? [] : bases.map((b, i) => [`base ${i + 1}`, { x: b[0], y: 0, z: b[2] }]))];
      for (const [name, q] of must) {
        const off = angleFromAxis(v, q);
        if (!(off < v.fov / 2 - 2)) bad.push(`${f.name} ${name}: ${off.toFixed(1)} deg of ${v.fov.toFixed(1)}`);
      }
      if (!(v.fov <= CONFIG.camera.playView.maxFov + 1e-9)) bad.push(`${f.name}: fov ${v.fov}`);
      const R = Math.hypot(v.pos[0], v.pos[2]), wall = fenceDistance(sprayOf(v.pos[0], v.pos[2]));
      if (!(R > Math.min(Math.hypot(f.x, f.z), wall - CONFIG.camera.playView.wallGap - 1))) bad.push(`${f.name}: the camera is not further out than the spot (or at the wall)`);
      const PV = CONFIG.camera.playView;
      if (!(R < wall - 5 || (R <= wall + PV.overWall + 1e-6 && v.pos[1] >= PV.overUp - 1e-6))) bad.push(`${f.name}: the camera is in the stands (${R.toFixed(0)} ft, wall ${wall.toFixed(0)}, ${v.pos[1].toFixed(0)} ft up)`);
      if (!(v.pos[2] < -100)) bad.push(`${f.name}: the camera is not out past the infield (z ${v.pos[2].toFixed(0)})`);
      if (!(v.look[2] > v.pos[2])) bad.push(`${f.name}: not looking in`);
      if (!(v.pos[1] > 20)) bad.push(`${f.name}: too low`);
    }
    expect(bad).toEqual([]);
  });
  it('keeps the ball in the picture too, all the way from the bat to the glove', () => {
    const f = { x: -150, z: -250 };
    for (const k of [0, 0.3, 0.6, 0.95]) {
      const ball = { x: f.x * k, y: 3 + 90 * Math.sin(Math.PI * k), z: f.z * k };
      const v = playView(f, [bases[3], [ball.x, ball.y, ball.z]], CONFIG, bases.slice(0, 3));
      expect(angleFromAxis(v, ball)).toBeLessThan(v.fov / 2 - 2);
    }
  });
});

describe('homerView (a home run while you pitch)', () => {
  it('follows the ball toward you with home in the picture, lets it go overhead, never turns round', () => {
    const P = CONFIG.camera.pitcher.pos;
    const bad = [];
    for (const k of [0.05, 0.2, 0.4, 0.6, 0.8, 0.95]) {
      const ball = { x: -40 * k, y: 3 + 110 * Math.sin(Math.PI * Math.min(1, k * 0.8)), z: -390 * k };
      const v = homerView(ball, k * 4, 'R', CONFIG);
      if (!(v.look[2] > v.pos[2])) bad.push(`k=${k}: looking away from home`);
      if (v.pos[0] !== P[0] || v.pos[2] !== P[2]) bad.push(`k=${k}: the camera moved sideways`);
      if (angleFromAxis(v, { x: 0, y: 0, z: 0 }) > v.fov / 2) bad.push(`k=${k}: home is out of the picture`);
      const following = ball.z - v.pos[2] > CONFIG.camera.homerView.letGoAhead && v.fov !== CONFIG.camera.homerView.fovAfter;
      if (following && angleFromAxis(v, ball) > v.fov / 2 - 2) bad.push(`k=${k}: lost the ball while following it`);
    }
    expect(bad).toEqual([]);
  });
});
