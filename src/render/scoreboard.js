// The big center-field scoreboard, painted on a canvas texture whenever the game state changes.
import * as THREE from 'three';
import { makeCanvas, toTexture } from './textures.js';

const W = 1536, H = 704;

export function createScoreboard() {
  const { canvas, ctx } = makeCanvas(W, H);
  const texture = toTexture(canvas, { anisotropy: 8 });
  const material = new THREE.MeshBasicMaterial({ map: texture, toneMapped: false });
  let data = { mode: 'quick', title: 'SANDLOT PARK', teams: [], count: { b: 0, s: 0, o: 0 }, message: '', flash: 0 };
  let dirty = true;
  let flashClock = 0;
  let brightness = 1;

  const AMBER = '#ffb52e';
  const WHITE = '#f4f7ff';
  const GREEN = '#42e070';
  const RED = '#ff4a3d';
  const YELLOW = '#ffd23d';

  function led(text, x, y, size, color = AMBER, align = 'left') {
    ctx.font = `800 ${size}px "Courier New", ui-monospace, Menlo, monospace`;
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    ctx.shadowColor = color;
    ctx.shadowBlur = size * 0.25;
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
    ctx.shadowBlur = 0;
  }
  function lamp(x, y, r, on, color) {
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = on ? color : 'rgba(255,255,255,0.09)';
    if (on) { ctx.shadowColor = color; ctx.shadowBlur = r * 1.1; }
    ctx.fill(); ctx.shadowBlur = 0;
  }

  function draw() {
    dirty = false;
    ctx.fillStyle = '#070b16';
    ctx.fillRect(0, 0, W, H);
    // LED dot texture
    ctx.fillStyle = 'rgba(255,255,255,0.025)';
    for (let y = 0; y < H; y += 8) for (let x = 0; x < W; x += 8) ctx.fillRect(x, y, 4, 4);
    // Frame
    ctx.strokeStyle = '#1c2a48'; ctx.lineWidth = 14; ctx.strokeRect(7, 7, W - 14, H - 14);
    ctx.strokeStyle = '#3b4d78'; ctx.lineWidth = 3; ctx.strokeRect(20, 20, W - 40, H - 40);

    // Title
    led(data.title || 'SANDLOT PARK', W / 2, 78, 84, AMBER, 'center');
    ctx.fillStyle = 'rgba(255,181,46,0.35)'; ctx.fillRect(80, 132, W - 160, 3);

    if (data.mode === 'derby') drawDerby();
    else if (data.mode === 'practice') drawPractice();
    else drawGame();

    // Message strip
    if (data.message) {
      const on = data.flash <= 0 || Math.floor(flashClock * 5) % 2 === 0;
      ctx.fillStyle = on ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.02)';
      ctx.fillRect(60, H - 150, W - 120, 104);
      if (on) led(data.message, W / 2, H - 98, 76, data.messageColor || WHITE, 'center');
    }
    texture.needsUpdate = true;
  }

  function drawGame() {
    const teams = data.teams || [];
    const innings = Math.max(data.innings || 3, 3);
    const colX0 = 470, colW = Math.min(96, 700 / innings);
    // header
    led('TEAM', 90, 190, 46, WHITE);
    for (let i = 0; i < innings; i++) led(String(i + 1), colX0 + colW * i + colW / 2, 190, 46, WHITE, 'center');
    const tx = colX0 + colW * innings + 40;
    led('R', tx, 190, 52, YELLOW, 'center');
    led('H', tx + 90, 190, 52, YELLOW, 'center');
    led('E', tx + 180, 190, 52, YELLOW, 'center');
    teams.forEach((t, r) => {
      const y = 270 + r * 92;
      ctx.fillStyle = t.color || '#888'; ctx.fillRect(70, y - 30, 12, 60);
      const active = data.half === (r === 0 ? 'top' : 'bottom');
      led((t.abbr || 'TEAM').toUpperCase(), 100, y, 60, active ? AMBER : WHITE);
      for (let i = 0; i < innings; i++) {
        const v = t.runs && t.runs[i];
        const txt = v === undefined || v === null ? (r === 1 && i === data.inning - 1 && data.half === 'top' ? '' : '') : String(v);
        led(txt, colX0 + colW * i + colW / 2, y, 60, i === (data.inning || 1) - 1 && active ? YELLOW : WHITE, 'center');
      }
      led(String(t.R ?? 0), tx, y, 66, AMBER, 'center');
      led(String(t.H ?? 0), tx + 90, y, 66, AMBER, 'center');
      led(String(t.E ?? 0), tx + 180, y, 66, AMBER, 'center');
    });
    // count / outs
    const c = data.count || { b: 0, s: 0, o: 0 };
    const y0 = 470;
    led('B', 130, y0, 48, WHITE, 'center'); for (let i = 0; i < 4; i++) lamp(200 + i * 52, y0, 19, i < c.b, GREEN);
    led('S', 520, y0, 48, WHITE, 'center'); for (let i = 0; i < 3; i++) lamp(590 + i * 52, y0, 19, i < c.s, YELLOW);
    led('O', 830, y0, 48, WHITE, 'center'); for (let i = 0; i < 3; i++) lamp(900 + i * 52, y0, 19, i < c.o, RED);
    if (data.inning) {
      const half = data.half === 'top' ? '▲' : '▼';
      led(`${half} ${data.inning}`, 1230, y0, 70, AMBER, 'left');
    }
  }

  function drawDerby() {
    const d = data.derby || { hr: 0, outsLeft: 10, longest: 0, streak: 0 };
    led('HOME RUN DERBY', W / 2, 200, 60, WHITE, 'center');
    led(String(d.hr), 360, 340, 190, AMBER, 'center');
    led('HOME RUNS', 360, 450, 42, WHITE, 'center');
    led(String(d.outsLeft), 780, 340, 190, RED, 'center');
    led('OUTS LEFT', 780, 450, 42, WHITE, 'center');
    led(d.longest ? `${d.longest}` : '--', 1190, 300, 100, YELLOW, 'center');
    led('LONGEST FT', 1190, 380, 38, WHITE, 'center');
    led(String(d.streak), 1190, 440, 60, GREEN, 'center');
    led('STREAK', 1190, 490, 32, WHITE, 'center');
  }

  function drawPractice() {
    const p = data.practice || {};
    led('PRACTICE', W / 2, 200, 60, WHITE, 'center');
    led(p.pitch || '--', 420, 330, 78, AMBER, 'center');
    led(p.speed ? `${p.speed} MPH` : '', 420, 420, 60, WHITE, 'center');
    led(p.timing || 'SWING AWAY', 1040, 350, 66, p.timingColor || WHITE, 'center');
    led(p.result || '', 1040, 435, 44, YELLOW, 'center');
    led(`RUNS ${p.runs ?? 0}   HITS ${p.hits ?? 0}`, W / 2, 520, 44, AMBER, 'center');
  }

  draw();

  return {
    material,
    texture,
    set(next) { data = { ...data, ...next }; dirty = true; },
    setBrightness(b) { brightness = b; material.color.setScalar(0.55 + 0.45 * b); },
    update(dt) {
      if (data.flash > 0) {
        flashClock += dt;
        data.flash -= dt;
        dirty = true;
        if (data.flash <= 0) data.flash = 0;
      }
      if (dirty) draw();
    },
  };
}
