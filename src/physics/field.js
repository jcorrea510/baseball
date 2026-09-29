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
