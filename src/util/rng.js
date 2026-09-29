// Small seeded random number generator so tests and bot runs are repeatable.
export function createRng(seed = (Math.random() * 2 ** 32) >>> 0) {
  let s = seed >>> 0;
  const next = () => {
    // mulberry32
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const rng = {
    seed,
    next,
    range: (a, b) => a + (b - a) * next(),
    int: (a, b) => Math.floor(a + (b - a + 1) * next()),
    chance: (p) => next() < p,
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    gauss: (mean = 0, sd = 1) => {
      let u = 0, v = 0;
      while (u === 0) u = next();
      while (v === 0) v = next();
      return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    },
    weighted: (table) => {
      // table: { key: weight }
      let total = 0;
      for (const k in table) total += table[k];
      let r = next() * total;
      for (const k in table) {
        r -= table[k];
        if (r <= 0) return k;
      }
      return Object.keys(table)[0];
    },
    fork: () => createRng((next() * 2 ** 32) >>> 0),
  };
  return rng;
}
