// The baseball: mesh with stitching, soft ground shadow and a glowing trail for hard-hit balls.
import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { ballTexture, softDotTexture } from './textures.js';

const TRAIL_N = 34;

const TRAIL_VERT = /* glsl */ `
attribute float aAlpha;
attribute float aSize;
varying float vAlpha;
uniform float uScale;
void main() {
  vAlpha = aAlpha;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uScale / max(0.1, -mv.z);
  gl_Position = projectionMatrix * mv;
}`;
const TRAIL_FRAG = /* glsl */ `
varying float vAlpha;
uniform vec3 uColor;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c) * 2.0;
  float a = smoothstep(1.0, 0.0, d);
  gl_FragColor = vec4(uColor, a * vAlpha);
}`;

export function createBall(scene) {
  const group = new THREE.Group();
  const r = CONFIG.physics.ballRadius;
  const mat = new THREE.MeshStandardMaterial({ map: ballTexture(), roughness: 0.55, metalness: 0, emissive: 0x222222 });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(r, 20, 14), mat);
  mesh.castShadow = true;
  group.add(mesh);
  scene.add(group);

  // soft shadow on the ground
  const shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.4, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -5 });
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.36, 20), shadowMat);
  shadow.rotation.x = -Math.PI / 2;
  shadow.renderOrder = 3;
  scene.add(shadow);

  // a soft glow so a far-away ball stays easy to follow (especially against a dark sky)
  const haloMat = new THREE.SpriteMaterial({ map: softDotTexture(64, 0), color: 0xfff4d8, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0, sizeAttenuation: false, fog: false });
  const halo = new THREE.Sprite(haloMat);
  halo.scale.setScalar(0.03);
  halo.renderOrder = 6;
  scene.add(halo);
  let haloBoost = 1;

  // trail
  const pos = new Float32Array(TRAIL_N * 3);
  const alpha = new Float32Array(TRAIL_N);
  const size = new Float32Array(TRAIL_N);
  const tg = new THREE.BufferGeometry();
  tg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  tg.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1));
  tg.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  const tm = new THREE.ShaderMaterial({
    vertexShader: TRAIL_VERT, fragmentShader: TRAIL_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uScale: { value: 500 }, uColor: { value: new THREE.Color(1.0, 0.86, 0.55) } },
  });
  const trail = new THREE.Points(tg, tm);
  trail.frustumCulled = false;
  scene.add(trail);

  const history = []; // recent positions (newest first)
  let trailStrength = 0;
  let visible = true;

  const api = {
    group, mesh,
    setHaloBoost(b) { haloBoost = b; },
    setVisible(v) { visible = v; group.visible = v; shadow.visible = v; halo.visible = v; if (!v) { trailStrength = 0; tg.getAttribute('aAlpha').array.fill(0); tg.getAttribute('aAlpha').needsUpdate = true; } },
    get visible() { return visible; },
    setScale(s) { mesh.scale.setScalar(s); },
    setPosition(x, y, z) {
      group.position.set(x, y, z);
      const h = Math.max(0, y - r);
      shadow.position.set(x, 0.05, z);
      const k = 1 + h * 0.035;
      shadow.scale.setScalar(k);
      shadowMat.opacity = Math.max(0.08, 0.45 - h * 0.006);
    },
    // Spin about an axis (radians per second).
    spin(axis, rate, dt) {
      mesh.rotateOnWorldAxis(axis, rate * dt);
    },
    setTrail(strength) { trailStrength = strength; },
    clearTrail() { history.length = 0; },
    // Call every frame after setPosition. `pts` (optional) = recent positions, newest first (from the
    // flight simulation), which gives a smooth continuous streak; otherwise the last frames are used.
    updateTrail(dt, camera, viewportH, pts) {
      if (pts) { history.length = 0; for (const q of pts) history.push(q); }
      else {
        history.unshift(group.position.clone());
        if (history.length > TRAIL_N) history.pop();
      }
      const a = tg.getAttribute('aAlpha'), s = tg.getAttribute('aSize'), p = tg.getAttribute('position');
      for (let i = 0; i < TRAIL_N; i++) {
        const h = history[Math.min(i, history.length - 1)];
        if (!h || i >= history.length) { a.array[i] = 0; continue; }
        p.array[i * 3] = h.x; p.array[i * 3 + 1] = h.y; p.array[i * 3 + 2] = h.z;
        const f = 1 - i / TRAIL_N;
        a.array[i] = trailStrength * f * f * 0.9;
        s.array[i] = 0.55 * (0.4 + f * 0.9);
      }
      a.needsUpdate = true; s.needsUpdate = true; p.needsUpdate = true;
      tm.uniforms.uScale.value = (viewportH * 0.5) / Math.tan((camera.fov * Math.PI) / 360);
      const d = camera.position.distanceTo(group.position);
      const k = Math.max(0, Math.min(1, (d - 70) / 130));
      haloMat.opacity = k * 0.85 * haloBoost;
      halo.position.copy(group.position);
      halo.scale.setScalar(0.022 + 0.012 * k);
    },
  };
  return api;
}
