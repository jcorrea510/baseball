// Sandlot entry point.
// The splash and the on-screen error screen live in index.html (window.__sandlotBoot). The splash is hidden by the game
// loop after the first frame is drawn; anything that goes wrong before that is reported through boot.fail().
// The two typefaces are bundled with the game (no font server): the rounded display face for headlines and big buttons, the narrow one
// for everything else.
import '@fontsource/lilita-one/latin-400.css';
import '@fontsource/barlow-condensed/latin-600.css';
import '@fontsource/barlow-condensed/latin-700.css';
import '@fontsource/barlow-condensed/latin-800.css';
import '@fontsource/barlow-condensed/latin-800-italic.css';
import './style.css';
import { App } from './app.js';

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('game');
const ui = document.getElementById('ui');
const boot = window.__sandlotBoot;

let started = false;
const report = (f, label) => { if (boot && boot.progress) boot.progress(f, label); };
function start() {
  if (started) return;
  started = true;
  const fail = (err) => { console.error(err); if (boot) boot.fail('start', err); };
  try {
    const app = new App(canvas, ui, params);
    window.__app = app; // handy for debugging / automated checks
    app.init(report).catch(fail);
  } catch (err) {
    fail(err);
  }
}
report(0.38, 'Getting the field ready');

// Let the browser paint the splash first, then build the (fairly heavy) ballpark. Animation frames never fire in a hidden
// tab, so a plain timer is the backstop: startup must not depend on the tab being visible.
requestAnimationFrame(() => setTimeout(start, 30));
setTimeout(start, 400);
