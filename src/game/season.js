// Season mode: a league of nine teams, a schedule that goes from the weakest opponent to the strongest, standings (the other
// games are simulated), playoffs and a World Series, coins for results, a roster of rated players and a shop to buy better ones.
// Pure logic on a plain object (it is saved as JSON in the player's save): no graphics, no DOM, easy to test.
import { CONFIG } from '../config.js';
import { createRng } from '../util/rng.js';
import { clamp } from '../util/math.js';
import { OPPONENTS, PLAYER_TEAM, FIRST, LAST, SKINS, makeLineup } from './teams.js';

export const POSITIONS9 = ['CF', 'SS', '1B', 'LF', 'RF', '3B', 'C', '2B', 'DH'];

// ---------------------------------------------------------------------------------------------------------------
// Players
// ---------------------------------------------------------------------------------------------------------------
/** Overall rating: contact and power count most, speed a little. */
export const overall = (p) => Math.round(0.4 * p.con + 0.4 * p.pow + 0.2 * p.spd);

/** What a player costs in the shop (and 30% of it back if you let him go). */
export function price(p, cfg = CONFIG) {
  const P = cfg.season.price;
  const raw = P.base + P.scale * Math.pow(Math.max(0, overall(p) - P.over), P.power);
  return Math.max(P.round, Math.round(raw / P.round) * P.round);
}
export const refund = (p, cfg = CONFIG) => Math.round((price(p, cfg) * cfg.season.price.refund) / 5) * 5;

function rating(rng, mean, sd, lo = 20, hi = 99) { return clamp(Math.round(rng.gauss(mean, sd)), lo, hi); }

/** A new player around `mean` overall. `s.nextId` numbers them. */
export function makePlayer(s, rng, mean, cfg = CONFIG, o = {}) {
  const sd = o.sd ?? cfg.season.ratingSd;
  const used = new Set((s.roster || []).concat(s.shop || []).map((p) => p.name));
  let name;
  do { name = rng.pick(FIRST) + ' ' + rng.pick(LAST); } while (used.has(name));
  // a player has a style: a slugger, a contact man, a speedster or an all-rounder
  const style = rng.weighted({ slug: 0.3, contact: 0.3, speed: 0.15, all: 0.25 });
  const tilt = { slug: [-4, 7, -6], contact: [7, -5, 1], speed: [2, -8, 12], all: [0, 0, 0] }[style];
  const p = {
    id: 'p' + (s.nextId = (s.nextId || 0) + 1),
    name,
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
  const s = {
    v: 1, seed, level: o.level || (prev && prev.level) || 'pro', length: o.length || (prev && prev.length) || 'short',
    year: prev ? prev.year + 1 : 1,
    boost: prev ? Math.min(S.yearCap, (prev.boost || 0) + nextBoost(prev, cfg)) : 0,
    coins: prev ? prev.coins : S.coins.start,
    nextId: prev ? prev.nextId : 0,
    roster: prev ? prev.roster : [],
    history: prev ? prev.history.slice() : [],
    stats: {}, games: [], phase: 'regular', round: 0, playoffs: null, champion: null,
    shop: [],
  };
  if (prev) s.history.push(summaryOf(prev));
  // your team: nine starters and a bench (first season only; after that you keep who you have)
  if (!s.roster.length) {
    POSITIONS9.forEach((pos) => s.roster.push(makePlayer(s, rng, S.starters, cfg, { pos })));
    for (let i = 0; i < S.roster.size - S.roster.lineup; i++) s.roster.push(makePlayer(s, rng, S.bench, cfg));
  }
  // the league: every CPU team gets a strength rating (shuffled each season)
  const ratings = shuffle(rng, S.teamRatings.slice());
  s.teams = [{ id: PLAYER_TEAM.id, name: PLAYER_TEAM.name, abbr: PLAYER_TEAM.abbr, color: PLAYER_TEAM.color, rating: null, w: 0, l: 0, rs: 0, ra: 0 }];
  OPPONENTS.forEach((t, i) => s.teams.push({ id: t.id, name: t.name, abbr: t.abbr, color: t.color, rating: clamp(ratings[i] + rng.int(-S.teamJitter, S.teamJitter) + s.boost, 20, 95), w: 0, l: 0, rs: 0, ra: 0, lineupSeed: rng.int(1, 1e9) }));
  s.schedule = makeSchedule(s, cfg);
  refillShop(s, rng, S.shop.size, cfg);
  return s;
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
    return { kind: 'regular', opp: mine[0] === 0 ? mine[1] : mine[0], label: `Game ${played + 1} of ${myGames(s)}`, gameNo: played + 1, of: myGames(s) };
  }
  if (s.phase === 'playoffs') {
    const po = s.playoffs;
    if (po.final) {
      const f = po.final;
      if (f.a !== 0 && f.b !== 0) return null;
      return { kind: 'final', opp: f.a === 0 ? f.b : f.a, label: `World Series · Game ${f.wa + f.wb + 1}`, gameNo: f.wa + f.wb + 1, of: f.bestOf, series: [f.a === 0 ? f.wa : f.wb, f.a === 0 ? f.wb : f.wa] };
    }
    const semi = po.semis.find((m) => m.a === 0 || m.b === 0);
    if (!semi || semi.winner !== undefined) return null;
    return { kind: 'semi', opp: semi.a === 0 ? semi.b : semi.a, label: 'Semifinal', gameNo: 1, of: 1 };
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
  const a = s.roster.findIndex((p) => p.id === idA), b = s.roster.findIndex((p) => p.id === idB);
  if (a < 0 || b < 0 || a === b) return false;
  [s.roster[a], s.roster[b]] = [s.roster[b], s.roster[a]];
  return true;
}

function refillShop(s, rng, n, cfg) {
  const S = cfg.season.shop;
  for (let i = 0; i < n; i++) {
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
  const full = s.roster.length >= cfg.season.roster.size;
  const out = full ? s.roster.findIndex((q) => q.id === replaceId) : -1;
  if (full && out < 0) return { ok: false, reason: 'pick' };
  const back = out >= 0 ? refund(s.roster[out], cfg) : 0;
  if (s.coins + back < cost) return { ok: false, reason: 'coins' };
  s.coins += back - cost;
  s.shop.splice(k, 1);
  if (out >= 0) s.roster[out] = p; else s.roster.push(p);
  return { ok: true, cost, back };
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
  };
  return { ...cfg, difficulty: { ...cfg.difficulty, [level]: dd } };
}

/** Everything the engine needs for your next game. */
export function gameSetup(s, cfg = CONFIG) {
  const g = nextGame(s);
  if (!g) return null;
  const t = s.teams[g.opp];
  const base = OPPONENTS.find((o) => o.id === t.id) || OPPONENTS[0];
  const opp = { ...base, name: t.name, abbr: t.abbr, color: t.color };
  const oppLineup = makeLineup(t.lineupSeed || 7, 'o');
  return {
    game: g, opponent: opp, oppLineup, lineup: lineup(s, cfg).map((p, i) => ({ ...p, order: i })),
    cfg: gameConfig(s.level, t.rating, cfg), level: s.level, innings: cfg.season.innings,
    seed: ((s.seed ^ ((s.games.length + 1) * 40503)) >>> 0),
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
