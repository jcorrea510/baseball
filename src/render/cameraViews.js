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
  const pos = [P[0] * m, P[1] + H.rise[0] * k, P[2] - H.rise[1] * k];
  let look = [ball.x, Math.max(1.5, ball.y), ball.z];
  if (plan && plan.homer && t > plan.ballHitEnd) {
    // the ball is in the seats: look up at the crowd and the fireworks
    look = [ball.x * 0.9, ball.y + H.homerLook, ball.z * 0.9];
  }
  const dist = Math.hypot(ball.x - pos[0], ball.y - pos[1], ball.z - pos[2]);
  let fov = lerp(H.fovNear, H.fovFar, smoothstep(0, H.farFeet, dist));
  // a ball high in the air: aim part of the way down toward the grass under it, so the ballpark stays in the picture and not only sky;
  // the view widens until the ball still fits (with `fitMarginDeg` to spare), and if even the widest view (`fovMax`) cannot hold it
  // the aim creeps back toward the ball
  if (!(plan && plan.homer && t > plan.ballHitEnd)) {
    let low = H.lowLook * smoothstep(H.lowFrom[0], H.lowFrom[1], ball.y);
    for (let i = 0; i < 6; i++) {
      const ly = lerp(ball.y, 4, low);
      const off = angleBetween(pos, [ball.x, ball.y, ball.z], [ball.x, Math.max(1.5, ly), ball.z]);
      const need = 2 * (off + H.fitMarginDeg);
      if (need <= H.fovMax || low < 0.01) { look = [ball.x, Math.max(1.5, ly), ball.z]; fov = Math.min(H.fovMax, Math.max(fov, need)); break; }
      low *= 0.6;
    }
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
