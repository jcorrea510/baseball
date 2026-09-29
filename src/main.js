// Sandlot entry point.
import './style.css';
import { App } from './app.js';

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('game');
const ui = document.getElementById('ui');
const app = new App(canvas, ui, params);
window.__app = app; // handy for debugging / automated checks
