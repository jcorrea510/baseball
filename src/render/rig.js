// A procedural human figure built from primitives, with a joint hierarchy and two-bone IK
// for arms and legs. Poses are described by a small set of numbers (see poses.js); the rig turns
// them into joint rotations every frame. Person-local axes: +y up, +z = the way the person faces,
// +x = the person's LEFT hand side.
import * as THREE from 'three';
import { jerseyTexture, makeCanvas, toTexture, surfaceNormalTexture } from './textures.js';
import { torsoGeometry, upperArmParts, foreArmParts, thighParts, shinParts, handParts as handParts_, gloveParts, maskParts, cleatParts } from './anatomy.js';
import { headParts as faceParts, capParts, helmetParts } from './face.js';
import { CONFIG } from '../config.js';

// ---------------------------------------------------------------- proportions (feet)
export const DIM = {
  ankle: 0.26, shin: 1.5, thigh: 1.5,
  hipW: 0.34,
  spine: 1.75, shoulderY: 1.62, shoulderW: 0.74,
  neck: 0.22, headR: 0.37,
  upperArm: 1.05, foreArm: 0.98,
};
DIM.hipStand = DIM.ankle + DIM.shin + DIM.thigh; // hip height with straight legs (3.26)

// Where the hands hold the bat: feet up the bat from the knob to the middle of each fist (bottom hand just above the knob, the top
// hand touching it - a pose can slide the top hand up the bat with `gripTop`, as for a bunt), and the point inside a closed fist
// the handle runs through (wrist space: down toward the fingers, out toward the curled fingertips).
// `reach`: how far beyond the arm's length (shoulder to wrist) the middle of the fist can be, keeping the elbow a touch bent.
const GRIP = { bottom: 0.17, top: 0.43, point: new THREE.Vector3(0, -0.2, 0.07), reach: 0.08 };

// ---------------------------------------------------------------- pose format
export const SCALARS = ['hipY', 'pelvisYaw', 'pelvisPitch', 'pelvisRoll', 'torsoPitch', 'torsoYaw', 'torsoRoll', 'headYaw', 'headPitch', 'footLTilt', 'footRTilt', 'footLYaw', 'footRYaw', 'batYaw', 'batPitch', 'batVis', 'gloveOpen', 'gripTop'];
export const VECTORS = ['pelvis', 'footL', 'footR', 'handL', 'handR', 'poleL', 'poleR', 'kneeL', 'kneeR', 'bat'];

export function makePose(o = {}) {
  const p = {
    hipY: DIM.hipStand - 0.12, pelvisYaw: 0, pelvisPitch: 0, pelvisRoll: 0,
    torsoPitch: 0, torsoYaw: 0, torsoRoll: 0, headYaw: 0, headPitch: 0,
    footLTilt: 0, footRTilt: 0, footLYaw: 0, footRYaw: 0, batYaw: 0, batPitch: 0, batVis: 0, gloveOpen: 0.5, gripTop: GRIP.top,
    pelvis: [0, 0, 0],
    footL: [0.34, DIM.ankle, 0], footR: [-0.34, DIM.ankle, 0],
    handL: [0.78, 2.6, 0.12], handR: [-0.78, 2.6, 0.12],
    poleL: [0.9, -0.6, -0.5], poleR: [-0.9, -0.6, -0.5],
    kneeL: [0.12, 0.05, 1], kneeR: [-0.12, 0.05, 1],
    bat: [0, 3, 0],
  };
  for (const k in o) {
    if (Array.isArray(o[k])) p[k] = o[k].slice();
    else p[k] = o[k];
  }
  return p;
}
export function copyPose(dst, src) {
  for (const k of SCALARS) dst[k] = src[k];
  for (const k of VECTORS) { dst[k][0] = src[k][0]; dst[k][1] = src[k][1]; dst[k][2] = src[k][2]; }
  return dst;
}
export function mixPose(out, a, b, t) {
  for (const k of SCALARS) out[k] = a[k] + (b[k] - a[k]) * t;
  for (const k of VECTORS) {
    out[k][0] = a[k][0] + (b[k][0] - a[k][0]) * t;
    out[k][1] = a[k][1] + (b[k][1] - a[k][1]) * t;
    out[k][2] = a[k][2] + (b[k][2] - a[k][2]) * t;
  }
  return out;
}

// ---------------------------------------------------------------- shared materials / geometry
const matCache = new Map();
export function getMat(hex, rough = 0.88, metal = 0) {
  const key = hex + '|' + rough + '|' + metal;
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color: hex, roughness: rough, metalness: metal });
    matCache.set(key, m);
  }
  return m;
}
// Jersey materials are shared by everybody wearing the same shirt and counted: when the last figure wearing one is
// disposed (a new game builds new teams), its texture is freed from the graphics card too.
const jerseyCache = new Map();
function getJerseyMat(u, mirror, size = 512) {
  const key = [u.primary, u.secondary, u.trim, u.text, u.number, u.stripe, u.back || '', mirror, size].join('|');
  let e = jerseyCache.get(key);
  if (!e) {
    const m = new THREE.MeshStandardMaterial({ map: jerseyTexture({ primary: u.primary, secondary: u.secondary, trim: u.trim, text: u.text || '', number: u.number || 0, stripe: !!u.stripe, mirror, back: u.back || '', size }), roughness: 0.9, normalMap: surfaceNormalTexture('fabric'), normalScale: new THREE.Vector2(0.32, 0.32) });
    e = { m, key, users: 0 };
    jerseyCache.set(key, e);
  }
  e.users++;
  return e;
}
function releaseJersey(e) {
  if (!e || --e.users > 0) return;
  jerseyCache.delete(e.key);
  if (e.m.map) e.m.map.dispose();
  e.m.dispose();
}
export const jerseyCacheSize = () => jerseyCache.size;
let blobTex = null;
function blobTexture() {
  if (blobTex) return blobTex;
  const { canvas, ctx } = makeCanvas(64, 64);
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 31);
  g.addColorStop(0, 'rgba(0,0,0,0.55)'); g.addColorStop(0.5, 'rgba(0,0,0,0.3)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
  blobTex = toTexture(canvas, { anisotropy: 1 });
  return blobTex;
}
const geoCache = {};
function capsuleGeo(r, len, ss = 6, rs = 12) {
  const key = `c${r}|${len}|${ss}|${rs}`;
  return geoCache[key] || (geoCache[key] = new THREE.CapsuleGeometry(r, len, ss, rs));
}
function sphereGeo(r, w = 16, h = 12) {
  const key = `s${r}|${w}|${h}`;
  return geoCache[key] || (geoCache[key] = new THREE.SphereGeometry(r, w, h));
}

let _vertexMat = null;
function vertexMat() {
  if (!_vertexMat) _vertexMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0 });
  return _vertexMat;
}
// Up close every surface has its own material (a figure in full detail): uniform cloth with a woven normal map, skin with a soft sheen,
// leather with a pebbled grain and a little gloss, matte hair. Far away (fielders, phones) everything shares vertexMat().
const SURF = {
  fabric: () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.93, metalness: 0, normalMap: surfaceNormalTexture('fabric'), normalScale: new THREE.Vector2(0.35, 0.35) }),
  // skin: a soft sheen at the edges (the fine hair on real skin) and fine pores - never shiny like plastic
  skin: () => new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: CONFIG.looks.skinRoughness, metalness: 0, sheen: CONFIG.looks.skinSheen, sheenRoughness: 0.7, sheenColor: new THREE.Color('#ffd9c4'), normalMap: surfaceNormalTexture('skin'), normalScale: new THREE.Vector2(0.07, 0.07) }),
  leather: () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0, normalMap: surfaceNormalTexture('leather'), normalScale: new THREE.Vector2(0.6, 0.6) }),
  hair: () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0, normalMap: surfaceNormalTexture('hair'), normalScale: new THREE.Vector2(0.7, 0.7) }),
  eye: () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.12, metalness: 0 }), // (wet: the eyes catch the light)
  helmet: () => new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.28, metalness: 0.05, clearcoat: 0.6, clearcoatRoughness: 0.2 }),
};
const surfMats = {};
function surfMat(kind) { return surfMats[kind] || (surfMats[kind] = SURF[kind]()); }
function cylGeo(rt, rb, h, seg = 12) {
  const key = `y${rt}|${rb}|${h}|${seg}`;
  return geoCache[key] || (geoCache[key] = new THREE.CylinderGeometry(rt, rb, h, seg));
}
const capsule = capsuleGeo, sphere = sphereGeo, cyl = cylGeo;
function box(w, h, d) {
  const key = `b${w}|${h}|${d}`;
  return geoCache[key] || (geoCache[key] = new THREE.BoxGeometry(w, h, d));
}
function hemi(r, frac) {
  const key = `h${r}|${frac}`;
  return geoCache[key] || (geoCache[key] = new THREE.SphereGeometry(r, 20, 12, 0, Math.PI * 2, 0, Math.PI * frac));
}
function cylHalf(r, h) {
  const key = `ch${r}|${h}`;
  return geoCache[key] || (geoCache[key] = new THREE.CylinderGeometry(r, r, h, 18, 1, false, 0, Math.PI));
}
function torus(r, tube, arc = Math.PI * 2, ts = 6, rs = 16) {
  const key = `t${r}|${tube}|${arc}|${ts}|${rs}`;
  return geoCache[key] || (geoCache[key] = new THREE.TorusGeometry(r, tube, ts, rs, arc));
}
const _mm = new THREE.Matrix4(), _mq = new THREE.Quaternion(), _me = new THREE.Euler(), _mp = new THREE.Vector3(), _ms = new THREE.Vector3();
const _mc = new THREE.Color();
// Bake primitives into one geometry with per-vertex colours.
function mergeParts(parts) {
  let vCount = 0, iCount = 0;
  const baked = parts.map((p) => {
    _mp.set(p.x || 0, p.y || 0, p.z || 0);
    _me.set(p.rx || 0, p.ry || 0, p.rz || 0);
    _mq.setFromEuler(_me);
    _ms.set(p.sx ?? 1, p.sy ?? 1, p.sz ?? 1);
    _mm.compose(_mp, _mq, _ms);
    // baked ambient occlusion: the ends of a part (where it meets the next one) are darkened a little
    let shade = null;
    if (p.ao) {
      const gl = p.geo;
      if (!gl.boundingBox) gl.computeBoundingBox();
      const cy = (gl.boundingBox.max.y + gl.boundingBox.min.y) / 2, hy = Math.max(1e-6, (gl.boundingBox.max.y - gl.boundingBox.min.y) / 2);
      const pa = gl.getAttribute('position');
      shade = new Float32Array(pa.count);
      for (let i = 0; i < pa.count; i++) shade[i] = 1 - p.ao * Math.pow(Math.min(1, Math.abs(pa.getY(i) - cy) / hy), 3);
    }
    // `paint(x, y, z)` -> [r, g, b] multipliers at a point of the part (its own coordinates): colour that varies across a part (a face's
    // sockets, cheeks and stubble)
    let tint = null;
    if (p.paint) {
      const pa = p.geo.getAttribute('position');
      tint = new Float32Array(pa.count * 3);
      for (let i = 0; i < pa.count; i++) tint.set(p.paint(pa.getX(i), pa.getY(i), pa.getZ(i)), i * 3);
    }
    const g = p.geo.clone().applyMatrix4(_mm);
    vCount += g.getAttribute('position').count;
    iCount += g.index.count;
    return { g, color: p.color, shade, tint };
  });
  const pos = new Float32Array(vCount * 3), nor = new Float32Array(vCount * 3), col = new Float32Array(vCount * 3), uvs = new Float32Array(vCount * 2);
  const idx = new Uint32Array(iCount);
  let vo = 0, io = 0;
  for (const { g, color, shade, tint } of baked) {
    const n = g.getAttribute('position').count;
    pos.set(g.getAttribute('position').array, vo * 3);
    nor.set(g.getAttribute('normal').array, vo * 3);
    const guv = g.getAttribute('uv');
    if (guv) uvs.set(guv.array, vo * 2);
    _mc.set(color);
    for (let i = 0; i < n; i++) {
      const k = shade ? shade[i] : 1;
      const tr = tint ? tint[i * 3] : 1, tg = tint ? tint[i * 3 + 1] : 1, tb = tint ? tint[i * 3 + 2] : 1;
      col[(vo + i) * 3] = _mc.r * k * tr; col[(vo + i) * 3 + 1] = _mc.g * k * tg; col[(vo + i) * 3 + 2] = _mc.b * k * tb;
    }
    const gi = g.index.array;
    for (let i = 0; i < gi.length; i++) idx[io + i] = gi[i] + vo;
    vo += n; io += gi.length;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeBoundingSphere();
  return out;
}

// ---------------------------------------------------------------- two-bone IK
const _d = new THREE.Vector3(), _pole = new THREE.Vector3(), _elbow = new THREE.Vector3(), _u = new THREE.Vector3(), _l = new THREE.Vector3();
const _q1 = new THREE.Quaternion(), _q1i = new THREE.Quaternion();
const DOWN = new THREE.Vector3(0, -1, 0);

// `from`: joint origin, `target`: wanted end position, both in the limb parent's space.
// Writes rotations for the upper limb (relative to parent) and lower limb (relative to upper).
export function solveTwoBone(len1, len2, from, target, poleDir, qUpper, qLower) {
  _d.copy(target).sub(from);
  let dist = _d.length();
  if (dist < 1e-5) { _d.set(0, -1, 0); dist = 1e-5; }
  const dir = _d.clone().divideScalar(dist);
  const maxR = len1 + len2 - 1e-3;
  const minR = Math.abs(len1 - len2) + 1e-3;
  const dd = Math.min(maxR, Math.max(minR, dist));
  const cosA = (len1 * len1 + dd * dd - len2 * len2) / (2 * len1 * dd);
  const A = Math.acos(Math.min(1, Math.max(-1, cosA)));
  _pole.copy(poleDir);
  _pole.addScaledVector(dir, -_pole.dot(dir));
  if (_pole.lengthSq() < 1e-6) _pole.set(0, 0, 1).addScaledVector(dir, -dir.z);
  _pole.normalize();
  _elbow.copy(from).addScaledVector(dir, len1 * Math.cos(A)).addScaledVector(_pole, len1 * Math.sin(A));
  _u.copy(_elbow).sub(from).normalize();
  const end = _l.copy(from).addScaledVector(dir, dd);
  _l.sub(_elbow).normalize();
  qUpper.setFromUnitVectors(DOWN, _u);
  _q1i.copy(qUpper).invert();
  const lowerLocal = _l.applyQuaternion(_q1i);
  qLower.setFromUnitVectors(DOWN, lowerLocal);
  void end;
}

// ---------------------------------------------------------------- the person
// Hair colour from skin tone and jersey number (deterministic, so a player always looks the same).
function hairColor(skinHex, number = 0) {
  _mc.set(skinHex);
  const lum = 0.3 * _mc.r + 0.59 * _mc.g + 0.11 * _mc.b;
  const dark = ['#0e0b09', '#17110d', '#241a12'];
  const mid = ['#1a120c', '#2b1d12', '#3a2716', '#5b3a1e', '#0e0b09'];
  const light = ['#2b1d12', '#5b3a1e', '#8a5a2b', '#b8863f', '#d4b56a', '#7a2f1a', '#4a4a4e'];
  const list = lum < 0.27 ? dark : lum < 0.5 ? mid : light;
  return list[(Math.abs(number) * 13 + Math.round(lum * 97)) % list.length];
}
let blobShared = null;

export class Person {
  /**
   * @param {object} o
   * @param {'batter'|'fielder'|'pitcher'|'catcher'|'runner'|'coach'} o.role
   * @param {object} o.uniform  { primary, secondary, trim, pants, cap, socks, number, text, stripe }
   * @param {string} [o.skin]
   * @param {number} [o.scale]   overall height scale
   * @param {number} [o.build]   width scale
   * @param {boolean} [o.helmet]
   * @param {boolean} [o.glove]
   * @param {boolean} [o.mirror] left-handed batter (mirrors the whole figure)
   */
  constructor(o) {
    this.role = o.role || 'fielder';
    this.scale = o.scale || 1;
    this.build = o.build || 1;
    this.mirror = !!o.mirror;
    this.pose = makePose();
    this.root = new THREE.Group();
    this.root.name = 'person-' + this.role;
    // (height scales the whole figure the same way in every direction; `build` only widens the body - a root stretched sideways
    // sheared every limb that turned, so a wide player's arms and bat were bent differently from everybody else's)
    this.root.scale.set(this.scale * (this.mirror ? -1 : 1), this.scale, this.scale);
    this._buildMeshes(o);
    this.setShadows(true);
    this._fk = { qU: new THREE.Quaternion(), qL: new THREE.Quaternion() };
    this.batWorldPos = new THREE.Vector3();
    this.gripHands = []; // where his hands were (figure space) last frame - on the bat or not: a pose that takes over blends out of it
    this.ballHand = new THREE.Vector3();
  }

  _mesh(geo, mat, parent, x = 0, y = 0, z = 0) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = false;
    parent.add(m);
    this.meshes.push(m);
    return m;
  }

  // Merge several coloured primitives into ONE mesh (one draw call) attached to `parent`.
  // Each part: { geo, color, x, y, z, sx, sy, sz, rx, ry, rz }
  // `kind`: the surface of parts that do not say (p.mat). In full detail the parts are grouped by surface - one mesh per material.
  _merged(parent, parts, kind = 'fabric') {
    if (this.surfaces) {
      const groups = new Map();
      for (const p of parts) { const k = p.mat || kind; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(p); }
      if (groups.size === 1) { const [[k, list]] = groups; return this._mergedOne(parent, list, surfMat(k)); }
      const g = new THREE.Group(); // (several surfaces: one mesh each, under one group so a scale applies to all of them)
      parent.add(g);
      for (const [k, list] of groups) this._mergedOne(g, list, surfMat(k));
      return g;
    }
    return this._mergedOne(parent, parts, vertexMat());
  }
  _mergedOne(parent, parts, mat) {
    const geo = mergeParts(parts);
    this.ownGeos.push(geo); // made for this figure only: freed in dispose()
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = true;
    parent.add(m);
    this.meshes.push(m);
    return m;
  }

  _buildMeshes(o) {
    const u = o.uniform;
    // how he looks (game/looks.js lookOf): skin, hair, facial hair, the shape of his face. Without a look: the old skin colour.
    const look = o.look || { skin: o.skin || '#cf9a72', hair: hairColor(o.skin || '#cf9a72', u.number), beard: 'none', long: false, face: ((Math.abs(u.number || 0) * 37) % 100) / 100 };
    const skinHex = look.skin;
    this.ownGeos = [];
    this.jersey = getJerseyMat(u, this.mirror, (o.detail ?? 1) >= 0.9 ? 512 : 256); // (a sharper shirt up close; far away and on phones half the size)
    const shirt = this.jersey.m;
    const pantsHex = u.pants || '#f2f2ee';
    // Jersey sleeves are short; where a team wears a contrasting long-sleeve undershirt (u.sleeve) it shows on the arms.
    const underHex = u.sleeve && u.sleeve !== u.primary ? u.sleeve : null;
    const armHex = o.armSkin === false ? (u.sleeve || u.primary) : (underHex || skinHex);
    const armMat = armHex === skinHex ? 'skin' : 'fabric';
    const socksHex = u.socks || u.secondary;
    const trimHex = u.trim || u.secondary;
    const capHex = u.cap || u.primary;
    const shoeHex = u.shoes || '#15171b';
    const beltHex = '#141414';
    const helmHex = u.helmet || u.cap || u.primary;
    const hairHex = look.hair;
    const isCatcher = this.role === 'catcher', isUmpire = this.role === 'umpire';
    this.meshes = [];
    // level of detail: 1 = full, lower = fewer polygons (distant fielders, phones)
    const dl = o.detail ?? 1;
    this.surfaces = dl >= 0.9; // (full detail: a material per surface - see _merged)
    const sphere = (r, w = 16, h = 12) => sphereGeo(r, Math.max(6, Math.round(w * dl)), Math.max(4, Math.round(h * dl)));
    const capsule = (r, len, ss = 6, rs = 12) => capsuleGeo(r, len, Math.max(2, Math.round(ss * dl)), Math.max(6, Math.round(rs * dl)));
    const cyl = (rt, rb, h, seg = 12) => cylGeo(rt, rb, h, Math.max(6, Math.round(seg * dl)));

    // --- pelvis group (hip height is animated): hips, seat, belt and buckle as one mesh
    this.pelvisG = new THREE.Group();
    this.root.add(this.pelvisG);
    const B = this.build;
    const pelvisMesh = this._merged(this.pelvisG, [
      // hips and seat as ONE smooth shape, a little fuller behind, wide enough to take in the tops of the thighs (separate seat
      // pieces left creases where they met)
      { geo: sphere(0.5, 20, 14), color: pantsHex, y: -0.03, z: -0.02, sx: 1.06, sy: 0.7, sz: 0.68, ao: 0.06 },
      { geo: cyl(0.5, 0.5, 0.12, 22), color: beltHex, y: 0.12, sx: 0.98, sz: 0.68, mat: 'leather' },
      { geo: box(0.15, 0.1, 0.04), color: '#c8ccd2', y: 0.12, z: 0.345, mat: 'leather' },
    ]);
    pelvisMesh.scale.set(B, 1, B);

    // --- spine / torso: a V-tapered jersey (textured) plus a collar
    this.spine = new THREE.Group();
    this.spine.position.set(0, 0.1, 0);
    this.pelvisG.add(this.spine);
    const torso = this._mesh(torsoGeometry(dl), shirt, this.spine, 0, 0, 0);
    torso.scale.set(B, 1, B);
    this.torsoMesh = torso;
    const yoke = this._merged(this.spine, [
      { geo: torus(0.2, 0.05, Math.PI * 2, 6, 18), color: trimHex, y: 1.7, rx: Math.PI / 2, sx: 1.08, sy: 1, sz: 0.85 },
      // the slope of the trapezius from the neck out to each shoulder (so the shoulders are not balls stuck on a vase)
      { geo: sphere(0.3, 12, 8), color: u.primary, x: 0.33, y: 1.56, z: -0.04, sx: 1.25, sy: 0.5, sz: 0.85 },
      { geo: sphere(0.3, 12, 8), color: u.primary, x: -0.33, y: 1.56, z: -0.04, sx: 1.25, sy: 0.5, sz: 0.85 },
    ]);
    yoke.scale.set(B, 1, B);
    if (isCatcher || isUmpire) {
      const chest = this._mesh(capsule(0.66, 0.4, 6, 18), getMat(u.gear || '#20242b', 0.7), this.spine, 0, 0.98, 0.04);
      chest.scale.set(1.03 * B, 1, 0.72 * B);
    }

    // --- head group: neck, skull, face, ears, hair and facial hair, cap or helmet - one mesh per surface (face.js)
    this.headG = new THREE.Group();
    this.headG.position.set(0, DIM.spine + DIM.neck * 0.5 + 0.2, 0);
    this.spine.add(this.headG);
    const fh = Math.round((look.face ?? 0.5) * 997);
    // eyes: mostly brown; blue, green or hazel now and then on fair skin
    const eyeHex = (look.tone ?? 5) <= 3 && fh % 3 === 0 ? ['#4a6f8f', '#56704a', '#6b5a3a'][fh % 7 % 3] : ['#3a2416', '#2b1a10', '#4a3220'][fh % 3];
    _mc.set(skinHex);
    const lipHex = '#' + _mc.clone().lerp(new THREE.Color('#8f4f4a'), 0.16).multiplyScalar(0.92).getHexString();
    const head = faceParts({ dl, skin: skinHex, lip: lipHex, eye: eyeHex, hair: hairHex, beard: look.beard || 'none', long: !!look.long && !o.helmet, face: look.face ?? 0.5, stubble: CONFIG.looks.stubble });
    const headParts = head.parts;
    if (o.helmet) headParts.push(...helmetParts(head.surf, { color: helmHex, badge: trimHex, dl, q: head.q }));
    // (the catcher wears his cap backwards under the mask)
    else headParts.push(...capParts(head.surf, { color: capHex, bill: u.capBill || capHex, badge: trimHex, dl, q: head.q, backward: isCatcher }));
    this._merged(this.headG, headParts, 'skin');
    if (isCatcher || isUmpire) this._merged(this.headG, maskParts({ dl }), 'leather'); // (a cage mask: the face shows between the bars)

    // --- arms (left = +x, right = -x): short jersey sleeve over (undershirt | bare) arm, forearm, hand / glove
    this.arms = [];
    // the glove's leather: tan, caramel, brown, dark brown or black (the catcher's mitt: black, brown or tan), laces to go with it
    const gl = Math.round((look.face ?? 0.5) * 991) + (u.number || 0);
    const gloveLeather = isCatcher ? ['#1c1b1a', '#4c2a17', '#7a431f', '#262a33'][gl % 4] : ['#b47a40', '#9c5c2a', '#6e3e1f', '#4a2a17', '#1c1b1a'][gl % 5];
    const gloveLace = ['#1c1b1a', '#262a33', '#4a2a17'].includes(gloveLeather) ? '#c9a06a' : gloveLeather === '#b47a40' ? '#7a4a24' : '#d0a670';
    for (const side of [1, -1]) {
      const sh = new THREE.Group();
      sh.position.set(side * DIM.shoulderW * B, DIM.shoulderY, 0);
      this.spine.add(sh);
      const upper = new THREE.Group(); sh.add(upper);
      // (lofted: a deltoid, biceps and triceps under a short sleeve - see anatomy.js)
      this._merged(upper, upperArmParts({ side, dl, len: DIM.upperArm, arm: armHex, armMat, sleeve: u.primary, trim: trimHex }));
      const elbow = new THREE.Group(); elbow.position.set(0, -DIM.upperArm, 0); upper.add(elbow);
      const wrist = new THREE.Group(); wrist.position.set(0, -DIM.foreArm, 0); elbow.add(wrist);
      const foreParts = foreArmParts({ side, dl, len: DIM.foreArm, arm: armHex, armMat });
      const isGloveHand = side === 1 && (o.glove || isCatcher);
      const handParts = [];
      if (isGloveHand) {
        // (a stitched fielder's glove, or the catcher's round padded mitt - anatomy.js)
        const webHex = new THREE.Color(gloveLeather).multiplyScalar(0.8).getHexString();
        foreParts.push(...gloveParts(isCatcher ? 'mitt' : 'glove', { dl, gy: -DIM.foreArm, leather: gloveLeather, lace: gloveLace, web: '#' + webHex, patch: trimHex }));
      } else if (this.role === 'batter') {
        // a batter's hand is a closed fist (in batting gloves) round the handle: the back of the hand and the knuckles, then four
        // fingers that wrap right round the bat (rings round the grip line, open only on the palm side) and the thumb across the
        // front. It is its own piece on the wrist, which turns to hold the bat (positions are from the wrist; GRIP.point is the
        // middle of the fist, where the handle runs through).
        handParts.push(...handParts_('fist', { side, dl, color: u.gloves || '#f0f0f0', cuff: '#22252b', strap: u.trim || '#c62828', gp: GRIP.point }));
        if (side === 1) foreParts.push({ geo: capsule(0.168, 0.22, 4, 10), color: '#191b20', y: -0.17, x: 0.012, sz: 0.92, ao: 0.1, mat: 'leather' }); // elbow guard on the lead arm
      } else {
        // the bare hand is its own piece on the wrist (positions are from the wrist): palm, four fingers of three bones, a thumb
        handParts.push(...handParts_('relaxed', { side, dl, color: skinHex }));
      }
      this._merged(elbow, foreParts);
      if (handParts.length) this._merged(wrist, handParts, 'skin');
      this.arms.push({ side, sh, upper, elbow, wrist, len1: DIM.upperArm, len2: DIM.foreArm });
    }

    // --- legs: baggy pants with a side stripe, stirrup socks with bands, and molded cleats
    this.legs = [];
    for (const side of [1, -1]) {
      const hip = new THREE.Group();
      hip.position.set(side * DIM.hipW, -0.06, 0);
      this.pelvisG.add(hip);
      const thigh = new THREE.Group(); hip.add(thigh);
      this._merged(thigh, thighParts({ side, dl, len: DIM.thigh, pants: pantsHex, trim: trimHex }));
      const knee = new THREE.Group(); knee.position.set(0, -DIM.thigh, 0); thigh.add(knee);
      const shin = shinParts({ dl, len: DIM.shin, pants: pantsHex, socks: socksHex, trim: trimHex, band: u.secondary || '#ffffff' });
      if (isCatcher || isUmpire) shin.push({ geo: capsule(0.23, DIM.shin - 0.5, 4, 10), color: u.gear || '#20242b', y: -DIM.shin / 2 + 0.05, z: 0.1, sz: 0.8 });
      this._merged(knee, shin);
      const ankle = new THREE.Group(); ankle.position.set(0, -DIM.shin, 0); knee.add(ankle);
      const accent = u.secondary && u.secondary !== shoeHex ? u.secondary : '#d8dbe0';
      this._merged(ankle, cleatParts({ dl, shoe: shoeHex, sole: shoeHex === '#15171b' ? '#0d0e10' : '#f1f1ee', accent }), 'leather');
      this.legs.push({ side, hip, thigh, knee, ankle });
    }

    // --- bat (batter only; positioned in root space)
    this.bat = null;
    if (this.role === 'batter') {
      this.bat = makeBat(o.batStyle);
      this.root.add(this.bat);
    }

    // soft blob shadow under the feet
    if (!blobShared) {
      blobShared = new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false, opacity: 0.6, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    }
    this.blob = new THREE.Mesh(geoCache.blob || (geoCache.blob = new THREE.PlaneGeometry(3.4, 3.4)), blobShared);
    this.blob.rotation.x = -Math.PI / 2;
    this.blob.position.y = 0.04;
    this.blob.renderOrder = 2;
    this.root.add(this.blob);
  }

  // Free everything made for this figure alone (shared shapes and colours stay cached). Call once it leaves the scene.
  dispose() {
    for (const g of this.ownGeos) g.dispose();
    this.ownGeos = [];
    releaseJersey(this.jersey);
    this.jersey = null;
    if (this.bat) { disposeBat(this.bat); this.bat = null; }
  }

  setShadows(on) {
    if (this._shadowsOn === on) return;
    this._shadowsOn = on;
    for (const m of this.meshes) m.castShadow = on;
  }

  // Place in the world. yaw = direction the person faces (radians about +y; 0 faces +z).
  place(x, y, z, yaw) {
    this.root.position.set(x, y, z);
    this.root.rotation.y = yaw;
  }

  // Apply the current `this.pose` to the joints (call after place()).
  apply() {
    const p = this.pose;
    const pg = this.pelvisG;
    pg.position.set(p.pelvis[0], p.hipY + p.pelvis[1], p.pelvis[2]);
    pg.rotation.set(p.pelvisPitch, p.pelvisYaw, p.pelvisRoll, 'YXZ');
    this.spine.rotation.set(p.torsoPitch, p.torsoYaw, p.torsoRoll, 'YXZ');
    this.headG.rotation.set(p.headPitch, p.headYaw, 0, 'YXZ');
    this.root.updateMatrixWorld(true);

    // legs: foot targets are given in root space; convert into pelvis space
    const tmp = _t1;
    for (const leg of this.legs) {
      const foot = leg.side === 1 ? p.footL : p.footR;
      tmp.set(foot[0], foot[1], foot[2]);
      pg.worldToLocal(this.root.localToWorld(tmp));
      const hipPos = _t2.copy(leg.hip.position);
      const kp = leg.side === 1 ? p.kneeL : p.kneeR;
      solveTwoBone(DIM.thigh, DIM.shin, hipPos, tmp, _pole.set(kp[0], kp[1], kp[2]), leg.thigh.quaternion, leg.knee.quaternion);
      // foot orientation: flat to the ground (root yaw) with an optional pitch
      leg.hip.updateMatrixWorld(true);
      leg.thigh.updateMatrixWorld(true);
      leg.knee.updateMatrixWorld(true);
      // (a foot points the way the figure faces, turned by footLYaw / footRYaw - e.g. toward the pitcher when squared to bunt)
      const tilt = leg.side === 1 ? p.footLTilt : p.footRTilt;
      const fyaw = (leg.side === 1 ? p.footLYaw : p.footRYaw) || 0;
      _qw.setFromEuler(_e.set(tilt, fyaw, 0, 'YXZ'));
      this.root.getWorldQuaternion(_qr);
      _qw.premultiply(_qr);
      leg.knee.getWorldQuaternion(_qk);
      leg.ankle.quaternion.copy(_qk.invert().multiply(_qw));
    }

    // bat placement (root space) and grip targets
    let gripA = null, gripB = null;
    if (this.bat) {
      this.bat.visible = p.batVis > 0.5;
      const cp = Math.cos(p.batPitch);
      _bd.set(Math.sin(p.batYaw) * cp, Math.sin(p.batPitch), Math.cos(p.batYaw) * cp).normalize();
      // The bat never leaves his hands: if a pose puts a grip further from its shoulder than the arm (plus the fist) can reach, the
      // bat is drawn back toward that shoulder by the difference - smoothly, so a bunt aimed far out or very low stays in his hands
      // (the picture only: the bunt and the swing are decided by the aim, not by where the bat is drawn).
      _knob.set(p.bat[0], p.bat[1], p.bat[2]);
      if (p.batVis > 0.5) {
        for (let pass = 0; pass < 2; pass++) {
          for (const arm of this.arms) {
            this.root.worldToLocal(arm.sh.getWorldPosition(_aim));
            _t2.copy(_knob).addScaledVector(_bd, arm.side === 1 ? GRIP.bottom : (p.gripTop ?? GRIP.top));
            const over = _t2.distanceTo(_aim) - (arm.len1 + arm.len2 + GRIP.reach);
            if (over > 0) _knob.addScaledVector(_aim.sub(_t2).normalize(), over);
          }
        }
      }
      this.bat.position.copy(_knob);
      this.bat.quaternion.setFromUnitVectors(_up, _bd);
      gripA = _ga.copy(_knob).addScaledVector(_bd, GRIP.bottom);
      gripB = _gb.copy(_knob).addScaledVector(_bd, p.gripTop ?? GRIP.top);
    }

    // arms
    const holding = this.bat && p.batVis > 0.5;
    for (const arm of this.arms) {
      const hand = arm.side === 1 ? p.handL : p.handR;
      const polev = arm.side === 1 ? p.poleL : p.poleR;
      const pole = _pole.set(polev[0], polev[1], polev[2]);
      if (!holding) {
        arm.wrist.quaternion.identity();
        tmp.set(hand[0], hand[1], hand[2]);
        (this.gripHands[arm.side === 1 ? 0 : 1] ||= [0, 0, 0]).splice(0, 3, tmp.x, tmp.y, tmp.z);
        this.spine.worldToLocal(this.root.localToWorld(tmp));
        solveTwoBone(arm.len1, arm.len2, arm.sh.position, tmp, pole, arm.upper.quaternion, arm.elbow.quaternion);
        continue;
      }
      // Hands hold the bat (the "bottom" hand is the person's left - a right-handed batter): each fist closes ROUND the handle at
      // its grip - the bat lies across the curled fingers, index finger toward the barrel - and the wrist turns to hold it there,
      // with the back of the hand toward the elbow. (Putting the wrist itself on the bat ran the bat through the cuff and made it
      // look like part of the forearm.) Found in two passes: a first guess with the hand pointing back at the shoulder, then again
      // with the hand pointing back at where the elbow really went.
      const G = arm.side === 1 ? gripA : gripB;
      _hx.copy(_bd).multiplyScalar(-arm.side);
      this.root.worldToLocal(arm.sh.getWorldPosition(_aim));
      for (let pass = 0; pass < 2; pass++) {
        _t2.copy(_aim).sub(G);
        _hy.copy(_t2).addScaledVector(_bd, -_t2.dot(_bd));
        if (_hy.lengthSq() < 1e-6) _hy.set(0, -1, 0).addScaledVector(_bd, _bd.y).normalize(); else _hy.normalize();
        _hz.crossVectors(_hx, _hy);
        _hm.makeBasis(_hx, _hy, _hz);
        _hq.setFromRotationMatrix(_hm);
        tmp.copy(GRIP.point).applyQuaternion(_hq).negate().add(G); // the wrist, so that the fist's grip point is on the bat
        (this.gripHands[arm.side === 1 ? 0 : 1] ||= [0, 0, 0]).splice(0, 3, tmp.x, tmp.y, tmp.z);
        this.spine.worldToLocal(this.root.localToWorld(tmp));
        solveTwoBone(arm.len1, arm.len2, arm.sh.position, tmp, pole, arm.upper.quaternion, arm.elbow.quaternion);
        arm.elbow.updateWorldMatrix(true, false);
        this.root.worldToLocal(arm.elbow.getWorldPosition(_aim));
      }
      // the wrist's turn: the hand's frame (in the figure's own space) relative to the forearm's
      _hq2.copy(this.pelvisG.quaternion).multiply(this.spine.quaternion).multiply(arm.sh.quaternion).multiply(arm.upper.quaternion).multiply(arm.elbow.quaternion);
      arm.wrist.quaternion.copy(_hq2.invert().multiply(_hq));
    }
    this.root.updateMatrixWorld(true);
  }

  // World position of a hand (for the ball, glove, bat toss, etc.).
  handWorld(side, out = new THREE.Vector3()) {
    const arm = this.arms[side === 'L' ? 0 : 1];
    arm.wrist.updateWorldMatrix(true, false);
    return out.setFromMatrixPosition(arm.wrist.matrixWorld);
  }
  gloveWorld(out = new THREE.Vector3()) {
    const arm = this.arms[0];
    arm.wrist.updateWorldMatrix(true, false);
    out.set(0, -0.1, 0.25);
    return arm.wrist.localToWorld(out);
  }
  batBarrelWorld(out = new THREE.Vector3()) {
    if (!this.bat) return out.set(0, 0, 0);
    out.set(0, 2.35, 0);
    this.bat.updateWorldMatrix(true, false);
    return this.bat.localToWorld(out);
  }
  batWorldMatrix() { this.bat.updateWorldMatrix(true, false); return this.bat.matrixWorld; }
}

const _t1 = new THREE.Vector3(), _t2 = new THREE.Vector3();
const _qw = new THREE.Quaternion(), _qr = new THREE.Quaternion(), _qk = new THREE.Quaternion();
const _e = new THREE.Euler();
const _bd = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0), _ga = new THREE.Vector3(), _gb = new THREE.Vector3();
const _hx = new THREE.Vector3(), _hy = new THREE.Vector3(), _hz = new THREE.Vector3(), _aim = new THREE.Vector3();
const _hm = new THREE.Matrix4(), _hq = new THREE.Quaternion(), _hq2 = new THREE.Quaternion(), _knob = new THREE.Vector3();

// ---------------------------------------------------------------- bat model (knob at the origin, barrel along +y)
export const BAT_STYLES = {
  ash: { wood: '#c9a066', grip: '#1a1a1a' },
  maple: { wood: '#e8d3a2', grip: '#2a2a2a' },
  midnight: { wood: '#151517', grip: '#c0392b' },
  cherry: { wood: '#8a2a1c', grip: '#111111' },
  golden: { wood: '#e3b93c', grip: '#3a2a08', metal: 0.6 },
  neon: { wood: '#22d3ee', grip: '#111827', emissive: '#0a5566' },
  sunset: { wood: '#f97316', grip: '#1f1400', emissive: '#4a1b00' },
  carbon: { wood: '#2b3440', grip: '#e5e7eb', metal: 0.5 },
};
export function makeBat(styleKey = 'ash') {
  const st = BAT_STYLES[styleKey] || BAT_STYLES.ash;
  const pts = [
    [0.0, 0.0], [0.09, 0.0], [0.085, 0.03], [0.055, 0.12], [0.045, 0.6], [0.05, 0.9], [0.075, 1.5],
    [0.105, 1.95], [0.118, 2.3], [0.118, 2.6], [0.1, 2.72], [0.0, 2.75],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const g = new THREE.LatheGeometry(pts, 14);
  const m = new THREE.MeshStandardMaterial({ color: st.wood, roughness: 0.45, metalness: st.metal || 0.05, emissive: st.emissive || '#000000' });
  const bat = new THREE.Mesh(g, m);
  bat.castShadow = true;
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.062, 0.62, 10), new THREE.MeshStandardMaterial({ color: st.grip, roughness: 0.9 }));
  grip.position.y = 0.34;
  bat.add(grip);
  const grp = new THREE.Group();
  grp.add(bat);
  grp.userData.material = m;
  grp.userData.gripMaterial = grip.material;
  return grp;
}
export function disposeBat(grp) {
  grp.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
}
export function restyleBat(grp, styleKey) {
  const st = BAT_STYLES[styleKey] || BAT_STYLES.ash;
  const m = grp.userData.material;
  m.color.set(st.wood); m.metalness = st.metal || 0.05; m.emissive.set(st.emissive || '#000000');
  grp.userData.gripMaterial.color.set(st.grip);
}
