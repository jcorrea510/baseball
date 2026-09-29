// Small math helpers shared by logic and rendering code.
export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => (b === a ? 0 : (v - a) / (b - a));
export const saturate = (v) => clamp(v, 0, 1);
export const smoothstep = (a, b, v) => {
  const t = saturate(invLerp(a, b, v));
  return t * t * (3 - 2 * t);
};
export const easeOutCubic = (t) => 1 - Math.pow(1 - saturate(t), 3);
export const easeInOutCubic = (t) => {
  t = saturate(t);
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
};
export const easeOutBack = (t) => {
  t = saturate(t);
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};
// Frame-rate independent smoothing: move `current` toward `target`.
export const damp = (current, target, lambda, dt) => lerp(current, target, 1 - Math.exp(-lambda * dt));
export const dist2 = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);
export const sign = (v) => (v < 0 ? -1 : 1);
export const mix = lerp;
export const wrapAngle = (a) => {
  while (a > Math.PI) a -= TAU;
  while (a < -Math.PI) a += TAU;
  return a;
};
export const lerpAngle = (a, b, t) => a + wrapAngle(b - a) * t;
