// The crowd: thousands of tiny people drawn as ONE instanced mesh (very cheap).
// Each person is a camera-facing cut-out with its own shirt / skin / hair colour that bobs
// gently and jumps up when something exciting happens.
import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { createRng } from '../util/rng.js';
import { crowdMaskTexture } from './textures.js';

const VERT = /* glsl */ `
attribute vec3 aPos;
attribute vec4 aSeed;   // x: random, y: size, z: row fraction, w: unused
attribute vec3 aShirt;
attribute vec3 aSkin;
attribute vec3 aHair;
uniform float uTime, uExcite;
varying vec2 vUv;
varying vec3 vShirt, vSkin, vHair;
varying float vSeed;
#include <fog_pars_vertex>
void main() {
  vUv = uv;
  vShirt = aShirt; vSkin = aSkin; vHair = aHair; vSeed = aSeed.x;
  float s = aSeed.y;
  float ph = aSeed.x * 60.0;
  float bob = sin(uTime * (1.4 + aSeed.x * 1.6) + ph) * 0.06;
  float jump = uExcite * max(0.0, sin(uTime * (7.0 + aSeed.x * 4.0) + ph)) * 0.9;
  vec3 toCam = cameraPosition - aPos;
  vec3 right = normalize(vec3(toCam.z, 0.0, -toCam.x) + vec3(1e-4));
  float w = 1.9 * s, h = 2.9 * s * (1.0 + uExcite * 0.08 * max(0.0, sin(uTime * 9.0 + ph)));
  vec3 world = aPos + right * (position.x * w) + vec3(0.0, position.y * h + bob + jump, 0.0);
  vec4 mvPosition = viewMatrix * vec4(world, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const FRAG = /* glsl */ `
uniform sampler2D uMask;
uniform float uBright, uFlash, uTime;
varying vec2 vUv;
varying vec3 vShirt, vSkin, vHair;
varying float vSeed;
#include <fog_pars_fragment>
float hash1(float n){ return fract(sin(n) * 43758.5453); }
void main() {
  vec4 m = texture2D(uMask, vUv);
  if (m.a < 0.5) discard;
  vec3 col = vShirt * m.r + vSkin * m.g + vHair * m.b;
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

const SHIRTS = ['#c0392b', '#2c5fa8', '#e8e8e8', '#f0c419', '#2f8f4e', '#1d2a44', '#d9822b', '#7a3f98', '#39a6b8', '#b33771', '#eeeeee', '#3a3a3a', '#a4c639', '#e58e8e'];
const SKINS = ['#f2c9a0', '#e0ac82', '#c68642', '#a3683b', '#7b4a2a', '#f7d7b5', '#5d3a22'];
const HAIRS = ['#1b1512', '#3a2618', '#6b4423', '#a67c3d', '#c9a45c', '#8a8a8a', '#101010', '#7a2e1a'];

/**
 * @param {Array} perimeter  perimeter points
 * @param {object} o { count }
 */
export function createCrowd(perimeter, { count = 6000 } = {}) {
  const rng = createRng(4242);
  const S = CONFIG.field.stands;
  const rd = 2.5;
  const rows = Math.floor(S.depth / rd);
  const rr = rd * S.slope;

  // Pick random spots along the perimeter (interpolating between points so there are no columns).
  // Weight by how visible each stretch is: outfield most, foul lines a lot, behind the plate less.
  const segs = [];
  let totalW = 0;
  for (let i = 0; i < perimeter.length - 1; i++) {
    const a = perimeter[i], b = perimeter[i + 1];
    if (a.kind === 'of' && Math.abs(a.a) < 8.5) continue; // batter's eye is a solid backdrop
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const w = len * (a.kind === 'of' ? 1.5 : a.kind === 'foul' ? 0.9 : 0.45);
    totalW += w;
    segs.push({ a, b, cum: totalW });
  }
  const pickSeg = () => {
    const r = rng.next() * totalW;
    let lo = 0, hi = segs.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (segs[mid].cum < r) lo = mid + 1; else hi = mid; }
    return segs[lo];
  };

  const pos = new Float32Array(count * 3);
  const seed = new Float32Array(count * 4);
  const shirt = new Float32Array(count * 3);
  const skin = new Float32Array(count * 3);
  const hair = new Float32Array(count * 3);
  const tmp = new THREE.Color();
  const put = (arr, i, hex, shade = 1) => {
    tmp.set(hex);
    arr[i * 3] = tmp.r * shade; arr[i * 3 + 1] = tmp.g * shade; arr[i * 3 + 2] = tmp.b * shade;
  };
  // Lots of "home" colour in the crowd for a cohesive look.
  const homeShirts = ['#c0392b', '#c0392b', '#e8e8e8', '#1d2a44', '#c0392b'];
  for (let i = 0; i < count; i++) {
    const sg = pickSeg();
    const t = rng.next();
    const px = sg.a.x + (sg.b.x - sg.a.x) * t, pz = sg.a.z + (sg.b.z - sg.a.z) * t;
    let nx = sg.a.nx + (sg.b.nx - sg.a.nx) * t, nz = sg.a.nz + (sg.b.nz - sg.a.nz) * t;
    const nl = Math.hypot(nx, nz) || 1; nx /= nl; nz /= nl;
    const h0 = sg.a.h0 + (sg.b.h0 - sg.a.h0) * t;
    const row = Math.floor(Math.pow(rng.next(), 0.85) * rows);
    const depth = row * rd + rd * 0.55 + rng.range(-0.3, 0.3);
    const lateral = rng.range(-0.9, 0.9);
    pos[i * 3] = px + nx * depth - nz * lateral;
    pos[i * 3 + 1] = h0 + row * rr + 0.25;
    pos[i * 3 + 2] = pz + nz * depth + nx * lateral;
    seed[i * 4] = rng.next();
    seed[i * 4 + 1] = rng.range(0.9, 1.12);
    seed[i * 4 + 2] = row / rows;
    put(shirt, i, rng.chance(0.4) ? rng.pick(homeShirts) : rng.pick(SHIRTS), rng.range(0.75, 1.05));
    put(skin, i, rng.pick(SKINS), rng.range(0.85, 1.05));
    put(hair, i, rng.pick(HAIRS));
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
  geo.instanceCount = count;

  const material = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    fog: true,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uMask: { value: crowdMaskTexture() },
        uTime: { value: 0 },
        uExcite: { value: 0 },
        uBright: { value: 1 },
        uFlash: { value: 0 },
      },
    ]),
  });
  const mesh = new THREE.Mesh(geo, material);
  mesh.frustumCulled = false;

  let excite = 0;
  let exciteTarget = 0;
  return {
    mesh,
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
