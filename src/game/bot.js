// A simple computer "player" that aims and swings with a chosen accuracy. Used for automated playtesting
// (scripts/sim.mjs, the browser auto-play check) - never in the real game unless ?bot is in the URL.
// It aims the bat's sweet spot at where it reads the pitch will cross the plate, a little under the ball (where fly balls come from),
// and times the swing with a timing error. Its read is a person's: the pitch guide's guess at the moment it must commit (fuzzier on the
// harder levels and for breaking balls, `read` of that error), plus a little hand error in moving the bat.
import { createRng } from '../util/rng.js';
import { zoneRatio } from '../physics/pitch.js';
import { pitchGuide } from './pitchGuide.js';

export function createBot(engine, o = {}) {
  const rng = o.rng || createRng(o.seed ?? 99);
  const errSd = o.errSd ?? 14; // ms of timing spread
  const bias = o.bias ?? 0;
  const aimSd = o.aimSd ?? 0.05; // ft of hand error moving the bat (up / down)
  const aimSdX = o.aimSdX ?? 0.08; // ft of hand error (in / out)
  const read = o.read ?? 0.7; // how much of the pitch guide's error its read of the pitch has (a person watching the ball reads a bit better than the circle)
  const under = o.under ?? 0.3; // how far under the ball it tries to get, as a share of the contact window (0 = square: line drives)
  const underSd = o.underSd ?? 0.1;
  const swingStrike = o.swingStrike ?? 0.85;
  const swingBall = o.swingBall ?? 0.06;
  let plan = null;
  engine.on('windup', ({ pitch }) => {
    const r = zoneRatio(pitch.target.x, pitch.target.y, engine.cfg);
    const inZone = pitch.isStrike || r < 1.15;
    const p = engine.mode === 'derby' ? 0.97 : engine.mode === 'practice' ? 0.9 : inZone ? swingStrike : swingBall;
    const win = engine.contactWindow;
    plan = {
      swing: rng.chance(p), err: rng.gauss(bias, errSd),
      dy: -(under + rng.gauss(0, underSd)) * win.up + rng.gauss(0, aimSd), dx: rng.gauss(0, aimSdX),
    };
  });
  return {
    update() {
      if (engine.awaitingBatter) engine.batterReady(); // (a new batter: the bot is always ready)
      const pitch = engine.pitch;
      if (!pitch || !plan) return;
      if (engine.phase === 'windup' || engine.phase === 'pitch') {
        // it reads where the pitch is going and puts the bat there (its read sharpens as the ball comes; once it has swung, it is committed)
        const T = pitch.flight.T, c = pitch.flight.at(T);
        const tSeen = engine.phase === 'pitch' ? Math.min(engine.time - pitch.tRelease, T - engine.cfg.timing.swingDelay) : 0;
        const g = pitchGuide(pitch, Math.max(0, tSeen), engine.cfg, engine.difficulty);
        engine.setBatAim(c.x + (g.x - pitch.target.x) * read + plan.dx, c.y + (g.y - pitch.target.y) * read + plan.dy);
      }
      if (engine.phase !== 'pitch' || !plan.swing || engine.swing) return;
      const t = pitch.tCross + plan.err / 1000 - engine.cfg.timing.swingDelay;
      if (engine.time >= t) engine.swingPressed(0);
    },
  };
}
