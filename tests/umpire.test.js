// The plate umpire: what he says, that it varies, that it respects mute/off, and when a close play is called "safe".
import { describe, it, expect } from 'vitest';
import { CONFIG } from '../src/config.js';
import { planCall, makeUmpireCharacter, FORMANTS } from '../src/audio/umpireVoice.js';
import { AudioEngine } from '../src/audio/audio.js';
import { simulateBattedBall } from '../src/physics/ballistics.js';
import { createDefense, planPlay } from '../src/game/fielding.js';
import { createRng } from '../src/util/rng.js';

const KINDS = ['strike', 'strikeSwing', 'strike3', 'strike3Swing', 'ball', 'ball4', 'foul', 'safe', 'out'];
const U = CONFIG.audio.umpire;
const voice = makeUmpireCharacter(3);
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const sd = (a) => { const m = mean(a); return Math.sqrt(mean(a.map((v) => (v - m) ** 2))); };

describe('planning a call', () => {
  it('every call is a well-formed timeline of sounds', () => {
    for (const kind of KINDS) {
      const p = planCall(kind, voice, createRng(5));
      expect(p.segments.length).toBeGreaterThan(1);
      let t = 0;
      for (const s of p.segments) {
        expect(s.t0).toBeCloseTo(t, 9);
        expect(s.dur).toBeGreaterThan(0);
        expect(['v', 'f', 's', 'p']).toContain(s.kind);
        if (s.kind === 'v') {
          expect(FORMANTS[s.vowel]).toBeTruthy();
          if (s.to) expect(FORMANTS[s.to]).toBeTruthy();
          expect(s.amp).toBeGreaterThan(0);
          expect(s.amp).toBeLessThanOrEqual(1.0001);
        }
        t += s.dur;
      }
      expect(p.duration).toBeCloseTo(t, 9);
      for (const [, f] of p.f0Keys) { expect(f).toBeGreaterThan(60); expect(f).toBeLessThan(260); } // a deep voice, never a squeak
    }
  });

  it('each call has a believable length: a curt "Ball", a drawn-out "Steee-rike", a longer punch-out', () => {
    const dur = (k) => mean(Array.from({ length: 30 }, (_, i) => planCall(k, voice, createRng(i + 1)).duration));
    expect(dur('ball')).toBeGreaterThan(0.25); expect(dur('ball')).toBeLessThan(0.5);
    expect(dur('strike')).toBeGreaterThan(0.55); expect(dur('strike')).toBeLessThan(1.05);
    expect(dur('strike3')).toBeGreaterThan(1.3); expect(dur('strike3')).toBeLessThan(2.4);
    expect(dur('foul')).toBeGreaterThan(0.7); expect(dur('foul')).toBeLessThan(1.3);
    expect(dur('safe')).toBeGreaterThan(0.6); expect(dur('safe')).toBeLessThan(1.1);
    expect(dur('out')).toBeGreaterThan(0.25); expect(dur('out')).toBeLessThan(0.6);
    expect(dur('strike3')).toBeGreaterThan(dur('strike'));
    expect(dur('strike')).toBeGreaterThan(dur('ball'));
    expect(dur('strike')).toBeGreaterThan(dur('strikeSwing')); // the swinging strike is quick, "Steee-rike" is drawn out
  });

  it('"Strike" is built like the word: hiss, pop, drawn-out "ee", "r", "eye" gliding to "ih", pop', () => {
    const p = planCall('strike', voice, createRng(1));
    expect(p.segments.map((s) => s.kind)).toEqual(['f', 's', 'v', 'v', 'v', 's']);
    expect(p.segments.map((s) => s.vowel || '')).toEqual(['', '', 'i', 'r', 'a', '']);
    expect(p.segments[4].to).toBe('I');
    // the emphasis is on "-rike": it is the loudest sound
    const amps = p.segments.filter((s) => s.kind === 'v').map((s) => s.amp);
    expect(Math.max(...amps)).toBe(p.segments[4].amp);
  });

  it('strike three ends with "you\'re out!" and the foul call is "foul ball"', () => {
    const s3 = planCall('strike3', voice, createRng(2));
    expect(s3.segments.filter((s) => s.kind === 'p').length).toBe(2); // pauses between "strike", "three", "you're out"
    expect(s3.segments[s3.segments.length - 2].vowel).toBe('a'); // ends on the "out" (a -> oo) and its pop
    const foul = planCall('foul', voice, createRng(2));
    expect(foul.segments[0].kind).toBe('f'); // the "f"
    expect(foul.segments.some((s) => s.kind === 's' && s.voicedStop)).toBe(true); // the "b" of ball
  });

  it('calls vary a little every time, and are repeatable for the same seed', () => {
    const plans = Array.from({ length: 25 }, (_, i) => planCall('strike', voice, createRng(1000 + i)));
    expect(sd(plans.map((p) => p.duration))).toBeGreaterThan(0.02);
    expect(sd(plans.map((p) => p.pitch))).toBeGreaterThan(2);
    expect(new Set(plans.map((p) => p.duration.toFixed(4))).size).toBeGreaterThan(20);
    expect(sd(plans.map((p) => p.rasp))).toBeGreaterThan(0.01);
    const a = planCall('ball4', voice, createRng(9)), b = planCall('ball4', voice, createRng(9));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('variation stays gentle: it is still the same umpire', () => {
    const plans = Array.from({ length: 40 }, (_, i) => planCall('strike', voice, createRng(i * 7 + 1)));
    for (const p of plans) { expect(p.pitch / voice.pitch).toBeGreaterThan(0.9); expect(p.pitch / voice.pitch).toBeLessThan(1.1); }
  });

  it('an unknown call is a programming error', () => {
    expect(() => planCall('nonsense', voice, createRng(1))).toThrow();
  });
});

describe('the umpire himself', () => {
  it('has a deep, gruff voice inside the configured range, and every game has its own umpire', () => {
    const seen = new Set();
    for (let seed = 1; seed <= 40; seed++) {
      const v = makeUmpireCharacter(seed);
      expect(v.pitch).toBeGreaterThanOrEqual(U.pitchHz[0]); expect(v.pitch).toBeLessThanOrEqual(U.pitchHz[1]);
      expect(v.rasp).toBeGreaterThanOrEqual(U.rasp[0]); expect(v.rasp).toBeLessThanOrEqual(U.rasp[1]);
      seen.add(v.pitch.toFixed(2));
    }
    expect(seen.size).toBeGreaterThan(30);
    expect(makeUmpireCharacter(11)).toEqual(makeUmpireCharacter(11));
  });
});

describe('mute and off', () => {
  it('nothing is spoken when the sound is muted, the umpire is off, or audio is not unlocked yet', () => {
    const a = new AudioEngine();
    expect(a.callUmpire('strike')).toBe(false); // not unlocked (no user gesture yet)
    a.muted = true; a.umpireMode = 'synth';
    expect(a.callUmpire('strike')).toBe(false);
    a.muted = false; a.umpireMode = 'off';
    expect(a.callUmpire('strike')).toBe(false);
    a.umpireMode = 'speech'; // no speech engine in Node: refused quietly, never an exception
    expect(a.callUmpire('ball')).toBe(false);
    a.muted = true;
    expect(a.callUmpire('ball')).toBe(false);
  });

  it('a broken audio system is swallowed, never thrown into the game', () => {
    const a = new AudioEngine();
    a.unlocked = true; a.ctx = {}; a.umpireMode = 'synth'; // a context that lacks everything
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
