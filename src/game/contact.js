// Contact model: pitch location + swing timing -> exit velocity, launch angle, spray angle.
// Pure function (plus an injected random source) so it can be unit tested.
import { CONFIG } from '../config.js';
import { clamp, lerp, invLerp } from '../util/math.js';
import { classifyTiming, timingFraction } from './timing.js';
import { zoneRatio } from '../physics/pitch.js';

function qualityFromTiming(grade, abs, windows, cfg) {
  const c = cfg.contact;
  if (grade === 'perfect') {
    const u = abs / windows.perfect;
    return lerp(c.qualityPerfect[1], c.qualityPerfect[0], u * u);
  }
  if (grade === 'good') {
    return lerp(c.qualityGood[1], c.qualityGood[0], invLerp(windows.perfect, windows.good, abs));
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
  let q = qualityFromTiming(timing.grade, timing.abs, timing.windows, cfg);
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
  const exitVelocity = clamp(evRaw + rng.gauss(0, 1.1), c.exitVelocityFloor, c.maxExitVelocity + 4);

  // ----- launch angle -----
  const tier = timing.grade === 'perfect' ? 'perfect' : timing.grade === 'good' ? 'good' : 'weak';
  const L = c.launch[tier];
  const heightBias = (cfg.timing.zoneCenterY - i.locY) * c.launch.heightEffect;
  const launchAngle = clamp(L.center + heightBias + rng.gauss(0, L.spread), -28, 78);

  // ----- spray angle -----
  const tf = timingFraction(i.errorMs, timing.windows); // -1 early .. +1 late
  const earliness = -tf; // + = early = pulled
  const pullSign = (i.batterHand || 'R') === 'R' ? -1 : 1; // right-handed hitters pull toward left field (-x)
  const timingSpray = pullSign * Math.sign(earliness) * c.spray.timingMax * Math.pow(Math.abs(earliness), c.spray.timingCurve);
  const aimSpray = clamp(i.aim ?? 0, -1, 1) * c.spray.aimMax;
  const sprayAngle = clamp(timingSpray + aimSpray + rng.gauss(0, c.spray.noise[tier]), -80, 80);

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
