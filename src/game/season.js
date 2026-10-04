// Season mode: a league of nine teams, a schedule that goes from the weakest opponent to the strongest, standings (the other
// games are simulated), playoffs and a World Series, coins for results, a roster of rated players and a shop to buy better ones.
// Pure logic on a plain object (it is saved as JSON in the player's save): no graphics, no DOM, easy to test.
import { CONFIG } from '../config.js';
import { createRng } from '../util/rng.js';
import { clamp } from '../util/math.js';
import { SKINS } from './teams.js';
import { FIRST_NAMES, LAST_NAMES, MLB_TEAMS, teamById, teamName, leagueFor, starsOf, allStars, armsOf, allArms, uniformFor, teamLineup, shortName } from './mlb.js';

export const POSITIONS9 = ['CF', 'SS', '1B', 'LF', 'RF', '3B', 'C', '2B', 'DH'];

// ---------------------------------------------------------------------------------------------------------------
// Players
// ---------------------------------------------------------------------------------------------------------------
/** Overall rating: for a hitter contact and power count most, speed a little; for a pitcher (`p.role`) see season.pitcherOverall. */
export const overall = (p) => {
  if (p.role) { const W = CONFIG.season.pitcherOverall; return Math.round(W.vel * p.vel + W.ctl * p.ctl + W.stf * p.stf + W.sta * p.sta); }
  return Math.round(0.4 * p.con + 0.4 * p.pow + 0.2 * p.spd);
};

/** What a player costs in the shop (and 30% of it back if you let him go). */
export function price(p, cfg = CONFIG) {
  const P = cfg.season.price;
  const raw = P.base + P.scale * Math.pow(Math.max(0, overall(p) - P.over), P.power);
  return Math.max(P.round, Math.round(raw / P.round) * P.round);
}

function rating(rng, mean, sd, lo = 20, hi = 99) { return clamp(Math.round(rng.gauss(mean, sd)), lo, hi); }

/** A new player around `mean` overall. `s.nextId` numbers them. */
export function makePlayer(s, rng, mean, cfg = CONFIG, o = {}) {
  const sd = o.sd ?? cfg.season.ratingSd;
  const used = new Set((s.roster || []).concat(s.shop || []).map((p) => p.name));
  let name;
  do { name = rng.pick(FIRST_NAMES) + ' ' + rng.pick(LAST_NAMES); } while (used.has(name));
  // a player has a style: a slugger, a contact man, a speedster or an all-rounder
  const style = rng.weighted({ slug: 0.3, contact: 0.3, speed: 0.15, all: 0.25 });
  const tilt = { slug: [-4, 7, -6], contact: [7, -5, 1], speed: [2, -8, 12], all: [0, 0, 0] }[style];
  const p = {
    id: 'p' + (s.nextId = (s.nextId || 0) + 1),
    name,
    short: shortName(name),
    number: rng.int(1, 99),
    pos: o.pos || rng.pick(POSITIONS9),
    hand: rng.chance(0.3) ? 'L' : 'R',
    skin: rng.pick(SKINS),
    scale: +rng.range(0.95, 1.05).toFixed(3),
    build: +rng.range(0.94, 1.1).toFixed(3),
    con: rating(rng, mean + tilt[0], sd),
    pow: rating(rng, mean + tilt[1], sd),
    spd: rating(rng, mean + tilt[2], sd),
  };
  return p;
}

/** A journeyman pitcher around mean overall: a starter (long tank) or a reliever (short one), a few pitches. */
export function makeArm(s, rng, mean, cfg = CONFIG) {
  const used = new Set((s.roster || []).concat(s.shop || [], s.staff || []).map((p) => p.name));
  let name;
  do { name = rng.pick(FIRST_NAMES) + ' ' + rng.pick(LAST_NAMES); } while (used.has(name));
  const role = rng.chance(0.5) ? 'SP' : 'RP';
  const P = cfg.pitching.staff;
  const n = role === 'SP' ? P.starterPitches : rng.int(P.relieverPitches[0], P.relieverPitches[1]);
  const others = P.pool.filter((t) => t !== 'fastball');
  const pitches = ['fastball'];
  while (pitches.length < Math.min(n, P.pool.length)) pitches.push(others.splice(rng.int(0, others.length - 1), 1)[0]);
  const sd = 5;
  return {
    id: 'p' + (s.nextId = (s.nextId || 0) + 1), name, short: shortName(name), team: '', star: false, role,
    hand: rng.chance(cfg.season.realArms.filler.left) ? 'L' : 'R', number: rng.int(10, 70), skin: rng.pick(SKINS),
    scale: +rng.range(1.0, 1.07).toFixed(3), build: +rng.range(0.98, 1.06).toFixed(3),
    vel: rating(rng, mean, sd), ctl: rating(rng, mean, sd), stf: rating(rng, mean, sd),
    sta: rating(rng, role === 'SP' ? mean : mean - cfg.season.shop.relieverStaminaGap, sd), pitches,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// A new season
// ---------------------------------------------------------------------------------------------------------------
/**
 * @param {object} [prev]  last season (its roster, coins and history carry over; the league gets tougher if you did well)
 * @param {object} o       { level: 'rookie'|'pro'|'allstar', length: 'short'|'full', seed }
 */
export function newSeason(prev, o = {}, cfg = CONFIG) {
  const S = cfg.season;
  const seed = o.seed ?? ((Math.random() * 2 ** 31) >>> 0);
  const rng = createRng(seed);
  const teamId = o.team || (prev && prev.teamId) || 'nym';
  const s = {
    v: 2, seed, level: o.level || (prev && prev.level) || 'pro', length: o.length || (prev && prev.length) || 'short', teamId,
    year: prev ? prev.year + 1 : 1,
    boost: prev ? Math.min(S.yearCap, (prev.boost || 0) + nextBoost(prev, cfg)) : 0,
    coins: prev ? prev.coins : S.coins.start,
    nextId: prev ? prev.nextId : 0,
    roster: prev && prev.teamId === teamId ? prev.roster : [],
    history: prev ? prev.history.slice() : [],
    inProgress: null, // a game that was left half-way (saved at every pitch, see Engine.checkpoint)
    stats: {}, games: [], phase: 'regular', round: 0, playoffs: null, champion: null,
    shop: [],
  };
  if (prev) s.history.push(summaryOf(prev));
  const mine = teamById(teamId);
  // your team: its stars at their positions, role players around them and a bench (first season only; after that you keep who you have)
  if (!s.roster.length) s.roster = startingRoster(s, mine, rng, cfg);
  s.pstats = {}; // (a new year, new lines)
  if (prev && prev.teamId === teamId && prev.staff) { s.staff = prev.staff; s.rotation = 0; s.rest = {}; for (const p of s.staff) s.rest[p.id] = 1; }
  ensureStaff(s, cfg);
  // the league: you and eight others (your division and a neighbour), each with a strength from its tier
  const league = leagueFor(teamId, seed);
  s.teams = league.map((t, i) => ({
    id: t.id, name: teamName(t), abbr: t.abbr, color: t.color, color2: t.color2, tier: t.tier,
    rating: i === 0 ? null : clamp(S.tierRating[t.tier] + rng.int(-S.teamJitter, S.teamJitter) + s.boost, 15, 95),
    w: 0, l: 0, rs: 0, ra: 0, lineupSeed: rng.int(1, 1e9),
  }));
  s.schedule = makeSchedule(s, cfg);
  s.others = makeOthers(s, rng, cfg);
  refillShop(s, rng, S.shop.size, cfg);
  return s;
}

// The other twenty-one clubs (outside your playoff race): they play their own games every day you do, so the standings show all
// thirty teams and all six divisions.
function makeOthers(s, rng, cfg) {
  const S = cfg.season;
  const inLeague = new Set(s.teams.map((t) => t.id));
  return MLB_TEAMS.filter((t) => !inLeague.has(t.id)).map((t) => ({
    id: t.id, name: teamName(t), abbr: t.abbr, color: t.color, color2: t.color2, tier: t.tier,
    rating: clamp(S.tierRating[t.tier] + rng.int(-S.teamJitter, S.teamJitter) + s.boost, 15, 95), w: 0, l: 0, rs: 0, ra: 0,
  }));
}
// One day for the other clubs: they pair off at random (one has the day off) and play.
function othersDay(s, rng, cfg) {
  const o = s.others;
  if (!o || !o.length) return;
  const idx = shuffle(rng, o.map((t, i) => i));
  const pseudo = { teams: o };
  for (let k = 0; k + 1 < idx.length; k += 2) apply(pseudo, simGame(pseudo, idx[k], idx[k + 1], rng, cfg));
}

/** Every club's record, by league and division: { AL: { East: [...], ... }, NL: {...} }, best first; `mine` marks your team. */
export function divisionTables(s) {
  const all = [...s.teams.map((t, i) => ({ ...t, mine: i === 0 })), ...(s.others || [])];
  const out = { AL: {}, NL: {} };
  const pct = (t) => (t.w + t.l ? t.w / (t.w + t.l) : 0);
  for (const t of all) {
    const m = teamById(t.id);
    ((out[m.league] ||= {})[m.division] ||= []).push(t);
  }
  for (const lg of Object.keys(out)) for (const dv of Object.keys(out[lg])) {
    const rows = out[lg][dv].sort((a, b) => pct(b) - pct(a) || (b.rs - b.ra) - (a.rs - a.ra));
    const lead = rows[0];
    out[lg][dv] = rows.map((t) => ({ team: t, gb: ((lead.w - t.w) + (t.l - lead.l)) / 2 }));
  }
  return out;
}

/**
 * A season saved before the clubs and stars got their real names: the names (and the stars' ratings, from their real numbers) are
 * brought up to date. Safe to call on any season; returns it.
 */
export function freshen(s) {
  if (!s || !Array.isArray(s.teams)) return s;
  for (const t of s.teams) { const m = teamById(t.id); if (m && m.id === t.id) t.name = teamName(m); }
  if (!s.others) {
    // (a league from before all thirty clubs were in the standings: the others catch up on the days already played)
    const rng = createRng((s.seed ^ 0x6f7468) >>> 0);
    s.others = makeOthers(s, rng, CONFIG);
    for (let d = 0; d < (s.round || 0); d++) othersDay(s, rng, CONFIG);
  }
  for (const t of s.others) { const m = teamById(t.id); if (m && m.id === t.id) t.name = teamName(m); }
  const byId = new Map(allStars().map((p) => [p.id, p]));
  for (const p of [...(s.roster || []), ...(s.shop || [])]) {
    const q = p && p.star ? byId.get(p.id) : null;
    if (!q) continue;
    Object.assign(p, { name: q.name, short: q.short, last: q.last, con: q.con, pow: q.pow, spd: q.spd, real: q.real, hand: q.hand, switch: q.switch });
  }
  return s;
}

/** Your team's tier decides how good the unnamed players around the stars are. */
export const roleMean = (tier, cfg = CONFIG) => cfg.season.starters.base + cfg.season.starters.perRating * cfg.season.tierRating[tier];

function startingRoster(s, team, rng, cfg) {
  const S = cfg.season;
  const stars = starsOf(team).sort((a, b) => overall(b) - overall(a));
  const slots = {};
  const leftovers = [];
  for (const p of stars) { if (!slots[p.pos]) slots[p.pos] = p; else leftovers.push(p); }
  for (const p of leftovers) { const free = ['DH', ...POSITIONS9].find((q) => !slots[q]); if (free) { slots[free] = { ...p, pos: free }; } }
  const mean = roleMean(team.tier, cfg);
  const lineup = POSITIONS9.map((pos) => slots[pos] || makePlayer(s, rng, mean, cfg, { pos }));
  // batting order: the best hitters at the top, the fastest of the first four leads off
  lineup.sort((a, b) => overall(b) - overall(a));
  const lead = lineup.slice(0, 4).reduce((best, p) => (p.spd + p.con > best.spd + best.con ? p : best), lineup[0]);
  lineup.splice(lineup.indexOf(lead), 1); lineup.unshift(lead);
  const bench = [];
  for (let i = 0; i < S.roster.size - S.roster.lineup; i++) bench.push(makePlayer(s, rng, S.bench, cfg));
  return lineup.concat(bench);
}

function shuffle(rng, a) {
  for (let i = a.length - 1; i > 0; i--) { const j = rng.int(0, i); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// How much tougher the league gets after this season: after a title the full step, after a playoff trip half of it.
function nextBoost(prev, cfg) {
  const f = finishOf(prev);
  return f === 'Champions' ? cfg.season.yearStep : f === 'Runner-up' || f === 'Semifinal' ? cfg.season.yearStep / 2 : 0;
}
export function finishOf(s) {
  if (s.champion === 0) return 'Champions';
  const po = s.playoffs;
  if (!po) return s.phase === 'regular' ? 'In progress' : 'Missed playoffs';
  if (po.final && (po.final.a === 0 || po.final.b === 0)) return 'Runner-up';
  if (po.seeds.includes(0)) return 'Semifinal';
  return 'Missed playoffs';
}
function summaryOf(s) {
  const me = s.teams[0];
  return { year: s.year, w: me.w, l: me.l, finish: finishOf(s), level: s.level };
}

/**
 * Round-robin schedule (9 teams: every round one team is off). Rounds are lists of [teamA, teamB] (team indexes; 0 = you).
 * Your opponents come in order from the weakest to the strongest; your off day is in the middle. A full season plays it twice.
 */
export function makeSchedule(s, cfg = CONFIG) {
  const n = s.teams.length; // 9
  const slots = n % 2 ? n + 1 : n; // 10 (one is the "off day")
  const BYE = slots - 1;
  // circle method on slot numbers: slot 0 stays, the others rotate
  const arr = Array.from({ length: slots }, (_, i) => i);
  const rounds = [];
  for (let r = 0; r < slots - 1; r++) {
    const pairs = [];
    for (let i = 0; i < slots / 2; i++) pairs.push([arr[i], arr[slots - 1 - i]]);
    rounds.push(pairs);
    arr.splice(1, 0, arr.pop());
  }
  // who does slot 0 (you) meet in each round? Give those slots to the opponents weakest-first, the off day in the middle.
  const meet = rounds.map((pairs) => pairs.find((p) => p[0] === 0 || p[1] === 0)).map((p) => (p[0] === 0 ? p[1] : p[0]));
  const offRound = Math.floor((slots - 1) / 2);
  const order = s.teams.map((t, i) => i).filter((i) => i !== 0).sort((a, b) => s.teams[a].rating - s.teams[b].rating);
  const teamOfSlot = { 0: 0 };
  // the slot you meet in the off-day round is the bye; swap rounds so that happens in the middle
  const byeRound = meet.indexOf(BYE);
  [rounds[byeRound], rounds[offRound]] = [rounds[offRound], rounds[byeRound]];
  [meet[byeRound], meet[offRound]] = [meet[offRound], meet[byeRound]];
  let k = 0;
  for (let r = 0; r < meet.length; r++) if (meet[r] !== BYE) teamOfSlot[meet[r]] = order[k++];
  const one = rounds.map((pairs) => pairs.filter((p) => p[0] !== BYE && p[1] !== BYE).map(([a, b]) => [teamOfSlot[a], teamOfSlot[b]]));
  const cycles = cfg.season.cycles[s.length] || 1;
  const out = [];
  for (let c = 0; c < cycles; c++) for (const r of one) out.push(r.map((p) => p.slice()));
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Where the season is: the next game you play
// ---------------------------------------------------------------------------------------------------------------
export const myGames = (s) => s.schedule.filter((r) => r.some((p) => p[0] === 0 || p[1] === 0)).length;

/** { kind: 'regular'|'semi'|'final', opp (team index), label, gameNo, of } or null when your season is over. */
export function nextGame(s) {
  if (s.phase === 'regular') {
    // (off days are played through automatically, see advance())
    const r = s.schedule[s.round];
    const mine = r && r.find((p) => p[0] === 0 || p[1] === 0);
    if (!mine) return null;
    const played = s.teams[0].w + s.teams[0].l;
    // (home and away in turn: the first game at home)
    return { kind: 'regular', opp: mine[0] === 0 ? mine[1] : mine[0], label: `Game ${played + 1} of ${myGames(s)}`, gameNo: played + 1, of: myGames(s), home: played % 2 === 0 };
  }
  if (s.phase === 'playoffs') {
    const po = s.playoffs;
    if (po.final) {
      const f = po.final;
      if (f.a !== 0 && f.b !== 0) return null;
      const no = f.wa + f.wb + 1;
      return { kind: 'final', opp: f.a === 0 ? f.b : f.a, label: `World Series · Game ${no}`, gameNo: no, of: f.bestOf, series: [f.a === 0 ? f.wa : f.wb, f.a === 0 ? f.wb : f.wa], home: (no % 2 === 1) === (f.a === 0) };
    }
    const semi = po.semis.find((m) => m.a === 0 || m.b === 0);
    if (!semi || semi.winner !== undefined) return null;
    return { kind: 'semi', opp: semi.a === 0 ? semi.b : semi.a, label: 'Semifinal', gameNo: 1, of: 1, home: semi.a === 0 }; // (the higher seed is at home)
  }
  return null;
}

// Standings: best record first (then run difference, then rating).
export function standings(s) {
  const pct = (t) => (t.w + t.l ? t.w / (t.w + t.l) : 0);
  const idx = s.teams.map((t, i) => i);
  idx.sort((a, b) => pct(s.teams[b]) - pct(s.teams[a]) || (s.teams[b].rs - s.teams[b].ra) - (s.teams[a].rs - s.teams[a].ra) || (s.teams[b].rating ?? 50) - (s.teams[a].rating ?? 50) || a - b);
  const lead = s.teams[idx[0]];
  return idx.map((i, k) => {
    const t = s.teams[i];
    const gb = ((lead.w - t.w) + (t.l - lead.l)) / 2;
    return { i, rank: k + 1, team: t, gb, pct: pct(t) };
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------------------------------------------
// A simulated game between two CPU teams.
function simGame(s, a, b, rng, cfg) {
  const S = cfg.season;
  const ra = s.teams[a].rating ?? teamRating(s), rb = s.teams[b].rating ?? teamRating(s);
  const pa = 1 / (1 + Math.exp(-S.simK * (ra - rb)));
  const aWins = rng.next() < pa;
  // a plausible score for the standings
  const loser = Math.max(0, Math.round(rng.gauss(S.simRuns * 0.72, 1.8)));
  const winner = loser + 1 + Math.max(0, Math.round(Math.abs(rng.gauss(0, 2.4))));
  return aWins ? { a, b, ra: winner, rb: loser } : { a, b, ra: loser, rb: winner };
}
function apply(s, g) {
  const A = s.teams[g.a], B = s.teams[g.b];
  A.rs += g.ra; A.ra += g.rb; B.rs += g.rb; B.ra += g.ra;
  if (g.ra > g.rb) { A.w++; B.l++; } else { B.w++; A.l++; }
}

/** Your team's strength, for the few places that need one (simulated playoff games never involve you, so it is only a tiebreak). */
export function teamRating(s) {
  const lineup = s.roster.slice(0, CONFIG.season.roster.lineup);
  return Math.round(lineup.reduce((sum, p) => sum + overall(p), 0) / Math.max(1, lineup.length));
}

/**
 * Your game is over. result = { won, runsFor, runsAgainst, lines: { playerId: { pa, ab, h, hr, rbi, bb, k, sb } } }.
 * Updates the standings, your players' season stats and coins, simulates the rest of the day, moves the season on.
 * Returns { coins, items: [[label, coins]...], next } for the results screen.
 */
export function recordGame(s, result, cfg = CONFIG) {
  const S = cfg.season;
  const g = nextGame(s);
  if (!g) return { coins: 0, items: [] };
  const rng = createRng((s.seed ^ (s.games.length * 2654435761)) >>> 0);
  // players' season lines
  for (const [id, L] of Object.entries(result.lines || {})) {
    const T = (s.stats[id] ||= { g: 0, pa: 0, ab: 0, h: 0, hr: 0, rbi: 0, bb: 0, k: 0, sb: 0 });
    T.g++;
    for (const k of ['pa', 'ab', 'h', 'hr', 'rbi', 'bb', 'k', 'sb']) T[k] += L[k] || 0;
  }
  // pitchers' season lines, rest and the rotation
  const starter = pickStarter(s, cfg);
  for (const [id, L] of Object.entries(result.pitching || {})) {
    const T = (s.pstats[id] ||= { g: 0, outs: 0, h: 0, r: 0, er: 0, bb: 0, k: 0 });
    T.g++;
    for (const k of ['outs', 'h', 'r', 'er', 'bb', 'k']) T[k] += L[k] || 0;
  }
  for (const p of s.staff) {
    const used = clamp((result.pitching && result.pitching[p.id] && result.pitching[p.id].used) || 0, 0, 1);
    s.rest[p.id] = Math.min(1, Math.max(0, (s.rest[p.id] ?? 1) - used) + (S.restPerGame[p.role] ?? 0));
  }
  const list = startersOf(s, cfg);
  if (starter) s.rotation = (list.findIndex((p) => p.id === starter.id) + 1) % Math.max(1, list.length);
  const items = [];
  const won = !!result.won;
  const margin = Math.abs(result.runsFor - result.runsAgainst);
  if (g.kind === 'regular') {
    apply(s, { a: 0, b: g.opp, ra: result.runsFor, rb: result.runsAgainst });
    s.games.push({ kind: 'regular', opp: g.opp, rf: result.runsFor, ra: result.runsAgainst, won });
    if (won) { items.push(['Win', S.coins.win]); if (margin > 1) items.push(['Margin', Math.min(S.coins.marginCap, S.coins.marginBonus * margin)]); }
    else items.push(['Game played', S.coins.loss]);
    // the rest of today's games
    for (const [a, b] of s.schedule[s.round]) if (a !== 0 && b !== 0) apply(s, simGame(s, a, b, rng, cfg));
    othersDay(s, rng, cfg);
    s.round++;
    advance(s, rng, cfg);
  } else {
    s.games.push({ kind: g.kind, opp: g.opp, rf: result.runsFor, ra: result.runsAgainst, won });
    items.push(won ? ['Playoff win', S.coins.playoffWin] : ['Playoff game', S.coins.playoffLoss]);
    const po = s.playoffs;
    if (g.kind === 'semi') {
      const m = po.semis.find((x) => x.a === 0 || x.b === 0);
      m.winner = won ? 0 : g.opp;
      finishSemis(s, rng, cfg);
    } else {
      const f = po.final;
      if (won === (f.a === 0)) f.wa++; else f.wb++;
      settleFinal(s, rng, cfg);
      if (s.champion === 0) items.push(['Champions', S.coins.title]);
    }
  }
  const coins = items.reduce((t, [, c]) => t + c, 0);
  s.coins += coins;
  // two new faces in the shop after every game
  refreshShop(s, rng, cfg);
  return { coins, items, next: nextGame(s) };
}

// Play through off days; start the playoffs when the regular season is over.
function advance(s, rng, cfg) {
  while (s.phase === 'regular' && s.round < s.schedule.length && !s.schedule[s.round].some((p) => p[0] === 0 || p[1] === 0)) {
    for (const [a, b] of s.schedule[s.round]) apply(s, simGame(s, a, b, rng, cfg));
    othersDay(s, rng, cfg);
    s.round++;
  }
  if (s.phase === 'regular' && s.round >= s.schedule.length) startPlayoffs(s, rng, cfg);
}

function startPlayoffs(s, rng, cfg) {
  const top = standings(s).slice(0, cfg.season.playoffTeams).map((x) => x.i);
  s.phase = 'playoffs';
  s.playoffs = { seeds: top, semis: [{ a: top[0], b: top[3] }, { a: top[1], b: top[2] }], final: null };
  finishSemis(s, rng, cfg);
}
// Semifinals that do not involve you are simulated; when both are decided the World Series is set.
function finishSemis(s, rng, cfg) {
  const po = s.playoffs;
  for (const m of po.semis) {
    if (m.winner !== undefined || m.a === 0 || m.b === 0) continue;
    const g = simGame(s, m.a, m.b, rng, cfg);
    m.winner = g.ra > g.rb ? m.a : m.b;
  }
  if (po.semis.every((m) => m.winner !== undefined) && !po.final) {
    po.final = { a: po.semis[0].winner, b: po.semis[1].winner, wa: 0, wb: 0, bestOf: cfg.season.finalGames };
    settleFinal(s, rng, cfg);
  }
}
function settleFinal(s, rng, cfg) {
  const f = s.playoffs.final;
  const need = Math.ceil(f.bestOf / 2);
  if (f.a !== 0 && f.b !== 0) {
    while (f.wa < need && f.wb < need) { const g = simGame(s, f.a, f.b, rng, cfg); if (g.ra > g.rb) f.wa++; else f.wb++; }
  }
  if (f.wa >= need || f.wb >= need) {
    s.champion = f.wa >= need ? f.a : f.b;
    s.phase = 'done';
  }
  // eliminated in the semifinal: the season is over for you (the rest was simulated above)
}
export function isOver(s) {
  if (s.phase === 'done') return true;
  if (s.phase === 'playoffs') {
    const po = s.playoffs;
    if (!po.seeds.includes(0)) return true;
    const semi = po.semis.find((m) => m.a === 0 || m.b === 0);
    if (semi.winner !== undefined && semi.winner !== 0) return true;
  }
  return false;
}
// When your season ended early, the rest of the playoffs is simulated so there is a champion to show.
export function finishSeason(s, cfg = CONFIG) {
  if (s.phase === 'done') return;
  const rng = createRng((s.seed ^ 0x2f6b) >>> 0);
  if (s.phase === 'regular') return;
  finishSemis(s, rng, cfg);
  if (s.playoffs.final) settleFinal(s, rng, cfg);
}

// ---------------------------------------------------------------------------------------------------------------
// Roster and shop
// ---------------------------------------------------------------------------------------------------------------
export const lineup = (s, cfg = CONFIG) => s.roster.slice(0, cfg.season.roster.lineup);
export const bench = (s, cfg = CONFIG) => s.roster.slice(cfg.season.roster.lineup);

/** Swap two players (batting order, or a bench player into the lineup). */
export function swapPlayers(s, idA, idB) {
  const sa = (s.staff || []).findIndex((p) => p.id === idA), sb = (s.staff || []).findIndex((p) => p.id === idB);
  if (sa >= 0 || sb >= 0) {
    // pitchers swap with pitchers only: the two trade places and jobs (a starter and a reliever trade roles)
    if (sa < 0 || sb < 0 || sa === sb) return false;
    const A = s.staff[sa], B = s.staff[sb];
    [A.role, B.role] = [B.role, A.role];
    [s.staff[sa], s.staff[sb]] = [B, A];
    return true;
  }
  const a = s.roster.findIndex((p) => p.id === idA), b = s.roster.findIndex((p) => p.id === idB);
  if (a < 0 || b < 0 || a === b) return false;
  [s.roster[a], s.roster[b]] = [s.roster[b], s.roster[a]];
  return true;
}

function refillShop(s, rng, n, cfg) {
  const S = cfg.season.shop;
  for (let i = 0; i < n; i++) {
    // now and then an arm: a real one from another club or a journeyman
    if (rng.chance(S.pitcherShare)) {
      if (rng.chance(S.starChance)) {
        const taken = new Set(s.staff.concat(s.shop).map((p) => p.id));
        const pool = allArms().filter((p) => !taken.has(p.id) && p.teamId !== s.teamId && overall(p) >= S.min);
        if (pool.length) { s.shop.push(rng.pick(pool)); continue; }
      }
      const mean = S.mean + (s.boost || 0) * 0.5;
      let p = makeArm(s, rng, mean, cfg);
      let tries = 0;
      while ((overall(p) < S.min || overall(p) > S.max) && tries++ < 20) p = makeArm(s, rng, mean + rng.gauss(0, S.sd), cfg);
      s.shop.push(p);
      continue;
    }
    // now and then a star from another team is on the block
    if (rng.chance(S.starChance)) {
      const taken = new Set(s.roster.concat(s.shop).map((p) => p.id));
      const pool = allStars().filter((p) => !taken.has(p.id) && p.teamId !== s.teamId && overall(p) >= S.min);
      if (pool.length) { s.shop.push(rng.pick(pool)); continue; }
    }
    // better players show up as the league gets tougher
    const mean = S.mean + (s.boost || 0) * 0.5;
    let p = makePlayer(s, rng, mean, cfg, { sd: 5 });
    let tries = 0;
    while ((overall(p) < S.min || overall(p) > S.max) && tries++ < 20) p = makePlayer(s, rng, mean + rng.gauss(0, S.sd), cfg, { sd: 5 });
    s.shop.push(p);
  }
  s.shop.sort((a, b) => overall(a) - overall(b));
}
function refreshShop(s, rng, cfg) {
  const n = Math.min(cfg.season.shop.refresh, s.shop.length);
  for (let i = 0; i < n; i++) s.shop.splice(rng.int(0, s.shop.length - 1), 1);
  refillShop(s, rng, cfg.season.shop.size - s.shop.length, cfg);
}

/**
 * Buy shop player `shopId`. With a full roster he takes the place of `replaceId` (who leaves, for a little money back).
 * Returns { ok, reason }.
 */
export function buyPlayer(s, shopId, replaceId, cfg = CONFIG) {
  const k = s.shop.findIndex((p) => p.id === shopId);
  if (k < 0) return { ok: false, reason: 'gone' };
  const p = s.shop[k];
  const cost = price(p, cfg);
  if (p.role) {
    // a pitcher takes the place (and the job) of a pitcher on the staff
    const isFull = s.staff.length >= cfg.season.staff.size;
    const at = isFull ? s.staff.findIndex((q) => q.id === replaceId) : -1;
    if (isFull && at < 0) return { ok: false, reason: 'pick' };
    if (s.coins < cost) return { ok: false, reason: 'coins' };
    s.coins -= cost;
    s.shop.splice(k, 1);
    if (at >= 0) { const old = s.staff[at]; s.staff[at] = { ...p, role: old.role }; delete s.rest[old.id]; s.rest[p.id] = 1; }
    else { s.staff.push({ ...p }); s.rest[p.id] = 1; }
    return { ok: true, cost };
  }
  const full = s.roster.length >= cfg.season.roster.size;
  const out = full ? s.roster.findIndex((q) => q.id === replaceId) : -1;
  if (full && out < 0) return { ok: false, reason: 'pick' };
  if (s.coins < cost) return { ok: false, reason: 'coins' }; // (he costs exactly his price, out of the coins you have - a player you let go brings nothing back)
  s.coins -= cost;
  s.shop.splice(k, 1);
  if (out >= 0) s.roster[out] = p; else s.roster.push(p);
  return { ok: true, cost };
}

// ---------------------------------------------------------------------------------------------------------------
// The game itself
// ---------------------------------------------------------------------------------------------------------------
/** A team's strength (-1 weak .. +1 strong) from its rating. */
export const strengthOf = (rating, cfg = CONFIG) => clamp((rating - 50) / cfg.season.strength.spread, -1.5, 1.5);

/**
 * The config for a game against a team of this rating: the level you picked, made a little easier against a weak team and a
 * little harder against a strong one (their pitcher's speed and command, their hitting, their fielding, their catcher).
 */
export function gameConfig(level, rating, cfg = CONFIG) {
  const k = strengthOf(rating, cfg);
  const T = cfg.season.strength;
  const d = cfg.difficulty[level];
  const loc = { ...d.locations };
  const move = Math.min(loc.heart * 0.5, loc.heart * T.heartShift * k);
  loc.heart -= move; loc.edge += move * 0.4; loc.chase += move * 0.6;
  const hit = 1 + T.offense * k;
  const ai = { ...d.ai };
  for (const key of ['single', 'double', 'triple', 'hr']) ai[key] *= Math.max(0.3, hit);
  ai.k *= Math.max(0.3, 1 - (T.offense * k) / 1.5);
  const dd = {
    ...d,
    fastball: [d.fastball[0] + T.fastballMph * k, d.fastball[1] + T.fastballMph * k],
    locations: loc,
    commandSigma: d.commandSigma * Math.max(0.4, 1 - T.commandSigma * k),
    ai,
    errorScale: (d.errorScale ?? 1) * Math.max(0.2, 1 - T.errors * k),
    catcherArm: (d.catcherArm ?? 1) * Math.max(0.6, 1 - T.catcher * k),
    cpuStrength: k, // (when you pitch: how good their batters are - see cpuBatter)
  };
  return { ...cfg, difficulty: { ...cfg.difficulty, [level]: dd } };
}

/** Your League club for the other modes (Quick Game, Derby, Practice): the same team in its home jersey, the same nine batters. */
export function clubSetup(s, cfg = CONFIG) {
  const club = teamById(s.teams[0].id);
  return {
    playerTeam: { id: club.id, name: s.teams[0].name, abbr: s.teams[0].abbr, color: s.teams[0].color, uniform: uniformFor(club, 'home') },
    lineup: lineup(s, cfg).map((p, i) => ({ ...p, order: i })),
    staff: armsOf(club, cfg), // (a Quick Game with your club: its five real arms, fresh)
  };
}

/** Your starters, in rotation order (the staff's 'SP' arms), and the rest of the staff. */
export const startersOf = (s, cfg = CONFIG) => s.staff.filter((p) => p.role === 'SP');
export const relieversOf = (s) => s.staff.filter((p) => p.role !== 'SP');

/** Who starts your next game: the next man in the rotation when he is rested (season.startMin), else the most rested starter. */
export function pickStarter(s, cfg = CONFIG) {
  const list = startersOf(s, cfg);
  if (!list.length) return s.staff[0] || null;
  const next = list[(s.rotation || 0) % list.length];
  if ((s.rest[next.id] ?? 1) >= cfg.season.startMin) return next;
  let best = next;
  for (let i = 1; i < list.length; i++) {
    const p = list[((s.rotation || 0) + i) % list.length];
    if ((s.rest[p.id] ?? 1) > (s.rest[best.id] ?? 1) + 1e-9) best = p;
  }
  return best;
}

/** The engine's staff: today's starter first, then your relievers, then the other starters (marked unavailable: never offered). */
function gameStaff(s, cfg) {
  const start = pickStarter(s, cfg);
  const tired = (p) => (s.rest[p.id] ?? 1) < cfg.season.relieverMin; // (a reliever who threw a lot lately: never offered today)
  return [{ ...start }, ...relieversOf(s).map((p) => (tired(p) ? { ...p, unavailable: true } : { ...p })), ...startersOf(s, cfg).filter((p) => p.id !== start.id).map((p) => ({ ...p, unavailable: true }))];
}

/** The other club's starter for its game number n: its three real starters in turn. */
export function opposingStarter(club, n, cfg = CONFIG) {
  const sp = armsOf(club, cfg).filter((p) => p.role === 'SP');
  return sp[n % sp.length];
}

/**
 * A League from before staffs: your club's five arms, the rotation, everyone rested, empty pitching lines. Safe on any league
 * (adds only what is missing); v stays 2. Returns it.
 */
export function ensureStaff(s, cfg = CONFIG) {
  if (!s || typeof s !== 'object') return s;
  if (!Array.isArray(s.staff) || !s.staff.length) {
    const club = teamById(s.teamId);
    s.staff = club ? armsOf(club, cfg) : [];
  }
  if (typeof s.rotation !== 'number') s.rotation = 0;
  s.rest ||= {};
  s.pstats ||= {};
  for (const p of s.staff) if (typeof s.rest[p.id] !== 'number') s.rest[p.id] = 1;
  return s;
}

/** Everything the engine needs for your next game. */
export function gameSetup(s, cfg = CONFIG) {
  const g = nextGame(s);
  if (!g) return null;
  const t = s.teams[g.opp];
  const club = teamById(s.teams[0].id), them = teamById(t.id);
  const atHome = g.home !== false;
  const opp = { id: t.id, name: t.name, abbr: t.abbr, color: t.color, uniform: uniformFor(them, atHome ? 'away' : 'home') };
  const mine = { id: club.id, name: s.teams[0].name, abbr: s.teams[0].abbr, color: s.teams[0].color, uniform: uniformFor(club, atHome ? 'home' : 'away') };
  return {
    // at home you bat last in your own park; on the road you bat first, in theirs
    home: atHome, playerSide: atHome ? 'bottom' : 'top', park: atHome ? club.id : them.id,
    game: g, opponent: opp, playerTeam: mine, oppLineup: teamLineup(them, t.lineupSeed || 7, 'o'), lineup: lineup(s, cfg).map((p, i) => ({ ...p, order: i })),
    cfg: gameConfig(s.level, t.rating, cfg), level: s.level, innings: cfg.season.innings,
    seed: ((s.seed ^ ((s.games.length + 1) * 40503)) >>> 0),
    staff: gameStaff(s, cfg), oppPitcher: opposingStarter(them, s.games.length + (t.lineupSeed || 0), cfg),
  };
}

/** A batter's rating effects: timing window multiplier, extra exit velocity (mph at full power), running speed multiplier. */
export function ratingEffects(p, cfg = CONFIG) {
  const R = cfg.ratings;
  if (!p || p.con === undefined) return { window: 1, ev: 0, speed: 1 };
  return {
    window: 1 + R.conWindow * (p.con - 50) / 50,
    ev: R.powMph * (p.pow - 50) / 50,
    speed: 1 + R.spdSpeed * (p.spd - 50) / 50,
  };
}

/** Batting average text (.312). */
export const avg = (h, ab) => (ab > 0 ? (h / ab).toFixed(3).replace(/^0/, '') : '.000');
