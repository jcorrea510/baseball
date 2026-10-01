// The outline of the ballpark (outfield wall + foul-territory walls + backstop), as a list of
// points with outward normals. Stands, walls, warning track and crowd all hang off it.
import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { fenceDistance, fenceHeightAt, polar } from '../physics/field.js';


// kind: 'of' = outfield fence (exact fence curve used by the physics), 'foul' = foul territory wall, 'back' = behind home
export function buildPerimeter() {
  const pts = [];
  // ---- outfield arc (left pole -> right pole) ----
  const STEP = 1.5;
  for (let a = -45; a <= 45.0001; a += STEP) {
    const d = fenceDistance(a);
    const p = polar(a, d);
    const len = Math.hypot(p.x, p.z);
    pts.push({ x: p.x, z: p.z, nx: p.x / len, nz: p.z / len, h0: fenceHeightAt(a), kind: 'of', a });
  }
  const pole = (side) => polar(45 * side, fenceDistance(45 * side));

  // ---- foul-territory walls and the back, as a smooth spline ----
  const ctrlFor = (side) => {
    const P = pole(side);
    const dir = new THREE.Vector3(side * 0.7071, 0, -0.7071); // along the foul line, away from home
    const nrm = new THREE.Vector3(side * 0.7071, 0, 0.7071); // outward
    const c = [new THREE.Vector3(P.x, 0, P.z).addScaledVector(nrm, 10).addScaledVector(dir, 6)];
    for (const s of [285, 225, 165, 110, 60, 20]) {
      const w = 12 + 58 * Math.pow(1 - s / 315, 1.15);
      c.push(dir.clone().multiplyScalar(s).addScaledVector(nrm, w));
    }
    return c;
  };
  const right = ctrlFor(1);
  const left = ctrlFor(-1).reverse();
  const back = [new THREE.Vector3(46, 0, 78), new THREE.Vector3(24, 0, 92), new THREE.Vector3(0, 0, 96), new THREE.Vector3(-24, 0, 92), new THREE.Vector3(-46, 0, 78)];
  const pR = pole(1), pL = pole(-1);
  const ctrl = [new THREE.Vector3(pR.x, 0, pR.z), ...right, ...back, ...left, new THREE.Vector3(pL.x, 0, pL.z)];
  const curve = new THREE.CatmullRomCurve3(ctrl, false, 'centripetal');
  const N = 140;
  const seg = [];
  for (let i = 1; i < N; i++) {
    const t = i / N;
    const p = curve.getPoint(t);
    const tg = curve.getTangent(t);
    // Travelling right pole -> home -> left pole. Outward normal is to the LEFT of travel (in xz)
    // for this direction of travel; verify against the outward direction from the field centre.
    let nx = tg.z, nz = -tg.x;
    const cx = p.x, cz = p.z + 100; // vector from the field centre (0,-100) to the point
    if (nx * cx + nz * cz < 0) { nx = -nx; nz = -nz; }
    const l = Math.hypot(nx, nz) || 1;
    // walls near the outfield poles start at fence height and step down toward the plate
    const h0 = 5 + 5 * Math.min(1, Math.abs(p.x) / 180);
    const kind = p.z > 40 ? 'back' : 'foul';
    seg.push({ x: p.x, z: p.z, nx: nx / l, nz: nz / l, h0, kind, a: 0 });
  }
  // Order: the outfield arc runs left -> right; the connecting spline runs right -> left,
  // which closes the loop.
  const loop = pts.concat(seg);
  // arc-length parameter
  let acc = 0;
  loop[0].s = 0;
  for (let i = 1; i < loop.length; i++) {
    acc += Math.hypot(loop[i].x - loop[i - 1].x, loop[i].z - loop[i - 1].z);
    loop[i].s = acc;
  }
  // (closing segment from last point back to first)
  return loop;
}

// Build a vertical ribbon along a list of perimeter points.
// offset: distance outward from the wall line. y0..y1: height range.
export function ribbonGeometry(points, { offset = 0, y0 = 0, y1 = 1, uPerFt = 0.1, vScale = 1 } = {}) {
  const n = points.length;
  const pos = new Float32Array(n * 2 * 3);
  const uv = new Float32Array(n * 2 * 2);
  const idx = [];
  for (let i = 0; i < n; i++) {
    const p = points[i];
    const x = p.x + p.nx * offset, z = p.z + p.nz * offset;
    const ya = typeof y0 === 'function' ? y0(p) : y0;
    const yb = typeof y1 === 'function' ? y1(p) : y1;
    pos.set([x, ya, z, x, yb, z], i * 6);
    const u = p.s * uPerFt;
    uv.set([u, 0, u, vScale], i * 4);
    if (i < n - 1) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// Flat strip lying on the ground, between `inner` and `outer` distances from the wall line (inward positive).
export function groundStripGeometry(points, { inner = 0, outer = 10, y = 0.02, uPerFt = 0.1 } = {}) {
  const n = points.length;
  const pos = new Float32Array(n * 2 * 3);
  const uv = new Float32Array(n * 2 * 2);
  const idx = [];
  for (let i = 0; i < n; i++) {
    const p = points[i];
    const w0 = typeof inner === 'function' ? inner(p) : inner;
    const w1 = typeof outer === 'function' ? outer(p) : outer;
    pos.set([p.x - p.nx * w0, y, p.z - p.nz * w0, p.x - p.nx * w1, y, p.z - p.nz * w1], i * 6);
    const u = p.s * uPerFt;
    uv.set([u, 0, u, 1], i * 4);
    if (i < n - 1) {
      const a = i * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
