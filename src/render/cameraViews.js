// Pure camera maths (no three.js): where the camera goes and what it looks at in the special views.
import { CONFIG } from '../config.js';
import { fenceDistance, sprayOf } from '../physics/field.js';
import { lerp, smoothstep, clamp, DEG } from '../util/math.js';

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

// A home run while you pitch: the camera stays behind the mound (rising a little) and looks up at the ball as it soars toward you,
// widening to keep home in the picture too; once it is high overhead or past you it is let go - it sails out over the top of the
// picture - and the eye settles on the diamond, where the batter rounds the bases. It never turns round.
//   ball = {x, y, z}, t = s since contact, hand = 'L' | 'R' -> { pos, look, fov }
export function homerView(ball, t, hand, cfg = CONFIG) {
  const H = cfg.camera.homerView, P = cfg.camera.pitcher.pos, m = hand === 'L' ? -1 : 1;
  const pos = [P[0] * m, P[1] + H.rise * smoothstep(0, H.riseTime, t), P[2]];
  const ahead = ball.z - pos[2]; // (> 0: between the camera and home - in front of it)
  const up = Math.atan2(ball.y - pos[1], Math.max(1, Math.hypot(ball.x - pos[0], ahead))) / DEG;
  const diamond = [0, 2, H.diamondZ];
  if (ahead > H.letGoAhead && up < H.letGoDeg) {
    const { aim, half } = fitAim(pos, [[ball.x, ball.y, ball.z], [0, 0, 0]]);
    return { pos, look: aim, fov: clamp(2 * (half + H.marginDeg), H.fovMin, H.fovMax) };
  }
  return { pos, look: diamond, fov: H.fovAfter };
}

// The play while you pitch, filmed from the outfield side looking in (the same way the pitching view looks, so nothing ever flips):
// the camera stands behind `spot` - where the play happens: the catch, the pickup, a home run's landing - on the far side from home
// plate (straight out toward center field for a spot near home, from out past second base), up high, and frames every point in `pts` ([x, y, z]: home, the
// bases, the fielder, the ball ...), backing up and climbing (steps of `pullStep`) until they fit, aimed so the view is as narrow as
// it can be.
//   spot = {x, z} -> { pos, look, fov }
//   extra = more points to fit when they can be (the bases away from the play): dropped when the view cannot hold them too.
export function playView(spot, pts, cfg = CONFIG, extra = []) {
  if (extra.length) {
    const v = playViewOf(spot, [...pts, ...extra], cfg);
    if (v.need <= cfg.camera.playView.maxFov) return v;
  }
  return playViewOf(spot, pts, cfg);
}
function playViewOf(spot, pts, cfg) {
  const C = cfg.camera.playView;
  const d = Math.hypot(spot.x, spot.z);
  const far = smoothstep(C.nearHome[0], C.nearHome[1], d); // (0 = at home: straight out; 1 = far out: away from home)
  let ux = lerp(0, d > 1 ? spot.x / d : 0, far), uz = lerp(-1, d > 1 ? spot.z / d : -1, far);
  const ul = Math.hypot(ux, uz) || 1;
  ux /= ul; uz /= ul;
  const all = [[spot.x, 3, spot.z], ...pts];
  const R0 = Math.max(d + C.back, C.minFromHome);
  // (home-centred: for a spot out in the field this is `back` beyond it; never nearer home than `minFromHome`, so a play near home is
  // still filmed from out past second base, looking in at all four bases; never past the outfield wall - `wallGap` inside it, never
  // in the stands. Where the wall leaves no room - a ball at the wall - the camera slides along it to the side of the spot instead,
  // toward center field first. It backs up and climbs, a step of `pullStep` at a time, until everything fits; the first fit wins.)
  const toCenter = sprayOf(ux, uz) > 0 ? -1 : 1;
  const turns = [0, ...C.sideTurns.map((a) => a * toCenter * DEG), ...C.sideTurns.map((a) => -a * toCenter * DEG)];
  let best = null;
  for (let k = 0; k <= C.pullSteps; k++) {
    const grow = 1 + C.pullStep * k;
    for (const turn of turns) {
      const c = Math.cos(turn), sn = Math.sin(turn);
      const vx = ux * c - uz * sn, vz = ux * sn + uz * c;
      const fence = fenceDistance(clamp(sprayOf(vx, vz), -45, 45));
      // (inside the wall; or, when there is no room for it there, a little way past the wall but high over the bleachers, the
      // batter's eye and the scoreboard - `overWall` ft past it, `overUp` ft up at least)
      for (const over of R0 * grow > fence - C.wallGap ? [false, true] : [false]) {
        const R = Math.min(R0 * grow, over ? fence + C.overWall : fence - C.wallGap);
        const off = Math.hypot(vx * R - spot.x, vz * R - spot.z);
        // (never nearly on top of the spot: from this close it would be looking straight down)
        if (off < C.minOff) continue;
        // high enough to look down on the play, never so high (for how far off it is) that the spot is straight below
        const up = clamp(off * C.upRatio, C.upMin, C.up * grow);
        const pos = [vx * R, over ? Math.max(up, C.overUp) : up, vz * R];
        const { aim, half } = fitAim(pos, all);
        const need = 2 * (half + C.marginDeg) + (over ? C.overCost : 0);
        const v = { pos, look: aim, fov: clamp(need, C.fovMin, C.maxFov), need };
        if (!best || need < best.need) best = v;
        if (need <= C.fovMax) return v;
      }
    }
  }
  return best;
}

/**
 * From a camera spot already chosen (playView), where to look and how wide, to hold `pts` - and `extra` too when that fits within
 * the widest view: { look, fov }.
 */
export function playAim(pos, pts, cfg = CONFIG, extra = []) {
  const C = cfg.camera.playView;
  if (extra.length) {
    const f = fitAim(pos, [...pts, ...extra]);
    if (2 * (f.half + C.marginDeg) <= C.maxFov) return { look: f.aim, fov: clamp(2 * (f.half + C.marginDeg), C.fovMin, C.maxFov) };
  }
  const f = fitAim(pos, pts);
  return { look: f.aim, fov: clamp(2 * (f.half + C.marginDeg), C.fovMin, C.maxFov) };
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
