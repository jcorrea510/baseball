// The crowd: thousands of people drawn as ONE instanced mesh (very cheap).
// Each fan sits in a real seat (rows and seats along the stands, sections fuller or emptier, some empty seats) and is a
// camera-facing cut-out from a small atlas of silhouettes (short hair, a cap, long hair, a hood - each seated and, for big
// moments, standing with the arms up). The clothes follow the home club (its colours, lots of white, grey and black, a few
// other colours), skin tones and hair are realistic, the figure is shaded (lighter at the head, darker at the sides and the
// edge) so it reads as a person and not a coloured dot. They bob gently and get up when something exciting happens.
import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { createRng } from '../util/rng.js';
import { crowdMaskTexture, CROWD_VARIANTS } from './textures.js';

const VERT = /* glsl */ `
attribute vec3 aPos;
attribute vec4 aSeed;   // x: random, y: size, z: row fraction, w: silhouette (0..variants-1)
attribute vec3 aShirt;
attribute vec3 aSkin;
attribute vec3 aHair;
uniform float uTime, uExcite, uVariants;
varying vec2 vUv;
varying vec3 vShirt, vSkin, vHair;
varying float vSeed, vUp;
#include <fog_pars_vertex>
void main() {
  vShirt = aShirt; vSkin = aSkin; vHair = aHair; vSeed = aSeed.x;
  float s = aSeed.y;
  float ph = aSeed.x * 60.0;
  // who gets up: the keenest fans first, everybody on a big moment
  float up = step(1.0 - uExcite * 1.15, fract(aSeed.x * 7.13));
  vUp = up;
  vUv = vec2((uv.x + aSeed.w) / uVariants, uv.y * 0.5 + up * 0.5);
  float bob = sin(uTime * (1.4 + aSeed.x * 1.6) + ph) * 0.05;
  float jump = up * uExcite * max(0.0, sin(uTime * (6.0 + aSeed.x * 3.0) + ph)) * 0.55;
  vec3 toCam = cameraPosition - aPos;
  vec3 right = normalize(vec3(toCam.z, 0.0, -toCam.x) + vec3(1e-4));
  float w = 1.95 * s, h = 2.95 * s * (1.0 + up * 0.32);
  vec3 world = aPos + right * (position.x * w) + vec3(0.0, position.y * h + bob + jump, 0.0);
  vec4 mvPosition = viewMatrix * vec4(world, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const CONFIG_SAT = CONFIG.crowd.saturation.toFixed(2);
const FRAG = /* glsl */ `
uniform sampler2D uMask;
uniform float uBright, uFlash, uTime;
varying vec2 vUv;
varying vec3 vShirt, vSkin, vHair;
varying float vSeed, vUp;
#include <fog_pars_fragment>
float hash1(float n){ return fract(sin(n) * 43758.5453); }
void main() {
  vec4 m = texture2D(uMask, vUv);
  if (m.a < 0.45) discard;
  float sum = max(0.001, m.r + m.g + m.b);
  vec3 col = (vShirt * m.r + vSkin * m.g + vHair * m.b) / sum;
  // shading: light from above, the edge of the figure darker (it separates one fan from the next)
  float cy = fract(vUv.y * 2.0);
  float cx = fract(vUv.x * ${CROWD_VARIANTS.toFixed(1)}) - 0.5;
  col *= (0.62 + 0.45 * cy) * (1.0 - 0.55 * cx * cx);
  col *= mix(0.45, 1.0, smoothstep(0.45, 0.95, m.a));
  // a touch less colour than the clothes themselves (a crowd seen across a ballpark is softer than a pile of swatches)
  col = mix(vec3(dot(col, vec3(0.299, 0.587, 0.114))), col, ${CONFIG_SAT});
  col *= uBright;
  // night-time camera flashes
  float slot = floor(uTime * 6.0 + vSeed * 40.0);
  float f = step(1.0 - uFlash * 0.05, hash1(slot + vSeed * 91.7));
  col += vec3(f) * 2.5;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

// realistic skin tones (light to deep) and hair
const SKINS = ['#f3d4bb', '#ecc4a2', '#e0b18c', '#d29e76', '#c08560', '#a86d48', '#8c5636', '#6f4128', '#56311d', '#e8bd96'];
const HAIRS = ['#15110e', '#1f1712', '#2e2018', '#46301f', '#5e4128', '#7a5634', '#a07a4a', '#c8a468', '#8d8a86', '#c9c6c0', '#5a2a18'];
// what a ballpark crowd wears besides the home club's colours (white and grey tees, black, navy, denim, a few bright ones)
const NEUTRAL = ['#f1f0ec', '#e9e8e3', '#d8d8d6', '#a3a5a8', '#7d8085', '#2b2c30', '#1c1d21', '#23304d', '#3f5878', '#556b8a'];
const OTHER = ['#7a2433', '#5d6b3a', '#b9a37c', '#8fb3d9', '#d98fa6', '#d9822b', '#e3c34a', '#3f7d4f', '#9b3b3b', '#4b3d6e', '#2f7f87'];

/**
 * @param {Array} perimeter  perimeter points (with arc length `s`)
 * @param {object} o { count, colors: [primary, secondary] of the home club,
 *   decks: more bowls of seats [{ points, offset (ft out from the points), base(p) (height of the first row), rows, rowDepth, slope }] }
 */
export function createCrowd(perimeter, { count = 9000, colors = ['#1d3a7e', '#c0392b'], decks = [] } = {}) {
  const rng = createRng(4242);
  const C = CONFIG.crowd;
  const S = CONFIG.field.stands;
  const lower = { points: perimeter, offset: 0, base: (p) => p.h0, rowDepth: 2.5, slope: S.slope, rows: Math.floor(S.depth / 2.5) };

  // every seat: along the stands every `seatWidth` ft, every row
  const seats = [];
  let wSum = 0;
  for (const bowl of [lower, ...decks]) {
  const pts = bowl.points, rows = bowl.rows;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    if (a.kind === 'of' && Math.abs(a.a) < 8.5) continue; // batter's eye is a solid backdrop
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    if (len < 1e-3) continue;
    const s0 = a.s ?? 0;
    const first = Math.ceil(s0 / C.seatWidth) * C.seatWidth;
    for (let s = first; s < s0 + len; s += C.seatWidth) {
      const t = (s - s0) / len;
      const section = Math.floor(s / C.sectionFeet);
      const secFill = C.sectionFill[0] + (C.sectionFill[1] - C.sectionFill[0]) * hash(section * 12.9898 + pts.length + bowl.offset);
      const kindW = a.kind === 'back' ? C.fill.back : a.kind === 'foul' ? C.fill.foul : C.fill.of;
      for (let r = 0; r < rows; r++) {
        const rowW = 1 - C.fill.highRows * (r / rows);
        const w = kindW * rowW * secFill;
        seats.push({ a, b, t, r, w, bowl });
        wSum += w;
      }
    }
  }
  }
  const k = Math.min(count, seats.length * 0.97) / Math.max(1e-6, wSum);
  const take = [];
  for (const st of seats) if (rng.next() < Math.min(0.97, st.w * k)) take.push(st);
  const n = Math.min(count, take.length);

  const pos = new Float32Array(n * 3);
  const seed = new Float32Array(n * 4);
  const shirt = new Float32Array(n * 3);
  const skin = new Float32Array(n * 3);
  const hair = new Float32Array(n * 3);
  const tmp = new THREE.Color();
  const put = (arr, i, hex, shade = 1) => {
    tmp.set(hex);
    arr[i * 3] = tmp.r * shade; arr[i * 3 + 1] = tmp.g * shade; arr[i * 3 + 2] = tmp.b * shade;
  };
  const [c1, c2] = colors;
  const shirtFor = () => {
    const r = rng.next();
    if (r < C.wear.primary) return c1;
    if (r < C.wear.primary + C.wear.secondary) return c2;
    if (r < C.wear.primary + C.wear.secondary + C.wear.neutral) return rng.pick(NEUTRAL);
    return rng.pick(OTHER);
  };
  for (let i = 0; i < n; i++) {
    const { a, b, t, r, bowl } = take[i];
    const rd = bowl.rowDepth, rr = rd * bowl.slope;
    const px = a.x + (b.x - a.x) * t, pz = a.z + (b.z - a.z) * t;
    let nx = a.nx + (b.nx - a.nx) * t, nz = a.nz + (b.nz - a.nz) * t;
    const nl = Math.hypot(nx, nz) || 1; nx /= nl; nz /= nl;
    const h0 = bowl.base(a) + (bowl.base(b) - bowl.base(a)) * t;
    const depth = bowl.offset + r * rd + rd * 0.55 + rng.range(-0.12, 0.12);
    const lateral = rng.range(-0.15, 0.15);
    pos[i * 3] = px + nx * depth - nz * lateral;
    pos[i * 3 + 1] = h0 + r * rr + 0.2;
    pos[i * 3 + 2] = pz + nz * depth + nx * lateral;
    seed[i * 4] = rng.next();
    seed[i * 4 + 1] = rng.range(0.88, 1.1);
    seed[i * 4 + 2] = r / bowl.rows;
    // silhouette: 0 short hair, 1 cap, 2 long hair, 3 hood
    const v = rng.next();
    const variant = v < C.caps ? 1 : v < C.caps + C.longHair ? 2 : v < C.caps + C.longHair + C.hoods ? 3 : 0;
    seed[i * 4 + 3] = variant;
    const top = shirtFor();
    put(shirt, i, top, rng.range(0.82, 1.0));
    put(skin, i, rng.pick(SKINS), rng.range(0.9, 1.03));
    // the "hair" channel is the cap (mostly the home club's) or the hood (the shirt's colour) or the hair
    const hairHex = variant === 1 ? (rng.chance(0.7) ? c1 : rng.chance(0.5) ? c2 : rng.pick(NEUTRAL)) : variant === 3 ? top : rng.pick(HAIRS);
    put(hair, i, hairHex, variant === 3 ? 0.85 : 1);
  }

  const quad = new THREE.PlaneGeometry(1, 1);
  quad.translate(0, 0.5, 0); // origin at the feet
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = quad.index;
  geo.setAttribute('position', quad.getAttribute('position'));
  geo.setAttribute('uv', quad.getAttribute('uv'));
  geo.setAttribute('aPos', new THREE.InstancedBufferAttribute(pos, 3));
  geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 4));
  geo.setAttribute('aShirt', new THREE.InstancedBufferAttribute(shirt, 3));
  geo.setAttribute('aSkin', new THREE.InstancedBufferAttribute(skin, 3));
  geo.setAttribute('aHair', new THREE.InstancedBufferAttribute(hair, 3));
  geo.instanceCount = n;

  const material = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    fog: true,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uMask: { value: null },
        uTime: { value: 0 },
        uExcite: { value: 0 },
        uBright: { value: 1 },
        uFlash: { value: 0 },
        uVariants: { value: CROWD_VARIANTS },
      },
    ]),
  });
  material.uniforms.uMask.value = crowdMaskTexture(); // (after the merge: UniformsUtils.merge clones textures)
  const mesh = new THREE.Mesh(geo, material);
  mesh.frustumCulled = false;

  let excite = 0;
  let exciteTarget = 0;
  return {
    mesh,
    count: n,
    // 0..1: how loud/animated the crowd is right now. Decays on its own.
    cheer(level = 1) { exciteTarget = Math.max(exciteTarget, level); excite = Math.max(excite, level * 0.6); },
    get excitement() { return excite; },
    update(dt, time, brightness, night) {
      exciteTarget = Math.max(0, exciteTarget - dt * 0.35);
      excite += (exciteTarget - excite) * Math.min(1, dt * 6);
      const u = material.uniforms;
      u.uTime.value = time;
      u.uExcite.value = excite;
      u.uBright.value = brightness;
      u.uFlash.value = night * (0.35 + excite * 2.4);
    },
  };
}

function hash(x) { const s = Math.sin(x) * 43758.5453; return s - Math.floor(s); }
