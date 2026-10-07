// The players' heads (render/face.js): the skull's surface, shells that sit ON it (hair, facial hair, cap, helmet), the parts per style.
import { describe, it, expect } from 'vitest';
import { skullRings, skullSurface, headParts, capParts, helmetParts, beardParts, beardCover } from '../src/render/face.js';
import { BEARDS } from '../src/game/looks.js';

const surf = skullSurface(skullRings(0.5));
const finite = (g) => { const a = g.getAttribute('position').array; for (const v of a) if (!Number.isFinite(v)) return false; return true; };
// every vertex of a shell is outside the skull (or on its turned-in rim, at most `rim` inside), never far from it
function distances(g) {
  const p = g.getAttribute('position');
  const out = [];
  for (let i = 0; i < p.count; i += 7) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    if (y < surf.yBottom || y > surf.yTop) continue;
    // the nearest point of the skin at this height (searched round the head), and which side of it the vertex is
    let best = null;
    for (let k = -60; k <= 60; k++) {
      const s = surf.at(y, Math.atan2(x, z - 0.01) + k * 0.01);
      const d2 = (x - s.p[0]) ** 2 + (z - s.p[2]) ** 2;
      if (!best || d2 < best.d2) best = { d2, s };
    }
    const s = best.s;
    out.push(Math.sign((x - s.p[0]) * s.n[0] + (z - s.p[2]) * s.n[2]) * Math.sqrt(best.d2));
  }
  return out;
}

describe('face', () => {
  it('the surface sampler matches the skull: a point at height y has that height and a unit outward normal', () => {
    for (const y of [-0.15, 0, 0.2, 0.4]) for (const th of [0, 0.8, 1.6, 3]) {
      const { p, n } = surf.at(y, th);
      expect(p[1]).toBeCloseTo(y, 3);
      expect(Math.hypot(...n)).toBeCloseTo(1, 4);
      expect(n[0] * Math.sin(th) + n[2] * Math.cos(th)).toBeGreaterThan(0);
    }
  });

  it('every style makes finite parts; facial hair and the cap sit just outside the skin, never coinciding with it', () => {
    for (const style of BEARDS) {
      const parts = beardParts(surf, { style, color: '#222222', dl: 1, q: 0.5 });
      if (style === 'none' || style === 'stubble') { expect(parts.length).toBe(0); continue; }
      expect(parts.length).toBeGreaterThan(0);
      for (const pt of parts) {
        expect(finite(pt.geo)).toBe(true);
        const d = distances(pt.geo);
        expect(Math.max(...d)).toBeLessThan(0.15);
        // (the visible part is clearly off the skin: the middle point at least 8 thousandths of a foot out; only its rim turns in)
        d.sort((a, b) => a - b);
        expect(d[Math.floor(d.length / 2)]).toBeGreaterThan(0.008);
      }
    }
    for (const pt of [...capParts(surf, { color: '#111111', bill: '#111111', badge: '#ffffff', dl: 1, q: 0.5 }), ...helmetParts(surf, { color: '#111111', badge: '#ffffff', dl: 1, q: 0.5 })]) expect(finite(pt.geo)).toBe(true);
  });

  it('the beard leaves the lips bare', () => {
    for (const style of ['goatee', 'short', 'full']) {
      expect(beardCover(0, 0.0, 0.34, style)).toBeLessThan(0.05); // the middle of the mouth
      expect(beardCover(0, -0.15, 0.27, style)).toBeGreaterThan(0.9); // the chin
    }
    expect(beardCover(0.1, 0.0, 0.33, 'none')).toBe(0);
  });

  it('a whole head at full and low detail', () => {
    for (const dl of [1, 0.5]) {
      const { parts } = headParts({ dl, skin: '#bd855c', lip: '#9a5a50', eye: '#3a2416', hair: '#100c0a', beard: 'full', long: true, face: 0.3 });
      expect(parts.length).toBeGreaterThan(20);
      for (const p of parts) expect(finite(p.geo)).toBe(true);
    }
  });
});
