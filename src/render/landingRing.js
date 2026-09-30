// The landing spot ring's picture: a soft ring lying on the grass (see game/landing.js for where and how big).
import * as THREE from 'three';
import { CONFIG } from '../config.js';

function ringTexture() {
  // a crisp chalk-white band with a faint dark edge on both sides, so it reads on bright grass as well as at night
  const s = 256, c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grad.addColorStop(0.0, 'rgba(255,255,255,0.06)');
  grad.addColorStop(0.66, 'rgba(255,255,255,0.08)');
  grad.addColorStop(0.7, 'rgba(0,0,0,0.25)');
  grad.addColorStop(0.74, 'rgba(255,255,255,0.95)');
  grad.addColorStop(0.9, 'rgba(255,255,255,0.95)');
  grad.addColorStop(0.94, 'rgba(0,0,0,0.25)');
  grad.addColorStop(1.0, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, s, s);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

export class LandingRing {
  constructor(scene) {
    // Lying flat on the grass like a chalk mark (depth-tested, nudged toward the camera so it never flickers into the grass).
    const mat = new THREE.MeshBasicMaterial({ map: ringTexture(), color: CONFIG.landing.color, transparent: true, opacity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.position.y = 0.06;
    this.mesh.renderOrder = 2;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  /** state = { visible, x, z, radius, alpha } from landingRing(); camera = the game camera (a far ring is kept a readable size) */
  show(state, camera) {
    const m = this.mesh;
    if (!state || !state.visible) { m.visible = false; return; }
    let r = state.radius;
    if (camera) r = Math.max(r, camera.position.distanceTo(m.position.set(state.x, 0.06, state.z)) * CONFIG.landing.minScreen);
    m.visible = true;
    m.position.set(state.x, 0.06, state.z);
    m.scale.setScalar(r);
    m.material.opacity = state.alpha;
  }

  hide() { this.mesh.visible = false; }
}
