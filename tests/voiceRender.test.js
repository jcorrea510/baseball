// The umpire's voice as raw audio: it is finite, the right length, repeatable, has the pitch and the vowel resonances it was asked
// for, and its consonants are quieter than its vowels (when the hiss was louder than the vowel, "strike" was not understood).
import { describe, it, expect } from 'vitest';
import { planCall, makeUmpireCharacter } from '../src/audio/umpireVoice.js';
import { renderCall, toWav } from '../src/audio/voiceRender.js';
import { createRng } from '../src/util/rng.js';

const KINDS = ['strike', 'strikeSwing', 'strike3', 'strike3Swing', 'ball', 'ball4', 'foul', 'safe', 'out'];
const RATE = 16000;

function fft(re, im) { // in-place radix-2
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len;
    for (let i = 0; i < n; i += len) for (let k = 0; k < len / 2; k++) {
      const wr = Math.cos(ang * k), wi = Math.sin(ang * k);
      const ur = re[i + k], ui = im[i + k], vr = re[i + k + len / 2] * wr - im[i + k + len / 2] * wi, vi = re[i + k + len / 2] * wi + im[i + k + len / 2] * wr;
      re[i + k] = ur + vr; im[i + k] = ui + vi; re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
    }
  }
}
/** energy of x[from .. from+n) inside each of the given frequency bands */
function bands(x, from, n, rate, list) {
  const re = new Float64Array(n), im = new Float64Array(n);
  for (let i = 0; i < n; i++) re[i] = (x[from + i] || 0) * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / n));
  fft(re, im);
  return list.map(([lo, hi]) => { let e = 0; for (let k = Math.floor(lo * n / rate); k <= Math.ceil(hi * n / rate) && k < n / 2; k++) e += re[k] * re[k] + im[k] * im[k]; return e; });
}
const rms = (x, a, b) => { let s = 0; for (let i = a; i < b; i++) s += x[i] * x[i]; return Math.sqrt(s / Math.max(1, b - a)); };
function pitchOf(x, from, n, rate) { // strongest repeat of the waveform between 70 and 300 Hz
  let best = 0, bestLag = 0;
  for (let lag = Math.floor(rate / 300); lag <= Math.floor(rate / 70); lag++) {
    let c = 0, e1 = 0, e2 = 0;
    for (let i = 0; i < n; i++) { const a = x[from + i], b = x[from + i + lag]; c += a * b; e1 += a * a; e2 += b * b; }
    const r = c / Math.sqrt(e1 * e2 + 1e-12);
    if (r > best) { best = r; bestLag = lag; }
  }
  return rate / bestLag;
}
const vowelPlan = (vowel, hz, dur = 0.6, rasp = 0.15) => ({
  kind: 'test', segments: [{ kind: 'v', vowel, to: null, glideAt: 0.4, dur, f0: [1, 1], amp: 0.9, rough: 1, t0: 0 }],
  duration: dur, f0Keys: [[0, hz], [dur, hz]], pitch: hz, rasp, formantScale: 1, breath: 0.04, seed: 5,
});

describe('rendering a call', () => {
  it('every call, for many umpires, is clean audio of the right length with a set loudness', () => {
    const problems = []; // (collected, then checked once: a per-sample expect() is far too slow)
    for (const kind of KINDS) {
      for (let seed = 1; seed <= 8; seed++) {
        const plan = planCall(kind, makeUmpireCharacter(seed), createRng(seed * 31));
        const x = renderCall(plan, RATE);
        if (x.length !== Math.ceil((plan.duration + 0.12) * RATE)) problems.push(`${kind}/${seed}: length ${x.length}`);
        let peak = 0, bad = 0;
        for (const v of x) { if (!Number.isFinite(v)) bad++; peak = Math.max(peak, Math.abs(v)); }
        if (bad) problems.push(`${kind}/${seed}: ${bad} bad samples`);
        if (peak < 0.89 || peak > 0.91) problems.push(`${kind}/${seed}: peak ${peak}`);
        if (rms(x, x.length - 200, x.length) >= 0.02) problems.push(`${kind}/${seed}: does not end in silence`); // no click at the end
      }
    }
    expect(problems).toEqual([]);
  });

  it('is repeatable for the same plan, and different for different calls', () => {
    const v = makeUmpireCharacter(4);
    const a = renderCall(planCall('strike', v, createRng(9)), RATE), b = renderCall(planCall('strike', v, createRng(9)), RATE), c = renderCall(planCall('strike', v, createRng(10)), RATE);
    expect(Array.from(a)).toEqual(Array.from(b));
    expect(Array.from(a)).not.toEqual(Array.from(c));
  });

  it('a different sample rate gives the same call at the same length', () => {
    const plan = planCall('foul', makeUmpireCharacter(2), createRng(3));
    expect(renderCall(plan, 48000).length / 48000).toBeCloseTo(renderCall(plan, 16000).length / 16000, 2);
  });

  it('is quick enough to render on the spot (a full "strike three" at 48 kHz)', () => {
    const plan = planCall('strike3', makeUmpireCharacter(2), createRng(3));
    const t0 = Date.now();
    renderCall(plan, 48000);
    expect(Date.now() - t0).toBeLessThan(1500); // ~30 ms on a normal machine; generous for slow CI
  });
});

describe('the voice has the pitch and vowel it was asked for', () => {
  it('speaks at the planned pitch', () => {
    for (const hz of [95, 120, 150]) {
      const x = renderCall(vowelPlan('a', hz), RATE);
      expect(Math.abs(pitchOf(x, 2400, 1600, RATE) - hz) / hz).toBeLessThan(0.06);
    }
  });

  it('"ee" has its energy up high (second resonance ~2.3 kHz), "ah" in the middle (~1.1 kHz)', () => {
    const bi = bands(renderCall(vowelPlan('i', 120), RATE), 2400, 2048, RATE, [[500, 1400], [1900, 2700]]);
    const ba = bands(renderCall(vowelPlan('a', 120), RATE), 2400, 2048, RATE, [[500, 1400], [1900, 2700]]);
    expect(bi[1] / bi[0]).toBeGreaterThan(3 * (ba[1] / ba[0]));
  });

  it('the glide from "ah" to "ih" moves the second resonance up', () => {
    const plan = vowelPlan('a', 120, 0.6); plan.segments[0].to = 'I'; plan.segments[0].glideAt = 0.3;
    const x = renderCall(plan, RATE);
    const early = bands(x, Math.floor(0.12 * RATE), 1024, RATE, [[900, 1400], [1600, 2300]]);
    const late = bands(x, Math.floor(0.42 * RATE), 1024, RATE, [[900, 1400], [1600, 2300]]);
    expect(late[1] / late[0]).toBeGreaterThan(4 * (early[1] / early[0]));
  });
});

describe('the words are balanced like real speech', () => {
  const strike = () => {
    const plan = planCall('strike', makeUmpireCharacter(3), createRng(11));
    return { plan, x: renderCall(plan, RATE) };
  };
  const span = (plan, i) => [Math.round(plan.segments[i].t0 * RATE), Math.round((plan.segments[i].t0 + plan.segments[i].dur) * RATE)];

  it('the "s" hiss is much quieter than the vowel and lives above 4 kHz', () => {
    const { plan, x } = strike();
    const [s0, s1] = span(plan, 0), [v0, v1] = span(plan, 3);
    const hissLevel = rms(x, s0 + 300, s1), vowelLevel = rms(x, v0, v1);
    expect(vowelLevel / hissLevel).toBeGreaterThan(2.5); // 8 dB or more
    const [lo, hi] = bands(x, s0 + 300, 512, RATE, [[300, 2500], [4000, 7500]]);
    expect(hi).toBeGreaterThan(lo);
  });

  it('the loudest moment of a strike is the long "-eye", not the "st" in front of it', () => {
    const { plan, x } = strike();
    const win = Math.round(0.02 * RATE); let best = 0, at = 0;
    for (let i = 0; i + win < x.length; i += win) { const r = rms(x, i, i + win); if (r > best) { best = r; at = i / RATE; } }
    const v = plan.segments[3];
    expect(at).toBeGreaterThan(v.t0 - 0.02); expect(at).toBeLessThan(v.t0 + v.dur + 0.02);
  });

  it('the closing "k" pop is quieter than the vowel', () => {
    const { plan, x } = strike();
    const [v0, v1] = span(plan, 3), [k0, k1] = span(plan, 4);
    expect(rms(x, k0, k1)).toBeLessThan(rms(x, v0, v1) * 0.6);
  });
});

describe('WAV export', () => {
  it('writes a valid mono 16-bit file', () => {
    const w = toWav(new Float32Array([0, 0.5, -0.5, 1, -1]), 16000);
    const s = (o, n) => String.fromCharCode(...w.slice(o, o + n));
    const dv = new DataView(w.buffer);
    expect(s(0, 4)).toBe('RIFF'); expect(s(8, 4)).toBe('WAVE'); expect(s(36, 4)).toBe('data');
    expect(dv.getUint32(24, true)).toBe(16000); expect(dv.getUint16(22, true)).toBe(1); expect(dv.getUint16(34, true)).toBe(16);
    expect(dv.getUint32(40, true)).toBe(10); expect(w.length).toBe(54);
    expect(dv.getInt16(46, true)).toBe(16384);
  });
});
