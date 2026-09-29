// Add or swap an umpire sound.
//
//   npm run umpire -- <call> <file or link> [--take b] [--format mp3|ogg|wav] [--threshold -50] [--no-trim]
//   npm run umpire -- --list
//
//   <call> is one of: strike, ball, strike3, foul, out, safe, ball4   ("strike three" and "foul ball" work too)
//   --take b   save it as an EXTRA version of the call (strike_b.mp3); one version is picked at random each time
//
// It downloads the link (or reads the file), trims the silence off both ends, brings it to the same loudness as the other calls,
// converts it to a small mp3 and saves it in public/sounds/umpire/. Then commit and push so the site picks it up.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FILE_NAMES } from '../src/audio/umpireNames.js';
import { umpireDir } from './umpireFiles.mjs';
import { resolveCall, outputName, findTool, INSTALL_HELP, processClip, download, existing, removeDuplicates } from './umpireAudio.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = umpireDir(ROOT); // public/sounds/umpire (SANDLOT_UMPIRE_DIR points it somewhere else, for tests)

function fail(msg) { console.error('\n' + msg + '\n'); process.exit(1); }

const args = process.argv.slice(2);
const flag = (name, dflt) => { const i = args.indexOf(name); if (i < 0) return dflt; const v = args[i + 1]; args.splice(i, 2); return v; };
const has = (name) => { const i = args.indexOf(name); if (i < 0) return false; args.splice(i, 1); return true; };

if (has('--list') || args.length === 0) {
  const found = existing(DIR);
  console.log('Umpire recordings in public/sounds/umpire/:');
  for (const n of FILE_NAMES) console.log(`  ${n.padEnd(8)} ${found[n] ? found[n].join(', ') : '(none - the built-in voice is used)'}`);
  if (args.length === 0) console.log('\nAdd one:  npm run umpire -- strike ~/Downloads/strike.wav\n          npm run umpire -- "strike three" https://example.com/strike3.mp3');
  process.exit(0);
}

const format = flag('--format', 'mp3');
const take = flag('--take', '');
const threshold = parseFloat(flag('--threshold', '-50'));
const trim = !has('--no-trim');
const [callText, source] = args;
if (!callText || !source) fail('Say which call and where the sound is, for example:  npm run umpire -- strike ~/Downloads/strike.wav');
const call = resolveCall(callText);
if (!call) fail(`"${callText}" is not one of the calls. Use: ${FILE_NAMES.join(', ')}`);

const ffmpeg = findTool('ffmpeg'), ffprobe = findTool('ffprobe');
if (!ffmpeg || !ffprobe) fail(INSTALL_HELP);

let input = source, temp = null;
try {
  if (/^https?:\/\//i.test(source)) { console.log('Downloading...'); input = temp = download(source); }
  else { input = path.resolve(source.replace(/^~(?=\/|$)/, process.env.HOME || '~')); if (!fs.existsSync(input)) fail(`I can't find the file "${source}". Give the full path, or put it in the repo and give the path from there.`); }
  fs.mkdirSync(DIR, { recursive: true });
  const name = outputName(call, take, format);
  const r = processClip({ input, output: path.join(DIR, name), ffmpeg, ffprobe, format, threshold, trim });
  const removed = removeDuplicates(DIR, call, take, name);
  console.log(`Saved ${path.relative(ROOT, path.join(DIR, name))}`);
  console.log(`  length ${r.inSeconds.toFixed(2)} s -> ${r.outSeconds.toFixed(2)} s (silence trimmed);  ${r.method};  loudest ${r.after.peakDb} dB${r.after.lufs !== null ? `, loudness ${r.after.lufs} LUFS` : ''}`);
  if (removed.length) console.log(`  replaced the older copy: ${removed.join(', ')}`);
  console.log('Commit and push it (or restart "npm run dev") and the game will use it with Settings -> Umpire -> Voice.');
} catch (err) {
  fail(err.message);
} finally { if (temp) fs.rmSync(temp, { force: true }); }
