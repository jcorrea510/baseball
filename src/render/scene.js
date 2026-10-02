// Renderer, scene, camera and the render loop plumbing (resize, adaptive resolution).
import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { createEnvironment } from './environment.js';
import { buildStadium } from './stadium.js';
import { setPark } from '../physics/field.js';
import { createResolution } from './resolution.js';

export function detectMobile() {
  const ua = navigator.userAgent || '';
  const touch = navigator.maxTouchPoints > 1;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || (touch && Math.min(screen.width, screen.height) < 900);
}

export function createScene(canvas, opts = {}) {
  const isMobile = opts.isMobile ?? detectMobile();
  const Q = CONFIG.quality;
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true, // phone graphics chips smooth edges almost for free
    powerPreference: 'high-performance',
    preserveDrawingBuffer: !!opts.preserveDrawingBuffer,
  });
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  const maxPR = isMobile ? Q.maxPixelRatioMobile : Q.maxPixelRatio;
  const sharpest = () => Math.min(window.devicePixelRatio || 1, maxPR);
  const res = createResolution(sharpest());
  renderer.setPixelRatio(res.ratio);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(CONFIG.camera.batter.fov, 16 / 9, 0.8, 6000);
  const env = createEnvironment(scene, renderer, { shadowSize: isMobile ? Q.shadowMapSizeMobile : Q.shadowMapSize });
  const stadium = buildStadium({ isMobile, crowdCount: isMobile ? Q.crowdCountMobile : Q.crowdCount });
  scene.add(stadium.root);

  const size = { w: 1, h: 1, aspect: 1 };
  function resize() {
    const w = Math.max(1, canvas.clientWidth || window.innerWidth);
    const h = Math.max(1, canvas.clientHeight || window.innerHeight);
    size.w = w; size.h = h; size.aspect = w / h;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 120));
  resize();

  // ---- adaptive resolution (render/resolution.js): fewer dots only while frames stay slow; sharp again once smooth ----
  function adapt(dtMs) {
    if (!res.sample(dtMs, sharpest())) return;
    renderer.setPixelRatio(res.ratio);
    renderer.setSize(size.w, size.h, false);
  }

  const S = {
    renderer, scene, camera, env, stadium, size, isMobile,
    /** Play in ballpark `id`: the field's shape changes and the stadium is built again (the old one is thrown away). */
    setPark(id) {
      if (!setPark(id)) return false;
      scene.remove(S.stadium.root);
      disposeTree(S.stadium.root);
      S.stadium = buildStadium({ isMobile, crowdCount: isMobile ? Q.crowdCountMobile : Q.crowdCount });
      scene.add(S.stadium.root);
      return true;
    },
    get pixelRatio() { return res.ratio; },
    resize,
    adapt,
  };
  return S;
}

// Free everything a group of meshes holds on the graphics card (geometries, materials, their textures).
function disposeTree(root) {
  const mats = new Set();
  root.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    const m = o.material;
    if (Array.isArray(m)) m.forEach((x) => mats.add(x)); else if (m) mats.add(m);
  });
  for (const m of mats) {
    for (const k of Object.keys(m)) { const v = m[k]; if (v && v.isTexture) v.dispose(); }
    if (m.uniforms) for (const u of Object.values(m.uniforms)) if (u && u.value && u.value.isTexture) u.value.dispose();
    for (const t of (m.userData && m.userData.extraTextures) || []) t.dispose();
    m.dispose();
  }
}
