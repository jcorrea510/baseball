// The League's teams and stars: the thirty big-league clubs with their real names, cities and colours, and their best hitters
// with their real names and last season's numbers (batting average, home runs, stolen bases) - their Contact / Power / Speed
// ratings are worked out from those numbers (see ratingsFromStats). The game is for the owner's personal use only (see Credits).
// Pure data and small helpers (no graphics, no DOM).
import { CONFIG } from '../config.js';
import { createRng } from '../util/rng.js';
import { SKINS } from './teams.js';

// strength tiers: 1 (rebuilding) .. 5 (the team to beat). A team's CPU strength rating comes from it (see config.season.tierRating).
// stars: [name, position, batting average, home runs, stolen bases, bats] - last season's numbers
const T = (id, city, nick, abbr, league, division, color, color2, tier, stars) => ({ id, city, nick, abbr, league, division, color, color2, tier, stars });

export const MLB_TEAMS = [
  // ---- American League East
  T('bal', 'Baltimore', 'Orioles', 'BAL', 'AL', 'East', '#df4601', '#111111', 2, [['Gunnar Henderson', 'SS', 0.274, 17, 30, 'L'], ['Jackson Holliday', '2B', 0.242, 17, 17, 'L'], ['Adley Rutschman', 'C', 0.220, 9, 0, 'S'], ['Jordan Westburg', '3B', 0.265, 17, 2, 'R']]),
  T('bos', 'Boston', 'Red Sox', 'BOS', 'AL', 'East', '#bd3039', '#0c2340', 3, [['Jarren Duran', 'LF', 0.256, 16, 24, 'L'], ['Trevor Story', 'SS', 0.263, 25, 31, 'R'], ['Roman Anthony', 'RF', 0.292, 8, 4, 'L'], ['Wilyer Abreu', 'CF', 0.247, 22, 6, 'L']]),
  T('nyy', 'New York', 'Yankees', 'NYY', 'AL', 'East', '#0c2340', '#c4ced3', 4, [['Aaron Judge', 'RF', 0.331, 53, 12, 'R'], ['Cody Bellinger', 'LF', 0.272, 29, 13, 'L'], ['Trent Grisham', 'CF', 0.235, 34, 4, 'L'], ['Giancarlo Stanton', 'DH', 0.273, 24, 0, 'R'], ['Ben Rice', '1B', 0.255, 26, 3, 'L']]),
  T('tb', 'Tampa Bay', 'Rays', 'TB', 'AL', 'East', '#092c5c', '#8fbce6', 2, [['Junior Caminero', '3B', 0.264, 45, 7, 'R'], ['Yandy Díaz', '1B', 0.300, 25, 3, 'R'], ['Jonathan Aranda', '2B', 0.316, 14, 0, 'L'], ['Chandler Simpson', 'CF', 0.295, 0, 44, 'R']]),
  T('tor', 'Toronto', 'Blue Jays', 'TOR', 'AL', 'East', '#134a8e', '#e8291c', 4, [['Vladimir Guerrero Jr.', '1B', 0.292, 23, 6, 'R'], ['Bo Bichette', 'SS', 0.311, 18, 4, 'R'], ['George Springer', 'DH', 0.309, 32, 18, 'R'], ['Daulton Varsho', 'CF', 0.238, 20, 3, 'L'], ['Ernie Clement', '3B', 0.277, 9, 6, 'R']]),
  // ---- American League Central
  T('cws', 'Chicago', 'White Sox', 'CWS', 'AL', 'Central', '#27251f', '#c4ced4', 1, [['Luis Robert Jr.', 'CF', 0.223, 14, 33, 'R'], ['Colson Montgomery', 'SS', 0.239, 21, 1, 'L'], ['Andrew Benintendi', 'LF', 0.240, 20, 1, 'L'], ['Kyle Teel', 'C', 0.271, 8, 3, 'L']]),
  T('cle', 'Cleveland', 'Guardians', 'CLE', 'AL', 'Central', '#00385d', '#e50022', 3, [['José Ramírez', '3B', 0.283, 30, 44, 'S'], ['Steven Kwan', 'LF', 0.272, 11, 21, 'L'], ['Kyle Manzardo', '1B', 0.234, 27, 0, 'L']]),
  T('det', 'Detroit', 'Tigers', 'DET', 'AL', 'Central', '#0c2340', '#fa4616', 4, [['Riley Greene', 'LF', 0.258, 36, 2, 'L'], ['Spencer Torkelson', '1B', 0.240, 31, 1, 'R'], ['Kerry Carpenter', 'RF', 0.252, 26, 0, 'L'], ['Gleyber Torres', '2B', 0.256, 16, 4, 'R']]),
  T('kc', 'Kansas City', 'Royals', 'KC', 'AL', 'Central', '#004687', '#bd9b60', 3, [['Bobby Witt Jr.', 'SS', 0.295, 23, 38, 'R'], ['Vinnie Pasquantino', '1B', 0.264, 32, 0, 'L'], ['Maikel Garcia', '3B', 0.286, 16, 23, 'R'], ['Salvador Perez', 'C', 0.236, 30, 0, 'R']]),
  T('min', 'Minnesota', 'Twins', 'MIN', 'AL', 'Central', '#002b5c', '#d31145', 2, [['Byron Buxton', 'CF', 0.264, 35, 24, 'R'], ['Royce Lewis', '3B', 0.237, 13, 12, 'R'], ['Trevor Larnach', 'RF', 0.250, 17, 1, 'L']]),
  // ---- American League West
  T('hou', 'Houston', 'Astros', 'HOU', 'AL', 'West', '#002d62', '#eb6e1f', 3, [['Jeremy Peña', 'SS', 0.304, 17, 20, 'R'], ['Jose Altuve', '2B', 0.265, 26, 10, 'R'], ['Yordan Alvarez', 'DH', 0.273, 6, 1, 'L'], ['Carlos Correa', '3B', 0.276, 13, 0, 'R']]),
  T('laa', 'Los Angeles', 'Angels', 'LAA', 'AL', 'West', '#ba0021', '#003263', 2, [['Mike Trout', 'DH', 0.232, 26, 2, 'R'], ['Zach Neto', 'SS', 0.257, 26, 26, 'R'], ['Jo Adell', 'RF', 0.236, 37, 5, 'R'], ['Taylor Ward', 'LF', 0.228, 36, 3, 'R']]),
  T('ath', 'Sacramento', 'Athletics', 'ATH', 'AL', 'West', '#003831', '#efb21e', 2, [['Nick Kurtz', '1B', 0.290, 36, 2, 'L'], ['Brent Rooker', 'DH', 0.262, 30, 6, 'R'], ['Shea Langeliers', 'C', 0.277, 31, 1, 'R'], ['Jacob Wilson', 'SS', 0.311, 13, 4, 'R'], ['Lawrence Butler', 'RF', 0.234, 21, 23, 'L']]),
  T('sea', 'Seattle', 'Mariners', 'SEA', 'AL', 'West', '#0c2c56', '#00857c', 4, [['Cal Raleigh', 'C', 0.247, 60, 14, 'S'], ['Julio Rodríguez', 'CF', 0.267, 32, 30, 'R'], ['Eugenio Suárez', '3B', 0.228, 49, 3, 'R'], ['Josh Naylor', '1B', 0.295, 20, 30, 'L'], ['Randy Arozarena', 'LF', 0.238, 27, 31, 'R']]),
  T('tex', 'Texas', 'Rangers', 'TEX', 'AL', 'West', '#003278', '#c0111f', 3, [['Corey Seager', 'SS', 0.271, 21, 3, 'L'], ['Wyatt Langford', 'LF', 0.241, 22, 22, 'R'], ['Josh Jung', '3B', 0.251, 14, 4, 'R'], ['Marcus Semien', '2B', 0.230, 15, 11, 'R']]),
  // ---- National League East
  T('atl', 'Atlanta', 'Braves', 'ATL', 'NL', 'East', '#13274f', '#ce1141', 2, [['Ronald Acuña Jr.', 'RF', 0.290, 21, 9, 'R'], ['Matt Olson', '1B', 0.272, 29, 0, 'L'], ['Drake Baldwin', 'C', 0.274, 19, 0, 'L'], ['Michael Harris II', 'CF', 0.249, 20, 20, 'L'], ['Ozzie Albies', '2B', 0.240, 16, 14, 'S']]),
  T('mia', 'Miami', 'Marlins', 'MIA', 'NL', 'East', '#00a3e0', '#111111', 2, [['Kyle Stowers', 'LF', 0.288, 25, 6, 'L'], ['Xavier Edwards', 'SS', 0.283, 3, 27, 'S'], ['Agustín Ramírez', 'C', 0.231, 21, 16, 'R'], ['Otto Lopez', '2B', 0.246, 15, 16, 'R']]),
  T('nym', 'New York', 'Mets', 'NYM', 'NL', 'East', '#002d72', '#ff5910', 3, [['Juan Soto', 'RF', 0.263, 43, 38, 'L'], ['Francisco Lindor', 'SS', 0.267, 31, 31, 'S'], ['Pete Alonso', '1B', 0.272, 38, 1, 'R'], ['Brandon Nimmo', 'LF', 0.262, 25, 13, 'L']]),
  T('phi', 'Philadelphia', 'Phillies', 'PHI', 'NL', 'East', '#e81828', '#002d72', 4, [['Kyle Schwarber', 'DH', 0.240, 56, 10, 'L'], ['Trea Turner', 'SS', 0.304, 15, 36, 'R'], ['Bryce Harper', '1B', 0.261, 27, 12, 'L'], ['Alec Bohm', '3B', 0.287, 11, 6, 'R'], ['J.T. Realmuto', 'C', 0.257, 12, 7, 'R']]),
  T('wsh', 'Washington', 'Nationals', 'WSH', 'NL', 'East', '#ab0003', '#14225a', 1, [['James Wood', 'LF', 0.256, 31, 15, 'L'], ['CJ Abrams', 'SS', 0.257, 19, 31, 'L'], ['Dylan Crews', 'RF', 0.214, 10, 17, 'R']]),
  // ---- National League Central
  T('chc', 'Chicago', 'Cubs', 'CHC', 'NL', 'Central', '#0e3386', '#cc3433', 4, [['Kyle Tucker', 'RF', 0.266, 22, 25, 'L'], ['Pete Crow-Armstrong', 'CF', 0.247, 31, 35, 'L'], ['Seiya Suzuki', 'DH', 0.245, 32, 5, 'R'], ['Michael Busch', '1B', 0.261, 34, 4, 'L'], ['Nico Hoerner', '2B', 0.297, 7, 29, 'R']]),
  T('cin', 'Cincinnati', 'Reds', 'CIN', 'NL', 'Central', '#c6011f', '#111111', 3, [['Elly De La Cruz', 'SS', 0.264, 22, 37, 'S'], ['Spencer Steer', '1B', 0.238, 21, 6, 'R'], ['TJ Friedl', 'CF', 0.261, 14, 12, 'L']]),
  T('mil', 'Milwaukee', 'Brewers', 'MIL', 'NL', 'Central', '#12284b', '#ffc52f', 4, [['Christian Yelich', 'LF', 0.264, 29, 16, 'L'], ['Jackson Chourio', 'CF', 0.270, 21, 21, 'R'], ['Brice Turang', '2B', 0.288, 18, 24, 'L'], ['William Contreras', 'C', 0.260, 17, 6, 'R']]),
  T('pit', 'Pittsburgh', 'Pirates', 'PIT', 'NL', 'Central', '#27251f', '#fdb827', 1, [['Oneil Cruz', 'CF', 0.200, 20, 38, 'L'], ['Bryan Reynolds', 'RF', 0.245, 16, 5, 'S'], ['Andrew McCutchen', 'DH', 0.239, 13, 5, 'R']]),
  T('stl', 'St. Louis', 'Cardinals', 'STL', 'NL', 'Central', '#c41e3a', '#0c2340', 2, [['Alec Burleson', 'RF', 0.290, 18, 5, 'L'], ['Iván Herrera', 'C', 0.284, 19, 8, 'R'], ['Willson Contreras', '1B', 0.257, 20, 3, 'R'], ['Masyn Wynn', 'SS', 0.253, 9, 6, 'R']]),
  // ---- National League West
  T('ari', 'Arizona', 'Diamondbacks', 'ARI', 'NL', 'West', '#a71930', '#30ced8', 3, [['Corbin Carroll', 'RF', 0.259, 31, 32, 'L'], ['Ketel Marte', '2B', 0.283, 28, 4, 'S'], ['Geraldo Perdomo', 'SS', 0.290, 20, 27, 'S'], ['Gabriel Moreno', 'C', 0.285, 9, 2, 'R']]),
  T('col', 'Colorado', 'Rockies', 'COL', 'NL', 'West', '#33006f', '#c4ced4', 1, [['Hunter Goodman', 'C', 0.278, 31, 1, 'R'], ['Jordan Beck', 'LF', 0.258, 16, 19, 'R'], ['Brenton Doyle', 'CF', 0.233, 15, 18, 'R'], ['Ezequiel Tovar', 'SS', 0.253, 6, 3, 'R']]),
  T('lad', 'Los Angeles', 'Dodgers', 'LAD', 'NL', 'West', '#005a9c', '#c4ced4', 5, [['Shohei Ohtani', 'DH', 0.282, 55, 20, 'L'], ['Freddie Freeman', '1B', 0.295, 24, 6, 'L'], ['Will Smith', 'C', 0.296, 17, 0, 'R'], ['Mookie Betts', 'SS', 0.258, 20, 8, 'R'], ['Teoscar Hernández', 'RF', 0.247, 25, 3, 'R']]),
  T('sd', 'San Diego', 'Padres', 'SD', 'NL', 'West', '#2f241d', '#ffc425', 4, [['Fernando Tatis Jr.', 'RF', 0.268, 25, 32, 'R'], ['Manny Machado', '3B', 0.275, 27, 14, 'R'], ['Jackson Merrill', 'CF', 0.264, 16, 1, 'L'], ['Xander Bogaerts', 'SS', 0.263, 11, 20, 'R']]),
  T('sf', 'San Francisco', 'Giants', 'SF', 'NL', 'West', '#fd5a1e', '#27251f', 3, [['Rafael Devers', '1B', 0.252, 35, 1, 'L'], ['Willy Adames', 'SS', 0.225, 30, 12, 'R'], ['Heliot Ramos', 'LF', 0.256, 21, 7, 'R'], ['Matt Chapman', '3B', 0.231, 21, 6, 'R']]),
];

/** Contact / Power / Speed (1-99) from a season's batting average, home runs and stolen bases (config.season.realStats). */
export function ratingsFromStats(avg, hr, sb, cfg = CONFIG) {
  const R = cfg.season.realStats;
  const c = (v) => Math.max(R.min, Math.min(R.max, Math.round(v)));
  return { con: c(R.conBase + (avg - R.conAvg) * R.conPerPoint * 1000), pow: c(R.powBase + hr * R.powPerHr), spd: c(R.spdBase + sb * R.spdPerSb) };
}

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

/** "Aaron Judge" -> "A. Judge" (for tight places). */
export const shortName = (name) => { const [f, ...r] = name.split(' '); return r.length ? `${f[0]}. ${r.join(' ')}` : name; };

/** A star as a player object (the shape the roster uses). */
export function starPlayer(team, row, k, rng) {
  const [name, pos, avg, hr, sb, bats] = row;
  const { con, pow, spd } = ratingsFromStats(avg, hr, sb);
  const [fn, ...rest] = name.split(' ');
  void fn;
  return {
    id: `${team.id}-${k}`, name, short: shortName(name), last: rest.join(' '), team: team.abbr, teamId: team.id, star: true,
    number: [24, 7, 12, 27, 99, 2, 44, 19, 3, 8][(k * 3 + team.abbr.charCodeAt(0)) % 10],
    pos, hand: bats === 'L' ? 'L' : 'R', switch: bats === 'S',
    skin: SKINS[(team.abbr.charCodeAt(0) + k * 3 + team.abbr.charCodeAt(1)) % SKINS.length],
    scale: +(0.97 + rng.range(0, 0.06)).toFixed(3), build: +(0.97 + rng.range(0, 0.1)).toFixed(3),
    con, pow, spd, real: { avg, hr, sb }, // (last season's real numbers)
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
