// The ring at the feet of the outfielder you are steering (picture only): a bright band lying on the grass that pulses gently, so you
// always know which man is yours.
import * as THREE from 'three';
import { CONFIG } from '../config.js';

export class FielderRing {
  constructor(scene) {
    const R = CONFIG.fielderRing;
    // (no haze on it and drawn after the see-through things, like the landing ring, so it reads at any distance and through the dust)
    const mat = new THREE.MeshBasicMaterial({ color: R.color, transparent: true, opacity: R.alpha, depthWrite: false, fog: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    this.mesh = new THREE.Mesh(new THREE.RingGeometry(R.inner, R.outer, 48), mat);
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.position.y = 0.07;
    this.mesh.renderOrder = 51;
    this.mesh.visible = false;
    this.t = 0;
    scene.add(this.mesh);
  }

  /** Put it under him at (x, z); dt = seconds since the last frame (for the pulse). */
  show(x, z, dt) {
    const R = CONFIG.fielderRing;
    this.t += dt;
    this.mesh.visible = true;
    this.mesh.position.set(x, 0.07, z);
    this.mesh.scale.setScalar(1 + R.pulse * Math.sin(this.t * Math.PI * 2 * R.pulseRate));
  }

  hide() { this.mesh.visible = false; this.t = 0; }
}
