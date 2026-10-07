// The opening shot of a game (picture only): the camera swings in over the ballpark from high beyond the outfield, round the
// right-field side and down to behind home plate, like a broadcast opening. Pure camera maths: `introShot(u, o)` gives the camera
// at u = 0..1 of the shot. Feet, the usual field axes (+z toward the camera behind home, -z to center field).
import { CONFIG } from '../config.js';

const smooth = (x) => x * x * (3 - 2 * x);
const lerp = (a, b, t) => a + (b - a) * t;

/**
 * @param {number} u 0..1 through the shot
 * @param {object} o { dome: true for a closed roof (the camera stays under it), side: +1 swing round the right-field side, -1 the left }
 * @returns {{ pos: number[], look: number[], fov: number }}
 */
export function introShot(u, o = {}) {
  const I = CONFIG.intro;
  const t = Math.max(0, Math.min(1, u));
  const k = smooth(t);
  const side = o.side || 1;
  const R0 = o.dome ? I.domeRadius : I.radius[0], Y0 = o.dome ? I.domeHeight : I.height[0];
  const th = side * lerp(I.angle[0], I.angle[1], k) * Math.PI / 180;
  const r = lerp(R0, I.radius[1], t * t);
  // high over the stands until it is round behind the infield, then down to the plate
  const y = lerp(Y0, I.height[1], smooth(Math.max(0, (t - I.descendFrom) / (1 - I.descendFrom))));
  const c = I.centre;
  const pos = [c[0] + r * Math.sin(th), y, c[2] + r * Math.cos(th)];
  const look = [0, lerp(I.lookFrom[1], I.lookTo[1], k), lerp(I.lookFrom[2], I.lookTo[2], k)];
  return { pos, look, fov: lerp(I.fov[0], I.fov[1], k) };
}
