// The plate umpire's voice. No audio files: every call is built from a small formant synthesizer (a raspy, low glottal
// buzz shaped by vowel resonances, plus hissed "s"/"f" and popped "t"/"k"/"b" consonants), so it sounds the same on every
// device, starts instantly and can be timed to the umpire's gesture. Every call varies a little (pitch, speed, how drawn
// out the "Steee-rike" is, roughness), and a game keeps one umpire "character" so he still sounds like one person.
//
// Two layers:
//   planCall()  - pure data: the words as a timeline of sounds with pitch and loudness (unit tested in Node)
//   speak()     - turns a plan into Web Audio nodes;  speakWithBrowserVoice() - optional Web Speech version
import { createRng } from '../util/rng.js';
import { CONFIG } from '../config.js';

// Vowel and glide resonances (Hz) of an adult male voice: [F1, F2, F3]
export const FORMANTS = {
  i: [290, 2250, 2950], // steee, three
  I: [400, 1900, 2550], // end of "rike", "safe"
  e: [500, 1850, 2500], // start of "safe"
  a: [720, 1150, 2450], // start of "rike", "foul", "out"
  o: [580, 880, 2450], // ball, four
  u: [450, 1050, 2300], // end of "foul", "out"
  x: [500, 1350, 2400], // "yer"
  r: [420, 1250, 1600],
  l: [380, 1150, 2650],
  j: [280, 2150, 3000],
};

// --- building blocks of a plan -------------------------------------------------------------------------------------
// Every sound has: kind ('v' voiced, 'f' hiss, 's' stop = silence + pop, 'p' pause), dur (s), and for voiced sounds
// the resonances, an optional glide target, a pitch contour [start, end] (x the umpire's base pitch) and a loudness.
const voiced = (vowel, dur, o = {}) => ({ kind: 'v', vowel, to: o.to || null, glideAt: o.glideAt ?? 0.4, dur, f0: o.f0 || [1, 1], amp: o.amp ?? 0.85, rough: o.rough ?? 1 });
const hiss = (center, dur, amp, bw = 1) => ({ kind: 'f', center, bw, dur, amp });
const stop = (center, closure, burst, amp, voicedStop = false) => ({ kind: 's', center, dur: closure + burst, closure, burst, amp, voicedStop });
const pause = (dur) => ({ kind: 'p', dur });

// The words. `e` = emphasis 0..1 (bigger pitch swings, louder, longer), `s` = how drawn out the vowel is.
function strikeWord(o) {
  return [
    hiss(6800, 0.085, 0.5), stop(4200, 0.028, 0.02, 0.3),
    voiced('i', 0.19 * o.s, { f0: [0.98, 1 + 0.2 * o.e], amp: 0.78 }), // "steee"
    voiced('r', 0.055, { f0: [1 + 0.2 * o.e, 1 + 0.24 * o.e], amp: 0.8 }),
    voiced('a', 0.32 * o.s, { to: 'I', glideAt: 0.5, f0: [1 + 0.34 * o.e, 0.98], amp: 1.0 }), // "-rike"
    stop(1900, 0.05, 0.035, 0.42),
  ];
}
function threeWord(o) {
  return [hiss(5200, 0.07, 0.3, 0.6), voiced('r', 0.055, { f0: [1.25, 1.35], amp: 0.85 }), voiced('i', 0.28 * o.s, { f0: [1.45 * (0.85 + 0.15 * o.e), 0.8], amp: 1.0 })];
}
function ballWord(o) {
  return [stop(450, 0.03, 0.03, 0.4, true), voiced('o', 0.2 * o.s, { f0: [1.02, 0.84], amp: 0.95 * o.amp }), voiced('l', 0.09, { f0: [0.84, 0.78], amp: 0.5 })];
}
function fourWord(o) {
  return [hiss(3200, 0.08, 0.28, 0.5), voiced('o', 0.17 * o.s, { f0: [1.05, 0.85], amp: 0.95 }), voiced('r', 0.07, { f0: [0.85, 0.8], amp: 0.5 })];
}
function outWord(o) {
  return [voiced('a', 0.3 * o.s, { to: 'u', glideAt: 0.45, f0: [1.1, 0.82], amp: 1.0 }), stop(4200, 0.05, 0.035, 0.42)];
}

/**
 * Plan one call. kind: 'strike' | 'strikeSwing' | 'strike3' | 'strike3Swing' | 'ball' | 'ball4' | 'foul' | 'safe' | 'out'
 * @param {object} voice  the umpire's character (see makeUmpireCharacter)
 * @param {object} rng    seeded random source: this is what makes every call a little different
 */
export function planCall(kind, voice, rng) {
  const speed = rng.range(0.93, 1.09) * (voice.tempo || 1); // >1 = slower
  const pitch = voice.pitch * rng.range(0.93, 1.07);
  const drawn = rng.range(0.85, 1.35); // how drawn out the "Steee-"
  const amp = rng.range(0.9, 1.0);
  let segs = [];
  const o = (e, s = 1) => ({ e, s: s * speed, amp });
  switch (kind) {
    case 'strike': segs = strikeWord(o(0.75, drawn)); break;
    case 'strikeSwing': segs = strikeWord(o(0.5, 0.6)); break;
    case 'strike3': segs = [...strikeWord(o(1.0, drawn)), pause(0.06 * speed), ...threeWord(o(1.0, 0.9)), pause(0.09 * speed), voiced('j', 0.04, { f0: [1.1, 1.1], amp: 0.6 }), voiced('x', 0.09, { f0: [1.05, 1.15], amp: 0.85 }), ...outWord(o(1.0, 0.9))]; break;
    case 'strike3Swing': segs = [...strikeWord(o(0.95, drawn * 0.8)), pause(0.08 * speed), ...threeWord(o(0.95, 0.95))]; break;
    case 'ball': segs = ballWord(o(0.6)); break;
    case 'ball4': segs = [...ballWord(o(0.7)), pause(0.11 * speed), ...fourWord(o(0.7))]; break;
    case 'foul': segs = [hiss(3200, 0.09, 0.32, 0.5), voiced('a', 0.3 * drawn * speed, { to: 'u', glideAt: 0.5, f0: [1.0, 1.26], amp: 1.0 }), voiced('l', 0.09, { f0: [1.26, 1.1], amp: 0.5 }), pause(0.05 * speed), ...ballWord(o(0.9))]; break;
    case 'safe': segs = [hiss(6800, 0.1, 0.5), voiced('e', 0.44 * drawn * speed, { to: 'I', glideAt: 0.35, f0: [1.02, 1.24], amp: 1.0 }), hiss(3200, 0.13, 0.3, 0.5)]; break;
    case 'out': segs = outWord(o(0.9)); break;
    default: throw new Error('unknown umpire call: ' + kind);
  }
  // lay the sounds out on a timeline and stretch by `speed`
  let t = 0;
  const timeline = segs.map((sg) => {
    const dur = sg.kind === 'v' || sg.kind === 'f' || sg.kind === 'p' || sg.kind === 's' ? sg.dur * (sg.kind === 'v' ? 1 : speed) : sg.dur;
    const out = { ...sg, t0: t, dur };
    if (sg.kind === 's') out.closure = sg.closure * speed;
    t += dur;
    return out;
  });
  // pitch contour: keys at the start/end of every voiced sound
  const f0Keys = [];
  for (const s of timeline) if (s.kind === 'v') { f0Keys.push([s.t0, s.f0[0] * pitch]); f0Keys.push([s.t0 + s.dur, s.f0[1] * pitch]); }
  return {
    kind, segments: timeline, duration: t, f0Keys, pitch, rasp: voice.rasp * rng.range(0.85, 1.1), formantScale: voice.formant * rng.range(0.985, 1.015),
    breath: rng.chance(0.3) ? 0.09 : 0.04, seed: (rng.next() * 2 ** 32) >>> 0,
  };
}

/** One umpire per game: a gruff low voice (his own pitch, mouth size, roughness and tempo). */
export function makeUmpireCharacter(seed = 1) {
  const r = createRng((seed ^ 0x5bd1e995) >>> 0);
  const U = CONFIG.audio.umpire;
  return {
    pitch: r.range(U.pitchHz[0], U.pitchHz[1]),
    formant: r.range(0.93, 1.03), // longer/shorter vocal tract
    rasp: r.range(U.rasp[0], U.rasp[1]),
    tempo: r.range(0.95, 1.08),
  };
}

// ------------------------------------------------------------------------------------------------------------------
// Synthesis (Web Audio)
// ------------------------------------------------------------------------------------------------------------------
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
let periodic = null;
function glottalWave(ctx) {
  // a rich, slightly buzzy glottal spectrum (harmonics fall off like 1/n^1.4), the source of a shouting voice
  if (periodic && periodic.ctx === ctx) return periodic.wave;
  const n = 48, real = new Float32Array(n + 1), imag = new Float32Array(n + 1);
  for (let k = 1; k <= n; k++) imag[k] = 1 / Math.pow(k, 1.4) * (k % 2 === 0 ? 0.92 : 1);
  const wave = ctx.createPeriodicWave(real, imag, { disableNormalization: false });
  periodic = { ctx, wave };
  return wave;
}
const softClip = (() => {
  const n = 1024, c = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(x * 2.2) / Math.tanh(2.2); }
  return c;
})();

/**
 * Schedule a planned call on an AudioEngine-like object: { ctx, noiseBuf, sfx, reverb }.
 * Returns the time (ctx seconds) at which the call ends.
 */
export function speak(audio, plan, { delay = 0.02, level = 0.9, pan = 0, reverb = 0.3 } = {}) {
  const c = audio.ctx;
  const t0 = c.currentTime + delay;
  const rng = createRng(plan.seed);
  const dur = plan.duration + 0.08;
  const RATE = 400; // control-curve resolution (Hz)

  // ---- voiced source: pitch (with jitter) and loudness (with shimmer / vocal fry) as precomputed curves
  const n = Math.max(4, Math.ceil(dur * RATE));
  const f0c = new Float32Array(n), ampc = new Float32Array(n);
  const keys = plan.f0Keys.length ? plan.f0Keys : [[0, plan.pitch], [dur, plan.pitch]];
  let jit = 0, ki = 0;
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    while (ki < keys.length - 2 && t > keys[ki + 1][0]) ki++;
    const [ta, fa] = keys[ki], [tb, fb] = keys[Math.min(ki + 1, keys.length - 1)];
    const u = tb > ta ? clamp((t - ta) / (tb - ta), 0, 1) : 1;
    jit += (rng.next() - 0.5) * 0.02 - jit * 0.12; // slow random wobble of the pitch
    f0c[i] = Math.max(60, (fa + (fb - fa) * u) * (1 + jit * plan.rasp * 1.3));
    // loudness from the voiced sounds
    let a = 0;
    for (const s of plan.segments) {
      if (s.kind !== 'v') continue;
      const e = s.t0 + s.dur;
      if (t < s.t0 - 0.004 || t > e + 0.03) continue;
      const attack = clamp((t - s.t0 + 0.004) / 0.018, 0, 1), release = clamp((e + 0.03 - t) / 0.05, 0, 1);
      a = Math.max(a, s.amp * Math.min(attack, release));
    }
    const fry = plan.rasp * (rng.next() < 0.22 ? 0.35 : 0); // occasional dropouts: gravel
    ampc[i] = a * (1 - plan.rasp * 0.22 * rng.next()) * (1 - fry);
  }
  const osc = c.createOscillator();
  osc.setPeriodicWave(glottalWave(c));
  osc.frequency.value = f0c[0];
  osc.frequency.setValueCurveAtTime(f0c, t0, n / RATE); // (no other event at the same instant: strict browsers refuse that)
  const vgain = c.createGain();
  vgain.gain.value = 0;
  vgain.gain.setValueCurveAtTime(ampc, t0, n / RATE);
  osc.connect(vgain);

  // ---- vocal tract: parallel resonators (formants), moved sound by sound
  const mix = c.createGain(); mix.gain.value = 1;
  const FQ = [9, 12, 14], FG = [1.0, 0.62, 0.34];
  const bank = [0, 1, 2].map((i) => {
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = FQ[i];
    const g = c.createGain(); g.gain.value = FG[i];
    vgain.connect(bp); bp.connect(g); g.connect(mix);
    return bp;
  });
  const f4 = c.createBiquadFilter(); f4.type = 'bandpass'; f4.frequency.value = 3500; f4.Q.value = 9;
  const f4g = c.createGain(); f4g.gain.value = 0.16; vgain.connect(f4); f4.connect(f4g); f4g.connect(mix);
  const F = (name) => FORMANTS[name].map((v) => v * plan.formantScale);
  let last = F('x');
  bank.forEach((bp, i) => bp.frequency.setValueAtTime(last[i], t0));
  for (const s of plan.segments) {
    if (s.kind !== 'v') continue;
    const a = F(s.vowel), b = s.to ? F(s.to) : a, st = t0 + s.t0;
    bank.forEach((bp, i) => {
      bp.frequency.setTargetAtTime(a[i], Math.max(t0, st - 0.014), 0.016);
      if (s.to) bp.frequency.setTargetAtTime(b[i], st + s.dur * s.glideAt, s.dur * 0.22);
    });
    last = b;
  }
  // breath through the same resonators (a hint of air makes it human)
  const noise = (dest, bpf, q, type = 'bandpass') => {
    const src = c.createBufferSource(); src.buffer = audio.noiseBuf; src.loop = true;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = bpf; f.Q.value = q;
    const g = c.createGain(); g.gain.value = 0;
    src.connect(f); f.connect(g); g.connect(dest);
    src.start(t0, Math.random() * 1.5); src.stop(t0 + dur + 0.05);
    return { f, g };
  };
  const air = c.createGain(); air.gain.value = 1;
  bank.forEach((bp) => air.connect(bp));
  const breath = noise(air, 1400, 0.4);
  breath.g.gain.setValueAtTime(plan.breath, t0);

  // ---- shouting: drive the voice into soft clipping, add presence, cut the rumble
  const shaper = c.createWaveShaper(); shaper.curve = softClip; shaper.oversample = '2x';
  const drive = c.createGain(); drive.gain.value = 1.0 + plan.rasp * 0.9;
  const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 85; hp.Q.value = 0.7;
  const pres = c.createBiquadFilter(); pres.type = 'peaking'; pres.frequency.value = 2400; pres.Q.value = 0.8; pres.gain.value = 4;
  mix.connect(drive); drive.connect(shaper); shaper.connect(hp); hp.connect(pres);
  const out = c.createGain(); out.gain.value = level * 0.85;
  pres.connect(out);

  // ---- consonants: hiss and pops come from noise, not the voice
  const cons = c.createGain(); cons.gain.value = 1; cons.connect(out);
  const ns = noise(cons, 5000, 1);
  const nsGain = ns.g.gain;
  nsGain.setValueAtTime(0, t0);
  for (const s of plan.segments) {
    const st = t0 + s.t0;
    if (s.kind === 'f') {
      ns.f.frequency.setValueAtTime(s.center, st); ns.f.Q.setValueAtTime(0.9 + s.bw * 0.3, st);
      nsGain.setValueAtTime(0.0001, st);
      nsGain.linearRampToValueAtTime(s.amp * 0.5, st + 0.02);
      nsGain.setValueAtTime(s.amp * 0.5, st + s.dur - 0.02);
      nsGain.linearRampToValueAtTime(0.0001, st + s.dur);
    } else if (s.kind === 's') {
      const bt = st + s.closure;
      ns.f.frequency.setValueAtTime(s.center, bt); ns.f.Q.setValueAtTime(1.3, bt);
      nsGain.setValueAtTime(0.0001, bt);
      nsGain.linearRampToValueAtTime(s.amp * 0.9, bt + 0.004);
      nsGain.exponentialRampToValueAtTime(0.0001, bt + Math.max(0.02, s.burst));
    }
  }

  // ---- placement: where the call comes from, a little stadium echo
  const panner = c.createStereoPanner ? c.createStereoPanner() : null;
  if (panner) { panner.pan.value = clamp(pan, -1, 1); out.connect(panner); panner.connect(audio.sfx); } else out.connect(audio.sfx);
  if (reverb > 0 && audio.reverb) { const send = c.createGain(); send.gain.value = reverb; out.connect(send); send.connect(audio.reverb); }

  osc.start(t0); osc.stop(t0 + dur + 0.06);
  return t0 + dur;
}

// ------------------------------------------------------------------------------------------------------------------
// Optional: the browser's own speech voices, tuned low and slow. (Quality varies a lot between devices.)
// ------------------------------------------------------------------------------------------------------------------
const SPEECH = {
  strike: ['Steeee-rike!', 'Steeeerike!', 'Strike!'],
  strikeSwing: ['Strike!', 'Strike!'],
  strike3: ['Steeeerike three! You\'re out!', 'Strike three! Yer out!'],
  strike3Swing: ['Strike three!', 'Strike three!'],
  ball: ['Ball.', 'Ball!'],
  ball4: ['Ball four.', 'Ball four!'],
  foul: ['Foul ball!', 'Foul!'],
  safe: ['Safe!', 'Safe!'],
  out: ['Out!', 'You\'re out!'],
};
let cachedVoice = null;
function pickVoice() {
  if (cachedVoice) return cachedVoice;
  const vs = (typeof speechSynthesis !== 'undefined' && speechSynthesis.getVoices()) || [];
  const en = vs.filter((v) => /^en/i.test(v.lang));
  const male = en.find((v) => /daniel|alex|fred|david|mark|guy|george|male|james|arthur|rishi/i.test(v.name));
  cachedVoice = male || en[0] || null;
  return cachedVoice;
}
export function speakWithBrowserVoice(kind, rng, volume = 1) {
  if (typeof speechSynthesis === 'undefined' || typeof SpeechSynthesisUtterance === 'undefined') return false;
  const list = SPEECH[kind] || SPEECH.strike;
  const u = new SpeechSynthesisUtterance(list[Math.floor(rng.next() * list.length)]);
  const v = pickVoice();
  if (v) u.voice = v;
  u.pitch = rng.range(0.55, 0.75);
  u.rate = kind === 'ball' || kind === 'ball4' ? rng.range(1.0, 1.15) : rng.range(0.82, 0.98);
  u.volume = clamp(volume, 0, 1);
  try { speechSynthesis.cancel(); speechSynthesis.speak(u); } catch (e) { return false; }
  return true;
}
export function stopBrowserVoice() { try { if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel(); } catch (e) { /* ignore */ } }
