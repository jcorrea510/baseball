// Decides what the pitcher throws: type, speed and where it is aimed.
import { CONFIG, PITCH_ORDER } from '../config.js';
import { clamp } from '../util/math.js';
import { isStrike, zoneRatio, hitsBatter } from '../physics/pitch.js';

/**
 * @param {object} o
 * @param {'quick'|'derby'|'practice'} o.mode
 * @param {string} o.difficulty
 * @param {{balls:number,strikes:number}} [o.count]
 * @param {object} o.rng
 * @param {'R'|'L'} [o.batterHand]
 * @param {object} [o.practice]  { type: key|'mixed', speed: mph, location: 'random'|'center' }
 * @param {string} [o.lastType]
 * @param {boolean} [o.intended]  quick game: return the spot he aims at (no command scatter, no pitch that gets away at the batter)
 * @param {string[]} [o.arsenal]  the pitches this pitcher throws (quick game): the type is drawn only from them (see arsenalMix)
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
  const mix = o.arsenal && o.arsenal.length ? arsenalMix(o.arsenal, cfg) : { ...d.mix };
  // (a type the pitcher does not throw is simply not in the mix: the count rules skip it)
  const scale = (t, k) => { if (mix[t]) mix[t] *= k; };
  if (count.strikes === 2) {
    // put-away pitches
    scale('curveball', 1.5); scale('slider', 1.5); scale('fastball', 0.85);
  }
  if (count.balls === 3) { scale('curveball', 0.4); scale('changeup', 0.6); }
  if (o.lastType && rng.chance(0.35)) scale(o.lastType, 0.5); // avoid repeating too much
  const type = rng.weighted(mix);

  // Where does it go? First decide what kind of pitch this is (in the zone, on the edge, a chase pitch or one way out of reach),
  // using the odds for this difficulty, then shift the odds for the count: with three balls he has to throw strikes, with two
  // strikes he tries to get you to chase.
  const away = (o.batterHand || 'R') === 'R' ? 1 : -1; // outside corner
  const w = { ...d.locations };
  if (count.balls === 3) { w.heart *= 4; w.edge *= 0.8; w.chase *= 0.06; w.waste *= 0.03; }
  else if (count.balls === 2 && count.strikes < 2) { w.heart *= 1.5; w.chase *= 0.55; w.waste *= 0.35; }
  if (count.strikes === 2 && count.balls < 3) { w.heart *= 0.7; w.chase *= 1.5; w.waste *= 1.3; }
  const kind = rng.weighted(w);
  // which way does this pitch break sideways? (a righty's slider goes toward the first-base side, his changeup fades the other way)
  const armSign = (o.pitcherHand || 'R') === 'R' ? -1 : 1;
  const breakDir = Math.sign(armSign * (cfg.pitch.types[type].breakArm || 0)) || away;
  let { x, y } = pickTarget(kind, type, away, cfg, rng, { zoneMidY, hw, halfH }, breakDir);
  // (`intended`: the spot he means to hit, before his wildness - your auto pitcher, whose misses come from the ring grade instead)
  if (!o.intended) {
    x += rng.gauss(0, d.commandSigma * 0.5);
    y += rng.gauss(0, d.commandSigma * 0.5);
  }
  const wild = !o.intended && rng.next() < (d.hitBatter || 0); // (one gets away from him, in at the batter)
  if (wild) { const H = cfg.pitch.hitBatter; x = -away * rng.range(H.inner + 0.1, H.inner + 0.75); y = rng.range(1.5, 4.2); }
  else if (kind === 'waste') { // never let his wildness bring a wasted pitch back toward the zone
    const r = zoneRatio(x, y, cfg);
    if (r < cfg.pitch.wasteMinRatio) { const k = cfg.pitch.wasteMinRatio / Math.max(0.5, r); x = zoneMidX(x, k); y = zoneMidY + (y - zoneMidY) * k; }
  }
  y = clamp(y, 0.5, 5.6);
  x = clamp(x, -3.4, 3.4);
  // (a pitch he means to waste inside stays just off the batter - he leans back from it; only one that gets away hits him)
  if (!wild && hitsBatter(x, y, o.batterHand || 'R', cfg)) x = -away * (cfg.pitch.hitBatter.inner - 0.1);
  if (o.intended && -away * x > cfg.pitch.hitBatter.inner - 0.1) x = -away * (cfg.pitch.hitBatter.inner - 0.1); // (never aimed closer to him than that)
  const strike = isStrike(x, y, cfg);

  let speed;
  if (type === 'heater') speed = rng.range(cfg.pitch.heaterSpeed[0], cfg.pitch.heaterSpeed[1]);
  else {
    const fb = rng.range(d.fastball[0], d.fastball[1]);
    speed = fb + cfg.pitch.types[type].speedDelta + (type === 'fastball' ? 0 : rng.range(-1.5, 1.5));
  }
  return { type, speedMph: speed, target: { x, y }, intendedStrike: strike, tell: tell(type), announce: d.announcePitch };
}

const zoneMidX = (x, k) => x * k;

// The odds of each type for a pitcher who throws only `arsenal`: his fastball (and sinker) together `pitch.arsenalFast`, split
// equally between them; every other listed type an equal share of the rest (the heater only when it is listed).
function arsenalMix(arsenal, cfg) {
  const FAST = ['fastball', 'sinker'];
  const types = [...new Set(arsenal)].filter((t) => cfg.pitch.types[t]);
  const fast = types.filter((t) => FAST.includes(t)), other = types.filter((t) => !FAST.includes(t));
  const fastShare = !other.length ? 1 : !fast.length ? 0 : cfg.pitch.arsenalFast;
  const mix = {};
  for (const t of fast) mix[t] = fastShare / fast.length;
  for (const t of other) mix[t] = (1 - fastShare) / other.length;
  return mix;
}

// Which way does a pitch that is not a strike miss? Angles in the plane of the plate as the batter sees it:
// 0 = the way the pitch breaks sideways (fastballs: away from the batter), PI/2 = up, PI = the other way, -PI/2 = down.
// Breaking pitches miss the way they break (so they start as strikes and move out of the zone); fastballs go up or in.
// (Every pitch STARTS on a path toward the zone, because movement is built into the flight: a slider aimed off the plate
//  begins as a strike and breaks away; a curveball aimed in the dirt begins at the belt and drops out; a fastball aimed high
//  rises out of the zone.)
const MISS = {
  fastball: { chase: [[1.0, 1.9, 0.55], [2.5, 3.3, 0.25], [-0.5, 0.4, 0.2]], waste: [[1.2, 1.9, 0.5], [2.6, 3.3, 0.25], [-0.4, 0.4, 0.25]] },
  heater: { chase: [[1.1, 1.9, 0.8], [2.6, 3.3, 0.2]], waste: [[1.3, 1.85, 0.85], [2.7, 3.3, 0.15]] },
  curveball: { chase: [[-1.9, -1.2, 0.7], [-1.0, -0.3, 0.3]], waste: [[-1.85, -1.3, 0.85], [-1.0, -0.4, 0.15]] },
  slider: { chase: [[-0.5, 0.4, 0.75], [-1.1, -0.5, 0.25]], waste: [[-0.4, 0.35, 0.7], [-1.1, -0.5, 0.3]] },
  changeup: { chase: [[-1.9, -1.2, 0.5], [-1.2, -0.4, 0.5]], waste: [[-1.9, -1.3, 0.6], [-1.2, -0.5, 0.4]] },
};
const BREAKS_SIDEWAYS = { curveball: true, slider: true, changeup: true };

/** The spot (x, y) where a pitch of this kind crosses the plate. */
export function pickTarget(kind, type, away, cfg, rng, g, breakDir = away) {
  const { zoneMidY, hw, halfH } = g;
  const P = cfg.pitch.locations;
  if (kind === 'heart') {
    let x = rng.range(-0.62, 0.62), y = zoneMidY + rng.range(-0.72, 0.72);
    if (type === 'curveball') y -= 0.25;
    if (type === 'slider') x += away * 0.2;
    if (type === 'fastball' || type === 'heater') y += 0.15;
    return { x, y };
  }
  let r, phi;
  if (kind === 'edge') { r = rng.range(P.edge[0], P.edge[1]); phi = rng.range(0, 2 * Math.PI); }
  else {
    const range = kind === 'chase' ? P.chase : P.waste;
    r = rng.range(range[0], range[1]);
    const opts = (MISS[type] || MISS.fastball)[kind];
    const pick = rng.weighted(Object.fromEntries(opts.map((o, i) => [i, o[2]])));
    const o = opts[+pick];
    phi = rng.range(o[0], o[1]);
  }
  // a pitch at "ratio" r from the middle of the zone (1.0 = the edge), in direction phi
  const side = BREAKS_SIDEWAYS[type] && kind !== 'edge' ? breakDir : away;
  return { x: side * hw * r * Math.cos(phi), y: zoneMidY + halfH * r * Math.sin(phi) };
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
