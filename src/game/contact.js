// Contact model: pitch location + swing timing -> exit velocity, launch angle, spray angle.
// Pure function (plus an injected random source) so it can be unit tested.
import { CONFIG } from '../config.js';
import { clamp, lerp, invLerp } from '../util/math.js';
import { classifyTiming, timingFraction } from './timing.js';
import { zoneRatio } from '../physics/pitch.js';

function qualityFromTiming(grade, abs, windows, cfg, goodQuality) {
  const c = cfg.contact;
  if (grade === 'perfect') {
    const u = abs / windows.perfect;
    return lerp(c.qualityPerfect[1], c.qualityPerfect[0], u * u);
  }
  if (grade === 'good') {
    const g = goodQuality || c.qualityGood;
    return lerp(g[1], g[0], invLerp(windows.perfect, windows.good, abs));
  }
  const limit = grade === 'early' ? windows.early : windows.late;
  return lerp(c.qualityWeak[1], c.qualityWeak[0], clamp(invLerp(windows.good, limit, abs), 0, 1));
}

/**
 * @param {object} i
 * @param {number} i.errorMs       signed timing error
 * @param {number} i.locX          pitch x at the plate (ft, + = toward first base side)
 * @param {number} i.locY          pitch height at the plate (ft)
 * @param {number} i.pitchSpeed    mph
 * @param {number} [i.windowScale] difficulty window multiplier
 * @param {number} [i.speedScale]  pitch specific window multiplier
 * @param {number} [i.aim]         -1 (aim toward left field) .. +1 (toward right field)
 * @param {'R'|'L'} [i.batterHand]
 * @param {number} [i.evBonus]      extra exit velocity in mph (Derby batting practice)
 * @param {number[]} [i.goodQuality] replaces the "good" power range (Derby)
 * @param {{center:number,spread:number}} [i.goodLaunch] replaces the "good" launch angle (Derby)
 * @param {number} [i.pullBonus]    extra mph on a fully pulled ball (Derby)
 * @param {number} [i.pullSpan]     degrees of spray toward the pull side that count as "fully pulled"
 * @param {object} i.rng
 */
export function computeContact(i, cfg = CONFIG) {
  const c = cfg.contact;
  const rng = i.rng;
  const timing = classifyTiming(i.errorMs, { windowScale: i.windowScale, speedScale: i.speedScale }, cfg);
  const ratio = zoneRatio(i.locX, i.locY, cfg);
  const base = { timing, grade: timing.grade, errorMs: i.errorMs, zoneRatio: ratio };

  if (timing.grade === 'miss') return { ...base, made: false, reason: 'timing' };
  if (ratio > cfg.timing.reachRatio) return { ...base, made: false, reason: 'reach' };

  // ----- power (quality 0..1) -----
  let q = qualityFromTiming(timing.grade, timing.abs, timing.windows, cfg, i.goodQuality);
  // Pitches away from the middle of the zone lose some power.
  const k = clamp(invLerp(c.locationFalloff, 1.15, ratio), 0, 1);
  q *= lerp(1, 0.78, k);
  let grade = timing.grade;
  if (ratio > cfg.timing.chaseRatio) {
    // Chasing a pitch outside the zone: contact is capped at "weak".
    q = Math.min(q, 0.55) * lerp(1, 0.75, clamp(invLerp(cfg.timing.chaseRatio, cfg.timing.reachRatio, ratio), 0, 1));
    if (grade === 'perfect' || grade === 'good') grade = i.errorMs < 0 ? 'early' : 'late';
  }

  const evRaw = c.maxExitVelocity * Math.pow(q, c.qualityCurve) + (i.pitchSpeed - 85) * c.pitchSpeedBonus * q + (i.evBonus || 0) * q;
  let exitVelocity = clamp(evRaw + rng.gauss(0, 1.1), c.exitVelocityFloor, c.maxExitVelocity + 4);

  // ----- launch angle -----
  const tier = timing.grade === 'perfect' ? 'perfect' : timing.grade === 'good' ? 'good' : 'weak';
  const L = tier === 'good' && i.goodLaunch ? i.goodLaunch : c.launch[tier];
  const heightBias = (cfg.timing.zoneCenterY - i.locY) * c.launch.heightEffect;
  const launchAngle = clamp(L.center + heightBias + rng.gauss(0, L.spread), -28, 78);

  // ----- spray angle -----
  const tf = timingFraction(i.errorMs, timing.windows); // -1 early .. +1 late
  const earliness = -tf; // + = early = pulled
  const pullSign = (i.batterHand || 'R') === 'R' ? -1 : 1; // right-handed hitters pull toward left field (-x)
  const timingSpray = pullSign * Math.sign(earliness) * c.spray.timingMax * Math.pow(Math.abs(earliness), c.spray.timingCurve);
  // aiming: steer toward the gap you hold; the better the contact, the more the aim wins over timing (and the less the scatter)
  const aim = clamp(i.aim ?? 0, -1, 1);
  const ctrl = Math.abs(aim) * c.spray.aimControl[tier];
  const sprayAngle = clamp(lerp(timingSpray, aim * c.spray.aimTarget, ctrl) + rng.gauss(0, c.spray.noise[tier] * (1 - 0.35 * ctrl)), -80, 80);
  if (ctrl > 0) {
    const pulling = Math.sign(aim) === Math.sign(pullSign);
    exitVelocity = clamp(exitVelocity * (1 + ctrl * (pulling ? c.spray.aimPower.pull : c.spray.aimPower.oppo)), c.exitVelocityFloor, c.maxExitVelocity + 4);
  }

  if (i.pullBonus) {
    // hitters are strongest out in front of the plate: a ball hit toward the pull side jumps off the bat a bit harder
    const pulledFrac = clamp((sprayAngle * pullSign) / (i.pullSpan || 30), 0, 1);
    exitVelocity = clamp(exitVelocity + i.pullBonus * pulledFrac * q, c.exitVelocityFloor, c.maxExitVelocity + 4 + i.pullBonus);
  }

  const backspin = clamp(c.backspin.base + c.backspin.perLaunchDeg * Math.max(launchAngle, 0) + rng.gauss(0, 150), 200, c.backspin.max);
  // Balls hit toward a foul line curve toward it.
  const hook = clamp(sprayAngle / 45, -1.3, 1.3) * c.sidespinMax;

  return {
    ...base,
    grade,
    made: true,
    quality: q,
    exitVelocity,
    launchAngle,
    sprayAngle,
    backspin,
    hook,
    pulled: earliness > 0.05,
  };
}

/** The extra batting-practice help the Derby gives every swing (goes straight into `computeContact`). */
export function derbyBatting(cfg = CONFIG) {
  const d = cfg.modes.derby;
  return { evBonus: d.evBonus, goodQuality: d.goodQuality, goodLaunch: d.goodLaunch, pullBonus: d.pullBonus, pullSpan: d.pullSpan };
}

/**
 * A bunt: the bat is held out square and pushed at the ball. Much easier to time than a swing (bigger windows), but the ball comes
 * off slowly: a good bunt rolls 30-70 ft down a line; a mistimed one or a high pitch pops up or goes foul. Aim picks the line.
 * @param {object} i  { errorMs, locX, locY, windowScale?, aim?, batterHand?, rng }
 */
export function computeBunt(i, cfg = CONFIG) {
  const B = cfg.bunt;
  const rng = i.rng;
  const ratio = zoneRatio(i.locX, i.locY, cfg);
  const scale = i.windowScale ?? 1;
  const abs = Math.abs(i.errorMs);
  const base = { bunt: true, errorMs: i.errorMs, zoneRatio: ratio, timing: { grade: 'bunt', abs } };
  if (ratio > B.reachRatio) return { ...base, grade: 'miss', made: false, reason: 'reach' };
  if (abs > B.windowMs[1] * scale) return { ...base, grade: 'miss', made: false, reason: 'timing' };
  // quality 1 = a soft, placed bunt; 0 = barely got a piece of it
  const tq = 1 - clamp(invLerp(B.windowMs[0] * scale, B.windowMs[1] * scale, abs), 0, 1);
  const high = clamp(invLerp(cfg.timing.zoneCenterY, cfg.pitch.zoneTop + 0.4, i.locY), 0, 1); // a high pitch is hard to keep down
  const outside = clamp(invLerp(0.9, B.reachRatio, ratio), 0, 1);
  const q = clamp(tq * (1 - 0.45 * high) * (1 - 0.5 * outside), 0, 1);
  const exitVelocity = clamp(lerp(B.exitVelocity[1], B.exitVelocity[0], q) + rng.gauss(0, 2.5), 14, 52);
  // good bunts are pushed down into the grass; poor ones pop up
  const launchAngle = clamp(lerp(B.popLaunch, B.goodLaunch, q) + high * 14 + rng.gauss(0, B.launchSpread), -30, 60);
  const aim = clamp(i.aim ?? 0, -1, 1);
  const side = Math.abs(aim) > 0.1 ? Math.sign(aim) : (rng.next() < 0.5 ? -1 : 1);
  const placed = Math.abs(aim) > 0.1 ? B.aimSpray : B.spray;
  let sprayAngle = side * rng.range(placed[0], placed[1]) + rng.gauss(0, B.sprayNoise * (1.4 - q));
  if (rng.next() < B.foulChance * (1 - q)) sprayAngle = side * rng.range(47, 70); // pushed foul
  const backspin = clamp(200 + 40 * Math.max(launchAngle, 0), 150, 1600);
  return { ...base, grade: q > 0.55 ? 'good' : 'weak', made: true, quality: q, exitVelocity, launchAngle, sprayAngle: clamp(sprayAngle, -80, 80), backspin, hook: 0, pulled: false };
}
