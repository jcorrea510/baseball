// Makes the pictures behind the Play-screen tiles (public/art/*.jpg) from the real game: the stadium, the batter's box, a ball in
// the air and the mound. Needs a dev server (npm run dev) and Chrome (CHROME_PATH, default the sandbox's Chromium).
// usage: node scripts/art.mjs [dev url]
import { chromium } from 'playwright-core';
import fs from 'node:fs';
const url = process.argv[2] || 'http://localhost:5173/';
const chrome = process.env.CHROME_PATH || '/opt/pw-browsers/chromium';
fs.mkdirSync('public/art', { recursive: true });
const SHOTS = {
  // name: [time of day, camera { pos, look, fov }, what to set up]
  league: ['night', { pos: [-46, 24, 40], look: [8, 9, -118], fov: 46 }, 'idle'],
  quick: ['dusk', { pos: [3.6, 4.9, 7.2], look: [-1.2, 4.2, -34], fov: 33 }, 'stance'],
  derby: ['night', { pos: [8.5, 4.4, -8.5], look: [-1.5, 4.3, -0.5], fov: 34 }, 'flyball'],
  practice: ['day', { pos: [4.2, 6.2, -49.5], look: [-0.4, 5.0, -60.5], fov: 28 }, 'windup'],
};
const browser = await chromium.launch({ executablePath: chrome, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
for (const [name, [tod, cam, what]] of Object.entries(SHOTS)) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto(`${url}?mode=practice&seed=11&tod=${tod}`, { waitUntil: 'load' });
  await page.waitForFunction(() => document.documentElement.getAttribute('data-boot') === 'ready', null, { timeout: 90000 });
  const data = await page.evaluate(async ({ cam, what, tod }) => {
    const a = window.__app; a.settings.tod = tod; a.startGame('practice'); const e = a.engine;
    document.getElementById('ui').style.display = 'none';
    e.practice.type = 'fastball'; e.practice.speed = 88; e.practice.location = 'center';
    for (let i = 0; i < 1500 && e.phase !== 'windup'; i++) a.tick(1 / 120, false);
    if (what === 'windup') { for (let i = 0; i < 2000 && !(e.time > e.pitch.tWindup + e.pitch.windupDur * 0.78); i++) a.tick(1 / 240, false); }
    if (what === 'stance') { for (let i = 0; i < 2000 && !(e.phase === 'pitch' && e.time > e.pitch.tCross - 0.42); i++) a.tick(1 / 240, false); }
    if (what === 'flyball') {
      for (let i = 0; i < 2000 && !(e.phase === 'pitch' && e.time > e.pitch.tCross - 0.4); i++) a.tick(1 / 240, false);
      e.contactOverride = () => ({ exitVelocity: 104, launchAngle: 30, sprayAngle: 6, backspin: 2200, hook: 0 });
      e.swingPressed(0);
      const th = e.swing.tHit;
      while (e.time < th + 0.07) a.tick(1 / 480, false);
    }
    a.cam.override = cam;
    a.tick(0.0001, true);
    return a.S.renderer.domElement.toDataURL('image/jpeg', 0.82);
  }, { cam, what, tod });
  fs.writeFileSync(`public/art/${name}.jpg`, Buffer.from(data.split(',')[1], 'base64'));
  console.log(name, (data.length * 0.75 / 1024).toFixed(0) + ' KB');
  await page.close();
}
await browser.close();
