// Particles: dust puffs, sparks, confetti and fireworks - all from two pooled point clouds.
import * as THREE from 'three';
import { softDotTexture } from './textures.js';
import { createRng } from '../util/rng.js';

const MAX = 2600;

const VERT = /* glsl */ `
attribute float aSize;
attribute vec4 aColor;
varying vec4 vColor;
uniform float uScale;
void main() {
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uScale / max(0.5, -mv.z);
  gl_Position = projectionMatrix * mv;
}`;
const FRAG = /* glsl */ `
uniform sampler2D uMap;
varying vec4 vColor;
void main() {
  vec4 t = texture2D(uMap, gl_PointCoord);
  gl_FragColor = vec4(vColor.rgb, vColor.a * t.a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

class Pool {
  constructor(scene, additive) {
    this.n = 0;
    this.pos = new Float32Array(MAX * 3);
    this.size = new Float32Array(MAX);
    this.col = new Float32Array(MAX * 4);
    this.vel = new Float32Array(MAX * 3);
    this.life = new Float32Array(MAX);
    this.maxLife = new Float32Array(MAX);
    this.grav = new Float32Array(MAX);
    this.drag = new Float32Array(MAX);
    this.grow = new Float32Array(MAX);
    this.base = new Float32Array(MAX * 4);
    this.trail = new Float32Array(MAX); // firework sparklers emit sub-particles
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    this.geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 4));
    this.geo.setDrawRange(0, 0);
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: { uMap: { value: softDotTexture(64, 0) }, uScale: { value: 500 } },
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }
  spawn(x, y, z, vx, vy, vz, life, size, r, g, b, a, grav = 0, drag = 0, grow = 0, trail = 0) {
    if (this.n >= MAX) return;
    const i = this.n++;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.life[i] = life; this.maxLife[i] = life; this.size[i] = size;
    this.base[i * 4] = r; this.base[i * 4 + 1] = g; this.base[i * 4 + 2] = b; this.base[i * 4 + 3] = a;
    this.grav[i] = grav; this.drag[i] = drag; this.grow[i] = grow; this.trail[i] = trail;
  }
  update(dt, spawnSub) {
    let i = 0;
    while (i < this.n) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        // swap-remove
        const j = --this.n;
        if (i !== j) {
          for (let k = 0; k < 3; k++) { this.pos[i * 3 + k] = this.pos[j * 3 + k]; this.vel[i * 3 + k] = this.vel[j * 3 + k]; }
          for (let k = 0; k < 4; k++) this.base[i * 4 + k] = this.base[j * 4 + k];
          this.life[i] = this.life[j]; this.maxLife[i] = this.maxLife[j]; this.size[i] = this.size[j];
          this.grav[i] = this.grav[j]; this.drag[i] = this.drag[j]; this.grow[i] = this.grow[j]; this.trail[i] = this.trail[j];
        }
        continue;
      }
      const k = Math.exp(-this.drag[i] * dt);
      this.vel[i * 3] *= k; this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * k - this.grav[i] * dt; this.vel[i * 3 + 2] *= k;
      this.pos[i * 3] += this.vel[i * 3] * dt; this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt; this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      if (this.pos[i * 3 + 1] < 0.05 && this.grav[i] > 0) { this.pos[i * 3 + 1] = 0.05; this.vel[i * 3 + 1] *= -0.3; }
      const f = this.life[i] / this.maxLife[i];
      this.col[i * 4] = this.base[i * 4]; this.col[i * 4 + 1] = this.base[i * 4 + 1]; this.col[i * 4 + 2] = this.base[i * 4 + 2];
      this.col[i * 4 + 3] = this.base[i * 4 + 3] * Math.min(1, f * 2.2);
      this.size[i] += this.grow[i] * dt;
      if (this.trail[i] > 0 && spawnSub && Math.random() < this.trail[i] * dt * 60) {
        spawnSub(this.pos[i * 3], this.pos[i * 3 + 1], this.pos[i * 3 + 2], this.base[i * 4], this.base[i * 4 + 1], this.base[i * 4 + 2]);
      }
      i++;
    }
    this.geo.setDrawRange(0, this.n);
    this.geo.getAttribute('position').needsUpdate = true;
    this.geo.getAttribute('aSize').needsUpdate = true;
    this.geo.getAttribute('aColor').needsUpdate = true;
  }
}

export function createEffects(scene) {
  const rng = createRng(777);
  const dust = new Pool(scene, false);
  const glow = new Pool(scene, true);
  const sub = (x, y, z, r, g, b) => glow.spawn(x, y, z, rng.range(-1, 1), rng.range(-1, 1), rng.range(-1, 1), rng.range(0.35, 0.7), 1.6, r, g, b, 0.9, 12, 1.5, 0);

  const api = {
    // brown / tan puff of dirt or chalk
    dustPuff(x, z, strength = 1, color = [0.62, 0.45, 0.3]) {
      const n = Math.round(6 + strength * 8);
      for (let i = 0; i < n; i++) {
        const a = rng.next() * Math.PI * 2, s = rng.range(1.5, 6) * strength;
        dust.spawn(x + rng.range(-0.4, 0.4), 0.2, z + rng.range(-0.4, 0.4), Math.cos(a) * s, rng.range(1.5, 4.5) * strength, Math.sin(a) * s,
          rng.range(0.55, 1.15), rng.range(2.2, 4.0), color[0], color[1], color[2], rng.range(0.28, 0.5), 4, 3.5, 3.4);
      }
    },
    grassBits(x, z, strength = 1) {
      for (let i = 0; i < 6 * strength; i++) {
        const a = rng.next() * Math.PI * 2, s = rng.range(2, 6);
        dust.spawn(x, 0.2, z, Math.cos(a) * s, rng.range(3, 7), Math.sin(a) * s, rng.range(0.4, 0.8), rng.range(0.7, 1.2), 0.3, 0.55, 0.2, 0.8, 22, 1, 0, 0);
      }
    },
    // white-hot sparks at bat contact
    contactSparks(x, y, z, strength = 1, dir = [0, 0, -1]) {
      const n = Math.round(12 + 26 * strength);
      for (let i = 0; i < n; i++) {
        const sp = rng.range(6, 26) * (0.5 + strength * 0.6);
        glow.spawn(x, y, z, dir[0] * sp * 0.6 + rng.range(-1, 1) * sp * 0.5, dir[1] * sp * 0.6 + rng.range(-0.4, 1) * sp * 0.5, dir[2] * sp * 0.6 + rng.range(-1, 1) * sp * 0.5,
          rng.range(0.16, 0.42), rng.range(0.5, 1.1), 1.0, 0.85 + rng.next() * 0.15, 0.55 + rng.next() * 0.3, 0.9, 30, 2, 0);
      }
      // a quick bright flash
      glow.spawn(x, y, z, 0, 0, 0, 0.09, 4.2 * (0.6 + strength), 1, 0.95, 0.8, 0.9, 0, 0, 0);
    },
    // a tiny white flash where the ball leaves the pitcher's hand (makes the release point easy to see)
    releaseGlint(x, y, z) {
      glow.spawn(x, y, z, 0, 0, 0, 0.16, 1.5, 1, 1, 0.95, 0.75, 0, 0, 4);
      for (let i = 0; i < 5; i++) glow.spawn(x, y, z, rng.range(-3, 3), rng.range(-2, 3), rng.range(-3, 3), 0.25, 0.5, 1, 1, 1, 0.7, 4, 3, 0);
    },
    confetti(x, y, z, n = 80, spread = 30) {
      const cols = [[1, 0.2, 0.2], [0.2, 0.6, 1], [1, 0.85, 0.2], [0.3, 1, 0.5], [1, 0.4, 0.9], [1, 1, 1]];
      for (let i = 0; i < n; i++) {
        const c = cols[i % cols.length];
        const a = rng.next() * Math.PI * 2, s = rng.range(0, spread);
        dust.spawn(x + rng.range(-10, 10), y, z + rng.range(-10, 10), Math.cos(a) * s * 0.5, rng.range(10, 32), Math.sin(a) * s * 0.5, rng.range(2.6, 4.6), rng.range(0.8, 1.4), c[0], c[1], c[2], 1, 9, 1.2, 0, 0);
      }
    },
    firework(x, y, z, color, big = 1) {
      const c = color || [[1, 0.4, 0.3], [1, 0.85, 0.3], [0.4, 0.8, 1], [0.6, 1, 0.5], [1, 0.5, 1]][Math.floor(rng.next() * 5)];
      const n = Math.round(90 * big);
      for (let i = 0; i < n; i++) {
        const u = rng.range(-1, 1), a = rng.next() * Math.PI * 2, r = Math.sqrt(1 - u * u);
        const sp = rng.range(18, 44) * big;
        glow.spawn(x, y, z, r * Math.cos(a) * sp, u * sp, r * Math.sin(a) * sp, rng.range(1.2, 2.1), rng.range(1.5, 2.4) * big, c[0], c[1], c[2], 1, 16, 1.6, 0, 0.5);
      }
      glow.spawn(x, y, z, 0, 0, 0, 0.1, 9 * big, 1, 1, 0.9, 0.8, 0, 0, 0);
    },
    update(dt, camera, viewportH) {
      const scale = (viewportH * 0.5) / Math.tan((camera.fov * Math.PI) / 360);
      dust.mat.uniforms.uScale.value = scale;
      glow.mat.uniforms.uScale.value = scale;
      dust.update(dt);
      glow.update(dt, sub);
    },
    clear() { dust.n = 0; glow.n = 0; },
    pools: { dust, glow },
  };
  return api;
}
