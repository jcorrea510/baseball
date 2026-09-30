// Helpers for turning any sound (a file on this computer or a link) into a game-ready umpire call:
// download it, trim the silence off both ends, make it the same loudness as the other calls, convert it to a small web-friendly
// file, and save it in public/sounds/umpire/ under the right name. Needs ffmpeg (https://ffmpeg.org).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { FILE_NAMES, parseUmpireFile } from '../src/audio/umpireNames.js';

export const LOUDNESS = { target: -16, truePeak: -1.5 }; // LUFS every call is brought to (a strong voice, no clipping)
export const TRIM = { thresholdDb: -50, keepStart: 0.03, keepEnd: 0.08 }; // silence quieter than this is cut; a sliver is left so nothing is clipped
export const FORMATS = { mp3: ['-c:a', 'libmp3lame', '-q:a', '2'], ogg: ['-c:a', 'libvorbis', '-q:a', '5'], wav: ['-c:a', 'pcm_s16le'] };

const ALIASES = {
  strike: ['strike', 'strikes', 'called strike', 'swinging strike'],
  strike1: ['strike1', 'strike one', 'strike 1', 'strike-one', 'strike_one'],
  strike2: ['strike2', 'strike two', 'strike 2', 'strike-two', 'strike_two'],
  playball: ['playball', 'play ball', 'play-ball', 'play_ball'],
  strike3: ['strike3', 'strike three', 'strike-three', 'strike_three', 'strikethree', 'strikeout', 'strike out', 'k', 'strike 3', 'you\'re out strike three'],
  ball: ['ball', 'balls', 'ball one', 'ball two', 'ball three'],
  ball4: ['ball4', 'ball four', 'ball-four', 'ball_four', 'ball 4', 'walk'],
  foul: ['foul', 'foul ball', 'fair or foul', 'foul-ball', 'foul_ball'],
  out: ['out', 'outs', 'youre out', 'you\'re out', 'yer out'],
  safe: ['safe', 'safe at first', 'safe at base'],
};

/** "Strike Three" / "foul ball" / "strike3.mp3" -> the name the game uses ('strike3', 'foul' ...), or null when it is not a call. */
export function resolveCall(text) {
  const t = String(text || '').trim().toLowerCase().replace(/\.(mp3|wav|ogg)$/, '').replace(/\s+/g, ' ');
  if (FILE_NAMES.includes(t)) return t;
  for (const [name, list] of Object.entries(ALIASES)) if (list.includes(t)) return name;
  return null;
}

/** The file name a call is saved under: strike -> strike.mp3, take 'b' -> strike_b.mp3 */
export function outputName(call, take = '', ext = 'mp3') {
  if (!FILE_NAMES.includes(call)) throw new Error(`"${call}" is not an umpire call (use one of: ${FILE_NAMES.join(', ')})`);
  if (take && !/^[a-z]$/i.test(take)) throw new Error('a take is one letter, like b (strike_b.mp3)');
  if (!FORMATS[ext]) throw new Error(`format must be one of: ${Object.keys(FORMATS).join(', ')}`);
  return `${call}${take ? '_' + take.toLowerCase() : ''}.${ext}`;
}

/** ffmpeg filters that cut the silence at the start and at the end (the end is cut by flipping the sound around), with tiny fades so nothing clicks. */
export function trimFilter({ thresholdDb = TRIM.thresholdDb, keepStart = TRIM.keepStart, keepEnd = TRIM.keepEnd } = {}) {
  const cut = (keep) => `silenceremove=start_periods=1:start_threshold=${thresholdDb}dB:start_silence=${keep}:detection=peak`;
  return [cut(keepStart), 'areverse', cut(keepEnd), 'afade=t=in:d=0.04', 'areverse', 'afade=t=in:d=0.004'].join(',');
}

export function loudnormFilter(measured, { target = LOUDNESS.target, truePeak = LOUDNESS.truePeak } = {}) {
  const base = `loudnorm=I=${target}:TP=${truePeak}:LRA=11`;
  if (!measured) return `${base}:print_format=json`;
  return `${base}:measured_I=${measured.input_i}:measured_TP=${measured.input_tp}:measured_LRA=${measured.input_lra}:measured_thresh=${measured.input_thresh}:offset=${measured.target_offset}:linear=true:print_format=summary`;
}

export function findTool(name, env = process.env) {
  const envKey = name.toUpperCase() + '_PATH';
  const candidates = [env[envKey], name].filter(Boolean);
  for (const c of candidates) {
    const r = spawnSync(c, ['-version'], { encoding: 'utf8' });
    if (r.status === 0) return c;
  }
  return null;
}

export const INSTALL_HELP = 'ffmpeg is not installed. Install it once: on a Mac "brew install ffmpeg", on Windows "winget install ffmpeg", on Linux "sudo apt install ffmpeg" (or download it from https://ffmpeg.org/download.html), then run this again.';

function run(tool, args) {
  const r = spawnSync(tool, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.error) throw r.error;
  return r;
}

/** { duration (s), hasAudio } of any file ffmpeg can read. */
export function probe(ffprobe, file) {
  const r = run(ffprobe, ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=codec_name:format=duration', '-of', 'json', file]);
  if (r.status !== 0) return { duration: 0, hasAudio: false };
  try {
    const j = JSON.parse(r.stdout);
    return { duration: parseFloat(j.format && j.format.duration) || 0, hasAudio: !!(j.streams && j.streams.length), codec: j.streams && j.streams[0] && j.streams[0].codec_name };
  } catch (e) { return { duration: 0, hasAudio: false }; }
}

/** Loudest sample (dB) and average loudness (dB) of a file. */
export function levels(ffmpeg, file) {
  const r = run(ffmpeg, ['-hide_banner', '-nostats', '-i', file, '-af', 'volumedetect', '-f', 'null', '-']);
  const num = (re) => { const m = re.exec(r.stderr); return m ? parseFloat(m[1]) : null; };
  return { peakDb: num(/max_volume:\s*(-?[\d.]+|-inf) dB/), meanDb: num(/mean_volume:\s*(-?[\d.]+|-inf) dB/) };
}

/** Integrated loudness (LUFS) of a file, or null when it is too short to measure. */
export function lufs(ffmpeg, file) {
  const r = run(ffmpeg, ['-hide_banner', '-nostats', '-i', file, '-af', 'ebur128', '-f', 'null', '-']);
  const m = /Integrated loudness:\s*\n\s*I:\s*(-?[\d.]+) LUFS/.exec(r.stderr);
  return m ? parseFloat(m[1]) : null;
}

function measureLoudness(ffmpeg, input, pre) {
  const r = run(ffmpeg, ['-hide_banner', '-nostats', '-i', input, '-af', `${pre},${loudnormFilter(null)}`, '-f', 'null', '-']);
  const m = /\{[^{}]*"input_i"[^{}]*\}/.exec(r.stderr);
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]);
    for (const k of ['input_i', 'input_tp', 'input_lra', 'input_thresh', 'target_offset']) if (!Number.isFinite(parseFloat(j[k]))) return null;
    return j;
  } catch (e) { return null; }
}

/**
 * Trim, normalise and convert one sound.
 * @returns {{ inSeconds:number, outSeconds:number, method:string, before:object, after:object }}
 */
export function processClip({ input, output, ffmpeg, ffprobe, format = 'mp3', threshold = TRIM.thresholdDb, trim = true }) {
  const before = probe(ffprobe, input);
  if (!before.hasAudio) throw new Error('that file has no sound in it (is it really an audio file?)');
  const pre = [trim ? trimFilter({ thresholdDb: threshold }) : null, 'aformat=channel_layouts=mono'].filter(Boolean).join(',');
  // length after trimming decides how to level it: EBU loudness needs about half a second of sound to measure, a short "Ball!" does not have that
  const trimmed = path.join(os.tmpdir(), `umpire-trim-${process.pid}-${Date.now()}.wav`);
  try {
    const t = run(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', '-i', input, '-af', pre, '-ar', '44100', trimmed]);
    if (t.status !== 0) throw new Error('ffmpeg could not read that file: ' + (t.stderr || '').trim().split('\n').pop());
    const cut = probe(ffprobe, trimmed);
    if (cut.duration < 0.05) throw new Error('nothing but silence was found in that file (try --threshold -60)');
    let gain, method;
    const measured = cut.duration >= 0.6 ? measureLoudness(ffmpeg, trimmed, 'anull') : null;
    if (measured) { gain = loudnormFilter(measured); method = `loudness matched to ${LOUDNESS.target} LUFS`; }
    else {
      const lv = levels(ffmpeg, trimmed);
      const db = Number.isFinite(lv.peakDb) ? LOUDNESS.truePeak - lv.peakDb : 0;
      gain = `volume=${db.toFixed(2)}dB`; method = `peak set to ${LOUDNESS.truePeak} dB (the clip is too short to measure loudness)`;
    }
    const enc = FORMATS[format];
    if (!enc) throw new Error(`unknown format ${format}`);
    const out = run(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', '-i', trimmed, '-af', `${gain},alimiter=limit=0.89:level=disabled`, '-ar', '44100', '-ac', '1', ...enc, output]);
    if (out.status !== 0) throw new Error('ffmpeg could not write the file: ' + (out.stderr || '').trim().split('\n').pop());
    return { inSeconds: before.duration, outSeconds: probe(ffprobe, output).duration, method, after: { ...levels(ffmpeg, output), lufs: lufs(ffmpeg, output) } };
  } finally { fs.rmSync(trimmed, { force: true }); }
}

/** Download a link to a temporary file. Only real sound files work; a web page (YouTube, a "download" page) gives a clear message. */
export function download(url, dir = os.tmpdir()) {
  if (!/^https?:\/\//i.test(url)) throw new Error('that does not look like a link');
  const ext = (/\.(mp3|wav|ogg|m4a|aac|flac|webm|mp4)(?:$|[?#])/i.exec(url) || [, 'bin'])[1].toLowerCase();
  const dest = path.join(dir, `umpire-download-${process.pid}-${Date.now()}.${ext}`);
  const r = run('curl', ['-fL', '--silent', '--show-error', '--max-time', '120', '-A', 'Mozilla/5.0', '-o', dest, '-w', '%{content_type}', url]);
  if (r.status !== 0) {
    fs.rmSync(dest, { force: true });
    throw new Error(`could not download that link (${(r.stderr || 'network blocked or link not found').trim().split('\n').pop()})`);
  }
  if (/html|json/i.test(r.stdout || '')) {
    fs.rmSync(dest, { force: true });
    throw new Error('that link is a web page, not a sound file. Open it in your browser, download the sound, and give me the file (or a direct link ending in .mp3 / .wav / .ogg).');
  }
  return dest;
}

/** Recordings already in the folder: { strike: ['strike.mp3'], ... } */
export function existing(dir) {
  const found = {};
  let files = [];
  try { files = fs.readdirSync(dir); } catch (e) { /* no folder yet */ }
  for (const f of files) { const p = parseUmpireFile(f); if (p) (found[p.name] = found[p.name] || []).push(f); }
  return found;
}

/** Remove other-format copies of the same name and take (strike.wav when strike.mp3 is saved) so a call never has two copies by accident. */
export function removeDuplicates(dir, call, take, keep) {
  const removed = [];
  for (const f of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
    const p = parseUmpireFile(f);
    if (p && p.name === call && p.take === (take || '').toLowerCase() && f !== keep) { fs.rmSync(path.join(dir, f)); removed.push(f); }
  }
  return removed;
}
