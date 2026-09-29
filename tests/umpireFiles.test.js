// Your own umpire recordings (public/sounds/umpire): found by name, several takes, ignored when missing, and used before the
// built-in voice. Plus the browser-voice fallback: which voice is chosen and how each call is spoken.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { UmpireFiles, FILES_FOR, FILE_NAMES } from '../src/audio/umpireFiles.js';
import { parseUmpireFile } from '../src/audio/umpireNames.js';
import { listUmpireFiles, umpireDir } from '../scripts/umpireFiles.mjs';
import { AudioEngine } from '../src/audio/audio.js';
import { speechPlan, pickBestVoice } from '../src/audio/umpireVoice.js';
import { CONFIG } from '../src/config.js';
import { createRng } from '../src/util/rng.js';

// a pretend web server: `present` lists the files (by URL path) that exist
function fakeWorld(present) {
  const asked = [];
  const fetch = async (url) => {
    asked.push(url);
    const path = url;
    if (present[path] === 'html') return { ok: true, headers: { get: () => 'text/html' }, arrayBuffer: async () => new ArrayBuffer(4) }; // a dev server's answer for a missing file
    if (!(path in present)) return { ok: false, status: 404, headers: { get: () => 'text/plain' }, arrayBuffer: async () => new ArrayBuffer(0) };
    return { ok: true, headers: { get: () => 'audio/mpeg' }, arrayBuffer: async () => new TextEncoder().encode(present[path]).buffer };
  };
  const ctx = { decodeAudioData: async (bytes) => ({ name: new TextDecoder().decode(bytes), duration: 1 }) };
  return { fetch, ctx, asked };
}

describe('which file names are understood', () => {
  it('the six named calls, ball4, extra takes with one letter, any capitals, .mp3 .wav .ogg', () => {
    expect(parseUmpireFile('strike.mp3')).toEqual({ name: 'strike', take: '' });
    expect(parseUmpireFile('Strike3.MP3')).toEqual({ name: 'strike3', take: '' });
    expect(parseUmpireFile('ball4.wav')).toEqual({ name: 'ball4', take: '' });
    expect(parseUmpireFile('strike_b.ogg')).toEqual({ name: 'strike', take: 'b' });
    expect(parseUmpireFile('strike3_c.mp3')).toEqual({ name: 'strike3', take: 'c' });
    for (const n of ['foul', 'out', 'safe', 'ball']) expect(parseUmpireFile(`${n}.mp3`).name).toBe(n);
  });

  it('anything else is ignored (a README, a typo, an unsupported format, a name that could be confused)', () => {
    for (const f of ['README.txt', 'strikes.mp3', 'strike three.mp3', 'strike_three.mp3', 'strike_3.mp3', 'strike.flac', 'strike.mp3.txt', '.gitkeep', 'homerun.mp3', 'strike__b.mp3']) expect(parseUmpireFile(f)).toBe(null);
  });

  it('the build lists what is in the folder, and a missing folder means no recordings', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ump-'));
    try {
      for (const f of ['strike.mp3', 'Ball.WAV', 'README.txt', 'notes.docx', 'strike_b.mp3']) fs.writeFileSync(path.join(dir, f), 'x');
      expect(listUmpireFiles(dir)).toEqual(['Ball.WAV', 'strike.mp3', 'strike_b.mp3']);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
    expect(listUmpireFiles(path.join(dir, 'nope'))).toEqual([]);
    expect(umpireDir('/repo', {})).toBe(path.join('/repo', 'public', 'sounds', 'umpire'));
    expect(umpireDir('/repo', { SANDLOT_UMPIRE_DIR: '/tmp/x' })).toBe('/tmp/x');
  });

  it('the folder in the repo has its instructions and no stray recordings', () => {
    const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    expect(fs.existsSync(path.join(repo, 'public', 'sounds', 'umpire', 'README.txt'))).toBe(true);
  });
});

describe('loading your recordings', () => {
  const files = (list, present = {}) => {
    const w = fakeWorld(present);
    return { w, f: new UmpireFiles({ base: '/', list, fetch: w.fetch }) };
  };

  it('downloads only the files the build found, from the site base path (GitHub Pages sub-folder or Vercel root)', async () => {
    const w = fakeWorld({ '/baseball/sounds/umpire/strike.mp3': 'S' });
    const f = new UmpireFiles({ base: '/baseball/', list: ['strike.mp3'], fetch: w.fetch });
    expect(await f.load(w.ctx)).toBe(1);
    expect(f.has('strike')).toBe(true);
    expect(w.asked).toEqual(['/baseball/sounds/umpire/strike.mp3']); // exactly one request: nothing that does not exist is asked for
    const v = fakeWorld({ '/sounds/umpire/ball.mp3': 'B' });
    const g = new UmpireFiles({ base: '/', list: ['ball.mp3'], fetch: v.fetch });
    await g.load(v.ctx);
    expect(g.has('ball')).toBe(true);
  });

  it('no recordings in the folder -> the game makes no requests at all', async () => {
    const { w, f } = files([]);
    expect(await f.load(w.ctx)).toBe(0);
    expect(w.asked).toEqual([]);
    expect(f.has('strike')).toBe(false);
  });

  it('the six named files work for every call', async () => {
    const present = {}, list = [];
    for (const n of ['strike.mp3', 'ball.mp3', 'strike3.mp3', 'foul.mp3', 'out.mp3', 'safe.wav']) { list.push(n); present[`/sounds/umpire/${n}`] = n; }
    const { w, f } = files(list, present);
    expect(await f.load(w.ctx)).toBe(6);
    for (const k of ['strike', 'strikeSwing', 'strike3', 'strike3Swing', 'ball', 'ball4', 'foul', 'safe', 'out']) expect(f.has(k)).toBe(true);
    expect(f.pick('safe').name).toBe('safe.wav');
  });

  it('a swinging strike uses strike, ball four uses ball unless ball4 exists', async () => {
    const a = files(['strike.mp3', 'ball.mp3'], { '/sounds/umpire/strike.mp3': 'strike', '/sounds/umpire/ball.mp3': 'ball' });
    await a.f.load(a.w.ctx);
    expect(a.f.pick('strikeSwing').name).toBe('strike');
    expect(a.f.pick('strike3Swing')).toBe(null);
    expect(a.f.pick('ball4').name).toBe('ball');
    const b = files(['ball.mp3', 'ball4.mp3'], { '/sounds/umpire/ball.mp3': 'ball', '/sounds/umpire/ball4.mp3': 'ball4' });
    await b.f.load(b.w.ctx);
    expect(b.f.pick('ball4').name).toBe('ball4');
    expect(b.f.pick('ball').name).toBe('ball');
  });

  it('extra takes (strike_b.mp3, strike_c.mp3) are picked at random', async () => {
    const { w, f } = files(['strike.mp3', 'strike_b.mp3', 'strike_c.mp3'], { '/sounds/umpire/strike.mp3': 'one', '/sounds/umpire/strike_b.mp3': 'two', '/sounds/umpire/strike_c.mp3': 'three' });
    expect(await f.load(w.ctx)).toBe(3);
    const seen = new Set();
    const rng = createRng(4);
    for (let i = 0; i < 60; i++) seen.add(f.pick('strike', rng).name);
    expect([...seen].sort()).toEqual(['one', 'three', 'two']);
  });

  it('a file that fails to download or decode, a server that answers with a web page, and going offline are all quietly ignored', async () => {
    const a = files(['strike.mp3'], { '/sounds/umpire/strike.mp3': 'html' });
    expect(await a.f.load(a.w.ctx)).toBe(0);
    expect(a.f.pick('strike')).toBe(null);
    const b = files(['out.mp3'], {}); // listed but gone: 404
    expect(await b.f.load(b.w.ctx)).toBe(0);
    const broken = { decodeAudioData: async () => { throw new Error('not audio'); } };
    const w2 = fakeWorld({ '/sounds/umpire/out.mp3': 'garbage' });
    const c = new UmpireFiles({ base: '/', list: ['out.mp3'], fetch: w2.fetch });
    expect(await c.load(broken)).toBe(0);
    const d = new UmpireFiles({ base: '/', list: ['out.mp3'], fetch: async () => { throw new Error('offline'); } });
    expect(await d.load(a.w.ctx)).toBe(0);
    const e = new UmpireFiles({ base: '/', list: ['out.mp3'], fetch: null });
    expect(await e.load(a.w.ctx)).toBe(0);
  });

  it('loading twice does not download twice', async () => {
    const { w, f } = files(['foul.mp3'], { '/sounds/umpire/foul.mp3': 'F' });
    await f.load(w.ctx); await f.load(w.ctx);
    expect(w.asked.length).toBe(1);
  });

  it('every call can be played by at least one file name, and every file name is a real call', () => {
    for (const names of Object.values(FILES_FOR)) { expect(names.length).toBeGreaterThan(0); for (const n of names) expect(FILE_NAMES).toContain(n); }
  });

  it('works with the older callback form of decodeAudioData', async () => {
    const w = fakeWorld({ '/sounds/umpire/foul.mp3': 'F' });
    const ctx = { decodeAudioData: (bytes, ok) => { ok({ name: 'old' }); } };
    const f = new UmpireFiles({ base: '/', list: ['foul.mp3'], fetch: w.fetch });
    expect(await f.load(ctx)).toBe(1);
    expect(f.pick('foul').name).toBe('old');
  });
});

// a recording of the audio graph: enough of the Web Audio API to see what plays
function fakeAudio() {
  const log = { sources: [], buffers: 0 };
  const node = () => ({ connect() {}, disconnect() {}, gain: { value: 1, setTargetAtTime() {} }, frequency: { value: 0 }, Q: { value: 0 }, delayTime: { value: 0 }, pan: { value: 0 }, threshold: { value: 0 }, knee: { value: 0 }, ratio: { value: 0 }, attack: { value: 0 }, release: { value: 0 } });
  const ctx = {
    currentTime: 1, sampleRate: 16000,
    createBuffer: (ch, n) => { log.buffers++; const d = new Float32Array(n); return { getChannelData: () => d, length: n }; },
    createBufferSource: () => { const s = { ...node(), start() { log.sources.push(s.buffer); } }; return s; },
    createGain: node, createBiquadFilter: node, createDynamicsCompressor: node, createStereoPanner: node, createDelay: node,
  };
  const a = new AudioEngine();
  a.ctx = ctx; a.unlocked = true; a.sfx = node(); a.reverb = node();
  return { a, log };
}

describe('recordings come first, then the built-in voice', () => {
  it('plays your recording when there is one, and the built-in voice for the rest', () => {
    const { a, log } = fakeAudio();
    const take = { name: 'mine' };
    a.files.takes.set('strike', [take]);
    expect(a.callUmpire('strike')).toBe(true);
    expect(log.sources[0]).toBe(take); // (your file, not a freshly rendered buffer)
    expect(log.buffers).toBe(0);
    expect(a.callUmpire('ball')).toBe(true); // no ball file: synthesized
    expect(log.buffers).toBe(1);
    expect(log.sources[1]).not.toBe(take);
  });

  it('nothing plays when the umpire is off or muted, even with recordings', () => {
    const { a, log } = fakeAudio();
    a.files.takes.set('strike', [{ name: 'mine' }]);
    a.umpireMode = 'off';
    expect(a.callUmpire('strike')).toBe(false);
    a.umpireMode = 'synth'; a.muted = true;
    expect(a.callUmpire('strike')).toBe(false);
    expect(log.sources.length).toBe(0);
  });
});

describe('the browser voice', () => {
  const V = (name, lang = 'en-US', localService = true) => ({ name, lang, localService });

  it('prefers a deep, local, American voice and avoids obviously female or non-English ones', () => {
    const voices = [V('Samantha'), V('Anna', 'de-DE'), V('Microsoft Zira - English (United States)'), V('Daniel', 'en-GB'), V('Google US English', 'en-US', false), V('Alex')];
    expect(pickBestVoice(voices).name).toBe('Alex');
    expect(pickBestVoice([V('Samantha'), V('Zira'), V('Daniel', 'en-GB')]).name).toBe('Daniel');
    expect(pickBestVoice([V('Anna', 'de-DE')])).toBe(null);
    expect(pickBestVoice([])).toBe(null);
    expect(pickBestVoice(undefined)).toBe(null);
  });

  it('every call is a few short phrases spoken low, a strike slow and a ball quick', () => {
    const S = CONFIG.audio.umpire.speech;
    for (const kind of ['strike', 'strikeSwing', 'strike3', 'strike3Swing', 'ball', 'ball4', 'foul', 'safe', 'out']) {
      for (let i = 0; i < 20; i++) {
        const plan = speechPlan(kind, createRng(i + 1));
        expect(plan.length).toBeGreaterThan(0);
        for (const p of plan) {
          expect(p.text.length).toBeGreaterThan(2);
          expect(p.pitch).toBeGreaterThanOrEqual(S.pitch[0] * 0.9); expect(p.pitch).toBeLessThanOrEqual(S.pitch[1]);
          expect(p.volume).toBeLessThanOrEqual(1);
        }
      }
    }
    const strike = speechPlan('strike', createRng(2))[0], ball = speechPlan('ball', createRng(2))[0];
    expect(strike.rate).toBeLessThan(ball.rate);
    expect(strike.rate).toBeLessThan(0.9);
    expect(speechPlan('strike3', createRng(2)).map((p) => p.text.replace(/[^a-z]/gi, '').toLowerCase().slice(0, 5))).toEqual(['strik', 'three', expect.stringMatching(/^(youre|yerou)/)]);
    expect(() => speechPlan('nonsense', createRng(1))).toThrow();
  });
});
