// Original teams, uniforms, players and cosmetic unlockables. All names are invented.
import { createRng } from '../util/rng.js';

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

export const OPPONENTS = [
  { id: 'foxes', name: 'Cedar Falls Foxes', abbr: 'CFF', color: '#d2691e', uniform: { primary: '#d2691e', secondary: '#1a1a1a', trim: '#ffffff', pants: '#efe9dc', cap: '#1a1a1a', capBill: '#d2691e', socks: '#1a1a1a', helmet: '#1a1a1a', sleeve: '#1a1a1a', text: 'FOXES' } },
  { id: 'herons', name: 'Harbor City Herons', abbr: 'HCH', color: '#123b6b', uniform: { primary: '#f1f3f5', secondary: '#123b6b', trim: '#5ab0e8', pants: '#f1f3f5', cap: '#123b6b', capBill: '#123b6b', socks: '#123b6b', helmet: '#123b6b', sleeve: '#123b6b', text: 'HERONS', stripe: true } },
  { id: 'miners', name: 'Ironvale Miners', abbr: 'IRN', color: '#e0a800', uniform: { primary: '#131313', secondary: '#f0b323', trim: '#f0b323', pants: '#131313', cap: '#131313', capBill: '#f0b323', socks: '#f0b323', helmet: '#131313', sleeve: '#131313', text: 'MINERS' } },
  { id: 'loons', name: 'Lakeshore Loons', abbr: 'LAK', color: '#0f7f8a', uniform: { primary: '#0f7f8a', secondary: '#ffffff', trim: '#0a2f36', pants: '#e9f2f3', cap: '#0a2f36', capBill: '#0f7f8a', socks: '#0f7f8a', helmet: '#0a2f36', sleeve: '#0a2f36', text: 'LOONS' } },
  { id: 'coyotes', name: 'Dustbowl Coyotes', abbr: 'DBC', color: '#7a1f1f', uniform: { primary: '#d5b981', secondary: '#7a1f1f', trim: '#ffffff', pants: '#d5b981', cap: '#7a1f1f', capBill: '#7a1f1f', socks: '#7a1f1f', helmet: '#7a1f1f', sleeve: '#7a1f1f', text: 'COYOTES' } },
  { id: 'comets', name: 'Sunport Comets', abbr: 'SPC', color: '#2a52be', uniform: { primary: '#2a52be', secondary: '#ffffff', trim: '#d62828', pants: '#f3f3f0', cap: '#d62828', capBill: '#2a52be', socks: '#d62828', helmet: '#2a52be', sleeve: '#d62828', text: 'COMETS' } },
  { id: 'ravens', name: 'Redrock Ravens', abbr: 'RRV', color: '#a4161a', uniform: { primary: '#a4161a', secondary: '#111111', trim: '#f4f4f0', pants: '#dedad0', cap: '#111111', capBill: '#a4161a', socks: '#111111', helmet: '#111111', sleeve: '#111111', text: 'RAVENS' } },
  { id: 'stampede', name: 'Prairie Stampede', abbr: 'PST', color: '#2e6b3a', uniform: { primary: '#2e6b3a', secondary: '#eadcaa', trim: '#eadcaa', pants: '#eee7d0', cap: '#1f4a28', capBill: '#1f4a28', socks: '#2e6b3a', helmet: '#1f4a28', sleeve: '#2e6b3a', text: 'STAMPEDE' } },
];

export const FIRST = ['J.', 'M.', 'D.', 'T.', 'C.', 'R.', 'A.', 'L.', 'K.', 'B.', 'S.', 'E.', 'N.', 'P.', 'G.', 'H.', 'W.', 'F.'];
export const LAST = ['Alvarez', 'Bennett', 'Castillo', 'Dawson', 'Ellis', 'Fontaine', 'Grayson', 'Hollis', 'Ishikawa', 'Jimenez', 'Kowalski', 'Lindgren', 'Marlow', 'Nakamura', 'Okafor', 'Pruitt', 'Quinn', 'Rourke', 'Santos', 'Tanaka', 'Underhill', 'Vasquez', 'Whitaker', 'Yoder', 'Zielinski', 'Brennan', 'Delgado', 'Faulkner', 'Haddad', 'Iverson', 'Mercer', 'Novak', 'Ortega', 'Petrov', 'Reyes', 'Sutton', 'Thibodeaux', 'Voss', 'Walsh', 'Abbott'];
export const SKINS = ['#f2c9a0', '#e0ac82', '#c68642', '#a3683b', '#7b4a2a', '#f7d7b5', '#5d3a22', '#d9a066'];

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
