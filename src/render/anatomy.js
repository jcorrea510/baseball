// Body-part shapes for the players (rig.js), made in code: smooth surfaces lofted through cross-sections, so an arm has a deltoid,
// biceps and a slim wrist, a calf bulges, a face has a brow, cheekbones and a jaw. Geometry only (no game logic); the parts are
// merged per bone by rig.js exactly like its other primitives.
import * as THREE from 'three';

const cache = new Map();

// How far out a ring reaches at angle `th` (radians; 0 = +z, the front; +PI/2 = +x, the figure's left): 1 + the bumps there.
function bumpAt(bumps, th) {
  let k = 1;
  if (!bumps) return k;
  for (const b of bumps) {
    let d = th - b.a;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    if (Math.abs(d) < b.w) k += b.h * 0.5 * (1 + Math.cos((Math.PI * d) / b.w));
  }
  return k;
}

const cr = (p0, p1, p2, p3, t) => {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
};

/**
 * A smooth closed surface swept through `rings` (in order along the part, usually from the joint down).
 * Ring: { y, rx, rz, x = 0, z = 0, bumps = [{ a, w, h }] } - an ellipse of half-widths rx (left-right) and rz (front-back) centred at
 * (x, y, z); a bump pushes it out by h x the radius around angle a (+- w, a cosine bump). Between rings the surface follows a
 * Catmull-Rom curve (`sub` steps per span). Columns start at the figure's right (-x) and go round through the front, so the
 * front is at u = 0.25 (the jersey texture's convention). Ends are closed with a rounded cap (`dome` x the end radius).
 * @returns {THREE.BufferGeometry} (cached when `key` is given - never dispose a cached one)
 */
export function loft(rings, { seg = 16, sub = 2, cap = true, dome = 0.35, key = null } = {}) {
  if (key && cache.has(key)) return cache.get(key);
  const n = rings.length, cols = seg + 1;
  // each original ring as points round its outline
  const P = rings.map((r) => {
    const pts = [];
    for (let j = 0; j < cols; j++) {
      const th = -Math.PI / 2 + (2 * Math.PI * j) / seg;
      const k = bumpAt(r.bumps, th);
      pts.push([(r.x || 0) + Math.sin(th) * r.rx * k, r.y, (r.z || 0) + Math.cos(th) * r.rz * k]);
    }
    return pts;
  });
  const rows = [];
  for (let i = 0; i < n - 1; i++) {
    const steps = sub;
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      const a = P[Math.max(0, i - 1)], b = P[i], c = P[i + 1], d = P[Math.min(n - 1, i + 2)];
      rows.push(b.map((_, j) => [0, 1, 2].map((q) => cr(a[j][q], b[j][q], c[j][q], d[j][q], t))));
    }
  }
  rows.push(P[n - 1].map((p) => p.slice()));
  const R = rows.length;
  const nv = R * cols + (cap ? 2 : 0);
  const pos = new Float32Array(nv * 3), uv = new Float32Array(nv * 2);
  for (let i = 0; i < R; i++) {
    for (let j = 0; j < cols; j++) {
      const v = i * cols + j;
      pos.set(rows[i][j], v * 3);
      uv[v * 2] = j / seg; uv[v * 2 + 1] = 1 - i / (R - 1);
    }
  }
  const idx = [];
  for (let i = 0; i < R - 1; i++) {
    for (let j = 0; j < seg; j++) {
      const a = i * cols + j, b = (i + 1) * cols + j, c = b + 1, d = a + 1;
      idx.push(a, b, d, b, c, d);
    }
  }
  const centre = (row) => { const c = [0, 0, 0]; for (let j = 0; j < seg; j++) for (let q = 0; q < 3; q++) c[q] += row[j][q] / seg; return c; };
  const radius = (row, c) => { let s = 0; for (let j = 0; j < seg; j++) s += Math.hypot(row[j][0] - c[0], row[j][2] - c[2]); return s / seg; };
  if (cap) {
    for (const [end, other, slot] of [[0, 1, R * cols], [R - 1, R - 2, R * cols + 1]]) {
      const c = centre(rows[end]), o = centre(rows[other]);
      const ax = [c[0] - o[0], c[1] - o[1], c[2] - o[2]], L = Math.hypot(...ax) || 1;
      const r = radius(rows[end], c) * dome;
      pos.set([c[0] + (ax[0] / L) * r, c[1] + (ax[1] / L) * r, c[2] + (ax[2] / L) * r], slot * 3);
      uv[slot * 2] = 0.5; uv[slot * 2 + 1] = end === 0 ? 1 : 0;
      for (let j = 0; j < seg; j++) idx.push(slot, end * cols + j + 1, end * cols + j);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  // wind every face outward (the rings may run up or down the part)
  const side = (i) => { // a side vertex in the middle: does its face normal point away from the axis?
    const a = new THREE.Vector3().fromArray(pos, idx[i] * 3), b = new THREE.Vector3().fromArray(pos, idx[i + 1] * 3), c = new THREE.Vector3().fromArray(pos, idx[i + 2] * 3);
    const nrm = b.clone().sub(a).cross(c.clone().sub(a));
    const mid = a.add(b).add(c).divideScalar(3);
    const row = Math.floor(idx[i] / cols), ctr = centre(rows[Math.min(R - 1, row)]);
    return nrm.x * (mid.x - ctr[0]) + nrm.z * (mid.z - ctr[2]);
  };
  const midTri = Math.floor((R - 1) / 2) * seg * 6 + Math.floor(seg / 4) * 6;
  if (side(midTri) < 0) for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
  g.setIndex(idx);
  g.computeVertexNormals();
  // the seam: the first and last column are the same place - give them the same (averaged) normal
  const nor = g.getAttribute('normal');
  for (let i = 0; i < R; i++) {
    const a = i * cols, b = i * cols + seg;
    const x = nor.getX(a) + nor.getX(b), y = nor.getY(a) + nor.getY(b), z = nor.getZ(a) + nor.getZ(b), L = Math.hypot(x, y, z) || 1;
    nor.setXYZ(a, x / L, y / L, z / L); nor.setXYZ(b, x / L, y / L, z / L);
  }
  g.computeBoundingSphere();
  if (key) cache.set(key, g);
  return g;
}
