// The pitch guide's picture: a soft translucent circle floating over the strike zone (see game/pitchGuide.js for where it points and
// how strongly it shows). It sits on the plane where timing is measured, so it looks like part of the zone.
import * as THREE from 'three';
import { CONFIG } from '../config.js';

function ringTexture() {
  // a soft disc with a slightly brighter, blurry rim - reads as a circle without a hard edge
  const s = 128, c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grad.addColorStop(0.0, 'rgba(255,255,255,0.30)');
  grad.addColorStop(0.55, 'rgba(255,255,255,0.26)');
  grad.addColorStop(0.78, 'rgba(255,255,255,0.62)');
  grad.addColorStop(0.9, 'rgba(255,255,255,0.20)');
  grad.addColorStop(1.0, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, s, s);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class PitchGuide {
  constructor(scene) {
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.MeshBasicMaterial({ map: ringTexture(), color: CONFIG.pitch.guide.color, transparent: true, opacity: 0, depthWrite: false })
    );
    this.mesh.position.z = CONFIG.pitch.contactZ + 0.06;
    this.mesh.renderOrder = 6;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  /** state = { visible, alpha, x, y, radius } from pitchGuide() */
  show(state) {
    const m = this.mesh;
    if (!state || !state.visible) { m.visible = false; return; }
    m.visible = true;
    m.position.x = state.x; m.position.y = state.y;
    m.scale.setScalar(state.radius);
    m.material.opacity = state.alpha;
  }

  hide() { this.mesh.visible = false; }
}
