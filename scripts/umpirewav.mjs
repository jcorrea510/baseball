// Renders every umpire call to .wav files so they can be analysed (or listened to) outside the game.
//   node scripts/umpirewav.mjs [folder=qa-output/umpire] [sampleRate=16000] [variants=3] [prefix=call]
import fs from 'node:fs';
import path from 'node:path';
import { planCall, makeUmpireCharacter } from '../src/audio/umpireVoice.js';
import { renderCall, toWav } from '../src/audio/voiceRender.js';
import { createRng } from '../src/util/rng.js';

const KINDS = ['strike', 'strikeSwing', 'strike3', 'strike3Swing', 'ball', 'ball4', 'foul', 'safe', 'out'];
export function renderAll(dir, rate = 16000, variants = 3, prefix = 'call') {
  fs.mkdirSync(dir, { recursive: true });
  const files = [];
  for (const kind of KINDS) {
    for (let v = 0; v < variants; v++) {
      const plan = planCall(kind, makeUmpireCharacter(v + 1), createRng(100 + v));
      const wav = toWav(renderCall(plan, rate), rate);
      const f = path.join(dir, `${prefix}_${kind}_${v}.wav`);
      fs.writeFileSync(f, wav);
      files.push(f);
    }
  }
  return files;
}

if (process.argv[1] && process.argv[1].endsWith('umpirewav.mjs')) {
  const dir = process.argv[2] || 'qa-output/umpire';
  const files = renderAll(dir, +(process.argv[3] || 16000), +(process.argv[4] || 3), process.argv[5] || 'call');
  console.log(`wrote ${files.length} files to ${dir}`);
}
