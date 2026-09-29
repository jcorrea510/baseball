// The landing spot ring's picture: a soft ring lying on the grass (see game/landing.js for where and how big).
import * as THREE from 'three';
import { CONFIG } from '../config.js';

function ringTexture() {
  const s = 256, c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grad.addColorStop(0.0, 'rgba(255,255,255,0.10)');
  grad.addColorStop(0.6, 'rgba(255,255,255,0.14)');
  grad.addColorStop(0.76, 'rgba(255,255,255,0.75)'); // the ring itself, soft on both sides
  grad.addColorStop(0.88, 'rgba(255,255,255,0.32)');
  grad.addColorStop(1.0, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, s, s);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class LandingRing {
  constructor(scene) {
    // (drawn without a depth test: seen from a low angle the tilted ring would otherwise be cut off by the grass in front of it)
    const mat = new THREE.MeshBasicMaterial({ map: ringTexture(), color: CONFIG.landing.color, transparent: true, opacity: 0, depthWrite: false, depthTest: false });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
    this.mesh.position.y = 0.07;
    this.normal = new THREE.Vector3(0, 1, 0);
    this.forward = new THREE.Vector3(0, 0, 1); // (a plane faces +z until it is turned)
    this.mesh.renderOrder = 2;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  /** state = { visible, x, z, radius, alpha } from landingRing(); camera = the game camera (keeps the ring visible from far away) */
  show(state, camera) {
    const m = this.mesh;
    if (!state || !state.visible) { m.visible = false; return; }
    let r = state.radius;
    let tilt = 0, hx = 0, hz = 1;
    if (camera) {
      const dx = camera.position.x - state.x, dz = camera.position.z - state.z, dh = Math.hypot(dx, dz) || 1;
      const d = Math.hypot(dh, camera.position.y);
      r = Math.max(r, d * CONFIG.landing.minScreen);
      // a flat ring seen from a few degrees above the grass is a thin sliver: turn it toward the camera (about its own centre)
      // until the camera sees it from at least `viewTilt` degrees
      tilt = Math.max(0, CONFIG.landing.viewTilt * Math.PI / 180 - Math.atan2(camera.position.y, dh));
      hx = dx / dh; hz = dz / dh;
    }
    this.normal.set(hx * Math.sin(tilt), Math.cos(tilt), hz * Math.sin(tilt));
    m.quaternion.setFromUnitVectors(this.forward, this.normal);
    m.visible = true;
    m.position.x = state.x; m.position.z = state.z;
    m.scale.setScalar(r);
    m.material.opacity = state.alpha;
  }

  hide() { this.mesh.visible = false; }
}
