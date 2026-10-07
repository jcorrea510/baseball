// Original teams, uniforms, players and cosmetic unlockables. All names are invented.
import { createRng } from '../util/rng.js';
import { clamp } from '../util/math.js';
import { CONFIG } from '../config.js';

// Each uniform: colours used by the figure builder.
export const UNIFORMS = {
  classic: { label: 'Sandlot Blues', primary: '#1d3a7e', secondary: '#f4f4ef', trim: '#f0b323', pants: '#ecebe4', cap: '#14295c', capBill: '#14295c', socks: '#f0b323', helmet: '#14295c', sleeve: '#1d3a7e', gloves: '#f4f4ef', text: 'SLUGGERS' },
  road: { label: 'Road Grays', primary: '#8e97a6', secondary: '#1d2f5c', trim: '#f4f4ef', pants: '#8e97a6', cap: '#1d2f5c', capBill: '#1d2f5c', socks: '#1d2f5c', helmet: '#1d2f5c', sleeve: '#8e97a6', gloves: '#f4f4ef', text: 'SANDLOT' },
  crimson: { label: 'Crimson Nights', primary: '#a3141f', secondary: '#f4f4ef', trim: '#141414', pants: '#ecebe4', cap: '#141414', capBill: '#a3141f', socks: '#a3141f', helmet: '#141414', sleeve: '#141414', gloves: '#141414', text: 'SLUGGERS' },
  emerald: { label: 'Emerald City', primary: '#0f7a4a', secondary: '#f4f4ef', trim: '#f0d060', pants: '#ecebe4', cap: '#0b5a37', capBill: '#0b5a37', socks: '#0f7a4a', helmet: '#0b5a37', sleeve: '#0f7a4a', gloves: '#f4f4ef', text: 'SLUGGERS' },
  gold: { label: 'Golden Era', primary: '#f0b323', secondary: '#141414', trim: '#ffffff', pants: '#f7f2e0', cap: '#141414', capBill: '#f0b323', socks: '#141414', helmet: '#f0b323', sleeve: '#141414', gloves: '#141414', text: 'SLUGGERS' },
  midnight: { label: 'Midnight Silver', primary: '#15171d', secondary: '#c9d1dc', trim: '#7d8796', pants: '#15171d', cap: '#15171d', capBill: '#15171d', socks: '#c9d1dc', helmet: '#15171d', sleeve: '#15171d', gloves: '#c9d1dc', text: 'SLUGGERS' },
  sunrise: { label: 'Sunrise', primary: '#e8641a', secondary: '#f8ecd0', trim: '#5b2a86', pants: '#f8ecd0', cap: '#5b2a86', capBill: '#5b2a86', socks: '#e8641a', helmet: '#5b2a86', sleeve: '#5b2a86', gloves: '#f8ecd0', text: 'SLUGGERS' },
};

export const BATS = {
  ash: { label: 'Ash Classic' },
  maple: { label: 'Maple Blonde' },
  cherry: { label: 'Cherry Bomb' },
  midnight: { label: 'Midnight Black' },
  golden: { label: 'Golden Slugger' },
  neon: { label: 'Neon Lightning' },
  sunset: { label: 'Sunset Fade' },
  carbon: { label: 'Carbon Elite' },
};

export const PLAYER_TEAM = { id: 'sandlot', name: 'Sandlot Sluggers', abbr: 'SLG', color: '#1d3a7e' };

export const FIRST = ['J.', 'M.', 'D.', 'T.', 'C.', 'R.', 'A.', 'L.', 'K.', 'B.', 'S.', 'E.', 'N.', 'P.', 'G.', 'H.', 'W.', 'F.'];
export const LAST = ['Alvarez', 'Bennett', 'Castillo', 'Dawson', 'Ellis', 'Fontaine', 'Grayson', 'Hollis', 'Ishikawa', 'Jimenez', 'Kowalski', 'Lindgren', 'Marlow', 'Nakamura', 'Okafor', 'Pruitt', 'Quinn', 'Rourke', 'Santos', 'Tanaka', 'Underhill', 'Vasquez', 'Whitaker', 'Yoder', 'Zielinski', 'Brennan', 'Delgado', 'Faulkner', 'Haddad', 'Iverson', 'Mercer', 'Novak', 'Ortega', 'Petrov', 'Reyes', 'Sutton', 'Thibodeaux', 'Voss', 'Walsh', 'Abbott'];
// Skin tones light to deep (the same steps as config.looks.skin). A player's picture takes its look from game/looks.js lookOf (by
// his name); this `skin` field is only kept for older code and saves.
export const SKINS = ['#f3d2bd', '#ebc2a3', '#dfae8a', '#cf9a72', '#bd855c', '#a66f48', '#8d5937', '#74462a', '#5a3420', '#432618'];

export function makeLineup(seed, prefix = '') {
  const rng = createRng(seed);
  const used = new Set();
  const out = [];
  for (let i = 0; i < 9; i++) {
    let name;
    do { name = rng.pick(FIRST) + ' ' + rng.pick(LAST); } while (used.has(name));
    used.add(name);
    out.push({
      name,
      number: rng.int(1, 99),
      skin: rng.pick(SKINS),
      scale: rng.range(0.95, 1.05),
      build: rng.range(0.94, 1.1),
      hand: rng.chance(0.28) ? 'L' : 'R',
      id: prefix + i,
    });
  }
  return out;
}

export function makePitcher(seed) {
  const rng = createRng(seed ^ 0x9e3779b9);
  return { name: rng.pick(FIRST) + ' ' + rng.pick(LAST), number: rng.int(10, 60), skin: rng.pick(SKINS), scale: 1.05, build: 1.02, hand: rng.chance(0.25) ? 'L' : 'R' };
}

/**
 * Sandlot's own pitching staff (your pitchers when you have no League club): the starters first (the best one at [0]), then the
 * relievers. Each pitcher: { id, name, short, number, hand, role 'SP'|'RP', vel, ctl, stf, sta (ratings 1-99), pitches, skin, scale, build }.
 */
export function makeStaff(seed, cfg = CONFIG) {
  const S = cfg.pitching.staff;
  const rng = createRng((seed ^ 0x27d4eb2f) >>> 0);
  const rating = () => Math.round(clamp(rng.gauss(S.mean, S.sd), 1, 99));
  const used = new Set();
  const arm = (role, i) => {
    let name;
    do { name = rng.pick(FIRST) + ' ' + rng.pick(LAST); } while (used.has(name));
    used.add(name);
    const n = role === 'SP' ? S.starterPitches : rng.int(S.relieverPitches[0], S.relieverPitches[1]);
    const others = S.pool.filter((t) => t !== 'fastball');
    const pitches = ['fastball'];
    while (pitches.length < Math.min(n, S.pool.length)) pitches.push(others.splice(rng.int(0, others.length - 1), 1)[0]);
    return {
      id: 'sp' + (role === 'SP' ? '' : 'r') + i, name, short: name, number: rng.int(10, 60), hand: rng.chance(0.25) ? 'L' : 'R', role,
      vel: rating(), ctl: rating(), stf: rating(), sta: rating(), pitches,
      skin: rng.pick(SKINS), scale: rng.range(1.0, 1.07), build: rng.range(0.98, 1.06),
    };
  };
  const ovr = (p) => p.vel + p.ctl + p.stf + p.sta;
  const starters = Array.from({ length: S.starters }, (_, i) => arm('SP', i)).sort((a, b) => ovr(b) - ovr(a));
  const relievers = Array.from({ length: S.relievers }, (_, i) => arm('RP', i));
  return [...starters, ...relievers];
}
