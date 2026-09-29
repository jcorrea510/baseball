// Sandlot entry point (replaced with the full app in the next milestones).
import { CONFIG } from './config.js';

const ui = document.getElementById('ui');
ui.textContent = 'Sandlot loading... (' + Object.keys(CONFIG.difficulty).length + ' difficulty levels)';
