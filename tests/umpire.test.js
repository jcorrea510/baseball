// The plate umpire: his calls respect mute / off and never break the game, and when a close play is called "safe".
import { describe, it, expect } from 'vitest';
import { CONFIG } from '../src/config.js';
import { AudioEngine } from '../src/audio/audio.js';
import { simulateBattedBall } from '../src/physics/ballistics.js';
import { createDefense, planPlay } from '../src/game/fielding.js';
import { createRng } from '../src/util/rng.js';

describe('mute and off', () => {
  it('nothing is spoken when the sound is muted, the umpire is off, or audio is not unlocked yet', () => {
    const a = new AudioEngine();
    expect(a.callUmpire('strike')).toBe(false); // not unlocked (no user gesture yet)
    a.muted = true; a.umpireMode = 'on';
    expect(a.callUmpire('strike')).toBe(false);
    a.muted = false; a.umpireMode = 'off';
    expect(a.callUmpire('strike')).toBe(false);
    a.muted = true;
    expect(a.callUmpire('ball')).toBe(false);
  });

  it('a broken audio system is swallowed, never thrown into the game', () => {
    const a = new AudioEngine();
    a.unlocked = true; a.ctx = {}; a.umpireMode = 'on'; // a context that lacks everything
    a.files.takes.set('strike', [{ duration: 0.5 }]); // (a recording that cannot be played)
    expect(() => a.callUmpire('strike')).not.toThrow();
    expect(a.callUmpire('strike')).toBe(false);
  });
});

describe('"Safe!" on a close play', () => {
  const contact = (ev, la, sp) => ({ exitVelocity: ev, launchAngle: la, sprayAngle: sp, backspin: Math.min(3400, 900 + 55 * Math.max(la, 0)), hook: 0 });
  const plans = [];
  const rng = createRng(12);
  const defense = createDefense();
  for (let i = 0; i < 700; i++) {
    const c = contact(rng.range(45, 104), rng.range(-8, 40), rng.range(-44, 44));
    const sim = simulateBattedBall({ ...c, start: { x: 0, y: 2.5, z: -1 } });
    plans.push(planPlay({ sim, contact: c, bases: [rng.chance(0.4) ? {} : null, rng.chance(0.3) ? {} : null, rng.chance(0.2) ? {} : null], outs: 0, defense }, CONFIG));
  }
  const withSafe = plans.filter((p) => p.events.some((e) => e.type === 'safe'));

  it('only close plays are called: some, but a small share of all plays', () => {
    expect(withSafe.length).toBeGreaterThan(3);
    expect(withSafe.length / plans.length).toBeLessThan(0.2);
  });

  it('the call comes just after the throw reaches the base, at a real base, and never on an out at that base', () => {
    for (const p of withSafe) {
      const e = p.events.find((x) => x.type === 'safe');
      expect([1, 2, 3, 4]).toContain(e.base);
      const th = p.throws.find((t) => t.toBase === e.base);
      expect(th).toBeTruthy();
      expect(e.t).toBeGreaterThan(th.t1);
      expect(p.events.some((x) => x.type === 'out' && x.base === e.base)).toBe(false);
    }
  });

  it('a routine play with a runner far ahead of the throw is not called', () => {
    const c = contact(100, 26, -30); // a long fly ball caught: no throw at all
    const sim = simulateBattedBall({ ...c, start: { x: 0, y: 2.5, z: -1 } });
    const p = planPlay({ sim, contact: c, bases: [null, null, null], outs: 0, defense }, CONFIG);
    expect(p.events.some((x) => x.type === 'safe')).toBe(false);
  });
});
