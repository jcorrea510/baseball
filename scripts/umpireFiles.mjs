// Which umpire recordings are in public/sounds/umpire? Read when the game is built (or the dev server starts), so the game only ever
// asks for files that exist and never fills the browser console with "404 not found".
import fs from 'node:fs';
import path from 'node:path';
import { parseUmpireFile } from '../src/audio/umpireNames.js';

export function listUmpireFiles(dir) {
  try {
    return fs.readdirSync(dir).filter((f) => parseUmpireFile(f)).sort();
  } catch (e) {
    return []; // no folder = no recordings
  }
}

/** The folder to look in: public/sounds/umpire, or SANDLOT_UMPIRE_DIR (used by the smoke test). */
export function umpireDir(root, env = process.env) {
  return env.SANDLOT_UMPIRE_DIR ? path.resolve(env.SANDLOT_UMPIRE_DIR) : path.join(root, 'public', 'sounds', 'umpire');
}
