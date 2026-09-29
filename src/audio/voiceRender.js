// Turns a planned call (see planCall in umpireVoice.js) into raw audio samples. This is a small source-filter speech synthesizer
// in plain JavaScript (no Web Audio, no DOM), so it runs in Node too and can be tested and analysed offline:
//   voice source (a real glottal pulse train with pitch wobble, loudness wobble, and gruff "creaky" cycles)
//     -> a chain of vowel resonances (formants) that glide from sound to sound  (the "mouth")
//   hissed "s"/"f" and popped "t"/"k"/"b" come from filtered noise;  a breath of noise goes through the mouth too.
// The result is a Float32Array at the requested sample rate, scaled so its loudest sample is `peak`.
import { createRng } from '../util/rng.js';
import { FORMANTS } from './formants.js';

const TWO_PI = Math.PI * 2;
const CONTROL_RATE = 1000; // how often the mouth shape / loudness curves are updated (Hz); everything between is interpolated
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// Where in the mouth a hiss or pop is made shapes the formants leading out of it: [F1, F2, F3] it starts from.
const LOCUS = { alveolar: [300, 1750, 2750], lips: [220, 850, 2200], teeth: [300, 1200, 2450], velar: [300, 1500, 2350] };
function locusFor(sg) {
  if (sg.locus) return LOCUS[sg.locus] || LOCUS.alveolar;
  if (sg.kind === 's' && sg.voicedStop) return LOCUS.lips;
  return sg.center > 4000 ? LOCUS.alveolar : sg.center > 2500 ? LOCUS.teeth : sg.center > 1200 ? LOCUS.velar : LOCUS.lips;
}

// One second-order resonator (a formant). Unity gain at 0 Hz, so a vowel's loudness comes from its formant layout.
class Resonator {
  constructor() { this.a = 1; this.b = 0; this.c = 0; this.y1 = 0; this.y2 = 0; }
  set(freq, bw, rate) {
    const f = clamp(freq, 50, rate * 0.45);
    const r = Math.exp(-Math.PI * bw / rate);
    this.c = -r * r;
    this.b = 2 * r * Math.cos(TWO_PI * f / rate);
    this.a = 1 - this.b - this.c;
  }
  run(x) { const y = this.a * x + this.b * this.y1 + this.c * this.y2; this.y2 = this.y1; this.y1 = y; return y; }
}

// A band-pass (peak gain 1) for hiss and bursts.
class BandPass {
  constructor() { this.b0 = 0; this.b2 = 0; this.a1 = 0; this.a2 = 0; this.x1 = 0; this.x2 = 0; this.y1 = 0; this.y2 = 0; }
  set(freq, q, rate) {
    const w = TWO_PI * clamp(freq, 100, rate * 0.45) / rate, al = Math.sin(w) / (2 * q), a0 = 1 + al;
    this.b0 = al / a0; this.b2 = -al / a0; this.a1 = -2 * Math.cos(w) / a0; this.a2 = (1 - al) / a0;
  }
  run(x) {
    const y = this.b0 * x + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y;
    return y;
  }
}

/**
 * @param {object} plan   from planCall()
 * @param {number} rate   samples per second of the result
 * @param {object} [o]
 * @param {number} [o.peak]   loudest sample of the result (0..1)
 * @param {number} [o.tail]   seconds of silence after the last sound (lets the closing pop ring out)
 * @param {number} [o.drive]  how hard the voice is pushed into soft clipping, x the umpire's roughness (0 = clean; a lot smears the words)
 * @returns {Float32Array}
 */
export function renderCall(plan, rate = 44100, { peak = 0.9, tail = 0.12, drive: driveScale = 0.35, presence = 0.5, hissGain = 0.7, burstGain = 0.55, voiceGain = 0.9 } = {}) {
  const rng = createRng((plan.seed ^ 0x9e3779b9) >>> 0);
  const total = plan.duration + tail;
  const n = Math.ceil(total * rate);
  const nc = Math.ceil(total * CONTROL_RATE) + 2;
  const segs = plan.segments;
  const rasp = clamp(plan.rasp, 0, 1.2);

  // ---- control curves, one value per millisecond ---------------------------------------------------------------------
  const f0 = new Float32Array(nc), voiceAmp = new Float32Array(nc), asp = new Float32Array(nc), fric = new Float32Array(nc);
  const fricCenter = new Float32Array(nc).fill(5000), fricQ = new Float32Array(nc).fill(1);
  const F = [new Float32Array(nc), new Float32Array(nc), new Float32Array(nc)];
  const bar = new Float32Array(nc); // low hum during the closure of a voiced stop ("b")
  const at = (t) => clamp(Math.round(t * CONTROL_RATE), 0, nc - 1);

  // pitch: straight lines between the keys, flat before the first and after the last
  const keys = plan.f0Keys.length ? plan.f0Keys : [[0, plan.pitch], [total, plan.pitch]];
  let ki = 0;
  for (let i = 0; i < nc; i++) {
    const t = i / CONTROL_RATE;
    while (ki < keys.length - 2 && t > keys[ki + 1][0]) ki++;
    const [ta, fa] = keys[ki], [tb, fb] = keys[Math.min(ki + 1, keys.length - 1)];
    f0[i] = fa + (fb - fa) * (tb > ta ? clamp((t - ta) / (tb - ta), 0, 1) : 1);
  }

  // mouth shape: each sound has a target (a vowel; or, for hisses and pops, the place in the mouth where they are made), and the
  // resonances slew toward it, so the pop of a "b" or "t" leaves a rising or falling formant transition into the next vowel -
  // which is a large part of what tells the ear which consonant it heard.
  const scale = (fm) => fm.map((v) => v * plan.formantScale);
  const target = [0, 1, 2].map(() => new Float32Array(nc));
  const firstVoiced = segs.find((s) => s.kind === 'v');
  let cur = scale(firstVoiced ? FORMANTS[firstVoiced.vowel] : FORMANTS.x);
  for (let k = 0; k < 3; k++) target[k].fill(cur[k]);
  const setTarget = (i0, i1, fm) => { for (let i = Math.max(0, i0); i < i1 && i < nc; i++) for (let k = 0; k < 3; k++) target[k][i] = fm[k]; };
  for (const sg of segs) {
    const i0 = at(sg.t0), i1 = at(sg.t0 + sg.dur);
    if (sg.kind === 'v') {
      const a = scale(FORMANTS[sg.vowel]), b = sg.to ? scale(FORMANTS[sg.to]) : a, ig = at(sg.t0 + sg.dur * sg.glideAt);
      setTarget(i0, ig, a); setTarget(ig, i1, b); cur = b;
    } else if (sg.kind === 'f' || sg.kind === 's') {
      cur = scale(locusFor(sg));
      setTarget(i0, i1, cur);
    } else setTarget(i0, i1, cur);
  }
  for (let k = 0; k < 3; k++) for (let i = at(total - tail); i < nc; i++) target[k][i] = cur[k]; // (the tail keeps the last shape)
  // slew toward the target with a time constant of ~13 ms (the tongue has weight)
  const alpha = 1 - Math.exp(-1 / (CONTROL_RATE * 0.013));
  for (let k = 0; k < 3; k++) { let v = target[k][0]; for (let i = 0; i < nc; i++) { v += (target[k][i] - v) * alpha; F[k][i] = v; } }

  // loudness of the voice and the breath, from the voiced sounds; hisses and pops from the consonants
  const setMax = (arr, i0, i1, v) => { for (let i = Math.max(0, i0); i < Math.min(nc, i1); i++) arr[i] = Math.max(arr[i], v); };
  for (const sg of segs) {
    const i0 = at(sg.t0), i1 = at(sg.t0 + sg.dur);
    if (sg.kind === 'v') {
      const atk = 12, rel = 38; // ms
      for (let i = i0 - atk; i < i1 + rel; i++) {
        if (i < 0 || i >= nc) continue;
        const u = i < i0 ? (i - (i0 - atk)) / atk : i > i1 ? 1 - (i - i1) / rel : 1;
        voiceAmp[i] = Math.max(voiceAmp[i], sg.amp * Math.sin(clamp(u, 0, 1) * Math.PI / 2));
      }
    } else if (sg.kind === 'f') {
      const ramp = Math.min(20, (i1 - i0) / 3);
      for (let i = i0; i < i1; i++) {
        const u = Math.min((i - i0) / ramp, (i1 - i) / ramp, 1);
        fric[i] = Math.max(fric[i], sg.amp * clamp(u, 0, 1));
        fricCenter[i] = sg.center; fricQ[i] = 0.9 + sg.bw * 0.3;
      }
    } else if (sg.kind === 's') {
      const ib = i0 + Math.round(sg.closure * CONTROL_RATE); // the burst starts when the closure opens
      const decay = Math.max(6, sg.burst * CONTROL_RATE * 0.5);
      for (let i = ib; i < Math.min(nc, ib + Math.round(sg.burst * CONTROL_RATE * 2.5) + 6); i++) {
        const e = Math.exp(-(i - ib) / decay);
        fric[i] = Math.max(fric[i], sg.amp * burstGain * e);
        fricCenter[i] = sg.center; fricQ[i] = 1.3;
        if (!sg.voicedStop) asp[i] = Math.max(asp[i], 0.7 * Math.exp(-(i - ib) / 26)); // the puff of air after t / k
      }
      if (sg.voicedStop) for (let i = i0; i < ib; i++) bar[i] = 0.10;
    }
  }

  // ---- sample loop ---------------------------------------------------------------------------------------------------
  const out = new Float32Array(n);
  const res = [new Resonator(), new Resonator(), new Resonator(), new Resonator(), new Resonator()];
  const bw = [80 + 20 * rasp, 100 + 30 * rasp, 150 + 40 * rasp, 260, 320];
  const f4 = 3400 * plan.formantScale, f5 = 4600 * plan.formantScale;
  const noiseBP = new BandPass();
  let phase = 0, cycleAmp = 1, cycleF = 1, cycleIdx = 0, lastG = 0, tilt = 0, hp1 = 0, hpPrev = 0, bar1 = 0;
  const Tp = 0.42, Tn = 0.14; // opening / closing fractions of a glottal cycle (a short close = a bright, pressed shout)
  const glottal = (p) => (p < Tp ? 0.5 * (1 - Math.cos(Math.PI * p / Tp)) : p < Tp + Tn ? Math.cos(Math.PI / 2 * (p - Tp) / Tn) : 0);
  const tiltCut = 1 - Math.exp(-TWO_PI * (2600 + 1800 * rasp) / rate); // gentle low-pass on the source: less buzz
  let fc = 0; // control index
  for (let i = 0; i < n; i++) {
    const cpos = i * CONTROL_RATE / rate, ci = Math.min(nc - 2, Math.floor(cpos)), cf = cpos - ci;
    const lerp = (arr) => arr[ci] + (arr[ci + 1] - arr[ci]) * cf;
    if (ci !== fc || i === 0) { // retune the mouth once per millisecond
      fc = ci;
      res[0].set(F[0][ci], bw[0], rate); res[1].set(F[1][ci], bw[1], rate); res[2].set(F[2][ci], bw[2], rate);
      res[3].set(f4, bw[3], rate); res[4].set(f5, bw[4], rate);
      noiseBP.set(fricCenter[ci], fricQ[ci], rate);
    }
    const va = lerp(voiceAmp), aa = lerp(asp), fa = lerp(fric), ba = lerp(bar);
    // glottal source
    let sourceVoice = 0;
    if (va > 0.002 || ba > 0.002) {
      const hz = lerp(f0) * cycleF;
      phase += hz / rate;
      if (phase >= 1) {
        phase -= 1; cycleIdx++;
        // every cycle is a little different: pitch wobble, loudness wobble, and now and then a rough, creaky cycle
        cycleF = 1 + (rng.next() - 0.5) * 0.025 * (0.6 + rasp);
        cycleAmp = 1 - 0.18 * rasp * rng.next();
        if (rng.next() < 0.18 * rasp) { cycleAmp *= 0.45; cycleF *= 0.94 + 0.04 * rng.next(); } // gravel
        else if (rasp > 0.6 && (cycleIdx & 1) && rng.next() < 0.3) cycleAmp *= 0.8; // uneven, "doubled" cycles
      }
      const g = glottal(phase);
      const d = (g - lastG) * 8; // derivative of the flow: what the air outside hears
      lastG = g;
      tilt += (d - tilt) * tiltCut;
      sourceVoice = tilt * cycleAmp;
    }
    const breath = (rng.next() * 2 - 1) * (0.06 + 0.10 * rasp) * (1 + 0.5 * (phase < Tp ? 0 : 1));
    const noise = rng.next() * 2 - 1;
    // through the mouth: voice + a little breath while voiced + the puff after a pop
    let x = sourceVoice * va + breath * va * 0.5 + noise * aa * 0.9;
    if (ba > 0.002) { bar1 += (sourceVoice - bar1) * 0.08; x += bar1 * ba * 2.5; } // a muffled hum through the closed lips
    let y = x;
    for (let r = 0; r < 5; r++) y = res[r].run(y);
    // hiss / burst noise (not through the mouth)
    const hiss = fa > 0.0005 ? noiseBP.run(noise) * fa * hissGain : (noiseBP.run(0), 0);
    out[i] = y * voiceGain + hiss;
  }

  // ---- shout: soft-clip harder for a gruffer voice, cut the rumble, add a little presence, then set the level ----------
  const drive = (1.1 + rasp * 1.2) * driveScale;
  const hpC = Math.exp(-TWO_PI * 90 / rate);
  let px = 0, py = 0, max = 0;
  for (let i = 0; i < n; i++) {
    const v = Math.tanh(out[i] * drive) / Math.tanh(drive);
    py = hpC * (py + v - px); px = v; // one-pole high-pass
    // presence: add a bit of the high-passed slope
    const pres = py + presence * (py - hpPrev); hpPrev = py;
    out[i] = pres;
    if (Math.abs(pres) > max) max = Math.abs(pres);
  }
  const g = max > 0 ? peak / max : 1;
  for (let i = 0; i < n; i++) out[i] *= g;
  return out;
}

/** Write samples as a mono 16-bit WAV (for listening tests and offline analysis). */
export function toWav(samples, rate) {
  const bytes = new Uint8Array(44 + samples.length * 2), dv = new DataView(bytes.buffer);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) bytes[o + i] = s.charCodeAt(i); };
  str(0, 'RIFF'); dv.setUint32(4, 36 + samples.length * 2, true); str(8, 'WAVEfmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, rate, true); dv.setUint32(28, rate * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true); str(36, 'data'); dv.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) dv.setInt16(44 + i * 2, Math.round(clamp(samples[i], -1, 1) * 32767), true);
  return bytes;
}
