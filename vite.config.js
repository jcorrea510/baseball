import { defineConfig } from 'vite';
import { resolveBase } from './scripts/resolveBase.mjs';

// The page asks for its files by path, so the build has to know where the site will live:
// GitHub Pages serves it under /<repo>/, Vercel (and most hosts) serve it at "/". resolveBase() picks
// the right one from the build environment (see scripts/resolveBase.mjs); set BASE_PATH to force one.
// During `npm run dev` the base is just "/".
export default defineConfig(({ command }) => ({
  base: resolveBase(process.env, command),
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 1200,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
  },
}));
