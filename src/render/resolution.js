// Adaptive resolution: how many screen dots per layout point the game draws. Pure (no three.js, no DOM) so it can be tested.
// Draws fewer dots only while frames stay slow, undoes a step that did not make them quicker (a phone locked at 30 a second
// gains nothing from a blurrier picture), ignores single long frames, and climbs back once frames keep up with the screen.
import { CONFIG } from '../config.js';

/** @param {number} max the sharpest allowed (the screen's own dots per point, capped) */
export function createResolution(max) {
  const Q = CONFIG.quality;
  let avg = 1000 / 60;
  let since = 0;
  let clock = 0;
  let holdUntil = 0;
  let probe = null; // a step down being tried: { ratio before it, avg before it }
  const R = {
    ratio: max,
    /** One frame that took `dtMs`; `max` = the sharpest allowed right now. Returns true when the ratio changed. */
    sample(dtMs, maxNow = max) {
      if (dtMs > Q.hiccupMs) return false;
      const sec = dtMs / 1000;
      clock += sec;
      since += sec;
      avg += (dtMs - avg) * 0.05;
      if (since < Q.checkEvery) return false;
      since = 0;
      const floor = Math.min(Q.minPixelRatio, maxNow);
      let next = Math.min(R.ratio, maxNow);
      if (probe) {
        if (avg > probe.avg * Q.helpGain) {
          next = Math.min(probe.ratio, maxNow);
          holdUntil = clock + Q.noHelpHold;
        }
        probe = null;
      } else if (avg > Q.slowFrameMs && next > floor && clock >= holdUntil) {
        probe = { ratio: next, avg };
        next = Math.max(floor, next * Q.stepDown);
      } else if (avg < Q.smoothFrameMs && next < maxNow) {
        next = Math.min(maxNow, next * Q.stepUp);
      }
      if (Math.abs(next - R.ratio) < 1e-6) return false;
      R.ratio = next;
      return true;
    },
  };
  return R;
}
