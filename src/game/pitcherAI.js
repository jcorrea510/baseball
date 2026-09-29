// Decides what the pitcher throws: type, speed and where it is aimed.
import { CONFIG, PITCH_ORDER } from '../config.js';
import { clamp } from '../util/math.js';

/**
 * @param {object} o
 * @param {'quick'|'derby'|'practice'} o.mode
 * @param {string} o.difficulty
 * @param {{balls:number,strikes:number}} [o.count]
 * @param {object} o.rng
 * @param {'R'|'L'} [o.batterHand]
 * @param {object} [o.practice]  { type: key|'mixed', speed: mph, location: 'random'|'center' }
 * @param {string} [o.lastType]
 */
export function choosePitch(o, cfg = CONFIG) {
  const rng = o.rng;
  const d = cfg.difficulty[o.difficulty] || cfg.difficulty.pro;
  const zoneMidY = cfg.timing.zoneCenterY;
  const hw = cfg.pitch.zoneHalfWidth;
  const halfH = cfg.timing.zoneHalfHeight;
  const tell = (type) => tellFor(type, d);

  if (o.mode === 'derby') {
    const speed = cfg.modes.derby.pitchSpeed[o.difficulty] + rng.range(-1.5, 1.5);
    const sig = cfg.modes.derby.locationSigma;
    const x = clamp(rng.gauss(0, sig), -0.55, 0.55);
    const y = clamp(zoneMidY + rng.gauss(0, sig), zoneMidY - 0.6, zoneMidY + 0.6);
    return { type: 'fastball', speedMph: speed, target: { x, y }, intendedStrike: true, tell: tell('fastball'), announce: false };
  }

  if (o.mode === 'practice') {
    const p = o.practice || {};
    const baseSpeed = p.speed ?? cfg.modes.practice.speedDefault;
    let type = p.type || 'fastball';
    let speed = baseSpeed;
    if (type === 'mixed') {
      type = rng.weighted({ fastball: 0.35, changeup: 0.2, curveball: 0.2, slider: 0.25 });
      speed = baseSpeed + cfg.pitch.types[type].speedDelta + rng.range(-1, 1);
    }
    let x, y;
    if (p.location === 'center') { x = 0; y = zoneMidY; }
    else if (p.location === 'edges') {
      const s = rng.chance(0.5) ? -1 : 1;
      x = s * rng.range(0.4, 0.75); y = zoneMidY + rng.range(-0.75, 0.75);
    } else { x = rng.range(-0.65, 0.65); y = zoneMidY + rng.range(-0.8, 0.8); }
    return { type, speedMph: clamp(speed, 40, 110), target: { x, y }, intendedStrike: true, tell: tell(type), announce: true };
  }

  // ---- Quick game: pick a pitch like a pitcher would ----
  const count = o.count || { balls: 0, strikes: 0 };
  const mix = { ...d.mix };
  if (count.strikes === 2) {
    // put-away pitches
    mix.curveball *= 1.5; mix.slider *= 1.5; mix.fastball *= 0.85;
  }
  if (count.balls === 3) { mix.curveball *= 0.4; mix.changeup *= 0.6; }
  if (o.lastType && rng.chance(0.35)) mix[o.lastType] *= 0.5; // avoid repeating too much
  const type = rng.weighted(mix);

  let pStrike = d.strikeRate;
  if (count.balls === 3) pStrike = 0.95;
  else if (count.balls === 2 && count.strikes < 2) pStrike += 0.12;
  if (count.strikes === 2 && count.balls < 3) pStrike -= 0.22;
  const strike = rng.chance(clamp(pStrike, 0.15, 0.97));
  const away = (o.batterHand || 'R') === 'R' ? 1 : -1; // outside corner
  let x, y;
  if (strike) {
    x = rng.range(-0.62, 0.62);
    y = zoneMidY + rng.range(-0.72, 0.72);
    if (type === 'curveball') y -= 0.25;
    if (type === 'slider') x += away * 0.2;
    if (type === 'fastball' || type === 'heater') y += 0.15;
  } else {
    const mode = rng.weighted({ outside: 3, low: 3, high: 1.2, inside: 1.5 });
    if (mode === 'outside') { x = away * (hw + rng.range(0.15, 0.85)); y = zoneMidY + rng.range(-0.8, 0.6); }
    else if (mode === 'inside') { x = -away * (hw + rng.range(0.15, 0.7)); y = zoneMidY + rng.range(-0.7, 0.6); }
    else if (mode === 'low') { x = rng.range(-0.7, 0.7); y = cfg.pitch.zoneBottom - rng.range(0.25, 0.85); }
    else { x = rng.range(-0.6, 0.6); y = cfg.pitch.zoneTop + rng.range(0.2, 0.7); }
  }
  x += rng.gauss(0, d.commandSigma * 0.5);
  y += rng.gauss(0, d.commandSigma * 0.5);
  y = Math.max(y, 0.55);

  let speed;
  if (type === 'heater') speed = rng.range(cfg.pitch.heaterSpeed[0], cfg.pitch.heaterSpeed[1]);
  else {
    const fb = rng.range(d.fastball[0], d.fastball[1]);
    speed = fb + cfg.pitch.types[type].speedDelta + (type === 'fastball' ? 0 : rng.range(-1.5, 1.5));
  }
  return { type, speedMph: speed, target: { x, y }, intendedStrike: strike, tell: tell(type), announce: d.announcePitch };
}

// How the pitcher's body gives the pitch away. slot: arm height offset; lag: slower arm (changeup).
export function tellFor(type, d) {
  const def = CONFIG.pitch.types[type];
  const s = d.tellStrength;
  return {
    slot: (def.armSlot || 0) * s * 3.0,
    lag: type === 'changeup' ? s * 1.2 : 0,
  };
}

// Timing-window scale for a given pitch (the heater is harder to time).
export function pitchWindowScale(type) {
  return type === 'heater' ? 0.85 : 1;
}

export { PITCH_ORDER };
