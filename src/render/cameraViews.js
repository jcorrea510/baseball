// Pure camera maths (no three.js): where the camera goes and what it looks at in the special views.
import { CONFIG } from '../config.js';
import { lerp, smoothstep, DEG } from '../util/math.js';

// You are pitching and the computer has hit the ball: the camera starts exactly where the pitching view was (behind and above the
// mound) and rises up and back toward the outfield, always looking at the ball, so it never cuts to home plate.
//   ball = {x, y, z} the ball now, t = seconds since contact, plan = the engine's play plan, hand = 'L' | 'R' (mirrors x).
// -> { pos: [x, y, z], look: [x, y, z], fov }
export function pitchHitView(ball, t, plan, hand, cfg = CONFIG) {
  const H = cfg.camera.pitchHit;
  const P = cfg.camera.pitcher.pos;
  const m = hand === 'L' ? -1 : 1;
  const k = smoothstep(0, H.riseTime, t);
  // toward the outfield = more negative z, so the eye stays in front of home plate (z < 0) however far it climbs
  // a ball way up and not far from home (a pop-up, a high fly) also pulls the eye further up and back, scaled by the same climb so
  // t = 0 is still exactly the pitching view: from higher and further away the ball and the grass under it fit in one picture
  const pull = smoothstep(H.pullFrom[0], H.pullFrom[1], ball.y) * (1 - smoothstep(H.pullNear[0], H.pullNear[1], Math.hypot(ball.x, ball.z))) * k;
  const pos = [P[0] * m, P[1] + H.rise[0] * k + H.pull[0] * pull, P[2] - H.rise[1] * k - H.pull[1] * pull];
  let look = [ball.x, Math.max(1.5, ball.y), ball.z];
  if (plan && plan.homer && t > plan.ballHitEnd) {
    // the ball is in the seats: look up at the crowd and the fireworks
    look = [ball.x * 0.9, ball.y + H.homerLook, ball.z * 0.9];
  }
  const dist = Math.hypot(ball.x - pos[0], ball.y - pos[1], ball.z - pos[2]);
  let fov = lerp(H.fovNear, H.fovFar, smoothstep(0, H.farFeet, dist));
  // a ball high in the air: aim part of the way down toward the grass under it, so the ballpark stays in the picture and not only sky;
  // the view widens until the ball AND that grass still fit (with keepBall's margin to spare), and if even the widest view
  // (keepBall's maxFov) cannot hold them the aim creeps back toward the ball
  if (!(plan && plan.homer && t > plan.ballHitEnd)) {
    const K = cfg.camera.keepBall;
    const high = ball.y > H.lowFrom[0];
    let found = false;
    let low = H.lowLook * smoothstep(H.lowFrom[0], H.lowFrom[1], ball.y);
    for (let i = 0; i < 12; i++) {
      const aim = [ball.x, Math.max(1.5, lerp(ball.y, 4, low)), ball.z];
      let half = angleBetween(pos, [ball.x, ball.y, ball.z], aim) + K.marginDeg;
      if (high) half = Math.max(half, angleBetween(pos, [ball.x, 0, ball.z], aim) + H.grassMarginDeg);
      const need = 2 * half;
      if (need <= K.maxFov || low < 0.01) { look = aim; fov = Math.min(K.maxFov, Math.max(fov, need)); found = true; break; }
      low *= 0.8;
    }
    if (!found) { look = [ball.x, Math.max(1.5, ball.y), ball.z]; fov = Math.min(K.maxFov, Math.max(fov, 2 * (K.marginDeg))); }
  }
  return { pos, look, fov };
}

// the angle (degrees) at `from` between the directions to two points
function angleBetween(from, a, b) {
  const u = [a[0] - from[0], a[1] - from[1], a[2] - from[2]];
  const v = [b[0] - from[0], b[1] - from[1], b[2] - from[2]];
  const c = (u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / (Math.hypot(...u) * Math.hypot(...v) || 1);
  return Math.acos(Math.max(-1, Math.min(1, c))) / DEG;
}
