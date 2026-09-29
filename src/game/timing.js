// Swing timing: turns "how many milliseconds off was the swing" into a grade.
import { CONFIG } from '../config.js';

/**
 * errorMs is (bat reaches plate) - (ball crosses plate): negative = EARLY, positive = LATE.
 * @param {number} errorMs
 * @param {object} [o]
 * @param {number} [o.windowScale]  difficulty multiplier (bigger = more forgiving)
 * @param {number} [o.speedScale]   extra multiplier (e.g. 0.85 for the heater)
 * @returns {{grade:'perfect'|'good'|'early'|'late'|'miss', abs:number, windows:object}}
 */
export function classifyTiming(errorMs, o = {}, cfg = CONFIG) {
  const s = (o.windowScale ?? 1) * (o.speedScale ?? 1);
  const t = cfg.timing;
  const windows = {
    perfect: t.perfectMs * s,
    good: t.goodMs * s,
    early: t.earlyMs * s,
    late: t.lateMs * s,
  };
  const abs = Math.abs(errorMs);
  let grade;
  if (abs <= windows.perfect) grade = 'perfect';
  else if (abs <= windows.good) grade = 'good';
  else if (errorMs < 0 && abs <= windows.early) grade = 'early';
  else if (errorMs > 0 && abs <= windows.late) grade = 'late';
  else grade = 'miss';
  return { grade, abs, windows };
}

// Milliseconds early (negative) / late (positive), as text for the readout.
export function describeError(errorMs) {
  const r = Math.round(Math.abs(errorMs));
  if (r <= 1) return 'dead on';
  return errorMs < 0 ? `${r}ms early` : `${r}ms late`;
}

// Timing "fraction" used for spray and quality: -1 (very early) .. +1 (very late) across the weak windows.
export function timingFraction(errorMs, windows) {
  return errorMs < 0 ? Math.max(-1, errorMs / windows.early) : Math.min(1, errorMs / windows.late);
}

// When (engine time) does the bat reach the plate and when does the BALL meet the bat?
// The visual contact is nudged so the bat and ball always meet (the bat can only reach
// a few feet in front of / behind the plate), but the graded error uses the true numbers.
export function resolveSwingTimes(pressTime, crossTime, cfg = CONFIG) {
  const t = cfg.timing;
  const barrelTime = pressTime + t.swingDelay;
  const errorMs = (barrelTime - crossTime) * 1000;
  const hitTime = Math.min(Math.max(barrelTime, crossTime - t.reachEarly), crossTime + t.reachLate);
  return { pressTime, barrelTime, errorMs, hitTime: Math.max(hitTime, pressTime + t.minSwingTime) };
}
