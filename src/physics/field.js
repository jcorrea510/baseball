// Ballpark geometry: bases, fence shape, fair/foul, grandstand profile.
// Coordinates: origin = back tip of home plate, +x = right field side, -z = toward center field.
import { CONFIG } from '../config.js';
import { DEG } from '../util/math.js';

const B = CONFIG.field.baseDistance / Math.SQRT2;

// Index 0 = home, 1..3 = bases, 4 = home again (scoring). Each is [x, z].
export const BASE_XZ = [
  [0, 0],
  [B, -B],
  [0, -2 * B],
  [-B, -B],
  [0, 0],
];

export const MOUND_XZ = [0, -CONFIG.field.moundDistance];

export function polar(sprayDeg, dist) {
  const a = sprayDeg * DEG;
  return { x: Math.sin(a) * dist, z: -Math.cos(a) * dist };
}

// Spray angle (degrees) of a point seen from home plate. 0 = straight to center.
export function sprayOf(x, z) {
  return Math.atan2(x, -z) / DEG;
}

// Catmull-Rom through the fence control points so the wall curves smoothly.
const pts = CONFIG.field.fencePoints;
export function fenceDistance(sprayDeg) {
  const a = Math.max(pts[0][0], Math.min(pts[pts.length - 1][0], sprayDeg));
  let i = 0;
  while (i < pts.length - 2 && a > pts[i + 1][0]) i++;
  const p0 = pts[Math.max(0, i - 1)][1];
  const p1 = pts[i][1];
  const p2 = pts[i + 1][1];
  const p3 = pts[Math.min(pts.length - 1, i + 2)][1];
  const t = (a - pts[i][0]) / (pts[i + 1][0] - pts[i][0]);
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

export const FENCE_HEIGHT = CONFIG.field.fenceHeight;

// Fair territory: in front of the plate and between the foul lines.
export function isFairXZ(x, z) {
  return z < 0 && Math.abs(x) <= -z + 1e-6;
}

// Height of the grandstand seating surface beyond the fence (`over` feet past the wall).
// It rises at a constant slope, then flattens into the "roof" level; a ball must
// clear that level to leave the park entirely.
export function standsHeight(over) {
  const s = CONFIG.field.stands;
  return CONFIG.field.fenceHeight + Math.min(Math.max(over, 0), s.depth) * s.slope;
}

export function distanceFromHome(x, z) {
  return Math.hypot(x, z);
}

// Distance between two [x,z] points.
export function distXZ(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

// ---------------------------------------------------------------------------------------------------------------
// Where can a person stand? The ballpark outline: the outfield wall, the foul-territory walls and the backstop
// (the same shape the stadium is drawn with, see render/perimeter.js). Fielders are kept inside it.
// ---------------------------------------------------------------------------------------------------------------
const PLAYABLE = (() => {
  const poly = [];
  for (let a = -45; a <= 45.0001; a += 1.5) { const p = polar(a, fenceDistance(a)); poly.push([p.x, p.z]); } // left pole -> right pole
  const S = Math.SQRT1_2;
  const side = (sd) => {
    const P = polar(45 * sd, fenceDistance(45 * sd));
    const c = [[P.x + sd * S * 16, P.z + S * 4]]; // just outside the pole
    for (const s of [285, 225, 165, 110, 60, 20]) {
      const w = 12 + 58 * Math.pow(1 - s / 315, 1.15); // how far outside the foul line the wall stands, s feet from home
      c.push([sd * S * (s + w), -S * s + S * w]);
    }
    return c;
  };
  const back = [[46, 78], [24, 92], [0, 96], [-24, 92], [-46, 78]];
  return poly.concat(side(1), back, side(-1).reverse());
})();

function pointInPolygon(x, z, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** Is this spot inside the ballpark, at least `margin` feet away from every wall? (negative margin = allow that far past) */
export function isInsideField(x, z, margin = 0) {
  const inside = pointInPolygon(x, z, PLAYABLE);
  if (margin === 0) return inside;
  const n = nearestEdge(x, z);
  return margin > 0 ? inside && n.d >= margin : inside || n.d <= -margin;
}

/** Signed distance to the nearest wall: positive = inside the ballpark, negative = outside. */
export function wallClearance(x, z) {
  const d = nearestEdge(x, z).d;
  return pointInPolygon(x, z, PLAYABLE) ? d : -d;
}

function nearestEdge(x, z) {
  let best = { d: Infinity, px: x, pz: z };
  for (let i = 0, j = PLAYABLE.length - 1; i < PLAYABLE.length; j = i++) {
    const [ax, az] = PLAYABLE[j], [bx, bz] = PLAYABLE[i];
    const ex = bx - ax, ez = bz - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / (ex * ex + ez * ez || 1)));
    const px = ax + ex * t, pz = az + ez * t;
    const d = Math.hypot(x - px, z - pz);
    if (d < best.d) best = { d, px, pz };
  }
  return best;
}

/** The closest spot to (x, z) that is inside the ballpark and at least `margin` feet from every wall. */
export function clampToField(x, z, margin = 0) {
  const inside = pointInPolygon(x, z, PLAYABLE);
  const n = nearestEdge(x, z);
  if (inside && n.d >= margin) return [x, z];
  let ix, iz;
  if (n.d < 1e-6) { ix = -x; iz = -120 - z; } // exactly on the wall: toward the middle of the field
  else if (inside) { ix = x - n.px; iz = z - n.pz; }
  else { ix = n.px - x; iz = n.pz - z; }
  const l = Math.hypot(ix, iz) || 1;
  return [n.px + (ix / l) * margin, n.pz + (iz / l) * margin];
}

/**
 * Starting inside the park and walking along (ux, uz): how many feet until the wall? (Infinity if never)
 * With `body` (feet), stop that far short of the wall measured straight out from it - so a fielder whose centre may get
 * `body` from the wall still has that much room when he reaches it at a slant.
 */
export function distanceToWall(x0, z0, ux, uz, body = 0) {
  let best = Infinity;
  for (let i = 0, j = PLAYABLE.length - 1; i < PLAYABLE.length; j = i++) {
    const [ax, az] = PLAYABLE[j], [bx, bz] = PLAYABLE[i];
    const ex = bx - ax, ez = bz - az;
    const den = ux * ez - uz * ex;
    if (Math.abs(den) < 1e-9) continue;
    const t = ((ax - x0) * ez - (az - z0) * ex) / den;
    const u = ((ax - x0) * uz - (az - z0) * ux) / den;
    if (t <= 1e-6 || u < 0 || u > 1) continue;
    const cos = Math.max(0.25, Math.abs(den) / Math.hypot(ex, ez)); // how squarely he meets this wall (1 = head on)
    const tt = t - body / cos;
    if (tt < best) best = tt;
  }
  return best;
}
