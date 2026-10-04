import { describe, it, expect } from 'vitest';
import { CONFIG } from '../src/config.js';
import { isPainted } from '../src/game/pitching.js';

const P = CONFIG.pitch;
const edge = { x: P.zoneHalfWidth - 0.05, y: 2.5 }; // just inside the edge
const mk = (t, grade = 'perfect') => ({ mine: true, grade, target: t });
describe('isPainted', () => {
  it('perfect called strike on the edge', () => expect(isPainted(mk(edge), 'calledStrike')).toBe(true));
  it('perfect swinging strike on the edge', () => expect(isPainted(mk(edge), 'swingingStrike')).toBe(true));
  it('same spot, good grade: no', () => expect(isPainted(mk(edge, 'good'), 'calledStrike')).toBe(false));
  it('a ball: no', () => expect(isPainted(mk({ x: P.zoneHalfWidth + 0.05, y: 2.5 }), 'ball')).toBe(false));
  it('strike three on the edge', () => expect(isPainted(mk(edge), 'strikeoutLooking')).toBe(true));
  it('middle of the zone: no', () => expect(isPainted(mk({ x: 0, y: 2.5 }), 'calledStrike')).toBe(false));
  it('not your pitch: no', () => expect(isPainted({ ...mk(edge), mine: false }, 'calledStrike')).toBe(false));
});
