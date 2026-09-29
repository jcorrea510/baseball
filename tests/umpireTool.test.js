// The "add an umpire sound" tool: it understands call names, builds the right ffmpeg filters, and (when ffmpeg is installed) really
// trims the silence, evens out the loudness, converts and saves the file under the right name.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { resolveCall, outputName, trimFilter, loudnormFilter, findTool, processClip, lufs, existing, removeDuplicates, download, probe, levels } from '../scripts/umpireAudio.mjs';
import { parseUmpireFile } from '../src/audio/umpireNames.js';

const ffmpeg = findTool('ffmpeg'), ffprobe = findTool('ffprobe');
const haveFfmpeg = !!(ffmpeg && ffprobe);
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ump-tool-'));

describe('call names', () => {
  it('understands the ways people name a call', () => {
    expect(resolveCall('strike')).toBe('strike');
    expect(resolveCall('Strike Three')).toBe('strike3');
    expect(resolveCall('strike-three')).toBe('strike3');
    expect(resolveCall('strike3.mp3')).toBe('strike3');
    expect(resolveCall('foul ball')).toBe('foul');
    expect(resolveCall('ball four')).toBe('ball4');
    expect(resolveCall("you're out")).toBe('out');
    expect(resolveCall('safe')).toBe('safe');
    expect(resolveCall('home run')).toBe(null);
    expect(resolveCall('')).toBe(null);
    expect(resolveCall(undefined)).toBe(null);
  });

  it('saves under names the game recognises', () => {
    for (const call of ['strike', 'ball', 'strike3', 'foul', 'out', 'safe', 'ball4']) {
      for (const ext of ['mp3', 'ogg', 'wav']) expect(parseUmpireFile(outputName(call, '', ext))).toEqual({ name: call, take: '' });
      expect(parseUmpireFile(outputName(call, 'B'))).toEqual({ name: call, take: 'b' });
    }
    expect(outputName('strike', 'b')).toBe('strike_b.mp3');
    expect(() => outputName('homerun')).toThrow(/not an umpire call/);
    expect(() => outputName('strike', 'bb')).toThrow(/one letter/);
    expect(() => outputName('strike', '', 'flac')).toThrow(/format/);
  });
});

describe('ffmpeg filters', () => {
  it('cut silence from the start and the end (by flipping the sound around), with tiny fades', () => {
    const f = trimFilter();
    expect(f.match(/silenceremove/g).length).toBe(2);
    expect(f.match(/areverse/g).length).toBe(2);
    expect(f).toContain('start_threshold=-50dB');
    expect(trimFilter({ thresholdDb: -60 })).toContain('-60dB');
  });

  it('measure first, then level with the measured numbers', () => {
    expect(loudnormFilter(null)).toContain('print_format=json');
    const f = loudnormFilter({ input_i: '-27.1', input_tp: '-9.0', input_lra: '1.2', input_thresh: '-37.3', target_offset: '0.4' });
    expect(f).toContain('measured_I=-27.1'); expect(f).toContain('linear=true'); expect(f).toContain('I=-16');
  });
});

describe('the folder', () => {
  it('lists what is there and replaces other-format copies of the same call', () => {
    const dir = tmp();
    try {
      for (const f of ['strike.wav', 'strike_b.mp3', 'ball.ogg', 'README.txt']) fs.writeFileSync(path.join(dir, f), 'x');
      expect(existing(dir)).toEqual({ strike: ['strike.wav', 'strike_b.mp3'], ball: ['ball.ogg'] });
      fs.writeFileSync(path.join(dir, 'strike.mp3'), 'x');
      expect(removeDuplicates(dir, 'strike', '', 'strike.mp3')).toEqual(['strike.wav']); // (the extra take strike_b.mp3 stays)
      expect(fs.readdirSync(dir).sort()).toEqual(['README.txt', 'ball.ogg', 'strike.mp3', 'strike_b.mp3']);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  it('a link that is not a link, or is not reachable, gives a plain message', () => {
    expect(() => download('not a link')).toThrow(/link/);
    expect(() => download('http://127.0.0.1:9/nothing.mp3')).toThrow(/could not download/);
  });
});

describe.skipIf(!haveFfmpeg)('processing a real sound (needs ffmpeg)', () => {
  // a test "voice": a tone with silence before and after, at a chosen level
  function makeClip(dir, name, { tone = 1.0, lead = 1.0, tail = 1.5, volumeDb = -20 } = {}) {
    const p = path.join(dir, name);
    const r = spawnSync(ffmpeg, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `sine=frequency=300:duration=${tone}`, '-af', `volume=${volumeDb}dB,adelay=${Math.round(lead * 1000)}|${Math.round(lead * 1000)},apad=pad_dur=${tail}`, p], { encoding: 'utf8' });
    expect(r.status).toBe(0);
    return p;
  }

  it('trims the silence, brings a quiet clip up to the standard loudness and saves a small mono mp3', () => {
    const dir = tmp();
    try {
      const input = makeClip(dir, 'quiet.wav', { tone: 1.0, lead: 1.0, tail: 1.5, volumeDb: -28 });
      const output = path.join(dir, 'strike.mp3');
      const r = processClip({ input, output, ffmpeg, ffprobe });
      expect(r.inSeconds).toBeGreaterThan(3.4);
      expect(r.outSeconds).toBeGreaterThan(1.0); expect(r.outSeconds).toBeLessThan(1.25); // 1 s of sound + a sliver of silence at each end
      const info = probe(ffprobe, output);
      expect(info.codec).toBe('mp3');
      expect(levels(ffmpeg, output).peakDb).toBeLessThanOrEqual(-0.9); // never clipping
      expect(Math.abs(lufs(ffmpeg, output) - -16)).toBeLessThan(1.5); // a quiet -28 dB clip came up to the standard loudness
      // ... and a loud one came down to the same
      const loud = makeClip(dir, 'loud.wav', { tone: 1.0, volumeDb: -6 });
      const out2 = path.join(dir, 'ball.mp3');
      processClip({ input: loud, output: out2, ffmpeg, ffprobe });
      expect(Math.abs(lufs(ffmpeg, out2) - lufs(ffmpeg, output))).toBeLessThan(1.5);
      expect(r.method).toMatch(/loudness matched/);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  it('short calls ("Ball!") are levelled by their peak instead', () => {
    const dir = tmp();
    try {
      const input = makeClip(dir, 'short.wav', { tone: 0.3, lead: 0.5, tail: 0.5, volumeDb: -18 });
      const output = path.join(dir, 'ball.ogg');
      const r = processClip({ input, output, ffmpeg, ffprobe, format: 'ogg' });
      expect(r.method).toMatch(/peak/);
      expect(r.outSeconds).toBeLessThan(0.55);
      expect(probe(ffprobe, output).codec).toBe('vorbis');
      expect(levels(ffmpeg, output).peakDb).toBeGreaterThan(-3); // (a short clip is set by its loudest point)
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  it('refuses a file with no sound in it, and a silent one', () => {
    const dir = tmp();
    try {
      fs.writeFileSync(path.join(dir, 'notes.txt'), 'hello');
      expect(() => processClip({ input: path.join(dir, 'notes.txt'), output: path.join(dir, 'x.mp3'), ffmpeg, ffprobe })).toThrow(/no sound/);
      const silent = path.join(dir, 'silent.wav');
      spawnSync(ffmpeg, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono', '-t', '1', silent]);
      expect(() => processClip({ input: silent, output: path.join(dir, 'y.mp3'), ffmpeg, ffprobe })).toThrow(/silence/);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});
