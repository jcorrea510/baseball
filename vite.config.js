import { defineConfig } from 'vite';
import { resolveBase } from './scripts/resolveBase.mjs';
import { listUmpireFiles, umpireDir } from './scripts/umpireFiles.mjs';

// Recordings you drop into public/sounds/umpire/ are found here, when the build (or `npm run dev`) starts, and the game is told
// exactly which files exist - so it never asks for a missing one. After adding files, restart `npm run dev`.
const umpireFiles = listUmpireFiles(umpireDir(process.cwd()));

// The page asks for its files by path, so the build has to know where the site will live:
// GitHub Pages serves it under /<repo>/, Vercel (and most hosts) serve it at "/". resolveBase() picks
// the right one from the build environment (see scripts/resolveBase.mjs); set BASE_PATH to force one.
// During `npm run dev` the base is just "/".
export default defineConfig(({ command }) => ({
  base: resolveBase(process.env, command),
  define: { __UMPIRE_FILES__: JSON.stringify(umpireFiles) },
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 1200,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
  },
}));
