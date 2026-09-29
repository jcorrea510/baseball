// Sandlot entry point.
import './style.css';
import { App } from './app.js';

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('game');
const ui = document.getElementById('ui');
const boot = document.getElementById('boot');

// Let the browser paint the "warming up" splash first, then build the (fairly heavy) ballpark.
requestAnimationFrame(() => setTimeout(() => {
  const app = new App(canvas, ui, params);
  window.__app = app; // handy for debugging / automated checks
  if (boot) {
    boot.style.opacity = '0';
    setTimeout(() => boot.remove(), 600);
  }
}, 30));
