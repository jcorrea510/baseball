// Sky dome, sun / stadium lights, fog and the day / dusk / night presets.
import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { damp } from '../util/math.js';

export const TIMES_OF_DAY = ['day', 'dusk', 'night'];

const PRESETS = {
  day: {
    skyTop: '#2a6fd4', skyHorizon: '#c4dcf0', skyBottom: '#6d8f5a',
    fog: '#c9dcea', fogNear: 700, fogFar: 3200,
    sunColor: '#fff3df', sunIntensity: 3.3, sunPos: [-150, 210, 80],
    fillIntensity: 0.55, fillColor: '#b8d0ff',
    hemiSky: '#bcd6ff', hemiGround: '#5e7a44', hemiIntensity: 1.05,
    exposure: 1.0, stars: 0, sunGlow: 1, lamps: 0, crowd: 1.0, glass: 0,
  },
  dusk: {
    skyTop: '#22306e', skyHorizon: '#ff9a5a', skyBottom: '#3b3a45',
    fog: '#b8806a', fogNear: 500, fogFar: 2600,
    sunColor: '#ffb27a', sunIntensity: 2.3, sunPos: [-220, 70, 60],
    fillIntensity: 0.45, fillColor: '#8a90d8',
    hemiSky: '#8f93d6', hemiGround: '#5a4a3c', hemiIntensity: 0.75,
    exposure: 1.05, stars: 0.25, sunGlow: 1, lamps: 0.75, crowd: 0.85, glass: 0,
  },
  night: {
    skyTop: '#02060f', skyHorizon: '#18264a', skyBottom: '#080d16',
    fog: '#0a1226', fogNear: 400, fogFar: 2200,
    sunColor: '#e4ecff', sunIntensity: 2.6, sunPos: [60, 260, 90],
    fillIntensity: 0.28, fillColor: '#6f86c8',
    hemiSky: '#4b5f95', hemiGround: '#1d271c', hemiIntensity: 0.62,
    exposure: 1.18, stars: 1, sunGlow: 0, lamps: 1, crowd: 0.62, glass: 1,
  },
};

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const SKY_FRAG = /* glsl */ `
varying vec3 vDir;
uniform vec3 uTop, uHorizon, uBottom, uSunDir, uSunColor;
uniform float uStars, uSunGlow;
float hash(vec3 p){ p = fract(p * 0.3183099 + .1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = mix(uHorizon, uTop, pow(clamp(h, 0.0, 1.0), 0.5));
  if (h < 0.0) col = mix(uHorizon, uBottom, clamp(-h * 5.0, 0.0, 1.0));
  float s = max(dot(d, normalize(uSunDir)), 0.0);
  col += uSunColor * (pow(s, 900.0) * 9.0 + pow(s, 14.0) * 0.32 + pow(s, 3.0) * 0.06) * uSunGlow;
  // stars
  if (uStars > 0.01 && h > 0.02) {
    vec3 q = floor(d * 260.0);
    float st = step(0.9965, hash(q));
    col += vec3(st) * uStars * smoothstep(0.02, 0.3, h) * (0.5 + 0.5 * hash(q + 3.1));
  }
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export function createEnvironment(scene, renderer, { shadowSize = 2048 } = {}) {
  const skyMat = new THREE.ShaderMaterial({
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uTop: { value: new THREE.Color() },
      uHorizon: { value: new THREE.Color() },
      uBottom: { value: new THREE.Color() },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunColor: { value: new THREE.Color() },
      uStars: { value: 0 },
      uSunGlow: { value: 1 },
    },
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(4000, 32, 16), skyMat);
  sky.frustumCulled = false;
  sky.renderOrder = -10;
  scene.add(sky);

  const hemi = new THREE.HemisphereLight(0xffffff, 0x445533, 1);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 3);
  sun.castShadow = true;
  sun.shadow.mapSize.set(shadowSize, shadowSize);
  const sc = sun.shadow.camera;
  sc.left = -125; sc.right = 125; sc.top = 125; sc.bottom = -125; sc.near = 20; sc.far = 700;
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.06;
  sun.shadow.radius = 3;
  scene.add(sun);
  sun.target.position.set(0, 0, -62);
  scene.add(sun.target);
  const fill = new THREE.DirectionalLight(0xffffff, 0.5);
  fill.position.set(160, 90, 160);
  scene.add(fill);

  scene.fog = new THREE.Fog(0xc9dcea, 700, 3200);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;

  // Current (smoothed) values
  const cur = {
    skyTop: new THREE.Color(), skyHorizon: new THREE.Color(), skyBottom: new THREE.Color(), fog: new THREE.Color(),
    sunColor: new THREE.Color(), fillColor: new THREE.Color(), hemiSky: new THREE.Color(), hemiGround: new THREE.Color(),
    sunPos: new THREE.Vector3(), fogNear: 0, fogFar: 0, sunIntensity: 0, fillIntensity: 0, hemiIntensity: 0,
    exposure: 1, stars: 0, sunGlow: 1, lamps: 0, crowd: 1, glass: 0,
  };
  let target = PRESETS.day;
  let name = 'day';
  const tmpColor = new THREE.Color();
  const tmpVec = new THREE.Vector3();

  function setNow() {
    const c = cur;
    skyMat.uniforms.uTop.value.copy(c.skyTop);
    skyMat.uniforms.uHorizon.value.copy(c.skyHorizon);
    skyMat.uniforms.uBottom.value.copy(c.skyBottom);
    skyMat.uniforms.uSunColor.value.copy(c.sunColor);
    skyMat.uniforms.uSunDir.value.copy(c.sunPos).normalize();
    skyMat.uniforms.uStars.value = c.stars;
    skyMat.uniforms.uSunGlow.value = c.sunGlow;
    scene.fog.color.copy(c.fog);
    scene.fog.near = c.fogNear;
    scene.fog.far = c.fogFar;
    sun.color.copy(c.sunColor);
    sun.intensity = c.sunIntensity;
    sun.position.copy(c.sunPos).add(sun.target.position);
    fill.color.copy(c.fillColor);
    fill.intensity = c.fillIntensity;
    hemi.color.copy(c.hemiSky);
    hemi.groundColor.copy(c.hemiGround);
    hemi.intensity = c.hemiIntensity;
    renderer.toneMappingExposure = c.exposure;
  }

  function snapTo(preset) {
    const c = cur;
    c.skyTop.set(preset.skyTop); c.skyHorizon.set(preset.skyHorizon); c.skyBottom.set(preset.skyBottom); c.fog.set(preset.fog);
    c.sunColor.set(preset.sunColor); c.fillColor.set(preset.fillColor); c.hemiSky.set(preset.hemiSky); c.hemiGround.set(preset.hemiGround);
    c.sunPos.set(...preset.sunPos);
    for (const k of ['fogNear', 'fogFar', 'sunIntensity', 'fillIntensity', 'hemiIntensity', 'exposure', 'stars', 'sunGlow', 'lamps', 'crowd', 'glass']) c[k] = preset[k];
    setNow();
  }
  snapTo(PRESETS.day);

  const env = {
    sky, sun, hemi, fill,
    get name() { return name; },
    get lamps() { return cur.lamps; },
    get crowdBrightness() { return cur.crowd; },
    get glass() { return cur.glass; },
    set(nameKey, instant = true) {
      target = PRESETS[nameKey] || PRESETS.day;
      name = PRESETS[nameKey] ? nameKey : 'day';
      if (instant) snapTo(target);
    },
    update(dt, camera) {
      const k = 2.5;
      const c = cur, t = target;
      const lc = (a, b) => { a.lerp(tmpColor.set(b), 1 - Math.exp(-k * dt)); };
      lc(c.skyTop, t.skyTop); lc(c.skyHorizon, t.skyHorizon); lc(c.skyBottom, t.skyBottom); lc(c.fog, t.fog);
      lc(c.sunColor, t.sunColor); lc(c.fillColor, t.fillColor); lc(c.hemiSky, t.hemiSky); lc(c.hemiGround, t.hemiGround);
      tmpVec.set(...t.sunPos);
      c.sunPos.lerp(tmpVec, 1 - Math.exp(-k * dt));
      for (const key of ['fogNear', 'fogFar', 'sunIntensity', 'fillIntensity', 'hemiIntensity', 'exposure', 'stars', 'sunGlow', 'lamps', 'crowd', 'glass']) {
        c[key] = damp(c[key], t[key], k, dt);
      }
      setNow();
      if (camera) sky.position.copy(camera.position);
    },
  };
  return env;
}
