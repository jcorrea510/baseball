// The body-part shapes the players are built from (render/anatomy.js): smooth lofted surfaces.
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { loft } from '../src/render/anatomy.js';

const rings = [
  { y: 0, rx: 0.2, rz: 0.15 },
  { y: -0.4, rx: 0.25, rz: 0.2 },
  { y: -0.9, rx: 0.12, rz: 0.1 },
];

describe('loft', () => {
  it('makes a closed surface: rings x columns plus two caps, unit normals, as wide as its widest ring', () => {
    const g = loft(rings, { seg: 12, sub: 2 });
    const pos = g.getAttribute('position'), nor = g.getAttribute('normal');
    const R = (rings.length - 1) * 2 + 1;
    expect(pos.count).toBe(R * 13 + 2);
    for (let i = 0; i < nor.count; i++) expect(Math.abs(Math.hypot(nor.getX(i), nor.getY(i), nor.getZ(i)) - 1)).toBeLessThan(1e-3);
    g.computeBoundingBox();
    expect(g.boundingBox.max.x).toBeCloseTo(0.25, 2);
    expect(g.boundingBox.min.z).toBeCloseTo(-0.2, 2);
    expect(g.getAttribute('uv')).toBeTruthy();
  });

  it('normals point outward (away from the axis) on the sides', () => {
    const g = loft(rings, { seg: 16 });
    const pos = g.getAttribute('position'), nor = g.getAttribute('normal');
    let bad = 0;
    for (let i = 0; i < pos.count - 2; i++) {
      const out = pos.getX(i) * nor.getX(i) + pos.getZ(i) * nor.getZ(i);
      if (out <= 0) bad++;
    }
    expect(bad).toBe(0);
  });

  it('a bump makes it bigger there by its height x the radius', () => {
    const plain = loft([{ y: 0, rx: 0.2, rz: 0.2 }, { y: -1, rx: 0.2, rz: 0.2 }], { seg: 16, sub: 1, cap: false });
    const bumped = loft([{ y: 0, rx: 0.2, rz: 0.2, bumps: [{ a: 0, w: 0.8, h: 0.3 }] }, { y: -1, rx: 0.2, rz: 0.2, bumps: [{ a: 0, w: 0.8, h: 0.3 }] }], { seg: 16, sub: 1, cap: false });
    // column 4 of 16 is the front (angle 0: +z) - the u = 0.25 convention of the jersey texture
    const zp = plain.getAttribute('position').getZ(4), zb = bumped.getAttribute('position').getZ(4);
    expect(zp).toBeCloseTo(0.2, 4);
    expect(zb).toBeCloseTo(0.2 * 1.3, 4);
    expect(bumped.getAttribute('uv').getX(4)).toBeCloseTo(0.25, 4);
    // ...and nothing at the back
    expect(bumped.getAttribute('position').getZ(12)).toBeCloseTo(-0.2, 4);
  });

  it('at minimum detail it is still closed', () => {
    const g = loft(rings, { seg: 6, sub: 1 });
    expect(g.getAttribute('position').count).toBe(3 * 7 + 2);
    expect(g.index.count).toBe((3 - 1) * 6 * 6 + 2 * 6 * 3);
  });

  it('is cached by key', () => {
    expect(loft(rings, { key: 'k1' })).toBe(loft(rings, { key: 'k1' }));
    expect(loft(rings, { key: 'k1' })).toBeInstanceOf(THREE.BufferGeometry);
  });
});
