// The pitch guide: where a soft circle over the strike zone says the pitch will cross the plate, and how strongly it shows.
// Pure logic (the picture is render/pitchGuide.js). It is deliberately NOT exact - that is what keeps a ball-or-strike decision hard:
//   - it fades in part of the way through the flight (later on the harder levels),
//   - the guess starts out assuming the pitch will not break (gravity only), so curveballs, sliders and changeups only show where
//     they really end up late (the guess slides from "if it did not break" to the real spot between `reveal[0]` and `reveal[1]`),
//   - the guess is a little off, by an amount that is fixed for a given pitch (so the circle never jitters) and grows with the level,
//     and the circle is bigger and softer the less sure the guess is.
import { CONFIG } from '../config.js';
import { createRng } from '../util/rng.js';
import { clamp } from '../util/math.js';

const smooth = (a, b, x) => { const t = clamp((x - a) / Math.max(1e-9, b - a), 0, 1); return t * t * (3 - 2 * t); };

// a repeatable random offset for one pitch (the same pitch always gets the same miss)
function pitchNoise(pitch) {
  const t = pitch.target;
  let h = 2166136261;
  for (const n of [Math.round(t.x * 1000), Math.round(t.y * 1000), Math.round((pitch.speedMph || 0) * 10), pitch.id || 0]) { h ^= (n | 0) + 0x9e3779b9; h = Math.imul(h, 16777619); }
  const r = createRng(h >>> 0);
  return [clamp(r.gauss(0, 1), -2.2, 2.2), clamp(r.gauss(0, 1), -2.2, 2.2)];
}

/**
 * @param {object} pitch    { flight (from buildPitch), target, speedMph, id? }
 * @param {number} elapsed  seconds since the ball left the pitcher's hand
 * @param {object} [cfg]
 * @param {string} [level]  'rookie' | 'pro' | 'allstar'
 * @returns {{visible:boolean, alpha:number, x:number, y:number, radius:number, f:number, error:number}}
 */
export function pitchGuide(pitch, elapsed, cfg = CONFIG, level = 'pro') {
  const G = cfg.pitch.guide;
  const L = (cfg.difficulty[level] || cfg.difficulty.pro).guide;
  const fl = pitch.flight;
  const f = clamp(elapsed / fl.T, 0, 1);
  const alpha = G.maxAlpha * smooth(L.fadeIn[0], L.fadeIn[1], f);
  // where the pitch would cross the plate if it did not break at all (it flew the straight line it left the hand on, with only gravity
  // pulling it down): that is what the eye guesses at first. Its real spot is the target; the guess slides there as the break shows.
  const g = cfg.physics.gravity, T = fl.T;
  const p0 = fl.at(0), v0 = fl.velocity(0);
  const straightX = p0.x + v0.x * T, straightY = p0.y + v0.y * T - 0.5 * g * T * T;
  const reveal = smooth(L.reveal[0], L.reveal[1], f);
  const gx = straightX + (pitch.target.x - straightX) * reveal;
  const gy = straightY + (pitch.target.y - straightY) * reveal;
  // the guess is a little off at first (fixed for this pitch) and homes in on the real spot as the ball comes - by the end of `sharpen`
  // it is exactly where the ball will cross, and the circle has closed in to just bigger than the ball
  const home = smooth(L.sharpen[0], L.sharpen[1], f);
  const err = L.error * (1 - home);
  const [nx, ny] = pitchNoise(pitch);
  const radius = G.radiusEnd + (G.radiusStart - G.radiusEnd) * (1 - smooth(L.fadeIn[0], L.sharpen[1], f));
  return { visible: alpha > 0.004 && f < 1, alpha, x: gx + nx * err, y: gy + ny * err, radius, f, error: err };
}
