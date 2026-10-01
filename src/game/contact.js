// The swing meets the pitch. You aim the bat (its sweet spot) with the cursor and time the swing; this turns that into a real
// bat-ball collision (physics/bat.js):
//   - WHEN the bat arrives (timing) decides how fast the barrel is moving and which way it faces: early pulls, late goes the other way;
//   - WHERE the bat is against the ball decides the rest: the bat under the ball sends it up with backspin (a fly ball - at the right
//     amount, a home run), square in the middle a hard line drive, on top of the ball a grounder;
//   - and WHERE ON THE BARREL: the sweet spot is best, off the end or in on the hands the ball dies.
// Pure functions (plus an injected random source) so it can all be unit tested.
import { CONFIG, MPH } from '../config.js';
import { clamp, lerp, invLerp, DEG } from '../util/math.js';
import { classifyTiming, timingFraction } from './timing.js';
import { zoneRatio } from '../physics/pitch.js';
import { hitBall } from '../physics/bat.js';

// Fraction of full bat speed the barrel has when it meets the ball, from the timing (a perfectly timed swing meets it at full speed).
function speedFromTiming(timing, cfg) {
  const S = cfg.swing.timingSpeed;
  const w = timing.windows;
  if (timing.grade === 'perfect') return lerp(S.perfect[0], S.perfect[1], timing.abs / w.perfect);
  if (timing.grade === 'good') return lerp(S.good[0], S.good[1], invLerp(w.perfect, w.good, timing.abs));
  const limit = timing.grade === 'early' ? w.early : w.late;
  return lerp(S.weak[0], S.weak[1], clamp(invLerp(w.good, limit, timing.abs), 0, 1));
}

/**
 * Where the ball is when the bat gets there, and how it is moving and spinning.
 * @param {object} flight     the pitch (physics/pitch.js buildPitch)
 * @param {number} tHit       seconds after release that the bat meets the ball (the clamped contact time)
 * @param {number} tBarrel    seconds after release that the bat reaches the plate (the true swing timing)
 * An early swing meets the ball out in front, where it has not dropped as far; a late one deeper, where it is lower. A batter swings
 * "on plane" - the barrel rises through the zone as the ball comes down - so most of that height change is matched by the bat: only
 * `1 - onPlane` of it counts against where he aimed.
 */
export function contactPoint(flight, tHit, tBarrel, cfg = CONFIG) {
  const S = cfg.swing;
  const t = Math.min(Math.max(0, tHit), flight.tCatch);
  const bp = flight.at(t), bv = flight.velocity(t);
  const cross = flight.at(flight.T);
  const tTrue = Math.min(Math.max(tBarrel, flight.T - S.planeEarly), flight.T + S.planeLate);
  const yTrue = flight.at(Math.min(Math.max(0, tTrue), flight.tCatch)).y;
  const sp = flight.spin, rad = sp.rpm / 9.5493;
  return {
    ball: { x: bp.x, y: cross.y + (yTrue - cross.y) * (1 - S.onPlane) },
    vBall: { x: bv.x * (flight.pace || 1), y: bv.y * (flight.pace || 1), z: bv.z * (flight.pace || 1) }, // (the bat feels the pitch's real speed)
    wBall: { x: sp.axis[0] * rad, y: sp.axis[1] * rad, z: sp.axis[2] * rad },
  };
}

/** The contact window for a level: how far (ft) above / below the ball's centre the bat can be and still hit it, and along the barrel. */
// { up, tip, handle } = how far from the sweet spot the bat still touches the ball; `sweet` (the same shape, smaller) = the part where
// it is hit properly: where the ball is inside the sweet zone decides how it comes off (see computeSwing).
export function contactWindow(level, cfg = CONFIG) {
  const d = cfg.difficulty[level] || cfg.difficulty.pro;
  const w = d.contactWindow || cfg.difficulty.pro.contactWindow;
  const s = d.sweetSpot || w;
  return { up: w.up, tip: w.tip, handle: w.handle, sweet: { up: s.up, tip: s.tip, handle: s.handle } };
}

/** The same window made bigger or smaller (the Contact rating, the Derby). */
export function scaleWindow(win, k) {
  const s = win.sweet || win;
  return { up: win.up * k, tip: win.tip * k, handle: win.handle * k, sweet: { up: s.up * k, tip: s.tip * k, handle: s.handle * k } };
}

/**
 * Where the bat is against the ball at contact.
 * @returns {{u:number, w:number, dv:number, along:number}}  u: -1 (bat on top of the ball) .. 0 (square) .. +1 (bat under the ball),
 *          w: -1 (in on the hands) .. 0 (sweet spot) .. +1 (off the end); dv / along in feet
 */
export function batOffset(ball, aim, hand, win) {
  const dv = ball.y - aim.y; // ball's centre above the sweet spot = the bat is under the ball
  const along = (ball.x - aim.x) * (hand === 'L' ? -1 : 1); // toward the end of the bat (the bat reaches across the plate from the batter)
  const s = win.sweet || win;
  return {
    dv, along, u: dv / win.up, w: along >= 0 ? along / win.tip : along / win.handle,
    // ...the same against the sweet zone (beyond +-1: only a piece of the ball)
    uq: dv / s.up, wq: along >= 0 ? along / s.tip : along / s.handle,
  };
}

/**
 * A full swing.
 * @param {object} i
 * @param {number} i.errorMs        signed timing error (ms): bat at the plate - ball at the plate
 * @param {{x:number,y:number}} i.aim   where the sweet spot of the bat was aimed (ft, in the plane over the plate)
 * @param {{x:number,y:number}} i.ball  where the ball was at contact
 * @param {{x,y,z}} i.vBall         the pitch's velocity at contact (ft/s)
 * @param {{x,y,z}} [i.wBall]       the pitch's spin (rad/s)
 * @param {object} i.window         contact window { up, tip, handle } (ft) - see contactWindow()
 * @param {number} [i.windowScale]  timing window multiplier (level, Contact rating)
 * @param {number} [i.speedScale]   pitch-specific timing window multiplier
 * @param {'R'|'L'} [i.batterHand]
 * @param {number} [i.evBonus]      extra exit velocity (mph) on a squared-up ball (Power rating, the Derby's batting practice)
 * @param {number} [i.batBonus]     extra bat speed (mph) for the level
 * @param {object} i.rng
 */
export function computeSwing(i, cfg = CONFIG) {
  const c = cfg.contact, S = cfg.swing, B = cfg.bat;
  const rng = i.rng;
  const hand = i.batterHand || 'R';
  const timing = classifyTiming(i.errorMs, { windowScale: i.windowScale, speedScale: i.speedScale }, cfg);
  const off = batOffset(i.ball, i.aim, hand, i.window);
  const ratio = zoneRatio(i.ball.x, i.ball.y, cfg);
  const base = { timing, grade: timing.grade, errorMs: i.errorMs, zoneRatio: ratio, u: off.uq, w: off.wq, aim: { ...i.aim }, ball: { ...i.ball } };
  if (timing.grade === 'miss') return { ...base, made: false, reason: 'timing' };
  if (Math.abs(off.u) > 1) return { ...base, made: false, reason: off.u > 0 ? 'under' : 'over' }; // swung under / over it
  if (off.w > 1 || off.w < -1) return { ...base, made: false, reason: off.w > 0 ? 'end' : 'hands' }; // it went past the end of the bat / in behind the hands

  // ----- the barrel at contact
  const tf = timingFraction(i.errorMs, timing.windows); // -1 early .. +1 late
  const earliness = -tf;
  const pullSign = hand === 'R' ? -1 : 1; // right-handed hitters pull toward left field (-x)
  let heading = pullSign * Math.sign(earliness) * c.spray.timingMax * Math.pow(Math.abs(earliness), c.spray.timingCurve);
  heading += pullSign * S.pullBias; // (on time = a little out front: toward the pull-side gap)
  // (how the ball comes off depends on where it is against the SWEET zone; outside it the bat only gets a piece)
  const uq = clamp(off.uq, -1, 1), wq = clamp(off.wq, -1, 1);
  heading += -pullSign * S.endSpray * wq; // off the end of the bat the ball goes the other way a little; in on the hands, pulled
  let speed = S.batSpeed * speedFromTiming(timing, cfg);
  speed *= 1 - S.handleSlow * Math.max(0, -wq); // nearer the hands the bat is moving slower
  const chase = clamp(invLerp(S.chase.from, S.chase.to, ratio), 0, 1); // reaching for a pitch well out of the zone costs bat speed
  speed *= 1 - S.chase.speedLoss * chase;
  speed += (i.evBonus || 0) / (1 + S.q) + (i.batBonus || 0); // (extra exit speed comes from extra bat speed)
  const attack = clamp(S.attack + (cfg.timing.zoneCenterY - i.ball.y) * S.attackPerFt, S.attackRange[0], S.attackRange[1]); // low pitch: uppercut
  // off the sweet spot the bat vibrates and gives: less bounce, a bigger share of the bat recoils
  const e = B.cor * (1 - S.offBarrel * wq * wq);
  const r = B.massRatio * (1 + S.offBarrelMass * wq * wq);
  // the window is gameplay-sized; the collision uses the real geometry (u = +-1 at the edge of the sweet zone is the ball just grazing
  // the barrel)
  const offset = clamp(uq, -S.maxGraze, S.maxGraze) * (cfg.physics.ballRadius + B.barrelRadius);
  const hit = hitBall({ offset, batSpeed: speed * MPH, heading: heading * DEG, attack: attack * DEG, vBall: i.vBall, wBall: i.wBall, e, r }, cfg);

  // ----- a little human scatter (much less on a squared-up ball)
  const tier = timing.grade === 'perfect' ? 'perfect' : timing.grade === 'good' ? 'good' : 'weak';
  const N = S.noise;
  const exitVelocity = clamp(hit.exitVelocity + rng.gauss(0, N.ev), 8, 125);
  const launchAngle = clamp(hit.launchAngle + rng.gauss(0, N.launch[tier]), -80, 85);
  // (a glancing ball can even go back over the catcher: the spray is not limited - fair / foul decides it)
  const sprayAngle = clamp(hit.sprayAngle + rng.gauss(0, N.spray[tier]), -179, 179);
  const backspin = clamp(hit.backspin + rng.gauss(0, 120), -4500, 5200);
  const hook = clamp(hit.sidespin + rng.gauss(0, 80), -2500, 2500);

  // how it is graded on screen: the timing, marked down for a ball off the barrel or hit way off-centre
  let grade = timing.grade;
  const squared = off.uq > S.squared[0] && off.uq < S.squared[1] && Math.abs(off.wq) < S.squaredAlong;
  if ((grade === 'perfect' || grade === 'good') && !squared) grade = grade === 'perfect' ? 'good' : (i.errorMs < 0 ? 'early' : 'late');
  if (chase > 0.5 && (grade === 'perfect' || grade === 'good')) grade = i.errorMs < 0 ? 'early' : 'late';
  const quality = clamp((exitVelocity - c.exitVelocityFloor) / (c.maxExitVelocity - c.exitVelocityFloor), 0, 1);
  return {
    ...base, grade, made: true, quality,
    exitVelocity, launchAngle, sprayAngle, backspin, hook,
    pulled: earliness > 0.05, batSpeed: speed, attack, squared,
  };
}

/** The extra batting-practice help the Derby gives every swing. */
export function derbyBatting(cfg = CONFIG) {
  const d = cfg.modes.derby;
  return { evBonus: d.evBonus };
}

/**
 * A bunt: the bat is held out square and pushed at the ball. Much easier to time than a swing (bigger windows), and the ball comes
 * off slowly. Where the bat meets the ball still matters: on top of it, the ball is pushed down into the grass (a good bunt);
 * under it, it pops up. An early bunt goes down the pull-side line, a late one the other way.
 * @param {object} i  { errorMs, ball, aim, window, windowScale?, batterHand?, rng }
 */
export function computeBunt(i, cfg = CONFIG) {
  const B = cfg.bunt;
  const rng = i.rng;
  const hand = i.batterHand || 'R';
  const ball = i.ball, aim = i.aim || i.ball;
  const ratio = zoneRatio(ball.x, ball.y, cfg);
  const scale = i.windowScale ?? 1;
  const abs = Math.abs(i.errorMs);
  const win = i.window || contactWindow('pro', cfg);
  const off = batOffset(ball, aim, hand, { up: win.up * B.windowScale, tip: win.tip * B.windowScale, handle: win.handle * B.windowScale });
  const base = { bunt: true, errorMs: i.errorMs, zoneRatio: ratio, timing: { grade: 'bunt', abs }, u: off.u, w: off.w, aim: { ...aim }, ball: { ...ball } };
  if (abs > B.windowMs[1] * scale) return { ...base, grade: 'miss', made: false, reason: 'timing' };
  if (Math.abs(off.u) > 1 || Math.abs(off.w) > 1) return { ...base, grade: 'miss', made: false, reason: Math.abs(off.u) > 1 ? (off.u > 0 ? 'under' : 'over') : 'end' };
  // quality 1 = a soft, placed bunt; 0 = barely got a piece of it
  const tq = 1 - clamp(invLerp(B.windowMs[0] * scale, B.windowMs[1] * scale, abs), 0, 1);
  const under = clamp(off.u, 0, 1); // the bat under the ball pops it up
  const outside = clamp(invLerp(0.9, B.reachRatio, ratio), 0, 1);
  const q = clamp(tq * (1 - 0.6 * under) * (1 - 0.5 * outside) * (1 - 0.3 * Math.abs(off.w)), 0, 1);
  const exitVelocity = clamp(lerp(B.exitVelocity[1], B.exitVelocity[0], q) + rng.gauss(0, 2.5), 14, 52);
  const launchAngle = clamp(B.goodLaunch + (B.popLaunch - B.goodLaunch) * clamp((off.u + 0.3) / 0.9, 0, 1) + rng.gauss(0, B.launchSpread), -30, 60); // (over the ball: down into the grass; square: low; under it: up)
  const pullSign = hand === 'R' ? -1 : 1;
  const early = -i.errorMs; // an early bunt goes toward the pull-side line
  const side = Math.abs(early) > 8 ? Math.sign(early) * pullSign : (rng.next() < 0.5 ? -1 : 1);
  const placed = Math.abs(early) > 8 ? B.aimSpray : B.spray;
  let sprayAngle = side * rng.range(placed[0], placed[1]) + rng.gauss(0, B.sprayNoise * (1.4 - q));
  if (rng.next() < B.foulChance * (1 - q)) sprayAngle = side * rng.range(47, 70); // pushed foul
  const backspin = clamp(200 + 40 * Math.max(launchAngle, 0), 150, 1600);
  return { ...base, grade: q > 0.55 ? 'good' : 'weak', made: true, quality: q, exitVelocity, launchAngle, sprayAngle: clamp(sprayAngle, -80, 80), backspin, hook: 0, pulled: false };
}
