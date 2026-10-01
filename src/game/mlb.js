// The League's teams and stars: the thirty big-league cities with their real locations and colours. Every nickname and every
// player's name is changed a little (the Nets, the Fillies, "Aaron Judd") so nobody is the real thing but everybody is easy to
// recognise. Pure data and small helpers (no graphics, no DOM).
import { createRng } from '../util/rng.js';
import { SKINS } from './teams.js';

// strength tiers: 1 (rebuilding) .. 5 (the team to beat). A team's CPU strength rating comes from it (see config.league.tierRating).
// stars: [name, position, contact, power, speed, bats]
const T = (id, city, nick, abbr, league, division, color, color2, tier, stars) => ({ id, city, nick, abbr, league, division, color, color2, tier, stars });

export const MLB_TEAMS = [
  // ---- American League East
  T('bal', 'Baltimore', 'Ospreys', 'BAL', 'AL', 'East', '#df4601', '#111111', 2, [['Gunner Hendricks', 'SS', 80, 76, 72, 'L'], ['Adley Rutledge', 'C', 78, 70, 40, 'L'], ['Jackson Holloway', '2B', 74, 62, 84, 'L']]),
  T('bos', 'Boston', 'Red Hose', 'BOS', 'AL', 'East', '#bd3039', '#0c2340', 3, [['Rafael Devera', '3B', 80, 84, 38, 'L'], ['Jarren Durant', 'CF', 76, 58, 94, 'L'], ['Roman Antonio', 'RF', 74, 70, 70, 'L']]),
  T('nyy', 'New York', 'Yankers', 'NYY', 'AL', 'East', '#0c2340', '#c4ced3', 4, [['Aaron Judd', 'RF', 84, 98, 58, 'R'], ['Giancarlo Stanford', 'DH', 66, 92, 36, 'R'], ['Anthony Volpi', 'SS', 68, 66, 82, 'R'], ['Austin Wellsley', 'CF', 72, 62, 78, 'L']]),
  T('tb', 'Tampa Bay', 'Rayfins', 'TB', 'AL', 'East', '#092c5c', '#8fbce6', 3, [['Yandi Diaz', '1B', 86, 66, 44, 'R'], ['Junior Camino', '3B', 74, 80, 56, 'R'], ['Brandon Lowry', '2B', 66, 60, 78, 'L']]),
  T('tor', 'Toronto', 'Blue Jets', 'TOR', 'AL', 'East', '#134a8e', '#e8291c', 3, [['Vladimir Guerrera Jr.', '1B', 86, 86, 34, 'R'], ['Bo Bishette', 'SS', 84, 66, 60, 'R'], ['George Springfield', 'CF', 70, 76, 68, 'R']]),
  // ---- American League Central
  T('cws', 'Chicago', 'White Socks', 'CWS', 'AL', 'Central', '#27251f', '#c4ced4', 1, [['Luis Roberts Jr.', 'CF', 68, 82, 80, 'R'], ['Andrew Benintendo', 'LF', 70, 56, 54, 'L'], ['Miguel Vargis', '3B', 64, 66, 60, 'R']]),
  T('cle', 'Cleveland', 'Guardsmen', 'CLE', 'AL', 'Central', '#00385d', '#e50022', 3, [['Jose Ramos', '3B', 82, 82, 80, 'S'], ['Steven Kwon', 'LF', 84, 44, 74, 'L'], ['Kyle Manzardo', '1B', 70, 70, 40, 'L']]),
  T('det', 'Detroit', 'Tygers', 'DET', 'AL', 'Central', '#0c2340', '#fa4616', 4, [['Riley Greer', 'CF', 78, 76, 74, 'L'], ['Kerry Carpentier', 'RF', 76, 80, 56, 'L'], ['Spencer Torkelsen', '1B', 62, 80, 36, 'R'], ['Javier Baeza', 'SS', 68, 56, 70, 'R']]),
  T('kc', 'Kansas City', 'Royales', 'KC', 'AL', 'Central', '#004687', '#bd9b60', 3, [['Bobby Wiltt Jr.', 'SS', 92, 84, 92, 'R'], ['Salvador Peres', 'C', 74, 80, 30, 'R'], ['Vinnie Pasquantini', '1B', 82, 62, 28, 'L']]),
  T('min', 'Minnesota', 'Twines', 'MIN', 'AL', 'Central', '#002b5c', '#d31145', 2, [['Byron Buxtin', 'CF', 70, 82, 92, 'R'], ['Carlos Correia', 'SS', 76, 74, 50, 'R'], ['Royce Louis', '3B', 72, 78, 74, 'R']]),
  // ---- American League West
  T('hou', 'Houston', 'Astrals', 'HOU', 'AL', 'West', '#002d62', '#eb6e1f', 3, [['Yordan Alvarado', 'DH', 90, 92, 40, 'L'], ['Jose Altuvo', '2B', 82, 66, 66, 'R'], ['Jeremy Penya', 'SS', 72, 62, 70, 'R']]),
  T('laa', 'Los Angeles', 'Angles', 'LAA', 'AL', 'West', '#ba0021', '#003263', 2, [['Mike Troutt', 'CF', 86, 90, 74, 'R'], ['Taylor Wardle', 'LF', 70, 74, 52, 'R'], ['Zach Netto', 'SS', 70, 62, 76, 'R']]),
  T('ath', 'Sacramento', 'Athletix', 'ATH', 'AL', 'West', '#003831', '#efb21e', 2, [['Brent Rooke', 'DH', 72, 90, 44, 'L'], ['Nick Kurtzman', '1B', 74, 86, 44, 'L'], ['Lawrence Butlin', 'RF', 76, 72, 66, 'L']]),
  T('sea', 'Seattle', 'Marines', 'SEA', 'AL', 'West', '#0c2c56', '#00857c', 3, [['Julio Rodrigues', 'CF', 78, 82, 90, 'R'], ['Cal Raliegh', 'C', 66, 94, 40, 'S'], ['Randy Arozaren', 'LF', 70, 78, 82, 'R'], ['Eugenio Suarex', '3B', 62, 84, 32, 'R']]),
  T('tex', 'Texas', 'Ranchers', 'TEX', 'AL', 'West', '#003278', '#c0111f', 3, [['Corey Seeger', 'SS', 86, 88, 50, 'L'], ['Marcus Semian', '2B', 74, 74, 70, 'R'], ['Wyatt Langfield', 'LF', 72, 76, 78, 'L']]),
  // ---- National League East
  T('atl', 'Atlanta', 'Bravos', 'ATL', 'NL', 'East', '#13274f', '#ce1141', 3, [['Ronaldo Acunya Jr.', 'RF', 86, 90, 96, 'R'], ['Matt Olsen', '1B', 76, 90, 42, 'L'], ['Ozzie Albeez', '2B', 78, 70, 78, 'S'], ['Austin Reilly', '3B', 74, 86, 40, 'R']]),
  T('mia', 'Miami', 'Merlins', 'MIA', 'NL', 'East', '#00a3e0', '#111111', 2, [['Kyle Stowes', 'RF', 66, 80, 74, 'L'], ['Xavier Edwardes', '2B', 80, 36, 80, 'S'], ['Otto Lopes', 'SS', 62, 56, 82, 'R']]),
  T('nym', 'New York', 'Nets', 'NYM', 'NL', 'East', '#002d72', '#ff5910', 4, [['Juan Sotto', 'LF', 92, 90, 58, 'L'], ['Francisco Lindar', 'SS', 80, 82, 74, 'S'], ['Pete Alonzo', '1B', 70, 92, 32, 'R'], ['Brandon Nimmow', 'RF', 78, 64, 60, 'L']]),
  T('phi', 'Philadelphia', 'Fillies', 'PHI', 'NL', 'East', '#e81828', '#002d72', 4, [['Bryce Harpur', '1B', 84, 90, 62, 'L'], ['Kyle Schwarbur', 'DH', 70, 94, 40, 'L'], ['Trea Turnor', 'SS', 82, 74, 94, 'R'], ['Alec Boehm', '3B', 78, 66, 42, 'R']]),
  T('wsh', 'Washington', 'Naturals', 'WSH', 'NL', 'East', '#ab0003', '#14225a', 1, [['James Woods', 'RF', 72, 80, 76, 'L'], ['CJ Abrahms', 'SS', 70, 68, 90, 'L'], ['Dylan Crewes', 'CF', 66, 66, 84, 'R']]),
  // ---- National League Central
  T('chc', 'Chicago', 'Cubbies', 'CHC', 'NL', 'Central', '#0e3386', '#cc3433', 4, [['Kyle Tuckor', 'RF', 84, 86, 72, 'L'], ['Seiya Suzuka', 'LF', 80, 76, 56, 'R'], ['Pete Crow-Armstrang', 'CF', 66, 74, 92, 'L'], ['Ian Hapt', '2B', 72, 70, 50, 'S']]),
  T('cin', 'Cincinnati', 'Redds', 'CIN', 'NL', 'Central', '#c6011f', '#111111', 3, [['Elly De La Cruze', 'SS', 68, 84, 98, 'S'], ['Spencer Steere', '1B', 74, 72, 66, 'R'], ['TJ Friedel', 'CF', 76, 54, 80, 'L']]),
  T('mil', 'Milwaukee', 'Brewmen', 'MIL', 'NL', 'Central', '#12284b', '#ffc52f', 4, [['William Contrares', 'C', 80, 76, 44, 'R'], ['Christian Yelick', 'LF', 80, 74, 60, 'L'], ['Jackson Chorio', 'CF', 74, 76, 84, 'R']]),
  T('pit', 'Pittsburgh', 'Pyrates', 'PIT', 'NL', 'Central', '#27251f', '#fdb827', 1, [['Oneil Cruze', 'SS', 64, 88, 82, 'L'], ['Bryan Reynold', 'LF', 78, 74, 56, 'S'], ['Nick Gonzaless', '2B', 66, 54, 66, 'R']]),
  T('stl', 'St. Louis', 'Redbirds', 'STL', 'NL', 'Central', '#c41e3a', '#0c2340', 2, [['Nolan Arenada', '3B', 78, 76, 40, 'R'], ['Willson Contrera', 'C', 74, 76, 44, 'R'], ['Masyn Wynn', 'SS', 72, 60, 80, 'R'], ['Brendan Donovin', '2B', 78, 58, 62, 'L']]),
  // ---- National League West
  T('ari', 'Arizona', 'Diamondbackers', 'ARI', 'NL', 'West', '#a71930', '#30ced8', 3, [['Corbin Caroll', 'CF', 76, 74, 94, 'L'], ['Ketel Martay', '2B', 84, 80, 50, 'S'], ['Gerardo Perdomo', 'SS', 78, 56, 70, 'S']]),
  T('col', 'Colorado', 'Rockers', 'COL', 'NL', 'West', '#33006f', '#c4ced4', 1, [['Ezequiel Tovarr', 'SS', 68, 66, 78, 'R'], ['Brenton Doyal', 'CF', 62, 76, 88, 'R'], ['Hunter Goodmann', 'C', 64, 76, 40, 'R']]),
  T('lad', 'Los Angeles', 'Dodgems', 'LAD', 'NL', 'West', '#005a9c', '#c4ced4', 5, [['Shohei Otani', 'DH', 90, 96, 80, 'L'], ['Mookie Betz', 'SS', 86, 78, 76, 'R'], ['Freddy Freemon', '1B', 90, 74, 50, 'L'], ['Will Smyth', 'C', 82, 76, 42, 'R'], ['Teoscar Hernandes', 'LF', 70, 84, 58, 'R']]),
  T('sd', 'San Diego', 'Padrinos', 'SD', 'NL', 'West', '#2f241d', '#ffc425', 4, [['Fernando Tatiz Jr.', 'RF', 80, 86, 88, 'R'], ['Manny Machada', '3B', 80, 82, 56, 'R'], ['Jackson Merril', 'LF', 84, 66, 66, 'L'], ['Xander Bogerts', '2B', 78, 60, 56, 'R']]),
  T('sf', 'San Francisco', 'Gyants', 'SF', 'NL', 'West', '#fd5a1e', '#27251f', 3, [['Willy Adamez', 'SS', 74, 80, 70, 'R'], ['Matt Chapmin', '3B', 68, 82, 52, 'R'], ['Heliot Ramoz', 'RF', 70, 74, 74, 'R']]),
];

export const teamById = (id) => MLB_TEAMS.find((t) => t.id === id) || MLB_TEAMS[0];
export const teamName = (t) => `${t.city} ${t.nick}`;
/** A short label for the jersey: the nickname. */
export const jerseyText = (t) => t.nick.toUpperCase().slice(0, 9);

const clamp01 = (v) => Math.max(0, Math.min(1, v));
function hexRgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
const rgbHex = (r, g, b) => '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
export function mix(a, b, t) { const A = hexRgb(a), B = hexRgb(b); return rgbHex(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t); }
export const lum = (h) => { const [r, g, b] = hexRgb(h); return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255; };

/**
 * A team's uniform for the figure builder. Home: the team-colour jersey over white pants. Away: road grey with the team's colours on
 * the cap, trim and socks (so two teams never wear the same colour on the field).
 */
export function uniformFor(t, side = 'home') {
  const light = lum(t.color) > 0.62; // a very light team colour needs dark lettering
  const dark = mix(t.color, '#000000', 0.55);
  if (side === 'away') {
    return { primary: '#9aa3b0', secondary: t.color, trim: t.color2 === '#111111' || lum(t.color2) < 0.12 ? t.color : t.color2, pants: '#aeb5bf', cap: light ? dark : t.color, capBill: light ? dark : t.color, socks: t.color, helmet: light ? dark : t.color, sleeve: '#9aa3b0', gloves: '#f4f4ef', text: t.city.toUpperCase().slice(0, 9) };
  }
  return { primary: t.color, secondary: lum(t.color) > 0.5 ? '#14181f' : '#f4f4ef', trim: lum(t.color2) < 0.1 ? '#f4f4ef' : t.color2, pants: '#f1efe6', cap: dark, capBill: t.color, socks: t.color2 && lum(t.color2) > 0.15 ? t.color2 : t.color, helmet: dark, sleeve: t.color, gloves: '#f4f4ef', text: jerseyText(t) };
}

// ---------------------------------------------------------------------------------------------------------------
// The league: you and eight others
// ---------------------------------------------------------------------------------------------------------------
const DIVS = ['East', 'Central', 'West'];
/**
 * Your team plus eight opponents: the four teams in your division and the four in another division of your league (which one
 * depends on the seed, so a new season can bring a new neighbour).
 */
export function leagueFor(teamId, seed = 1) {
  const me = teamById(teamId);
  const mine = MLB_TEAMS.filter((t) => t.league === me.league && t.division === me.division && t.id !== me.id);
  const others = DIVS.filter((d) => d !== me.division);
  const pick = others[(seed >>> 0) % others.length];
  const guests = MLB_TEAMS.filter((t) => t.league === me.league && t.division === pick);
  guests.splice(Math.floor((seed >>> 0) / 3) % guests.length, 1); // (five teams live there: one sits this season out)
  return [me, ...mine, ...guests];
}

// ---------------------------------------------------------------------------------------------------------------
// Players
// ---------------------------------------------------------------------------------------------------------------
export const FIRST_NAMES = ['Jake', 'Marcus', 'Danny', 'Tyler', 'Carlos', 'Ryan', 'Alex', 'Luis', 'Kevin', 'Brandon', 'Sam', 'Eric', 'Nate', 'Paul', 'Gabe', 'Hector', 'Will', 'Felix', 'Omar', 'Dustin', 'Mateo', 'Trevor', 'Andre', 'Cody'];
export const LAST_NAMES = ['Alvarez', 'Bennett', 'Castillo', 'Dawson', 'Ellis', 'Fontaine', 'Grayson', 'Hollis', 'Ishikawa', 'Jimenez', 'Kowalski', 'Lindgren', 'Marlow', 'Nakamura', 'Okafor', 'Pruitt', 'Quinn', 'Rourke', 'Santos', 'Tanaka', 'Underhill', 'Vasquez', 'Whitaker', 'Yoder', 'Zielinski', 'Brennan', 'Delgado', 'Faulkner', 'Haddad', 'Iverson', 'Mercer', 'Novak', 'Ortega', 'Petrov', 'Reyes', 'Sutton', 'Thibodeaux', 'Voss', 'Walsh', 'Abbott'];

/** "Aaron Judd" -> "A. Judd" (for tight places). */
export const shortName = (name) => { const [f, ...r] = name.split(' '); return r.length ? `${f[0]}. ${r.join(' ')}` : name; };

/** A star as a player object (the shape the roster uses). */
export function starPlayer(team, row, k, rng) {
  const [name, pos, con, pow, spd, bats] = row;
  const [fn, ...rest] = name.split(' ');
  void fn;
  return {
    id: `${team.id}-${k}`, name, short: shortName(name), last: rest.join(' '), team: team.abbr, teamId: team.id, star: true,
    number: [24, 7, 12, 27, 99, 2, 44, 19, 3, 8][(k * 3 + team.abbr.charCodeAt(0)) % 10],
    pos, hand: bats === 'L' ? 'L' : 'R', switch: bats === 'S',
    skin: SKINS[(team.abbr.charCodeAt(0) + k * 3 + team.abbr.charCodeAt(1)) % SKINS.length],
    scale: +(0.97 + rng.range(0, 0.06)).toFixed(3), build: +(0.97 + rng.range(0, 0.1)).toFixed(3),
    con, pow, spd,
  };
}
export const starsOf = (t) => t.stars.map((row, k) => starPlayer(t, row, k, createRng(t.id.charCodeAt(0) * 131 + k * 17 + t.id.charCodeAt(t.id.length - 1))));
export const allStars = () => MLB_TEAMS.flatMap((t) => starsOf(t));

/** A team's nine batters for the game (your opponent's lineup): its stars and some journeymen, in a shuffled order. */
export function teamLineup(t, seed, prefix = 'o') {
  const rng = createRng((seed ^ 0x51ed270b) >>> 0);
  const used = new Set();
  const out = [];
  const add = (p) => { used.add(p.name); out.push({ name: p.name, short: p.short || shortName(p.name), number: p.number, skin: p.skin, scale: p.scale, build: p.build, hand: p.hand, id: prefix + out.length }); };
  for (const p of starsOf(t)) add(p);
  while (out.length < 9) {
    let name;
    do { name = rng.pick(FIRST_NAMES) + ' ' + rng.pick(LAST_NAMES); } while (used.has(name));
    add({ name, number: rng.int(1, 99), skin: rng.pick(SKINS), scale: +rng.range(0.95, 1.05).toFixed(3), build: +rng.range(0.94, 1.1).toFixed(3), hand: rng.chance(0.3) ? 'L' : 'R' });
  }
  for (let i = out.length - 1; i > 0; i--) { const j = rng.int(0, i); [out[i], out[j]] = [out[j], out[i]]; }
  out.forEach((p, i) => { p.id = prefix + i; });
  return out;
}
