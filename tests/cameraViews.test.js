// The camera while you pitch and the computer has hit the ball (pure maths, no three.js): cameraViews.fieldView.
import { describe, it, expect } from 'vitest';
import { CONFIG } from '../src/config.js';
import { fieldView } from '../src/render/cameraViews.js';
import { simulateBattedBall } from '../src/physics/ballistics.js';
import { createDefense, sampleBall } from '../src/game/fielding.js';
import { createRng } from '../src/util/rng.js';

const DEG = Math.PI / 180;
const angleFromAxis = (v, p) => {
  const a = [p.x - v.pos[0], p.y - v.pos[1], p.z - v.pos[2]];
  const b = [v.look[0] - v.pos[0], v.look[1] - v.pos[1], v.look[2] - v.pos[2]];
  const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  return Math.acos(Math.min(1, dot / (Math.hypot(...a) * Math.hypot(...b)))) / DEG;
};

describe('fieldView (behind home plate, looking out)', () => {
  // a few dozen batted balls of every kind; the nearest fielder runs straight toward where the ball is
  const rng = createRng(9);
  const defense = createDefense();
  const balls = [];
  for (let i = 0; i < 40; i++) {
    const la = rng.range(-12, 70), ev = rng.range(55, 105), spray = rng.range(-44, 44);
    balls.push(simulateBattedBall({ exitVelocity: ev, launchAngle: la, sprayAngle: spray, backspin: 900 + 55 * Math.max(la, 0), hook: 0, start: { x: 0, y: 2.6, z: -1 } }));
  }
  it('keeps the ball and the man after it in the picture, stays behind the plate side, low, and looks out', () => {
    const bad = [];
    for (const [n, sim] of balls.entries()) {
      const land = sampleBall(sim, sim.duration);
      let f = null;
      for (const pos of ['P', '1B', '2B', 'SS', '3B', 'LF', 'CF', 'RF']) { const q = defense[pos]; const d = Math.hypot(q.x - land.x, q.z - land.z); if (!f || d < f.d) f = { q, d }; }
      for (const t of [0.2, 0.8, 1.6, 3, 5]) {
        if (t > sim.duration) continue;
        const ball = sampleBall(sim, t);
        const k = Math.min(1, t / Math.max(1, sim.duration));
        const man = { x: f.q.x + (land.x - f.q.x) * k, y: 3, z: f.q.z + (land.z - f.q.z) * k };
        const v = fieldView(ball, [[man.x, man.y, man.z]], CONFIG, { x: land.x, z: land.z });
        if (v.pos[1] > CONFIG.camera.fieldView.up[1] + CONFIG.camera.fieldView.popUp + 1e-6) bad.push(`ball ${n} t=${t}: too high (${v.pos[1].toFixed(0)} ft)`);
        if (!(v.look[2] < v.pos[2])) bad.push(`ball ${n} t=${t}: not looking out`);
        if (ball.y < CONFIG.camera.fieldView.ballOnlyAbove && angleFromAxis(v, ball) > v.fov / 2 - 1) bad.push(`ball ${n} t=${t}: lost the ball (${angleFromAxis(v, ball).toFixed(1)} of ${v.fov.toFixed(1)})`);
        if (angleFromAxis(v, man) > v.fov / 2 - 1) bad.push(`ball ${n} t=${t}: lost the fielder`);
      }
    }
    expect(bad).toEqual([]);
  });
  it('is close on a ball far out: a narrow view, the ball a good size', () => {
    const v = fieldView({ x: 0, y: 30, z: -300 }, [[10, 3, -310]], CONFIG);
    expect(v.fov).toBeLessThan(26);
  });
});
