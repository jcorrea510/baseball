// Your pitch: turns the player's aim and ring tap into a thrown pitch (pure logic, no graphics).
// Pitcher shape everywhere: { id, name, short, number, hand: 'R'|'L', role: 'SP'|'RP', vel, ctl, stf, sta, pitches, skin, scale, build }
// with the ratings 1-99. Coordinates: feet, x as the catcher sees it from behind the plate (+x = right-field side).
import { CONFIG } from '../config.js';
import { clamp, lerp } from '../util/math.js';
import { zoneEdgeDistance } from '../physics/pitch.js';

/** Share (0-1) of a 1-99 rating. */
const share = (r) => clamp((r - 1) / 98, 0, 1);
/** A rating mapped linearly onto [a, b] (rating 1 -> a, 99 -> b). */
const mapRating = (r, [a, b]) => lerp(a, b, share(r));

/** How much this pitcher's pitches break (share of normal) at a PERFECT tap and no fatigue: what the aim arc shows. */
export function pitcherStuff(pitcher, cfg = CONFIG) {
  return mapRating(pitcher.stf, cfg.pitching.stuff);
}

/**
 * How long the ring takes, and when it meets the dot (seconds). Harder pitches, worse Control and a tired arm shrink it faster.
 */
export function ringTiming(pitcher, type, fatigueF = 0, cfg = CONFIG) {
  const p = cfg.pitching;
  const ctl = 1 + p.control * (share(pitcher.ctl) * 2 - 1);
  const speed = (p.ringSpeed[type] ?? 1) * (1 + p.stamina.tireRing * fatigueF);
  const time = (p.ring.time * ctl) / speed;
  return { time, hitAt: p.ring.hitAt * time };
}

/** Grades a tap by its error in ms (negative = early, null = no tap). */
export function gradeTap(errMs, cfg = CONFIG) {
  if (errMs == null) return 'wild';
  const a = Math.abs(errMs), r = cfg.pitching.ring;
  if (a <= r.perfect) return 'perfect';
  if (a <= r.good) return 'good';
  if (a <= r.ok) return 'ok';
  return 'wild';
}

/** The speed (mph) of a pitch type for this pitcher before the tap's grade and fatigue (what the pitch buttons show). */
export function pitchTopMph(pitcher, type, cfg = CONFIG) {
  return type === 'heater'
    ? mapRating(pitcher.vel, cfg.pitch.heaterSpeed)
    : mapRating(pitcher.vel, cfg.pitching.velo) + (cfg.pitch.types[type]?.speedDelta ?? 0);
}

/**
 * The pitch that leaves the hand: speed, where it is headed (before any break), how much it breaks.
 * errMs: tap error in ms (negative = early; null = no tap = wild). fatigueF: 0-1 (see `fatigue`).
 */
export function throwPitch({ pitcher, type, aim, errMs, fatigueF = 0, rng }, cfg = CONFIG) {
  const p = cfg.pitching;
  const grade = gradeTap(errMs, cfg);
  const g = p.grades[grade];
  const tire = p.stamina;

  // Speed: Velocity sets the fastball, the type moves it, the grade and a tired arm take some off.
  const base = pitchTopMph(pitcher, type, cfg);
  const speedMph = base * g.speed - tire.tireVelo * fatigueF;
  let movementScale = mapRating(pitcher.stf, p.stuff) * g.brk * (1 - tire.tireBreak * fatigueF);

  // Where it goes: the aim, then a random miss and a push for the tap (early = up and arm side, late = down and glove side).
  const reach = cfg.swing.reach;
  const ax = clamp(aim.x, -reach.x, reach.x);
  const ay = clamp(aim.y, reach.yMin, reach.yMax);
  const armX = pitcher.hand === 'L' ? 1 : -1;
  const dir = errMs == null ? 0 : Math.sign(errMs);
  const push = errMs == null ? 0 : Math.min(Math.abs(errMs), 250) / 250;
  const tiredMiss = 1 + tire.tireMiss * fatigueF;
  let x, y, wildKind = null;

  if (grade === 'wild' && rng.chance(p.hang.share)) {
    // Hang: floats toward the middle of the zone with hardly any break (scatter is the small PERFECT one).
    wildKind = 'hang';
    const sd = p.grades.perfect.miss * tiredMiss;
    x = ax + (0 - ax) * p.hang.pull + rng.gauss(0, sd);
    y = ay + (cfg.timing.zoneCenterY - ay) * p.hang.pull + p.hang.up + rng.gauss(0, sd);
    movementScale *= p.hang.brk;
  } else {
    if (grade === 'wild') wildKind = 'sail';
    const miss = g.miss * tiredMiss;
    x = ax + rng.gauss(0, miss) - dir * armX * push * miss;
    y = ay + rng.gauss(0, miss) - dir * push * miss;
  }

  // Same limits as the computer pitcher's targets.
  y = clamp(y, 0.5, 5.6);
  x = clamp(x, -3.4, 3.4);
  return { type, speedMph, target: { x, y }, movementScale, grade, wildKind, errMs: errMs ?? null };
}

/** 0 = fresh, 1 = spent: fatigue only starts once the tank is below `tireFrom`. */
export function fatigue(left, max, cfg = CONFIG) {
  const from = cfg.pitching.stamina.tireFrom;
  if (max <= 0) return 1;
  return clamp((from - left / max) / from, 0, 1);
}

/** What one pitch takes out of the tank. */
export function pitchCost({ type, balls = 0, risp = false }, cfg = CONFIG) {
  const s = cfg.pitching.stamina;
  return s.cost * (type === 'heater' ? s.heater : 1) * (balls >= 3 ? s.threeBalls : 1) * (risp ? s.risp : 1);
}

/** Size of a pitcher's tank (starters and relievers differ). */
export function staminaMax(pitcher, cfg = CONFIG) {
  const s = cfg.pitching.stamina;
  return mapRating(pitcher.sta, pitcher.role === 'RP' ? s.reliever : s.starter);
}

/**
 * PAINTED: a perfect pitch of yours that was called (or swung at) as a strike on the very edge of the zone. `call` is the pitch call
 * ('calledStrike' / 'swingingStrike') or, for a plate appearance's last pitch, its result ('strikeoutLooking' ...).
 */
export function isPainted(pitch, call, cfg = CONFIG) {
  if (!pitch || !pitch.mine || pitch.grade !== 'perfect') return false;
  if (call !== 'calledStrike' && call !== 'swingingStrike' && !/^strikeout/.test(call || '')) return false;
  return Math.abs(zoneEdgeDistance(pitch.target.x, pitch.target.y, cfg)) <= cfg.pitching.painted;
}
