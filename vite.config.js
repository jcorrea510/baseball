import { defineConfig } from 'vite';
import { resolveBase, resolveSiteUrl } from './scripts/resolveBase.mjs';
import { listUmpireFiles, umpireDir } from './scripts/umpireFiles.mjs';
import { logoSVG } from './src/ui/logo.js';

// index.html gets two things at build (and dev) time: the logo drawn into the loading splash (the page's inline startup script
// shows it before any game code has loaded), and the link-preview tags with the site's full address when the build knows it.
function brandHtml() {
  return {
    name: 'sandlot-brand',
    transformIndexHtml(html) {
      const site = resolveSiteUrl(process.env);
      const img = `${site}og-image.jpg`;
      html = html.replace('<div id="boot-logo"><b>SANDLOT</b></div>', `<div id="boot-logo">${logoSVG({ id: 'boot' }).replace(/\n/g, '')}</div>`);
      html = html.replace('<meta property="og:image" content="og-image.jpg" />', `<meta property="og:image" content="${img}" />`);
      html = html.replace('<meta name="twitter:image" content="og-image.jpg" />', `<meta name="twitter:image" content="${img}" />`);
      if (site) html = html.replace('<meta property="og:type" content="website" />', `<meta property="og:type" content="website" />\n    <meta property="og:url" content="${site}" />`);
      return html;
    },
  };
}

// Recordings you drop into public/sounds/umpire/ are found here, when the build (or `npm run dev`) starts, and the game is told
// exactly which files exist - so it never asks for a missing one. After adding files, restart `npm run dev`.
const umpireFiles = listUmpireFiles(umpireDir(process.cwd()));

// The page asks for its files by path, so the build has to know where the site will live:
// GitHub Pages serves it under /<repo>/, Vercel (and most hosts) serve it at "/". resolveBase() picks
// the right one from the build environment (see scripts/resolveBase.mjs); set BASE_PATH to force one.
// During `npm run dev` the base is just "/".
export default defineConfig(({ command }) => ({
  base: resolveBase(process.env, command),
  plugins: [brandHtml()],
  define: { __UMPIRE_FILES__: JSON.stringify(umpireFiles) },
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 1200,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
    // Several tests play thousands of simulated plays (2-4 s here, slower on GitHub's machines): the 5 s default is too tight.
    testTimeout: 60000,
  },
}));
