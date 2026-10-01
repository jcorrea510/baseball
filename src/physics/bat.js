// The bat meeting the ball: a real collision between a moving cylinder (the barrel) and a ball.
//
// Where on the ball the bat lands is everything:
//   - the bat a little UNDER the middle of the ball (the ball's centre above the bat's centre) sends it up with backspin: a fly ball,
//     and at the right amount a home run;
//   - square in the middle: a hard line drive, flat;
//   - ON TOP of the ball: it is driven down into the ground, with topspin - a grounder.
// The physics: the contact normal runs from the bat's axis through the ball's centre. Along it the ball rebounds with the
// bat-ball coefficient of restitution (and the bat recoils a little - its effective mass at the impact point); across it friction
// grips the ball, which starts to roll on the bat - that is where backspin / topspin come from. Pure maths, no graphics.
import { CONFIG } from '../config.js';

const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const add = (a, b, k = 1) => ({ x: a.x + b.x * k, y: a.y + b.y * k, z: a.z + b.z * k });
const scale = (a, k) => ({ x: a.x * k, y: a.y * k, z: a.z * k });
const len = (a) => Math.sqrt(dot(a, a));
const norm = (a) => { const l = len(a) || 1; return scale(a, 1 / l); };
export const RPM = 60 / (2 * Math.PI); // rad/s -> rpm

/**
 * One collision.
 * @param {object} o
 * @param {{x,y,z}} o.vBat    velocity of the bat at the impact point (ft/s)
 * @param {{x,y,z}} o.vBall   velocity of the ball coming in (ft/s)
 * @param {{x,y,z}} [o.wBall] the ball's spin coming in (rad/s)
 * @param {{x,y,z}} o.n       unit contact normal, from the bat's axis to the ball's centre
 * @param {number} o.e        coefficient of restitution (bat-ball)
 * @param {number} o.r        ball mass / effective bat mass at the impact point (the bat recoils)
 * @param {number} o.mu       friction between bat and ball
 * @param {number} o.slipKeep fraction of the sliding speed across the bat the ball keeps once it rolls (5/7 for a rigid ball)
 * @param {number} o.R        ball radius (ft)
 * @returns {{v:{x,y,z}, w:{x,y,z}}}  the ball's velocity (ft/s) and spin (rad/s) as it leaves the bat
 */
export function collide(o) {
  const n = o.n;
  const w0 = o.wBall || { x: 0, y: 0, z: 0 };
  const vrel = add(o.vBall, o.vBat, -1);
  const vn = dot(vrel, n);
  if (vn >= 0) return { v: { ...o.vBall }, w: { ...w0 } }; // (moving apart already: no collision)
  // normal impulse (per unit ball mass): the rebound along the normal, less what the bat's recoil takes
  const Jn = (-(1 + o.e) * vn) / (1 + o.r);
  // sliding of the ball's surface across the bat at the contact point (its centre's velocity across the bat, plus its spin)
  const rc = scale(n, -o.R); // contact point, from the ball's centre
  const slip0 = add(add(vrel, n, -vn), cross(w0, rc));
  const slipT = add(slip0, n, -dot(slip0, n));
  const s = len(slipT);
  let Jt = { x: 0, y: 0, z: 0 };
  if (s > 1e-9) {
    // friction takes off what it takes to make the ball roll (keeping `slipKeep` of the slide), never more than mu x the normal impulse
    const want = (1 - o.slipKeep) * s;
    const j = Math.min(want, o.mu * Jn);
    Jt = scale(slipT, -j / s);
  }
  const v = add(add(o.vBall, n, Jn), Jt);
  // the friction impulse acts at the contact point: it spins the ball (solid-ish ball: I = 2/5 m R^2)
  // (a real ball squashes on the bat and comes away with less spin than a rigid one would: `spinKeep` is the measured share)
  const dw = scale(cross(rc, Jt), (5 / (2 * o.R * o.R)) * (o.spinKeep ?? 1));
  // (the grip during contact wipes out most of the spin the pitch came in with: `spinCarry` of it survives)
  return { v, w: add(scale(w0, o.spinCarry ?? 1), dw) };
}

/**
 * The bat at the moment of contact and what it does to the ball.
 * @param {object} i
 * @param {number} i.offset        how far the ball's centre is ABOVE the bat's centre at contact (ft, real size: within +-(ball + barrel radius))
 * @param {number} i.batSpeed      speed of the barrel at the impact point (ft/s)
 * @param {number} i.heading       direction the barrel is moving, radians: 0 = straight at the pitcher, + toward right field (+x)
 * @param {number} i.attack        the barrel's upward angle (radians): a level swing is 0, a slight uppercut ~0.15
 * @param {{x,y,z}} i.vBall        the pitch's velocity at contact (ft/s)
 * @param {{x,y,z}} [i.wBall]      the pitch's spin (rad/s)
 * @param {number} [i.e]           restitution (default config)
 * @param {number} [i.r]           recoil mass ratio (default config: at the sweet spot)
 * @returns {{v, w, exitVelocity:number, launchAngle:number, sprayAngle:number, spinRpm:number, backspin:number, sidespin:number, n}}
 *          v/w as from collide; exitVelocity mph; angles in degrees; backspin rpm (+ = backspin, - = topspin); sidespin rpm (+ = curves to +x)
 */
export function hitBall(i, cfg = CONFIG) {
  const B = cfg.bat;
  const R = cfg.physics.ballRadius;
  const sumR = R + B.barrelRadius;
  const sinT = Math.max(-0.995, Math.min(0.995, i.offset / sumR));
  const theta = Math.asin(sinT);
  // the swing direction (with its attack angle) and "up" in the plane the barrel moves in
  const ch = Math.cos(i.heading), sh = Math.sin(i.heading), ca = Math.cos(i.attack), sa = Math.sin(i.attack);
  const s = { x: sh * ca, y: sa, z: -ch * ca };
  const up = { x: -sh * sa, y: ca, z: ch * sa };
  const n = norm(add(scale(s, Math.cos(theta)), up, sinT));
  const out = collide({
    vBat: scale(s, i.batSpeed), vBall: i.vBall, wBall: i.wBall, n,
    e: i.e ?? B.cor, r: i.r ?? B.massRatio, mu: B.friction, slipKeep: B.slipKeep, spinKeep: B.spinKeep, spinCarry: B.spinCarry, R,
  });
  return { ...out, n, ...describe(out.v, out.w) };
}

/** Exit speed (mph), launch angle, spray angle (degrees) and backspin / sidespin (rpm) of a ball leaving the bat. */
export function describe(v, w) {
  const h = Math.hypot(v.x, v.z);
  const MPH = 1.4666667;
  const exitVelocity = len(v) / MPH;
  const launchAngle = Math.atan2(v.y, h) * 180 / Math.PI;
  const sprayAngle = Math.atan2(v.x, -v.z) * 180 / Math.PI;
  // backspin: spin about the horizontal axis across the ball's path (direction of travel x up); positive lifts the ball
  const dir = h > 1e-6 ? { x: v.x / h, y: 0, z: v.z / h } : { x: 0, y: 0, z: -1 };
  const across = cross(dir, { x: 0, y: 1, z: 0 }); // (for a ball going to centre field this is +x: backspin spins about +x, as in ballistics.js)
  const backspin = dot(w, across) * RPM;
  const sidespin = -w.y * RPM; // spin about the vertical axis: + curves the ball toward +x (the same sign as `hook` in ballistics.js)
  return { exitVelocity, launchAngle, sprayAngle, spinRpm: len(w) * RPM, backspin, sidespin };
}
