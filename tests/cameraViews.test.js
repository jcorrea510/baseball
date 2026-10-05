// The camera that follows the ball after the computer's contact while you pitch (pure maths, no three.js).
import { describe, it, expect } from 'vitest';
import { CONFIG } from '../src/config.js';
import { pitchHitView, chaseView, chaseYaw, screenToField } from '../src/render/cameraViews.js';
import { simulateBattedBall } from '../src/physics/ballistics.js';
import { createDefense, sampleBall } from '../src/game/fielding.js';
import { landingSpot } from '../src/game/landing.js';
import { createRng } from '../src/util/rng.js';

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

describe('chaseView (you steer an outfielder)', () => {
  // a dozen fly balls to the outfield; the fielder runs straight from his spot toward the landing spot
  const rng = createRng(4);
  const defense = createDefense();
  const plays = [];
  while (plays.length < 12) {
    const la = rng.range(18, 45), ev = rng.range(78, 100), spray = rng.range(-42, 42);
    const sim = simulateBattedBall({ exitVelocity: ev, launchAngle: la, sprayAngle: spray, backspin: 900 + 55 * la, hook: 0, start: { x: 0, y: 2.6, z: -1 } });
    const land = landingSpot(sim, null);
    if (!land || Math.hypot(land.x, land.z) < 180) continue;
    const pos = land.x < -60 ? 'LF' : land.x > 60 ? 'RF' : 'CF';
    plays.push({ sim, land, f: defense[pos] });
  }
  it('keeps him, the landing spot and (once it is out in front) the ball in the picture, and never turns', () => {
    const bad = [];
    let seen = 0;
    for (const [n, p] of plays.entries()) {
      const yaw0 = chaseView(p.f, sampleBall(p.sim, 0), p.land).yaw;
      for (const t of [0, 1, 2.5, p.land.tLand - 0.6, p.land.tLand - 0.2]) {
        const k = Math.min(1, t / p.land.tLand);
        const fielder = { x: p.f.x + (p.land.x - p.f.x) * k, z: p.f.z + (p.land.z - p.f.z) * k };
        const ball = sampleBall(p.sim, Math.min(t, p.sim.duration));
        const v = chaseView(fielder, ball, p.land);
        if (Math.abs(v.yaw - yaw0) > 1e-9) bad.push(`ball ${n} t=${t}: it turned`);
        const out = (ball.x - v.pos[0]) * Math.sin(v.yaw) - (ball.z - v.pos[2]) * Math.cos(v.yaw) > CONFIG.camera.chase.ballAhead + 1;
        const must = [['fielder', { x: fielder.x, y: 3, z: fielder.z }], ['landing', { x: p.land.x, y: 0, z: p.land.z }]];
        if (out) { must.push(['ball', ball]); seen++; }
        for (const [name, q] of must) {
          const off = angleFromAxis(v, q);
          if (!(off < v.fov / 2 - 4)) bad.push(`ball ${n} t=${t} ${name}: ${off.toFixed(1)} deg of ${v.fov.toFixed(1)}`);
        }
        if (!(v.pos[2] > fielder.z)) bad.push(`ball ${n} t=${t}: the camera is not on the home side of him`);
      }
    }
    expect(bad).toEqual([]);
    expect(seen).toBeGreaterThan(8); // (the ball out in front in a fair share of the moments checked)
  });
  it('up on the screen points from home toward the landing spot; the stick turns with it', () => {
    for (const p of plays) {
      const yaw = chaseYaw(p.land);
      const [ux, uz] = screenToField(0, 1, yaw);
      const d = Math.hypot(p.land.x, p.land.z);
      expect((ux * p.land.x + uz * p.land.z) / d).toBeGreaterThan(0.99);
      const [rx, rz] = screenToField(1, 0, yaw);
      expect(Math.abs(rx * ux + rz * uz)).toBeLessThan(1e-9); // (right is square to up)
      expect(rx * -uz + rz * ux).toBeGreaterThan(0); // ...and to the right of it as seen from home (toward right field for a ball to center)
    }
    const [x, z] = screenToField(1, 0, 0);
    expect(x).toBeCloseTo(1, 9); expect(z).toBeCloseTo(0, 9);
  });
});
