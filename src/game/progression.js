// Saved progress: settings, career stats, high scores and unlockable bats / uniforms.
// Everything goes through try/catch: if storage is blocked (private windows etc.) the game still works,
// it just does not remember anything.
import { CONFIG } from '../config.js';

export const DEFAULT_SAVE = () => ({
  v: 1,
  settings: {
    difficulty: 'pro', tod: 'day', zone: true, pitchGuide: true, landingRing: true, umpire: 'on', hand: 'auto', sound: true, shake: true, howtoSeen: false, aimAssistHint: true,
    // sound: master volume and the three channels under it (0..1)
    volume: 0.8, sfxVolume: 1, umpireVolume: 1, crowdVolume: 1,
    flashes: true, // white screen flashes on big hits (off = calmer screen)
    inputDelayMs: 0, // swing timing adjustment for screens / controllers that lag (ms subtracted from every press)
  },
  career: {
    games: 0, wins: 0, pa: 0, ab: 0, hits: 0, hr: 0, longestHR: 0, maxEV: 0, perfects: 0, swings: 0, contacts: 0,
    derbyGames: 0, derbyBestHR: 0, derbyBestStreak: 0, practiceSwings: 0, strikeouts: 0, walks: 0, rbi: 0,
  },
  high: { quick: { rookie: null, pro: null, allstar: null }, derby: { rookie: 0, pro: 0, allstar: 0 } },
  unlocked: { bats: ['ash'], uniforms: ['classic'] },
  equipped: { bat: 'ash', uniform: 'classic' },
});

// Milestones. Each has a test on the saved data (after the latest game has been added).
export const UNLOCKS = [
  { id: 'road', kind: 'uniforms', name: 'Road Grays', hint: 'Finish 1 Quick Game', test: (s) => s.career.games >= 1 },
  { id: 'maple', kind: 'bats', name: 'Maple Blonde', hint: 'Get 5 career hits', test: (s) => s.career.hits >= 5 },
  { id: 'crimson', kind: 'uniforms', name: 'Crimson Nights', hint: 'Get 15 career hits', test: (s) => s.career.hits >= 15 },
  { id: 'cherry', kind: 'bats', name: 'Cherry Bomb', hint: 'Hit 3 career home runs', test: (s) => s.career.hr >= 3 },
  { id: 'emerald', kind: 'uniforms', name: 'Emerald City', hint: 'Hit 5+ home runs in one Derby', test: (s) => s.career.derbyBestHR >= 5 },
  { id: 'midnight', kind: 'bats', name: 'Midnight Black', hint: 'Get 40 career hits', test: (s) => s.career.hits >= 40 },
  { id: 'neon', kind: 'bats', name: 'Neon Lightning', hint: 'Win a Quick Game', test: (s) => s.career.wins >= 1 },
  { id: 'sunrise', kind: 'uniforms', name: 'Sunrise', hint: 'Win 3 Quick Games', test: (s) => s.career.wins >= 3 },
  { id: 'sunset', kind: 'bats', name: 'Sunset Fade', hint: 'Hit 15 career home runs', test: (s) => s.career.hr >= 15 },
  { id: 'gold', kind: 'uniforms', name: 'Golden Era', hint: 'Hit a 450 ft home run', test: (s) => s.career.longestHR >= 450 },
  { id: 'golden', kind: 'bats', name: 'Golden Slugger', hint: 'Hit 10+ home runs in one Derby', test: (s) => s.career.derbyBestHR >= 10 },
  { id: 'carbon', kind: 'bats', name: 'Carbon Elite', hint: 'Hit 40 career home runs', test: (s) => s.career.hr >= 40 },
  { id: 'midnightU', kind: 'uniforms', name: 'Midnight Silver', hint: 'Hit 25 career home runs', test: (s) => s.career.hr >= 25, key: 'midnight' },
];
export const unlockKey = (u) => u.key || u.id;

function makeStore() {
  try {
    const k = '__sandlot_test__';
    window.localStorage.setItem(k, '1');
    window.localStorage.removeItem(k);
    return {
      get: (key) => { try { return window.localStorage.getItem(key); } catch { return null; } },
      set: (key, val) => { try { window.localStorage.setItem(key, val); } catch { /* ignore */ } },
    };
  } catch {
    const mem = {};
    return { get: (key) => (key in mem ? mem[key] : null), set: (key, val) => { mem[key] = val; } };
  }
}

function merge(base, extra) {
  if (Array.isArray(base) || typeof base !== 'object' || base === null) return extra === undefined ? base : extra;
  const out = { ...base };
  if (extra && typeof extra === 'object') for (const k of Object.keys(extra)) out[k] = k in base ? merge(base[k], extra[k]) : extra[k];
  return out;
}

export class Progress {
  constructor(store) {
    this.store = store || makeStore();
    this.data = this.load();
  }
  load() {
    this.fresh = true; // nothing saved yet: a first visit
    try {
      const raw = this.store.get(CONFIG.storageKey);
      if (raw) {
        const d = merge(DEFAULT_SAVE(), JSON.parse(raw));
        if (d.settings.umpire !== 'off') d.settings.umpire = 'on'; // (older saves had 'synth' / 'speech' voices, now gone)
        this.fresh = false;
        return d;
      }
    } catch { /* fall through */ }
    return DEFAULT_SAVE();
  }
  save() {
    try { this.store.set(CONFIG.storageKey, JSON.stringify(this.data)); } catch { /* ignore */ }
  }
  get settings() { return this.data.settings; }
  updateSettings(patch) { Object.assign(this.data.settings, patch); this.save(); }
  isUnlocked(kind, id) { return this.data.unlocked[kind].includes(id); }
  equip(kind, id) {
    if (!this.isUnlocked(kind, id)) return false;
    if (kind === 'bats') this.data.equipped.bat = id; else this.data.equipped.uniform = id;
    this.save();
    return true;
  }

  // Add the results of a finished game. Returns { records: [text...], unlocked: [{kind,name,id}...] }.
  recordGame(res) {
    const c = this.data.career;
    const st = res.stats;
    const records = [];
    c.pa += st.pa; c.ab += st.ab; c.hits += st.hits; c.hr += st.hr; c.rbi += st.rbi || 0;
    c.perfects += st.perfect; c.swings += st.swings; c.contacts += st.contacts;
    c.strikeouts += st.strikeouts || 0; c.walks += st.walks || 0;
    if (st.maxEV > c.maxEV) { if (c.maxEV > 0) records.push(`Exit velo ${Math.round(st.maxEV)} mph`); c.maxEV = st.maxEV; }
    if (st.longestHR > c.longestHR) { if (c.longestHR > 0 || st.longestHR > 0) records.push(`Longest HR ${st.longestHR} ft`); c.longestHR = st.longestHR; }
    if (res.mode === 'quick') {
      c.games++;
      if (res.won) c.wins++;
      const score = res.game.score;
      const margin = score.top - score.bottom;
      const prev = this.data.high.quick[res.difficulty];
      if (!prev || margin > prev.margin || (margin === prev.margin && score.top > prev.runs)) {
        this.data.high.quick[res.difficulty] = { margin, runs: score.top, against: score.bottom };
        if (prev) records.push('Best Quick Game');
      }
    } else if (res.mode === 'derby') {
      c.derbyGames++;
      const d = res.derby;
      if (d.hr > c.derbyBestHR) { if (c.derbyBestHR > 0) records.push(`Derby record ${d.hr} HR`); c.derbyBestHR = d.hr; }
      if (d.bestStreak > c.derbyBestStreak) c.derbyBestStreak = d.bestStreak;
      if (d.hr > (this.data.high.derby[res.difficulty] || 0)) this.data.high.derby[res.difficulty] = d.hr;
    }
    const unlocked = this.checkUnlocks();
    this.save();
    return { records, unlocked };
  }

  recordPracticeSwing() { this.data.career.practiceSwings++; if (this.data.career.practiceSwings % 10 === 0) this.save(); }

  checkUnlocks() {
    const got = [];
    for (const u of UNLOCKS) {
      const id = unlockKey(u);
      if (!this.data.unlocked[u.kind].includes(id) && u.test(this.data)) {
        this.data.unlocked[u.kind].push(id);
        got.push({ kind: u.kind, name: u.name, id });
      }
    }
    return got;
  }

  // Milestones that are still locked, with a hint about how to earn them.
  lockedHint(kind, id) {
    const u = UNLOCKS.find((x) => x.kind === kind && unlockKey(x) === id);
    return u ? u.hint : '';
  }

  average() {
    const c = this.data.career;
    return c.ab > 0 ? c.hits / c.ab : 0;
  }
  // Wipe career stats and high scores. Settings, unlocked bats / uniforms and what is equipped are kept (they were earned).
  resetStats() {
    const d = DEFAULT_SAVE();
    this.data.career = d.career;
    this.data.high = d.high;
    this.save();
  }
  reset() { this.data = DEFAULT_SAVE(); this.save(); }
}
