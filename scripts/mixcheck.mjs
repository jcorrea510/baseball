// The sound mix, measured: renders every game sound through the real mix offline and prints its peak and loudest 100 ms (dBFS).
//   npm run dev  then  node scripts/mixcheck.mjs [url]
// Offline loudness of every game sound (peak and loudest 100 ms RMS, dBFS), through the real mix.
import fs from 'node:fs';
import { chromium } from 'playwright-core';
const BROWSER = process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : fs.existsSync('/opt/pw-browsers/chromium') ? { executablePath: '/opt/pw-browsers/chromium' } : {};
fs.mkdirSync('qa-output', { recursive: true });
const browser = await chromium.launch({ ...BROWSER, args: ['--no-sandbox'] });
const page = await browser.newPage();
const errors = []; page.on('pageerror', (e) => errors.push(e.message));
await page.goto(process.argv[2] || 'http://localhost:5173/', { waitUntil: 'load' });
const res = await page.evaluate(async () => {
  const { AudioEngine } = await import('/src/audio/audio.js');
  const rate = 44100;
  const measure = async (fn, dur = 2.5, setup) => {
    const ctx = new OfflineAudioContext(2, rate * dur, rate);
    const a = new AudioEngine();
    a.volume = 0.8;
    a.build(ctx);
    if (setup) await setup(a, ctx);
    a.setUmpire(3);
    fn(a);
    const buf = await ctx.startRendering();
    const L = buf.getChannelData(0), R = buf.getChannelData(1);
    let peak = 0, best = 0; const w = Math.floor(rate * 0.1);
    let acc = 0;
    for (let i = 0; i < L.length; i++) {
      const v = (L[i] * L[i] + R[i] * R[i]) / 2; acc += v; if (i >= w) { const o = (L[i - w] ** 2 + R[i - w] ** 2) / 2; acc -= o; }
      peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
      if (i >= w) best = Math.max(best, acc / w);
    }
    const db = (x) => (20 * Math.log10(Math.max(1e-9, x))).toFixed(1);
    return `peak ${db(peak)}  loud100ms ${db(Math.sqrt(best))}`;
  };
  const out = {};
  out['bat perfect'] = await measure((a) => a.batCrack(1, 105));
  out['bat good'] = await measure((a) => a.batCrack(0.62, 92));
  out['bat weak'] = await measure((a) => a.batCrack(0.25, 60));
  out['glove pop (pitch)'] = await measure((a) => a.glovePop(0.8));
  out['swing whoosh'] = await measure((a) => a.swingWhoosh());
  const rec = (a, ctx) => a.files.load(ctx); // the umpire's recordings, decoded into this offline context
  for (const k of ['strike', 'strike1', 'strike2', 'strike3', 'ball', 'foul', 'out', 'safe', 'playball']) {
    out['umpire ' + k] = await measure((a) => a.callUmpire(k, { pan: k === 'out' || k === 'safe' ? 0.55 : 0 }), 3, rec);
  }
  out['crowd idle'] = await measure((a) => a.startAmbience(), 4);
  out['crowd swell big'] = await measure((a) => { a.startAmbience(); a.crowdSwell(0.95, 2.4); }, 4);
  out['crowd groan big'] = await measure((a) => { a.startAmbience(); a.crowdSwell(0.8, 3); setTimeout(() => a.crowdGroan(0.9), 0); }, 4);
  out['applause single'] = await measure((a) => a.applause(1.2, 0.5), 3);
  out['applause run'] = await measure((a) => a.applause(1.6, 0.8), 3);
  out['home run'] = await measure((a) => { a.startAmbience(); a.homeRun(420); }, 5);
  out['ui click'] = await measure((a) => a.uiClick(), 0.5);
  return out;
});
for (const [k, v] of Object.entries(res)) console.log(k.padEnd(20), v);
console.log('errors', errors);
await browser.close();
