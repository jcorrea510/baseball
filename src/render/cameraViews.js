// Pure camera maths (no three.js): where the camera goes and what it looks at in the special views.
import { CONFIG } from '../config.js';
import { lerp, smoothstep, clamp, DEG } from '../util/math.js';

// The play while you pitch, filmed like the TV games do it: from behind home plate, looking out - low (you see the ball against the
// field, not from the sky), close on the action, and never turning round (everything that happens is in front of it). It slides
// toward the side the ball went, climbs and moves in a little for a deep ball, backs up for a pop-up near home, and frames the ball,
// the man after it (or with it) and the other points that matter (the runners on the move, the bag a throw is going to).
//   ball = {x, y, z}; pts = [[x, y, z] ...] the rest to keep in the picture; land = {x, z} where a ball in the air comes down (or
//   null) -> { pos, look, fov }
export function fieldView(ball, pts, cfg = CONFIG, land = null) {
  const C = cfg.camera.fieldView;
  // where the action is, on the ground: the ball and the others, the ball counting double
  let ax = ball.x * 2, az = ball.z * 2, n = 2;
  for (const q of pts) { ax += q[0]; az += q[2]; n++; }
  ax /= n; az /= n;
  const d = Math.hypot(ax, az), k = smoothstep(0, C.farFeet, d);
  // a ball way up and not far out (a pop-up): back up and climb, so it and the man under it fit in one picture
  const pop = smoothstep(C.popFrom[0], C.popFrom[1], ball.y) * (1 - smoothstep(C.popNear[0], C.popNear[1], Math.hypot(ball.x, ball.z)));
  const pos = [clamp(ax * C.side, -C.sideMax, C.sideMax), lerp(C.up[0], C.up[1], k) + C.popUp * pop, lerp(C.back[0], C.back[1], k) + C.popBack * pop];
  // (a ball way up - a high fly, a pop-up: the picture stays on the field - the man under it and the spot it comes down on, `land` -
  // and the ball drops into it; framing it and the men under it together would mean a picture from far away where nobody can see
  // anything, and following it alone a picture of the sky)
  const high = ball.y > C.ballOnlyAbove && (pts.length || land);
  const all = high ? [...pts, ...(land ? [[land.x, 0, land.z]] : [])] : [[ball.x, Math.max(0.5, ball.y), ball.z], ...pts];
  const { aim, half } = fitAim(pos, all);
  return { pos, look: aim, fov: clamp(2 * (half + C.marginDeg), high ? C.fovHigh : C.fovMin, C.fovMax) };
}

// The aim that needs the narrowest view to hold every point (it starts at their middle and leans toward whichever is furthest out
// until no lean helps): { aim, half } (half = degrees from the aim to the furthest point).
function fitAim(pos, pts) {
  let ax = 0, ay = 0, az = 0;
  for (const q of pts) { ax += q[0]; ay += q[1]; az += q[2]; }
  let aim = [ax / pts.length, ay / pts.length, az / pts.length];
  let half = fitHalf(pos, pts, aim);
  for (let i = 0; i < 24; i++) {
    let worst = null, wa = -1;
    for (const q of pts) { const a = angleBetween(pos, q, aim); if (a > wa) { wa = a; worst = q; } }
    // lean toward the worst point: aim along a direction part of the way from the current aim to it (as unit vectors from the camera)
    const u = unit([aim[0] - pos[0], aim[1] - pos[1], aim[2] - pos[2]]), w = unit([worst[0] - pos[0], worst[1] - pos[1], worst[2] - pos[2]]);
    const k = 0.5 / (i + 2);
    const dir = unit([u[0] + (w[0] - u[0]) * k, u[1] + (w[1] - u[1]) * k, u[2] + (w[2] - u[2]) * k]);
    const next = [pos[0] + dir[0] * 100, pos[1] + dir[1] * 100, pos[2] + dir[2] * 100];
    const h = fitHalf(pos, pts, next);
    if (h < half) { half = h; aim = next; }
  }
  return { aim, half };
}
const unit = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };

// the widest angle (degrees) from the view axis (pos -> aim) to any of the points
function fitHalf(pos, pts, aim) {
  let half = 0;
  for (const q of pts) half = Math.max(half, angleBetween(pos, q, aim));
  return half;
}

// the angle (degrees) at `from` between the directions to two points
function angleBetween(from, a, b) {
  const u = [a[0] - from[0], a[1] - from[1], a[2] - from[2]];
  const v = [b[0] - from[0], b[1] - from[1], b[2] - from[2]];
  const c = (u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / (Math.hypot(...u) * Math.hypot(...v) || 1);
  return Math.acos(Math.max(-1, Math.min(1, c))) / DEG;
}
