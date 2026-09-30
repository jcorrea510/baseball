// A simple computer "player" that swings with a chosen accuracy. Used for automated playtesting
// (scripts/sim.mjs, the browser auto-play check) - never in the real game unless ?bot is in the URL.
import { CONFIG } from '../config.js';
import { createRng } from '../util/rng.js';
import { zoneRatio } from '../physics/pitch.js';

export function createBot(engine, o = {}) {
  const rng = o.rng || createRng(o.seed ?? 99);
  const errSd = o.errSd ?? 14; // ms of timing spread
  const bias = o.bias ?? 0;
  const swingStrike = o.swingStrike ?? 0.85;
  const swingBall = o.swingBall ?? 0.06;
  let plan = null;
  engine.on('windup', ({ pitch }) => {
    const r = zoneRatio(pitch.target.x, pitch.target.y, engine.cfg);
    const inZone = pitch.isStrike || r < 1.15;
    const p = engine.mode === 'derby' ? 0.97 : engine.mode === 'practice' ? 0.9 : inZone ? swingStrike : swingBall;
    plan = { swing: rng.chance(p), err: rng.gauss(bias, errSd) };
  });
  return {
    update() {
      if (engine.awaitingBatter) engine.batterReady(); // (a new batter: the bot is always ready)
      if (engine.phase !== 'pitch' || !plan || !plan.swing || engine.swing) return;
      const pitch = engine.pitch;
      const t = pitch.tCross + plan.err / 1000 - engine.cfg.timing.swingDelay;
      if (engine.time >= t) engine.swingPressed(0);
    },
  };
}
