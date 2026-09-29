// The plate umpire's voice. There are three ways he can be heard:
//   1. Your own recordings (public/sounds/umpire/*.mp3 - see umpireFiles.js) - used first whenever they exist.
//   2. The built-in voice: every call is built in code from a small speech synthesizer (a raspy glottal buzz shaped by vowel
//      resonances, plus hissed "s"/"f" and popped "t"/"k"/"b" consonants), then squeezed through a compressor, boosted where a
//      shout cuts through, and sent into the stadium (slap-back echo + reverb). Every call varies a little (pitch, speed, how
//      drawn out the "Strrr-IIIKE" is, roughness), and a game keeps one umpire "character" so he still sounds like one person.
//   3. The browser's own speech voices (optional), spoken low and slow.
//
// Layers:
//   planCall()     - pure data: the words as a timeline of sounds with pitch and loudness (unit tested in Node)
//   renderCall()   - (voiceRender.js) pure: that plan as raw audio samples
//   speak()        - plays the samples through the stadium chain;  speakWithBrowserVoice() - the Web Speech version
import { createRng } from '../util/rng.js';
import { CONFIG } from '../config.js';
import { FORMANTS } from './formants.js';
import { renderCall } from './voiceRender.js';

export { FORMANTS };

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
    hiss(6800, 0.1, 0.5), stop(4200, 0.03, 0.02, 0.35), // "st"
    voiced('r', 0.07, { f0: [1 + 0.15 * o.e, 1 + 0.25 * o.e], amp: 0.8 }), // "r"
    voiced('a', 0.42 * o.s, { to: 'I', glideAt: 0.22, f0: [1 + 0.36 * o.e, 0.97], amp: 1.0 }), // the long, loud "-eye"
    stop(1900, 0.05, 0.035, 0.42), // "k"
  ];
}
function threeWord(o) {
  return [hiss(5200, 0.07, 0.3, 0.6), voiced('r', 0.055, { f0: [1.25, 1.35], amp: 0.85 }), voiced('i', 0.28 * o.s, { f0: [1.45 * (0.85 + 0.15 * o.e), 0.8], amp: 1.0 })];
}
function ballWord(o) {
  return [stop(1500, 0.045, 0.025, 0.75, true), voiced('o', 0.2 * o.s, { f0: [1.02, 0.84], amp: 0.95 * o.amp }), voiced('l', 0.11, { f0: [0.84, 0.78], amp: 0.7 })];
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
  const drawn = rng.range(0.85, 1.35); // how drawn out the "Strrr-IIIKE"
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
// Playback (Web Audio): the rendered call goes through presence + compression, then out into the stadium
// ------------------------------------------------------------------------------------------------------------------
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/**
 * Put a voice into the ballpark: pan it, and send some of it to the reverb and to a couple of slap-back echoes off the far stands.
 * `out` is any node carrying the dry voice. (The echoes are plain delay taps, not a feedback loop, so the nodes free themselves.)
 */
export function placeVoice(audio, out, { pan = 0, reverb = 0.3, echo = 1 } = {}) {
  const c = audio.ctx, U = CONFIG.audio.umpire;
  const panner = c.createStereoPanner ? c.createStereoPanner() : null;
  if (panner) { panner.pan.value = clamp(pan, -1, 1); out.connect(panner); panner.connect(audio.sfx); } else out.connect(audio.sfx);
  if (reverb > 0 && audio.reverb) { const send = c.createGain(); send.gain.value = reverb; out.connect(send); send.connect(audio.reverb); }
  if (echo > 0 && c.createDelay) {
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = U.echo.lowpassHz; // far-away sound is muffled
    lp.connect(audio.sfx);
    U.echo.taps.forEach((t, i) => {
      const d = c.createDelay(1.5); d.delayTime.value = t;
      const g = c.createGain(); g.gain.value = U.echo.levels[i] * echo;
      out.connect(d); d.connect(g); g.connect(lp);
    });
  }
}

/**
 * Speak a planned call through the Web Audio graph of `audio` ({ ctx, sfx, reverb }).
 * Returns the time (ctx seconds) at which the call ends.
 */
export function speak(audio, plan, { delay = 0.02, level = 0.9, pan = 0, reverb } = {}) {
  const c = audio.ctx, U = CONFIG.audio.umpire;
  const samples = renderCall(plan, c.sampleRate, { drive: U.grit });
  const buf = c.createBuffer(1, samples.length, c.sampleRate);
  buf.getChannelData(0).set(samples);
  const src = c.createBufferSource(); src.buffer = buf;
  // shouting: boost the range that cuts through a crowd, then squeeze it so a quiet vowel and a loud one are both loud
  const pres = c.createBiquadFilter(); pres.type = 'peaking'; pres.frequency.value = 2500; pres.Q.value = 0.9; pres.gain.value = U.presenceDb;
  const comp = c.createDynamicsCompressor();
  comp.threshold.value = U.squeeze.threshold; comp.knee.value = 8; comp.ratio.value = U.squeeze.ratio; comp.attack.value = 0.002; comp.release.value = U.squeeze.release;
  const out = c.createGain(); out.gain.value = level;
  src.connect(pres); pres.connect(comp); comp.connect(out);
  placeVoice(audio, out, { pan, reverb: reverb ?? U.reverb });
  const t0 = c.currentTime + delay;
  src.start(t0);
  return t0 + samples.length / c.sampleRate;
}

// ------------------------------------------------------------------------------------------------------------------
// Optional: the browser's own speech voices, tuned low and slow. (Quality varies a lot between devices, and the browser does
// not let a page process its voice - no echo or squeezing - so this is just the raw voice, as deep and loud as it will go.)
// ------------------------------------------------------------------------------------------------------------------
// What is said: each call is a few short phrases, each spoken with its own speed. `drawn` = stretched out and emphatic.
const SAY = {
  strike: [[{ t: 'Strike!', drawn: true }], [{ t: 'Strrike!', drawn: true }]],
  strikeSwing: [[{ t: 'Strike!' }]],
  strike3: [[{ t: 'Strike!', drawn: true }, { t: 'Three!', gap: 0.12 }, { t: 'You\'re out!', gap: 0.16 }], [{ t: 'Strike!', drawn: true }, { t: 'Three!', gap: 0.12 }, { t: 'Yer out!', gap: 0.16 }]],
  strike3Swing: [[{ t: 'Strike!', drawn: true }, { t: 'Three!', gap: 0.1 }]],
  ball: [[{ t: 'Ball.' }], [{ t: 'Ball!' }]],
  ball4: [[{ t: 'Ball.' }, { t: 'Four!', gap: 0.12 }]],
  foul: [[{ t: 'Foul!', drawn: true }], [{ t: 'Foul ball!', drawn: true }]],
  safe: [[{ t: 'Safe!', drawn: true }]],
  out: [[{ t: 'Out!' }], [{ t: 'You\'re out!' }]],
};

/** The phrases (text, rate, pitch, volume, pause before) of one call. Pure, so it is unit tested. */
export function speechPlan(kind, rng) {
  const options = SAY[kind];
  if (!options) throw new Error('unknown umpire call: ' + kind);
  const S = CONFIG.audio.umpire.speech;
  const words = options[Math.floor(rng.next() * options.length) % options.length];
  const pitch = rng.range(S.pitch[0], S.pitch[1]);
  return words.map((w, i) => ({
    text: w.t,
    rate: w.drawn ? rng.range(S.drawnRate[0], S.drawnRate[1]) : rng.range(S.quickRate[0], S.quickRate[1]),
    pitch: clamp(pitch * (i > 0 ? 0.94 : 1), 0, 2),
    volume: S.volume,
    gap: w.gap || 0,
  }));
}

// Voices worth having, best first. A local voice starts talking right away; an online one can lag half a second behind the play.
const VOICE_LIKES = [/google us english/i, /microsoft (guy|davis|christopher|eric|roger|steffan|brian|andrew)/i, /\balex\b/i, /\bdaniel\b/i, /\baaron\b/i, /\barthur\b/i, /\bevan\b/i, /\btom\b/i, /\bfred\b/i, /\bmale\b/i];
const VOICE_DISLIKES = /female|zira|samantha|karen|susan|hazel|aria|jenny|moira|tessa|victoria|fiona|allison|ava|kate|serena|siri.*female/i;

/** Pick the best-sounding English (American if possible) male-ish voice from what the device offers; null if there is none. */
export function pickBestVoice(voices) {
  const en = (voices || []).filter((v) => v && /^en/i.test(v.lang || ''));
  if (!en.length) return null;
  const score = (v) => {
    let sc = 0;
    if (/^en[-_]us/i.test(v.lang)) sc += 30;
    const like = VOICE_LIKES.findIndex((re) => re.test(v.name));
    if (like >= 0) sc += 40 - like * 3;
    if (VOICE_DISLIKES.test(v.name)) sc -= 60;
    if (v.localService) sc += 12;
    return sc;
  };
  return en.slice().sort((a, b) => score(b) - score(a))[0];
}

let cachedVoice = null;
function bestVoice() {
  if (cachedVoice) return cachedVoice;
  const vs = (typeof speechSynthesis !== 'undefined' && speechSynthesis.getVoices && speechSynthesis.getVoices()) || [];
  cachedVoice = pickBestVoice(vs);
  return cachedVoice;
}
/** Ask the browser to load its voices now (they arrive late on many devices) so the first call is not spoken in the default voice. */
export function warmBrowserVoices() {
  try {
    if (typeof speechSynthesis === 'undefined') return;
    speechSynthesis.getVoices();
    if (speechSynthesis.addEventListener) speechSynthesis.addEventListener('voiceschanged', () => { cachedVoice = null; });
  } catch (e) { /* ignore */ }
}

export function speakWithBrowserVoice(kind, rng, volume = 1) {
  if (typeof speechSynthesis === 'undefined' || typeof SpeechSynthesisUtterance === 'undefined') return false;
  try {
    const voice = bestVoice();
    speechSynthesis.cancel();
    for (const p of speechPlan(kind, rng)) {
      const u = new SpeechSynthesisUtterance(p.text);
      if (voice) { u.voice = voice; u.lang = voice.lang; }
      u.pitch = p.pitch; u.rate = p.rate; u.volume = clamp(p.volume * volume, 0, 1);
      speechSynthesis.speak(u);
    }
  } catch (e) { return false; }
  return true;
}
export function stopBrowserVoice() { try { if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel(); } catch (e) { /* ignore */ } }
