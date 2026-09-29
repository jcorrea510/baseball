import { defineConfig } from 'vite';

// GitHub Pages serves the site from https://<user>.github.io/<repo>/, so the
// production build needs that sub-path as its base. The deploy workflow passes
// it in BASE_PATH; the fallback below matches this repo's name ("baseball").
// During `npm run dev` the base is just "/".
export default defineConfig(({ command }) => ({
  base: command === 'build' ? (process.env.BASE_PATH || '/baseball/') : '/',
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 1200,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
  },
}));
