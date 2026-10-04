import { describe, it, expect } from 'vitest';
import { CONFIG } from '../src/config.js';
import { zoneEdgeDistance } from '../src/physics/pitch.js';

describe('zoneEdgeDistance', () => {
  const P = CONFIG.pitch;
  it('is 0 on the edge, positive inside and negative outside', () => {
    expect(zoneEdgeDistance(P.zoneHalfWidth, 2.5)).toBeCloseTo(0, 6);
    expect(zoneEdgeDistance(0, (P.zoneBottom + P.zoneTop) / 2)).toBeGreaterThan(0.5);
    expect(zoneEdgeDistance(P.zoneHalfWidth + 0.2, 2.5)).toBeCloseTo(-0.2, 6);
    expect(zoneEdgeDistance(0, P.zoneTop + 0.1)).toBeCloseTo(-0.1, 6);
  });
});
