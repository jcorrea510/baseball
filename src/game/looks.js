// How every player LOOKS (picture only - nothing here changes a game): skin tone, facial hair, hair colour and length, the shape of
// the face, and the real jersey number of a real player. The League's real players look like themselves (the table below, from what
// they look like on TV); every other player (role players, the Quick Game's names, Sandlot's own staff, base coaches) gets a
// realistic look worked out from his name, so the same player always looks the same - and an old save needs nothing new.
// Pure data and small helpers (no graphics, no DOM).
import { CONFIG } from '../config.js';

// Facial hair styles, from none to a full beard.
export const BEARDS = ['none', 'stubble', 'mustache', 'goatee', 'short', 'full'];
const BEARD_CODE = { n: 'none', s: 'stubble', m: 'mustache', g: 'goatee', b: 'short', f: 'full' };
// Hair colours by code: k black, d dark brown, b brown, l light brown, y blond, r red / auburn, s salt and pepper, g grey.
const HAIR_CODE = ['k', 'd', 'b', 'l', 'y', 'r', 's', 'g'];

// The real players: name -> [skin tone 1-10 (1 = very fair, 10 = deep; halves allowed), facial hair (n s m g b f), hair (see above),
// jersey number or null, 'long' for hair that shows well below the cap]. As remembered at the time of writing: correct one here if
// it is off (the picture follows by itself).
const REAL = {
  // Orioles
  'Gunnar Henderson': [2, 's', 'l', 2], 'Jackson Holliday': [2, 'n', 'l', 7], 'Adley Rutschman': [2, 'b', 'l', 35], 'Jordan Westburg': [2, 'b', 'b', 11],
  'Trevor Rogers': [2, 's', 'b', 28], 'Dean Kremer': [2.5, 'b', 'd', 64], 'Tomoyuki Sugano': [3, 'n', 'k', 19], 'Félix Bautista': [8, 'b', 'k', 74], 'Keegan Akin': [2, 'f', 'b', 45],
  // Red Sox
  'Jarren Duran': [4, 'm', 'k', 16], 'Trevor Story': [2, 'b', 'b', 10], 'Roman Anthony': [2, 'n', 'b', null], 'Wilyer Abreu': [5, 'b', 'k', 52],
  'Garrett Crochet': [2, 'f', 'b', 35, 'long'], 'Brayan Bello': [7, 's', 'k', 66], 'Lucas Giolito': [2, 'b', 'b', null], 'Aroldis Chapman': [8, 'g', 'k', null], 'Garrett Whitlock': [2, 'b', 'b', 22],
  // Yankees
  'Aaron Judge': [6, 'n', 'k', 99], 'Cody Bellinger': [2, 's', 'b', 35], 'Trent Grisham': [2, 'm', 'b', 12], 'Giancarlo Stanton': [6, 's', 'k', 27], 'Ben Rice': [2, 'n', 'b', null],
  'Max Fried': [2, 's', 'd', 54], 'Carlos Rodón': [3, 'b', 'd', 55], 'Cam Schlittler': [2, 'n', 'b', null], 'David Bednar': [2, 'b', 'b', null], 'Luke Weaver': [2, 'm', 'b', 30],
  // Rays
  'Junior Caminero': [7, 'n', 'k', 13], 'Yandy Díaz': [4, 'b', 'k', 2], 'Jonathan Aranda': [4, 's', 'k', 62], 'Chandler Simpson': [8, 'n', 'k', null],
  'Drew Rasmussen': [2, 'b', 'b', 57], 'Ryan Pepiot': [2, 's', 'b', 44], 'Shane Baz': [2, 's', 'b', 11], 'Pete Fairbanks': [2, 'f', 'b', 29], 'Garrett Cleavinger': [2, 'f', 'b', null],
  // Blue Jays
  'Vladimir Guerrero Jr.': [7, 'b', 'k', 27], 'Bo Bichette': [2.5, 'n', 'd', 11, 'long'], 'George Springer': [5, 'b', 'k', 4], 'Daulton Varsho': [2, 'b', 'b', 25], 'Ernie Clement': [2, 'b', 'b', null],
  'Kevin Gausman': [2, 'f', 'b', 34, 'long'], 'Chris Bassitt': [2, 'b', 'b', 40], 'José Berríos': [5, 'b', 'k', 17], 'Jeff Hoffman': [2, 'f', 'b', 23], 'Louis Varland': [2, 's', 'l', null],
  // White Sox
  'Luis Robert Jr.': [8, 's', 'k', 88], 'Colson Montgomery': [2, 'n', 'l', null], 'Andrew Benintendi': [2, 's', 'b', 23], 'Kyle Teel': [2, 'n', 'b', null],
  'Shane Smith': [2, 'b', 'b', null], 'Davis Martin': [2, 'b', 'b', null], 'Jonathan Cannon': [2, 's', 'b', null], 'Grant Taylor': [2, 'b', 'b', null],
  // Guardians
  'José Ramírez': [6, 'b', 'k', 11], 'Steven Kwan': [3, 'n', 'k', 38], 'Kyle Manzardo': [2, 'b', 'b', 9],
  'Gavin Williams': [2, 'f', 'b', 32], 'Tanner Bibee': [2, 'b', 'b', 28], 'Slade Cecconi': [2, 'm', 'b', null], 'Cade Smith': [2, 'b', 'b', null], 'Hunter Gaddis': [2, 'b', 'b', null],
  // Tigers
  'Riley Greene': [2, 'b', 'b', 31], 'Spencer Torkelson': [1.5, 's', 'r', 20], 'Kerry Carpenter': [2, 'b', 'b', 30], 'Gleyber Torres': [5, 'g', 'k', 25],
  'Tarik Skubal': [2, 'f', 'b', 29, 'long'], 'Casey Mize': [2, 's', 'b', 12], 'Jack Flaherty': [4, 'b', 'd', 9], 'Will Vest': [2, 'f', 'b', null], 'Tyler Holton': [2, 'b', 'b', null],
  // Royals
  'Bobby Witt Jr.': [2, 'n', 'b', 7], 'Vinnie Pasquantino': [2, 'f', 'd', 9], 'Maikel Garcia': [6, 'n', 'k', 11], 'Salvador Perez': [6, 'b', 'k', 13],
  'Kris Bubic': [2, 'b', 'b', 50], 'Michael Wacha': [2, 'b', 'b', 52], 'Seth Lugo': [2, 'f', 'b', 67], 'Carlos Estévez': [7, 'b', 'k', 53], 'Lucas Erceg': [2, 'b', 'b', null],
  // Twins
  'Byron Buxton': [7.5, 'b', 'k', 25], 'Royce Lewis': [5, 's', 'k', 23], 'Trevor Larnach': [2, 'b', 'b', 9],
  'Joe Ryan': [2, 'm', 'l', 41, 'long'], 'Pablo López': [4, 'b', 'k', 49], 'Bailey Ober': [2, 'b', 'b', 17], 'Cole Sands': [2, 'b', 'b', null],
  // Astros
  'Jeremy Peña': [5, 'n', 'k', 3], 'Jose Altuve': [5, 's', 'k', 27], 'Yordan Alvarez': [8, 'b', 'k', 44], 'Carlos Correa': [4, 's', 'k', 1],
  'Hunter Brown': [5, 's', 'k', 58], 'Framber Valdez': [8, 'g', 'k', 59], 'Josh Hader': [2, 's', 'l', 71, 'long'], 'Bryan Abreu': [8, 's', 'k', 52],
  // Angels
  'Mike Trout': [2, 'n', 'b', 27], 'Zach Neto': [3, 'n', 'd', 9], 'Jo Adell': [7, 'n', 'k', 7], 'Taylor Ward': [2, 'b', 'b', 3],
  'Yusei Kikuchi': [3, 'n', 'k', null], 'José Soriano': [8, 'n', 'k', null], 'Tyler Anderson': [2, 'b', 'b', null], 'Kenley Jansen': [9, 'b', 'k', 74], 'Reid Detmers': [2, 'n', 'l', 48],
  // Athletics
  'Nick Kurtz': [2, 'n', 'b', null], 'Brent Rooker': [2, 'f', 'b', 25], 'Shea Langeliers': [2, 'b', 'b', 23], 'Jacob Wilson': [2, 'n', 'b', 5], 'Lawrence Butler': [7, 's', 'k', 4],
  'Jeffrey Springs': [2, 'b', 'b', null], 'Luis Severino': [7, 'g', 'k', 40], 'Jacob Lopez': [4, 's', 'k', null],
  // Mariners
  'Cal Raleigh': [2, 'f', 'b', 29], 'Julio Rodríguez': [7, 'n', 'k', 44], 'Eugenio Suárez': [5, 'b', 'k', 28], 'Josh Naylor': [2, 'f', 'd', null], 'Randy Arozarena': [6, 'b', 'k', 56],
  'Bryan Woo': [3, 'n', 'k', 22], 'Logan Gilbert': [2, 's', 'b', 36], 'George Kirby': [2, 's', 'b', 68], 'Andrés Muñoz': [5, 'g', 'k', 75], 'Matt Brash': [2, 's', 'b', 47],
  // Rangers
  'Corey Seager': [2, 'b', 'b', 5], 'Wyatt Langford': [2, 'n', 'l', 36], 'Josh Jung': [2, 's', 'b', 6], 'Marcus Semien': [7, 'b', 'k', 2],
  'Jacob deGrom': [2, 'b', 'd', 48], 'Nathan Eovaldi': [2, 'f', 'd', 17], 'Merrill Kelly': [2, 'b', 'b', null], 'Shawn Armstrong': [2, 'f', 'b', null], 'Robert Garcia': [4, 'b', 'k', null],
  // Braves
  'Ronald Acuña Jr.': [8, 's', 'k', 13], 'Matt Olson': [1.5, 'f', 'r', 28], 'Drake Baldwin': [2, 'n', 'b', null], 'Michael Harris II': [8, 'n', 'k', 23], 'Ozzie Albies': [8, 'g', 'k', 1],
  'Chris Sale': [2, 's', 'd', 51], 'Spencer Schwellenbach': [2, 'm', 'b', 56], 'Spencer Strider': [2, 'm', 'b', 99], 'Raisel Iglesias': [6, 'g', 'k', 26], 'Dylan Lee': [2, 'b', 'b', null],
  // Marlins
  'Kyle Stowers': [2, 'b', 'b', null], 'Xavier Edwards': [6, 'n', 'k', null], 'Agustín Ramírez': [6, 's', 'k', null], 'Otto Lopez': [6, 's', 'k', null],
  'Edward Cabrera': [7, 'n', 'k', 27], 'Eury Pérez': [7, 'n', 'k', 39], 'Sandy Alcantara': [8, 's', 'k', 22], 'Ronny Henriquez': [7, 'n', 'k', null],
  // Mets
  'Juan Soto': [7, 's', 'k', 22], 'Francisco Lindor': [6, 'b', 'k', 12], 'Pete Alonso': [3, 's', 'd', 20], 'Brandon Nimmo': [2, 'b', 'b', 9],
  'Kodai Senga': [3, 'n', 'k', 34], 'David Peterson': [2, 'b', 'b', 23], 'Clay Holmes': [2, 'f', 'b', 35], 'Edwin Díaz': [7, 's', 'k', 39], 'Tyler Rogers': [2, 'f', 'b', null],
  // Phillies
  'Kyle Schwarber': [2, 'f', 'b', 12], 'Trea Turner': [2, 'b', 'b', 7], 'Bryce Harper': [2, 'b', 'd', 3], 'Alec Bohm': [2, 'b', 'b', 28], 'J.T. Realmuto': [2, 'b', 'd', 10],
  'Cristopher Sánchez': [6, 's', 'k', 61], 'Zack Wheeler': [2, 'f', 'b', 45], 'Jesús Luzardo': [4, 's', 'k', 44], 'Jhoan Duran': [7, 'n', 'k', 59], 'Matt Strahm': [2, 'f', 'b', 25],
  // Nationals
  'James Wood': [7, 'n', 'k', 29], 'CJ Abrams': [7, 'n', 'k', 5], 'Dylan Crews': [2, 'n', 'b', 3],
  'MacKenzie Gore': [2, 'b', 'b', 1], 'Jake Irvin': [2, 'f', 'b', 27], 'Mitchell Parker': [2, 'b', 'b', null],
  // Cubs
  'Kyle Tucker': [2, 's', 'b', 30], 'Pete Crow-Armstrong': [2, 'n', 'b', 4], 'Seiya Suzuki': [3, 's', 'k', 27], 'Michael Busch': [2, 'b', 'b', 29], 'Nico Hoerner': [2, 's', 'b', 2],
  'Matthew Boyd': [2, 'f', 'b', null], 'Cade Horton': [2, 'n', 'b', null], 'Shota Imanaga': [3, 'n', 'k', 18], 'Daniel Palencia': [6, 'n', 'k', null], 'Brad Keller': [2, 'b', 'b', null],
  // Reds
  'Elly De La Cruz': [8, 'n', 'k', 44], 'Spencer Steer': [2, 'b', 'b', 7], 'TJ Friedl': [2, 'm', 'b', 29],
  'Hunter Greene': [7, 'n', 'k', 21], 'Andrew Abbott': [2, 'b', 'b', 41], 'Nick Lodolo': [2, 'b', 'b', 40], 'Emilio Pagán': [4, 'b', 'd', 15, 'long'], 'Tony Santillan': [4, 'b', 'k', null],
  // Brewers
  'Christian Yelich': [3, 's', 'd', 22], 'Jackson Chourio': [8, 'n', 'k', 11], 'Brice Turang': [3, 'n', 'd', 2], 'William Contreras': [6, 'b', 'k', 24],
  'Freddy Peralta': [7, 's', 'k', 51], 'Quinn Priester': [2, 'n', 'b', null], 'Brandon Woodruff': [2, 'f', 'b', 53], 'Trevor Megill': [2, 'f', 'b', null], 'Abner Uribe': [8, 'n', 'k', null],
  // Pirates
  'Oneil Cruz': [8, 'n', 'k', 15], 'Bryan Reynolds': [2, 'b', 'b', 10], 'Andrew McCutchen': [8, 'f', 's', 22],
  'Paul Skenes': [2, 'm', 'b', 30], 'Mitch Keller': [2, 'b', 'b', 23], 'Mike Burrows': [2, 'b', 'b', null], 'Dennis Santana': [7, 'n', 'k', null],
  // Cardinals
  'Alec Burleson': [2, 'b', 'b', 41], 'Iván Herrera': [5, 'n', 'k', 48], 'Willson Contreras': [6, 'b', 'k', 40], 'Masyn Wynn': [6, 'n', 'k', 0],
  'Sonny Gray': [2, 'b', 'b', 54], 'Matthew Liberatore': [2, 'b', 'b', 52], 'Miles Mikolas': [2, 'f', 'd', 39], "Riley O'Brien": [2, 'b', 'b', null], 'JoJo Romero': [4, 'b', 'k', null],
  // Diamondbacks
  'Corbin Carroll': [2.5, 'n', 'b', 7], 'Ketel Marte': [7, 's', 'k', 4], 'Geraldo Perdomo': [7, 'n', 'k', 2], 'Gabriel Moreno': [6, 'n', 'k', 14],
  'Ryne Nelson': [2, 'b', 'b', 19], 'Zac Gallen': [2, 'b', 'b', 23], 'Brandon Pfaadt': [2, 'b', 'b', 32],
  // Rockies
  'Hunter Goodman': [2, 'b', 'b', 15], 'Jordan Beck': [2, 'b', 'b', 27], 'Brenton Doyle': [6, 'n', 'k', 9], 'Ezequiel Tovar': [6, 'n', 'k', 14],
  'Kyle Freeland': [2, 'f', 'b', 21], 'Chase Dollander': [2, 'n', 'b', null], 'Germán Márquez': [6, 'b', 'k', 48], 'Victor Vodnik': [5, 's', 'k', null],
  // Dodgers
  'Shohei Ohtani': [3, 'n', 'k', 17], 'Freddie Freeman': [2, 's', 'b', 5], 'Will Smith': [2, 'b', 'b', 16], 'Mookie Betts': [8, 's', 'k', 50], 'Teoscar Hernández': [7, 'b', 'k', 37],
  'Yoshinobu Yamamoto': [3, 'n', 'k', 18], 'Blake Snell': [2, 's', 'b', 7], 'Tyler Glasnow': [2, 's', 'b', 31, 'long'], 'Alex Vesia': [2, 'f', 'b', 51], 'Tanner Scott': [2, 'b', 'b', null],
  // Padres
  'Fernando Tatis Jr.': [6, 's', 'k', 23], 'Manny Machado': [5, 'b', 'k', 13], 'Jackson Merrill': [2, 'n', 'b', 3], 'Xander Bogaerts': [6, 'b', 'k', 2],
  'Nick Pivetta': [2, 'b', 'b', 27], 'Dylan Cease': [2, 'b', 'b', 84], 'Michael King': [2, 'b', 'b', 34], 'Robert Suarez': [6, 'g', 'k', 75], 'Mason Miller': [2, 'n', 'b', null],
  // Giants
  'Rafael Devers': [7, 's', 'k', null], 'Willy Adames': [7, 'b', 'k', 2], 'Heliot Ramos': [6, 'n', 'k', 17], 'Matt Chapman': [2, 's', 'r', 26],
  'Logan Webb': [2, 'b', 'b', 62], 'Robbie Ray': [2, 'f', 'b', null], 'Justin Verlander': [2, 's', 'b', 35], 'Randy Rodríguez': [7, 'n', 'k', null], 'Ryan Walker': [2, 'b', 'b', null],
};

/** The real player's table row (or null): { tone, beard, hairCode, number, long }. */
export function realLook(name) {
  const r = REAL[name];
  if (!r) return null;
  return { tone: r[0], beard: BEARD_CODE[r[1]] || 'none', hairCode: r[2], number: r[3] ?? null, long: r[4] === 'long' };
}
/** A real player's jersey number, or null when the table does not know it. */
export const realNumber = (name) => (REAL[name] ? REAL[name][3] ?? null : null);
/** Every real player's name in the table (for tests). */
export const realNames = () => Object.keys(REAL);

// A small string hash (FNV-1a): the same name always gives the same number.
export function nameHash(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
// A tiny random sequence from a hash (deterministic; never the engine's rng).
function seq(h) {
  let s = h >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function weighted(r, table) {
  let total = 0;
  for (const k in table) total += table[k];
  let x = r * total;
  for (const k in table) { x -= table[k]; if (x <= 0) return k; }
  return Object.keys(table)[0];
}

// The background a surname suggests (only the generated names: see game/teams.js and game/mlb.js), so a Tanaka is not given red hair.
const SURNAME_GROUP = {
  latino: ['Alvarez', 'Castillo', 'Jimenez', 'Santos', 'Vasquez', 'Delgado', 'Ortega', 'Reyes'],
  asian: ['Ishikawa', 'Nakamura', 'Tanaka'],
  african: ['Okafor'],
  levant: ['Haddad'],
};
const groupOf = (name) => {
  const last = String(name || '').split(' ').slice(-1)[0];
  for (const g in SURNAME_GROUP) if (SURNAME_GROUP[g].includes(last)) return g;
  return null;
};

/**
 * A generated player's look, from his name (the same name always looks the same). Skin tones, hair and facial hair follow a big-league
 * clubhouse (config.looks.mix): most players fair to olive, many Latin American, a good share Black, some East Asian.
 */
export function generatedLook(name, cfg = CONFIG) {
  const L = cfg.looks;
  const r = seq(nameHash(String(name || 'player')));
  const group = groupOf(name) || weighted(r(), L.mix);
  const G = L.groups[group] || L.groups.euro;
  const tone = G.tone[0] + r() * (G.tone[1] - G.tone[0]);
  const hairCode = weighted(r(), G.hair);
  const beard = weighted(r(), L.beards);
  return { tone: Math.round(tone * 2) / 2, beard, hairCode, number: null, long: r() < L.longHair };
}

/** The colour of skin tone t (1-10, fractions blend the steps; config.looks.skin). */
export function skinHex(t, cfg = CONFIG) {
  const S = cfg.looks.skin;
  const x = Math.max(1, Math.min(S.length, t)) - 1;
  const i = Math.min(S.length - 2, Math.floor(x)), f = x - i;
  return mixHex(S[i], S[i + 1], f);
}
function mixHex(a, b, t) {
  const A = parseInt(a.slice(1), 16), B = parseInt(b.slice(1), 16);
  const ch = (s) => Math.round(((A >> s) & 255) + (((B >> s) & 255) - ((A >> s) & 255)) * t);
  return '#' + [16, 8, 0].map((s) => ch(s).toString(16).padStart(2, '0')).join('');
}

/**
 * How a player looks, for the figure builder (render/rig.js Person `look`):
 * { tone, skin (hex), beard (one of BEARDS), hair (hex), long (hair below the cap), face (0..1: the shape of the face), number }.
 * A real player from the table, else worked out from his name. `p.look` (an object of the same shape) wins when a player has one.
 */
export function lookOf(p, cfg = CONFIG) {
  const name = (p && p.name) || 'player';
  if (p && p.look && p.look.skin) return p.look;
  const base = realLook(name) || generatedLook(name, cfg);
  const h = nameHash(name + '|face');
  const hair = cfg.looks.hair[base.hairCode] || cfg.looks.hair.d;
  // (a touch of variety inside a tone step: no two players exactly the same colour)
  const tone = base.tone + (((h >>> 8) & 255) / 255 - 0.5) * cfg.looks.toneJitter;
  return { tone: base.tone, skin: skinHex(tone, cfg), beard: base.beard, hair, long: base.long, face: (h & 1023) / 1023, number: base.number };
}

/** The plate umpire: a veteran (config.looks.umpire). */
export function umpireLook(cfg = CONFIG) {
  const U = cfg.looks.umpire;
  return { tone: U.tone, skin: skinHex(U.tone, cfg), beard: U.beard, hair: cfg.looks.hair[U.hair], long: false, face: U.face, number: null };
}

/**
 * Who stands where when a team takes the field (picture only): its batters at their own positions (`posOf(player)` -> 'SS', 'C',
 * ...), the others (a DH, players without a position) filling the open places in order. The pitcher is not one of them.
 * @returns {object} position -> player (or nothing for a place nobody fills)
 */
export function fieldersFrom(lineup, posOf = (p) => p.pos) {
  const places = ['C', '1B', '2B', 'SS', '3B', 'LF', 'CF', 'RF'];
  const out = {}, left = [];
  for (const p of lineup || []) { const q = posOf(p); if (q && places.includes(q) && !out[q]) out[q] = p; else left.push(p); }
  for (const q of places) if (!out[q] && left.length) out[q] = left.shift();
  return out;
}

export { HAIR_CODE };
