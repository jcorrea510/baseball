import { planCall, speak, placeVoice, makeUmpireCharacter, speakWithBrowserVoice, stopBrowserVoice, warmBrowserVoices } from './umpireVoice.js';
import { UmpireFiles } from './umpireFiles.js';
import { createRng } from '../util/rng.js';
import { CONFIG } from '../config.js';

// All sound is synthesized live with the Web Audio API - no audio files. The audio context is only created
// after the first click / key press (browsers require that), so nothing plays before then.
export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.volume = 0.8; // master
    this.levels = { sfx: 1, umpire: 1, crowd: 1 }; // the three channels under the master volume (Settings sliders)
    this.hidden = false;
    this.unlocked = false;
    this.ambience = null;
    this.noiseBuf = null;
    this.reverbBuf = null;
    this.lastCrack = 0;
    this.umpireMode = CONFIG.audio.umpire.voice; // 'synth' | 'speech' | 'off'
    this.umpire = null; // this game's umpire (his own voice)
    this.callRng = createRng(1);
    this.files = new UmpireFiles(); // your own recordings from public/sounds/umpire (loaded after the first click)
  }

  // A new game gets a new umpire (a deep, gruff voice of his own).
  setUmpire(seed) {
    this.umpire = makeUmpireCharacter(seed);
    this.callRng = createRng((seed * 2654435761) >>> 0);
  }

  // The plate umpire calls a pitch / play. kind: strike | strikeSwing | strike3 | strike3Swing | ball | ball4 | foul | safe | out.
  // Silent when muted or when the umpire voice is off. Every call varies a little. With the Voice setting, a recording of the call
  // (public/sounds/umpire) is played when there is one, otherwise the built-in voice speaks; the Browser setting uses the device's voice.
  callUmpire(kind, { pan = 0, delay = 0.04 } = {}) {
    if (this.muted || this.umpireMode === 'off') return false;
    try {
      const U = CONFIG.audio.umpire;
      if (this.umpireMode === 'speech') return this.hidden ? false : speakWithBrowserVoice(kind, this.callRng, this.volume * this.levels.umpire);
      if (!this.ok || this.levels.umpire <= 0.001) return false;
      const take = this.files.pick(kind, this.callRng);
      if (take) { this.playFile(take, { pan, delay }); return true; }
      if (!this.umpire) this.setUmpire(1);
      speak(this, planCall(kind, this.umpire, this.callRng), { delay, level: U.level * this.levels.umpire, pan });
      return true;
    } catch (err) {
      return false; // a sound problem must never interrupt the game
    }
  }

  // One of your own recordings, placed in the ballpark like the built-in voice (a little reverb and echo).
  playFile(buffer, { pan = 0, delay = 0.04 } = {}) {
    const c = this.ctx, F = CONFIG.audio.umpire.files;
    const src = c.createBufferSource(); src.buffer = buffer;
    const out = c.createGain(); out.gain.value = F.level * this.levels.umpire;
    src.connect(out);
    placeVoice(this, out, { pan, reverb: F.reverb, echo: F.echo });
    src.start(c.currentTime + delay);
  }

  // Call from a user gesture (pointerdown / keydown).
  unlock() {
    if (this.unlocked) { if (this.ctx && this.ctx.state === 'suspended' && !this.hidden) this.ctx.resume(); return; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      // iPhones: play through the ring/silent switch like a game should (Safari 16.4+; ignored elsewhere)
      try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) { /* not supported */ }
      this.build(new AC());
      if (this.ctx.state === 'suspended' && !this.hidden) this.ctx.resume();
      this.startAmbience();
      warmBrowserVoices();
      try { this.files.load(this.ctx); } catch (e) { /* recordings are optional */ } // look for your own umpire recordings
    } catch (e) { this.unlocked = false; }
  }

  // The mixing desk: effects, umpire and crowd each have a channel; all three go through the master volume and a gentle limiter.
  // (Separate from unlock() so the mix can be measured in an offline context.)
  build(ctx) {
    const A = CONFIG.audio.mix;
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4; comp.attack.value = 0.003; comp.release.value = 0.2;
    this.master.connect(comp); comp.connect(ctx.destination);
    this.sfx = ctx.createGain(); this.sfx.gain.value = A.sfx * this.levels.sfx; this.sfx.connect(this.master);
    this.crowd = ctx.createGain(); this.crowd.gain.value = A.crowd * this.levels.crowd; this.crowd.connect(this.master);
    // reverb: effects reach it through a send that follows the effects slider (the umpire's calls are already scaled per call)
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.makeImpulse(1.7, 2.6);
    this.reverbGain = ctx.createGain(); this.reverbGain.gain.value = 0.22;
    this.reverb.connect(this.reverbGain); this.reverbGain.connect(this.master);
    this.sfxVerb = ctx.createGain(); this.sfxVerb.gain.value = A.sfx * this.levels.sfx; this.sfxVerb.connect(this.reverb);
    // shared noise
    const len = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.applauseBuf = this.makeApplause(6);
    this.unlocked = true;
  }

  // Tab hidden (switched away, phone locked): everything goes quiet, and comes back when the game is visible again.
  setHidden(h) {
    this.hidden = !!h;
    if (h) stopBrowserVoice();
    if (!this.ctx) return;
    try { if (h) this.ctx.suspend(); else if (this.ctx.state !== 'running') this.ctx.resume(); } catch (e) { /* ignore */ }
  }

  makeImpulse(seconds, decay) {
    const rate = this.ctx.sampleRate;
    const n = Math.floor(rate * seconds);
    const buf = this.ctx.createBuffer(2, n, rate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay);
    }
    return buf;
  }

  setMuted(m) {
    this.muted = m;
    if (m) stopBrowserVoice();
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : this.volume, this.ctx.currentTime, 0.03);
  }
  setVolume(v) {
    this.volume = v;
    if (this.master && !this.muted) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.03);
  }
  // channel: 'sfx' | 'umpire' | 'crowd', v: 0..1
  setLevel(channel, v) {
    this.levels[channel] = Math.max(0, Math.min(1, +v || 0));
    if (!this.ctx) return;
    const A = CONFIG.audio.mix, t = this.ctx.currentTime;
    if (channel === 'sfx') { this.sfx.gain.setTargetAtTime(A.sfx * this.levels.sfx, t, 0.03); this.sfxVerb.gain.setTargetAtTime(A.sfx * this.levels.sfx, t, 0.03); }
    if (channel === 'crowd') this.crowd.gain.setTargetAtTime(A.crowd * this.levels.crowd, t, 0.03);
  }
  get ok() { return this.unlocked && this.ctx && !this.muted; }

  // ---------------------------------------------------------------- building blocks
  noise(t0, dur, { type = 'bandpass', freq = 1000, q = 1, gain = 1, attack = 0.002, freqEnd = null, sendReverb = 0, dest = null } = {}) {
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = c.createBiquadFilter();
    f.type = type; f.frequency.setValueAtTime(freq, t0); f.Q.value = q;
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), t0 + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f); f.connect(g); g.connect(dest || this.sfx);
    if (sendReverb > 0) { const s = c.createGain(); s.gain.value = sendReverb; g.connect(s); s.connect(dest === this.crowd ? this.reverb : this.sfxVerb); }
    src.start(t0, Math.random() * 1.5); src.stop(t0 + dur + 0.05);
  }

  tone(t0, dur, { type = 'sine', freq = 440, freqEnd = null, gain = 0.3, attack = 0.002, sendReverb = 0, dest = null } = {}) {
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = type; o.frequency.setValueAtTime(freq, t0);
    if (freqEnd) o.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), t0 + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(dest || this.sfx);
    if (sendReverb > 0) { const s = c.createGain(); s.gain.value = sendReverb; g.connect(s); s.connect(this.sfxVerb); }
    o.start(t0); o.stop(t0 + dur + 0.05);
  }

  // ---------------------------------------------------------------- game sounds
  // quality 0..1 (1 = perfect). ev = exit velocity in mph.
  batCrack(quality = 0.5, ev = 90) {
    if (!this.ok) return;
    const t = this.ctx.currentTime + 0.001;
    this.lastCrack = t;
    const q = Math.max(0, Math.min(1, quality));
    const punch = Math.max(0.35, Math.min(1.3, (ev - 40) / 60));
    // sharp wooden snap
    this.noise(t, 0.05 + 0.03 * q, { type: 'bandpass', freq: 2200 + 2600 * q, q: 0.9, gain: 1.0 * punch, attack: 0.001, sendReverb: 0.5 });
    this.noise(t, 0.09, { type: 'highpass', freq: 3800 + 3000 * q, q: 0.7, gain: 0.5 * q * punch, attack: 0.001 });
    // "tock" body
    this.tone(t, 0.16 + 0.1 * q, { type: 'sine', freq: 210 + 60 * q, freqEnd: 70, gain: 0.85 * punch, attack: 0.002 });
    // bat ring
    this.tone(t, 0.12, { type: 'triangle', freq: 1500 + 900 * q, freqEnd: 900, gain: 0.35 * q + 0.08, attack: 0.001, sendReverb: 0.3 });
    this.noise(t, 0.22, { type: 'bandpass', freq: 620, q: 14, gain: 0.25 * punch, attack: 0.001 });
    if (q > 0.8) {
      // perfect contact: extra low boom and a bright ping
      this.tone(t, 0.42, { type: 'sine', freq: 82, freqEnd: 46, gain: 0.7, attack: 0.003, sendReverb: 0.4 });
      this.tone(t + 0.004, 0.2, { type: 'sine', freq: 3300, freqEnd: 2400, gain: 0.16, attack: 0.001, sendReverb: 0.5 });
    }
    if (q < 0.35) {
      // weak: dull thud / tink
      this.noise(t, 0.12, { type: 'lowpass', freq: 500, q: 0.7, gain: 0.5, attack: 0.002 });
    }
  }
  // Late/early "foul tip" tick
  tick() {
    if (!this.ok) return;
    const t = this.ctx.currentTime;
    this.noise(t, 0.04, { type: 'bandpass', freq: 3500, q: 2, gain: 0.5, attack: 0.001 });
    this.tone(t, 0.05, { type: 'triangle', freq: 1800, freqEnd: 1200, gain: 0.15 });
  }
  swingWhoosh(speed = 1) {
    if (!this.ok) return;
    const t = this.ctx.currentTime;
    speed *= CONFIG.audio.mix.whoosh;
    this.noise(t, 0.2, { type: 'bandpass', freq: 380, freqEnd: 1900, q: 0.8, gain: 0.32 * speed, attack: 0.05 });
    this.noise(t + 0.02, 0.14, { type: 'highpass', freq: 2500, q: 0.5, gain: 0.08 * speed, attack: 0.05 });
  }
  glovePop(intensity = 1) {
    if (!this.ok) return;
    const t = this.ctx.currentTime;
    const g = Math.max(0.3, Math.min(1.3, intensity)) * CONFIG.audio.mix.glovePop;
    this.noise(t, 0.07, { type: 'lowpass', freq: 1300, q: 0.9, gain: 0.85 * g, attack: 0.001, sendReverb: 0.25 });
    this.noise(t, 0.05, { type: 'bandpass', freq: 2100, q: 1.2, gain: 0.35 * g, attack: 0.001 });
    this.tone(t, 0.12, { type: 'sine', freq: 150, freqEnd: 70, gain: 0.6 * g, attack: 0.002 });
  }
  throwWhoosh() {
    if (!this.ok) return;
    const t = this.ctx.currentTime;
    this.noise(t, 0.25, { type: 'bandpass', freq: 900, freqEnd: 500, q: 0.7, gain: 0.12, attack: 0.05 });
  }
  strikeCue() {
    if (!this.ok) return;
    const t = this.ctx.currentTime;
    this.tone(t, 0.09, { type: 'square', freq: 740, gain: 0.07, attack: 0.002 });
    this.tone(t + 0.09, 0.13, { type: 'square', freq: 990, gain: 0.07, attack: 0.002 });
  }
  ballCue() {
    if (!this.ok) return;
    const t = this.ctx.currentTime;
    this.tone(t, 0.11, { type: 'sine', freq: 420, freqEnd: 360, gain: 0.14, attack: 0.003 });
  }
  outCue() {
    if (!this.ok) return;
    const t = this.ctx.currentTime;
    this.tone(t, 0.12, { type: 'square', freq: 330, gain: 0.06 });
    this.tone(t + 0.12, 0.2, { type: 'square', freq: 220, gain: 0.06 });
  }
  wallThud() {
    if (!this.ok) return;
    const t = this.ctx.currentTime;
    this.noise(t, 0.16, { type: 'lowpass', freq: 380, q: 0.8, gain: 0.7, attack: 0.002 });
    this.tone(t, 0.2, { type: 'sine', freq: 95, freqEnd: 50, gain: 0.6 });
  }
  dirtThud(v = 0.5) {
    if (!this.ok) return;
    const t = this.ctx.currentTime;
    this.noise(t, 0.09, { type: 'lowpass', freq: 420, q: 0.6, gain: 0.32 * v, attack: 0.002 });
  }
  uiClick() {
    if (!this.ok) return;
    const t = this.ctx.currentTime;
    this.tone(t, 0.06, { type: 'sine', freq: 620, freqEnd: 880, gain: 0.12 * CONFIG.audio.mix.ui });
  }
  uiBack() {
    if (!this.ok) return;
    const t = this.ctx.currentTime;
    this.tone(t, 0.07, { type: 'sine', freq: 520, freqEnd: 360, gain: 0.1 * CONFIG.audio.mix.ui });
  }
  unlockChime() {
    if (!this.ok) return;
    const t = this.ctx.currentTime;
    [523, 659, 784, 1047].forEach((f, i) => this.tone(t + i * 0.09, 0.4, { type: 'triangle', freq: f, gain: 0.12, sendReverb: 0.4 }));
  }

  // ---------------------------------------------------------------- crowd
  startAmbience() {
    if (!this.ctx || this.ambience) return;
    const c = this.ctx;
    const src = c.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 520; bp.Q.value = 0.35;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1700;
    const g = c.createGain(); g.gain.value = 0.0;
    // slow wobble
    const lfo = c.createOscillator(); lfo.frequency.value = 0.13;
    const lfoG = c.createGain(); lfoG.gain.value = 0.02;
    lfo.connect(lfoG); lfoG.connect(g.gain);
    src.connect(bp); bp.connect(lp); lp.connect(g); g.connect(this.crowd);
    // a second, higher layer for excited "voices"
    const src2 = c.createBufferSource(); src2.buffer = this.noiseBuf; src2.loop = true;
    const f1 = c.createBiquadFilter(); f1.type = 'bandpass'; f1.frequency.value = 800; f1.Q.value = 4;
    const f2 = c.createBiquadFilter(); f2.type = 'bandpass'; f2.frequency.value = 1300; f2.Q.value = 5;
    const g2 = c.createGain(); g2.gain.value = 0;
    const vib = c.createOscillator(); vib.frequency.value = 5.5;
    const vibG = c.createGain(); vibG.gain.value = 70;
    vib.connect(vibG); vibG.connect(f1.frequency); vibG.connect(f2.frequency);
    src2.connect(f1); src2.connect(f2); f1.connect(g2); f2.connect(g2); g2.connect(this.crowd);
    const now = c.currentTime;
    g.gain.setTargetAtTime(0.085, now, 1.5);
    src.start(now); src2.start(now); lfo.start(now); vib.start(now);
    this.ambience = { g, g2, bp, lp, f1, f2 };
    // occasional murmurs / claps
    const murmur = () => {
      if (!this.ambience) return;
      if (this.ok) {
        const t = c.currentTime;
        const a = this.ambience;
        a.g.gain.cancelScheduledValues(t);
        a.g.gain.setTargetAtTime(0.085 + Math.random() * 0.05, t, 0.4);
        a.g.gain.setTargetAtTime(0.085, t + 1.2, 0.8);
      }
      this.murmurTimer = setTimeout(murmur, 2500 + Math.random() * 4500);
    };
    murmur();
  }

  // level 0..1: how big the reaction is.
  crowdSwell(level = 0.5, seconds = 2.4) {
    if (!this.ok || !this.ambience) return;
    const c = this.ctx, t = c.currentTime, a = this.ambience;
    const peak = 0.09 + level * 0.32;
    a.g.gain.cancelScheduledValues(t);
    a.g.gain.setTargetAtTime(peak, t, 0.18);
    a.g.gain.setTargetAtTime(0.085, t + seconds * 0.5, seconds * 0.35);
    a.g2.gain.cancelScheduledValues(t);
    a.g2.gain.setTargetAtTime(level * 0.28, t, 0.25);
    a.g2.gain.setTargetAtTime(0.0, t + seconds * 0.55, seconds * 0.3);
    a.bp.frequency.cancelScheduledValues(t);
    a.bp.frequency.setTargetAtTime(700 + level * 500, t, 0.3);
    a.bp.frequency.setTargetAtTime(520, t + seconds * 0.6, 0.9);
  }
  // disappointed "ooooh"
  crowdGroan(level = 0.5) {
    if (!this.ok || !this.ambience) return;
    const c = this.ctx, t = c.currentTime, a = this.ambience;
    a.g2.gain.cancelScheduledValues(t);
    a.g2.gain.setTargetAtTime(level * 0.16, t, 0.12);
    a.g2.gain.setTargetAtTime(0, t + 0.5, 0.35);
    a.f1.frequency.cancelScheduledValues(t);
    a.f1.frequency.setValueAtTime(900, t);
    a.f1.frequency.exponentialRampToValueAtTime(420, t + 1.0);
    a.f1.frequency.setTargetAtTime(800, t + 1.6, 0.3);
  }
  // Applause: one pre-rendered stretch of clapping (made once, at unlock), played from a random point with a swell-and-fade.
  applause(seconds = 2.2, density = 1) {
    if (!this.ok || !this.applauseBuf) return;
    const c = this.ctx, t = c.currentTime, buf = this.applauseBuf;
    const src = c.createBufferSource(); src.buffer = buf; src.loop = true;
    const g = c.createGain();
    const peak = CONFIG.audio.mix.applause * Math.min(1.2, density);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + Math.min(0.35, seconds * 0.25));
    g.gain.setTargetAtTime(0.0001, t + seconds * 0.55, seconds * 0.18);
    src.connect(g); g.connect(this.crowd);
    src.start(t, Math.random() * buf.duration);
    src.stop(t + seconds * 1.4 + 0.2);
  }

  // A few seconds of a crowd clapping (stereo): thousands of short, bright hand claps at random moments. Pure maths, no files.
  makeApplause(seconds) {
    const rate = this.ctx.sampleRate, n = Math.floor(rate * seconds);
    const buf = this.ctx.createBuffer(2, n, rate);
    const L = buf.getChannelData(0), R = buf.getChannelData(1);
    const claps = Math.floor(seconds * 260);
    for (let k = 0; k < claps; k++) {
      const at = Math.floor(Math.random() * n);
      const len = Math.floor(rate * (0.012 + Math.random() * 0.02));
      const amp = 0.25 + Math.random() * 0.75, pan = Math.random();
      const decay = 4 / len;
      let prev = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        const v = (w - prev * 0.85) * amp * Math.exp(-i * decay); // a crude high-pass: claps are bright
        prev = w;
        const j = (at + i) % n; // wraps round, so the buffer loops without a seam
        L[j] += v * (1 - pan); R[j] += v * pan;
      }
    }
    let peak = 0;
    for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
    const k = 0.9 / (peak || 1);
    for (let i = 0; i < n; i++) { L[i] *= k; R[i] *= k; }
    return buf;
  }

  // ---------------------------------------------------------------- home run
  homeRun(distance = 400) {
    if (!this.ok) return;
    const big = Math.max(0.4, Math.min(1, (distance - 300) / 180));
    this.crowdSwell(0.7 + big * 0.3, 4.2);
    this.applause(3.4, 1);
    // original little organ riff
    const t = this.ctx.currentTime + 0.35;
    const notes = [261.6, 293.7, 329.6, 392, 440, 523.3];
    notes.forEach((f, i) => this.organ(t + i * 0.13, 0.22, f, 0.09));
    const tt = t + notes.length * 0.13 + 0.05;
    [523.3, 659.3, 784].forEach((f) => this.organ(tt, 0.9, f, 0.07));
  }
  organ(t0, dur, freq, gain = 0.08) {
    const c = this.ctx;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.02);
    g.gain.setTargetAtTime(gain * 0.7, t0 + 0.04, 0.2);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2400;
    g.connect(lp); lp.connect(this.crowd); // the ballpark organ belongs to the stadium, like the crowd
    const s = c.createGain(); s.gain.value = 0.35 * CONFIG.audio.mix.crowd * this.levels.crowd; g.connect(s); s.connect(this.reverb);
    for (const [mult, type, vol] of [[1, 'square', 0.6], [2, 'sine', 0.4], [3, 'sine', 0.2], [0.5, 'sine', 0.35]]) {
      const o = c.createOscillator(); o.type = type; o.frequency.value = freq * mult;
      const og = c.createGain(); og.gain.value = vol;
      o.connect(og); og.connect(g);
      o.start(t0); o.stop(t0 + dur + 0.05);
    }
  }
}
