// Season mode: schedule, standings, playoffs, coins, roster, shop and what team strength and player ratings do.
import { describe, it, expect } from 'vitest';
import { CONFIG } from '../src/config.js';
import * as S from '../src/game/season.js';
import { Engine } from '../src/game/engine.js';
import { createRng } from '../src/util/rng.js';
import { simulateBattedBall } from '../src/physics/ballistics.js';
import { createDefense, planPlay } from '../src/game/fielding.js';
import { createBot } from '../src/game/bot.js';

const play = (s, won, rf = 5, ra = 3) => S.recordGame(s, { won, runsFor: won ? Math.max(rf, ra + 1) : Math.min(rf, ra - 1), runsAgainst: ra, lines: {} });

import { armsOf, MLB_TEAMS, leagueFor, uniformFor, starsOf, lum, ratingsFromStats } from '../src/game/mlb.js';

describe('the big-league teams', () => {
  it('thirty teams, six divisions of five, stars with real numbers that make sensible ratings', () => {
    expect(MLB_TEAMS.length).toBe(30);
    for (const lg of ['AL', 'NL']) for (const d of ['East', 'Central', 'West']) expect(MLB_TEAMS.filter((t) => t.league === lg && t.division === d).length).toBe(5);
    expect(new Set(MLB_TEAMS.map((t) => t.abbr)).size).toBe(30);
    for (const t of MLB_TEAMS) {
      expect(t.stars.length).toBeGreaterThanOrEqual(3);
      for (const st of t.stars) { expect(st[2]).toBeGreaterThan(0.18); expect(st[2]).toBeLessThan(0.36); expect(st[3]).toBeGreaterThanOrEqual(0); expect(st[3]).toBeLessThan(70); expect(st[4]).toBeGreaterThanOrEqual(0); expect(st[4]).toBeLessThan(80); }
      for (const p of starsOf(t)) for (const v of [p.con, p.pow, p.spd]) { expect(v).toBeGreaterThanOrEqual(25); expect(v).toBeLessThanOrEqual(99); }
    }
    // the numbers decide the ratings: more home runs = more power, a higher average = more contact
    const r = (avg, hr, sb) => ratingsFromStats(avg, hr, sb);
    expect(r(0.3, 20, 5).con).toBeGreaterThan(r(0.25, 20, 5).con);
    expect(r(0.26, 45, 5).pow).toBeGreaterThan(r(0.26, 20, 5).pow);
    expect(r(0.26, 20, 40).spd).toBeGreaterThan(r(0.26, 20, 5).spd);
  });
  it('your league: your team, your division and four teams from a neighbouring division', () => {
    for (const t of MLB_TEAMS) for (const seed of [1, 2, 3]) {
      const lg = leagueFor(t.id, seed);
      expect(lg.length).toBe(9);
      expect(lg[0].id).toBe(t.id);
      expect(new Set(lg.map((x) => x.id)).size).toBe(9);
      expect(lg.every((x) => x.league === t.league)).toBe(true);
      expect(lg.filter((x) => x.division === t.division).length).toBe(5);
    }
  });
  it('a team keeps its colours and the road team never matches the home team on the field', () => {
    for (const a of MLB_TEAMS) {
      const home = uniformFor(a, 'home'), away = uniformFor(a, 'away');
      expect(home.primary.toLowerCase()).toBe(a.color.toLowerCase());
      expect(Math.abs(lum(home.primary) - lum(away.primary))).toBeGreaterThan(0.02);
    }
  });
});

describe('a Quick Game opponent', () => {
  it('is one of the thirty clubs, in its road uniform, with its own lineup', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const e = new Engine({ mode: 'quick', seed });
      const t = MLB_TEAMS.find((x) => x.id === e.opponent.id);
      expect(t).toBeTruthy();
      expect(e.opponent.name).toBe(`${t.city} ${t.nick}`);
      expect(e.opponent.uniform.primary).toBe(uniformFor(t, 'away').primary);
      expect(e.oppLineup.length).toBe(9);
    }
  });
});

describe('picking a team', () => {
  it('you start with your own team\'s stars, at their positions', () => {
    const t = MLB_TEAMS.find((x) => x.id === 'lad');
    const s = S.newSeason(null, { team: 'lad', seed: 5 });
    expect(s.teams[0].abbr).toBe('LAD');
    const names = s.roster.map((p) => p.name);
    for (const st of starsOf(t)) expect(names).toContain(st.name);
    expect(new Set(s.roster.slice(0, 9).map((p) => p.pos)).size).toBe(9);
    expect(s.teams.length).toBe(9);
  });
  it('a stronger team starts with a stronger lineup', () => {
    const avg = (s) => s.roster.slice(0, 9).reduce((t, p) => t + S.overall(p), 0) / 9;
    expect(avg(S.newSeason(null, { team: 'lad', seed: 5 }))).toBeGreaterThan(avg(S.newSeason(null, { team: 'col', seed: 5 })));
  });
  it('the shop sometimes has a real star from another team, never one of yours', () => {
    let stars = 0;
    for (let seed = 1; seed <= 30; seed++) { const s = S.newSeason(null, { team: 'nym', seed }); for (const p of s.shop) if (p.star) { stars++; expect(p.teamId).not.toBe('nym'); } }
    expect(stars).toBeGreaterThan(10);
  });
});

describe('a new season', () => {
  const s = S.newSeason(null, { level: 'pro', length: 'full', seed: 11 });
  it('nine teams, your roster of twelve, coins to start, a shop', () => {
    expect(s.teams.length).toBe(9);
    expect(s.teams[0].abbr).toBe('NYM');
    expect(s.roster.length).toBe(CONFIG.season.roster.size);
    expect(new Set(s.roster.map((p) => p.id)).size).toBe(12);
    expect(s.coins).toBe(CONFIG.season.coins.start);
    expect(s.shop.length).toBe(CONFIG.season.shop.size);
    for (const p of s.roster.concat(s.shop).filter((q) => !q.role)) for (const k of ['con', 'pow', 'spd']) { expect(p[k]).toBeGreaterThanOrEqual(20); expect(p[k]).toBeLessThanOrEqual(99); }
  });
  it('some CPU teams are better than others', () => {
    const r = s.teams.slice(1).map((t) => t.rating);
    expect(Math.max(...r) - Math.min(...r)).toBeGreaterThan(12);
  });
  it('the schedule: everyone plays everyone once per cycle, your opponents go from weakest to strongest', () => {
    expect(S.myGames(s)).toBe(16);
    const meets = {};
    for (const r of s.schedule) {
      const seen = new Set();
      for (const [a, b] of r) { expect(seen.has(a) || seen.has(b)).toBe(false); seen.add(a); seen.add(b); const k = Math.min(a, b) + '-' + Math.max(a, b); meets[k] = (meets[k] || 0) + 1; }
    }
    expect(Object.keys(meets).length).toBe(36); // every pair of 9 teams
    expect(Object.values(meets).every((n) => n === 2)).toBe(true);
    const mine = s.schedule.slice(0, 9).map((r) => r.find((p) => p[0] === 0 || p[1] === 0)).filter(Boolean).map((p) => s.teams[p[0] === 0 ? p[1] : p[0]].rating);
    expect(mine).toEqual(mine.slice().sort((a, b) => a - b));
  });
  it('a short season is half as long', () => {
    expect(S.myGames(S.newSeason(null, { length: 'short', seed: 2 }))).toBe(8);
  });
});

describe('playing the season through', () => {
  it('records, standings, coins; then the playoffs and a champion', () => {
    const s = S.newSeason(null, { level: 'pro', length: 'short', seed: 4 });
    const coins0 = s.coins;
    let games = 0;
    while (s.phase === 'regular') { const r = play(s, true, 6, 2); expect(r.coins).toBeGreaterThan(0); games++; }
    expect(games).toBe(8);
    const tot = s.teams.reduce((a, t) => a + t.w - t.l, 0);
    expect(tot).toBe(0); // every game has a winner and a loser
    expect(s.teams[0].w).toBe(8);
    expect(S.standings(s)[0].i).toBe(0);
    expect(s.phase).toBe('playoffs');
    expect(S.nextGame(s).kind).toBe('semi');
    play(s, true);
    expect(S.nextGame(s).kind).toBe('final');
    play(s, true); play(s, true);
    expect(s.phase).toBe('done');
    expect(s.champion).toBe(0);
    expect(S.finishOf(s)).toBe('Champions');
    expect(s.coins).toBeGreaterThan(coins0 + 8 * CONFIG.season.coins.win + CONFIG.season.coins.title);
  });

  it('losing the semifinal ends your season; the rest is played out', () => {
    const s = S.newSeason(null, { length: 'short', seed: 5 });
    while (s.phase === 'regular') play(s, true);
    play(s, false);
    expect(S.isOver(s)).toBe(true);
    expect(S.nextGame(s)).toBe(null);
    S.finishSeason(s);
    expect(s.champion).not.toBe(null);
    expect(s.champion).not.toBe(0);
    expect(S.finishOf(s)).toBe('Semifinal');
  });

  it('a bad season misses the playoffs; next season carries the roster and coins, and the league only gets tougher after success', () => {
    const s = S.newSeason(null, { length: 'short', seed: 6 });
    while (s.phase === 'regular') play(s, false);
    expect(S.isOver(s)).toBe(true);
    expect(S.finishOf(s)).toBe('Missed playoffs');
    const n = S.newSeason(s, {});
    expect(n.year).toBe(2);
    expect(n.boost).toBe(0);
    expect(n.roster.map((p) => p.id)).toEqual(s.roster.map((p) => p.id));
    expect(n.coins).toBe(s.coins);
    expect(n.history[0].finish).toBe('Missed playoffs');
    // a champion's next league is stronger
    const c = S.newSeason(null, { length: 'short', seed: 7 });
    while (!S.isOver(c)) play(c, true);
    const c2 = S.newSeason(c, {});
    expect(c2.boost).toBe(CONFIG.season.yearStep);
  });

  it("players' season lines add up", () => {
    const s = S.newSeason(null, { length: 'short', seed: 8 });
    const id = s.roster[0].id;
    S.recordGame(s, { won: true, runsFor: 4, runsAgainst: 1, lines: { [id]: { pa: 4, ab: 3, h: 2, hr: 1, rbi: 2, bb: 1 } } });
    S.recordGame(s, { won: false, runsFor: 1, runsAgainst: 2, lines: { [id]: { pa: 4, ab: 4, h: 1, hr: 0, rbi: 1 } } });
    expect(s.stats[id]).toMatchObject({ g: 2, pa: 8, ab: 7, h: 3, hr: 1, rbi: 3, bb: 1 });
    expect(S.avg(3, 7)).toBe('.429');
  });
});

describe('roster and shop', () => {
  it('swapping players changes the batting order', () => {
    const s = S.newSeason(null, { seed: 9 });
    const [a, b] = [s.roster[0].id, s.roster[10].id];
    expect(S.swapPlayers(s, a, b)).toBe(true);
    expect(s.roster[0].id).toBe(b);
    expect(s.roster[10].id).toBe(a);
  });
  it('buying: costs exactly its price out of your coins, replaces the player you pick, cannot overspend', () => {
    const s = S.newSeason(null, { seed: 10 });
    const target = s.shop.find((p) => !p.role);
    const out = s.roster[3];
    expect(S.buyPlayer(s, target.id, null).reason).toBe('pick'); // the roster is full
    s.coins = 0;
    expect(S.buyPlayer(s, target.id, out.id).reason).toBe('coins');
    s.coins = S.price(target) - 5; // (a player you let go brings nothing back: 5 short is short)
    expect(S.buyPlayer(s, target.id, out.id).reason).toBe('coins');
    s.coins = 1000;
    const r = S.buyPlayer(s, target.id, out.id);
    expect(r.ok).toBe(true);
    expect(s.coins).toBe(1000 - S.price(target));
    expect(s.roster[3].id).toBe(target.id); // he takes the same spot in the order
    expect(s.shop.some((p) => p.id === target.id)).toBe(false);
  });
  it('better players cost more', () => {
    const lo = { con: 45, pow: 45, spd: 45 }, mid = { con: 60, pow: 60, spd: 60 }, hi = { con: 80, pow: 80, spd: 70 };
    expect(S.price(lo)).toBeLessThan(S.price(mid));
    expect(S.price(mid)).toBeLessThan(S.price(hi));
  });
  it('the shop turns over after every game', () => {
    const s = S.newSeason(null, { seed: 12 });
    const before = s.shop.map((p) => p.id);
    play(s, true);
    const after = s.shop.map((p) => p.id);
    expect(after.length).toBe(CONFIG.season.shop.size);
    expect(after.filter((id) => !before.includes(id)).length).toBe(CONFIG.season.shop.refresh);
  });
});

describe('what strength and ratings do', () => {
  it('a strong team throws harder, hits better and fields better than a weak one', () => {
    const weak = S.gameConfig('pro', 35).difficulty.pro, strong = S.gameConfig('pro', 68).difficulty.pro;
    expect(strong.fastball[0]).toBeGreaterThan(weak.fastball[0]);
    expect(strong.ai.single).toBeGreaterThan(weak.ai.single);
    expect(strong.ai.k).toBeLessThan(weak.ai.k);
    expect(strong.errorScale).toBeLessThan(weak.errorScale);
    // the level you picked is untouched for other modes
    expect(CONFIG.difficulty.pro.fastball).toEqual([80, 90]);
  });
  it('ratings: Contact widens the timing windows, Power adds exit velocity, Speed makes him faster; average = no change', () => {
    expect(S.ratingEffects({ con: 50, pow: 50, spd: 50 })).toEqual({ window: 1, ev: 0, speed: 1 });
    const star = S.ratingEffects({ con: 90, pow: 90, spd: 90 });
    expect(star.window).toBeGreaterThan(1.1);
    expect(star.ev).toBeGreaterThan(4);
    expect(star.speed).toBeGreaterThan(1.05);
    expect(S.ratingEffects({ name: 'no ratings' })).toEqual({ window: 1, ev: 0, speed: 1 });
  });
  it('a season game: six innings, your lineup, their name; a fast runner beats out more infield grounders than a slow one', () => {
    const s = S.newSeason(null, { seed: 13 });
    const set = S.gameSetup(s);
    const e = new Engine({ mode: 'quick', playerSide: 'top', difficulty: set.level, innings: set.innings, lineup: set.lineup, opponent: set.opponent, oppLineup: set.oppLineup, seed: 3 }, set.cfg);
    expect(e.game.innings).toBe(6);
    expect(e.lineup[0].id).toBe(s.roster[0].id);
    expect(e.opponent.name).toBe(s.teams[set.game.opp].name);
    // speed: the same ground balls, a slow batter and a fast one
    const rng = createRng(1);
    let fast = 0, slow = 0;
    for (let k = 0; k < 1200; k++) {
      const c = { exitVelocity: rng.range(20, 60), launchAngle: rng.range(-14, 0), sprayAngle: rng.range(-40, 40), backspin: 900, hook: 0 }; // (slow rollers and choppers: the close plays)
      const sim = simulateBattedBall({ ...c, start: { x: 0, y: 2.6, z: -1 } });
      const hit = (spd) => { const pl = planPlay({ sim, contact: c, bases: [null, null, null], outs: 0, defense: createDefense(), speeds: { 0: spd } }, CONFIG); return pl.batterDest > 0 ? 1 : 0; };
      fast += hit(S.ratingEffects({ con: 50, pow: 50, spd: 95 }).speed);
      slow += hit(S.ratingEffects({ con: 50, pow: 50, spd: 20 }).speed);
    }
    expect(fast).toBeGreaterThan(slow);
    expect(e.runnerSpeeds()[0]).toBeCloseTo(S.ratingEffects(e.batter).speed, 9);
  });
});

describe('older saves', () => {
  it('a league saved with the old made-up names gets the real club and player names', () => {
    const s = S.newSeason(null, { team: 'nym', seed: 3 });
    const old = JSON.parse(JSON.stringify(s));
    old.teams[0].name = 'New York Nets';
    const star = old.roster.find((p) => p.star);
    star.name = 'Juan Sotto'; star.short = 'J. Sotto'; star.con = 1;
    S.freshen(old);
    expect(old.teams[0].name).toBe('New York Mets');
    const fresh = s.roster.find((p) => p.id === star.id);
    expect(star.name).toBe(fresh.name);
    expect(star.con).toBe(fresh.con);
  });
});

describe('all thirty clubs', () => {
  it('the standings have every club in its division, and the other clubs play every day you do', () => {
    const s = S.newSeason(null, { team: 'sea', seed: 9 });
    expect(s.teams.length + s.others.length).toBe(30);
    for (let i = 0; i < 4; i++) S.recordGame(s, { won: i % 2 === 0, runsFor: i % 2 ? 1 : 5, runsAgainst: 3, lines: {} });
    const d = S.divisionTables(s);
    let n = 0;
    for (const lg of ['AL', 'NL']) for (const dv of ['East', 'Central', 'West']) { expect(d[lg][dv].length).toBe(5); n += 5; }
    expect(n).toBe(30);
    expect(d.AL.West.filter((x) => x.team.mine).length).toBe(1);
    const games = s.others.reduce((t, x) => t + x.w + x.l, 0);
    expect(games).toBeGreaterThan(s.round * 18); // (twenty of the twenty-one play each day)
  });
  it('an older league without the other clubs gets them, caught up on the days already played', () => {
    const s = S.newSeason(null, { team: 'nym', seed: 2 });
    for (let i = 0; i < 3; i++) S.recordGame(s, { won: true, runsFor: 4, runsAgainst: 1, lines: {} });
    delete s.others;
    S.freshen(s);
    expect(s.others.length).toBe(21);
    expect(s.others.reduce((t, x) => t + x.w + x.l, 0)).toBeGreaterThan(0);
  });
});

describe('home and away', () => {
  it('League games alternate home and away: at home you bat last in your park, on the road first in theirs', () => {
    let s = S.newSeason(null, { seed: 21, team: 'bos' });
    const seen = [];
    for (let k = 0; k < 4; k++) {
      const set = S.gameSetup(s);
      seen.push(set.home);
      if (set.home) { expect(set.playerSide).toBe('bottom'); expect(set.park).toBe('bos'); }
      else { expect(set.playerSide).toBe('top'); expect(set.park).toBe(set.opponent.id); }
      // two clubs never wear the same look: the home side in its colours, the visitors in road grey
      expect(set.playerTeam.uniform).not.toEqual(set.opponent.uniform);
      S.recordGame(s, { won: true, runsFor: 3, runsAgainst: 1, lines: {} });
    }
    expect(seen).toEqual([true, false, true, false]);
  });
  it('a road game: you bat in the top half and the game ends the same way', () => {
    const s = S.newSeason(null, { seed: 22 });
    S.recordGame(s, { won: true, runsFor: 3, runsAgainst: 1, lines: {} });
    const set = S.gameSetup(s);
    expect(set.home).toBe(false);
    const e = new Engine({ mode: 'quick', difficulty: set.level, innings: set.innings, lineup: set.lineup, opponent: set.opponent, playerTeam: set.playerTeam, oppLineup: set.oppLineup, seed: 3, playerSide: set.playerSide }, set.cfg);
    const bot = createBot(e, { errSd: 30, seed: 2 });
    let over = null;
    e.on('gameOver', (p) => { over = p; });
    e.start();
    for (let t = 0; t < 4000 && !e.over; t += 1 / 60) { e.update(1 / 60); bot.update(); }
    expect(over).toBeTruthy();
    expect(over.game.playerSide).toBe('top');
    expect(over.game.pf).toBe(over.game.score.top);
  }, 60000);
});

describe('pitchers', () => {
  const game = (s, pitching = {}) => S.recordGame(s, { won: true, runsFor: 5, runsAgainst: 3, lines: {}, pitching });
  const starterOf = (s) => S.gameSetup(s).staff[0].id;
  it('a new league has a five-man staff of the club\'s real arms, all rested', () => {
    const s = S.newSeason(null, { team: 'nym', seed: 21 });
    expect(s.staff.length).toBe(5);
    expect(s.staff.map((p) => p.role)).toEqual(['SP', 'SP', 'SP', 'RP', 'RP']);
    expect(s.staff.every((p) => p.teamId === 'nym' && s.rest[p.id] === 1)).toBe(true);
    expect(s.rotation).toBe(0);
    expect(s.v).toBe(2);
  });
  it('ensureStaff adds a staff to an old league, keeps v 2 and is idempotent', () => {
    const s = S.newSeason(null, { team: 'nym', seed: 22 });
    const old = JSON.parse(JSON.stringify(s));
    delete old.staff; delete old.rotation; delete old.rest; delete old.pstats;
    S.ensureStaff(old);
    expect(old.v).toBe(2);
    expect(old.staff.map((p) => p.id)).toEqual(s.staff.map((p) => p.id));
    expect(old.rotation).toBe(0);
    expect(Object.keys(old.rest).length).toBe(5);
    expect(old.pstats).toEqual({});
    const again = JSON.stringify(S.ensureStaff(old));
    expect(JSON.stringify(S.ensureStaff(old))).toBe(again);
  });
  it('the starter goes 1 -> 2 -> 3 -> 1 when everybody is rested', () => {
    const s = S.newSeason(null, { team: 'nym', seed: 23 });
    const sp = s.staff.filter((p) => p.role === 'SP').map((p) => p.id);
    const seen = [];
    for (let i = 0; i < 4; i++) { seen.push(starterOf(s)); game(s); }
    expect(seen).toEqual([sp[0], sp[1], sp[2], sp[0]]);
  });
  it('the engine gets today\'s starter first, the relievers, then the other starters marked unavailable (never offered)', () => {
    const s = S.newSeason(null, { team: 'nym', seed: 24 });
    const setup = S.gameSetup(s);
    expect(setup.staff.length).toBe(5);
    expect(setup.staff.map((p) => p.role)).toEqual(['SP', 'RP', 'RP', 'SP', 'SP']);
    expect(setup.staff.map((p) => !!p.unavailable)).toEqual([false, false, false, true, true]);
    const e = new Engine({ difficulty: 'pro', staff: setup.staff, cpuHalf: 'pitch', playerSide: 'top', seed: 3 });
    e.start();
    expect(e.bullpenOptions().every((o) => o.pitcher.role === 'RP' && !o.pitcher.unavailable)).toBe(true);
  });
  it('a starter who used 90% of his stamina is skipped when below startMin; the most rested starter starts', () => {
    const s = S.newSeason(null, { team: 'nym', seed: 25 });
    const [a, b, c] = s.staff.filter((p) => p.role === 'SP').map((p) => p.id);
    game(s, { [a]: { outs: 18, h: 6, r: 3, er: 3, bb: 1, k: 7, used: 0.9 } });
    expect(s.rest[a]).toBeCloseTo(0.1 + 0.34, 5);
    s.rest[b] = 0.5; s.rest[c] = 0.9; // the next in turn (b) is tired
    expect(starterOf(s)).toBe(c);
    s.rest[c] = 0.3; s.rest[b] = 0.4; s.rest[a] = 0.2;
    expect(starterOf(s)).toBe(b); // nobody is fresh: the most rested
  });
  it('rest recovers a little every game and never goes over 1', () => {
    const s = S.newSeason(null, { team: 'nym', seed: 26 });
    const [r1] = s.staff.filter((p) => p.role === 'RP');
    s.rest[r1.id] = 0.1;
    game(s);
    expect(s.rest[r1.id]).toBeCloseTo(0.1 + CONFIG.season.restPerGame.RP, 5);
    game(s); game(s);
    expect(s.rest[r1.id]).toBe(1);
  });
  it('earned runs and the rest of the line add up in pstats', () => {
    const s = S.newSeason(null, { team: 'nym', seed: 27 });
    const a = s.staff[0].id;
    game(s, { [a]: { outs: 15, h: 5, r: 4, er: 3, bb: 2, k: 6, used: 0.5 } });
    game(s, { [a]: { outs: 12, h: 4, r: 2, er: 2, bb: 1, k: 3, used: 0.4 } });
    expect(s.pstats[a]).toEqual({ g: 2, outs: 27, h: 9, r: 6, er: 5, bb: 3, k: 9 });
  });
  it('buying a pitcher with a full staff needs a pitcher to replace; a hitter is refused; he takes the job', () => {
    const s = S.newSeason(null, { team: 'nym', seed: 28 });
    s.shop.push({ ...s.staff[0], id: 'zz1', name: 'Test Arm', teamId: 'xxx', role: 'SP' });
    s.coins = 5000;
    expect(S.buyPlayer(s, 'zz1', null).reason).toBe('pick');
    expect(S.buyPlayer(s, 'zz1', s.roster[0].id).reason).toBe('pick');
    const out = s.staff[4]; // a reliever
    expect(S.buyPlayer(s, 'zz1', out.id).ok).toBe(true);
    expect(s.staff[4].id).toBe('zz1');
    expect(s.staff[4].role).toBe('RP');
    expect(s.staff.length).toBe(5);
    expect(s.rest.zz1).toBe(1);
    // a hitter cannot replace a pitcher
    const h = s.shop.find((p) => !p.role);
    expect(S.buyPlayer(s, h.id, s.staff[0].id).reason).toBe('pick');
  });
  it('swapping a starter and a reliever trades their jobs; a pitcher and a hitter do not swap', () => {
    const s = S.newSeason(null, { team: 'nym', seed: 29 });
    const sp = s.staff[0], rp = s.staff[3];
    expect(S.swapPlayers(s, sp.id, rp.id)).toBe(true);
    expect(s.staff[0].id).toBe(rp.id);
    expect(s.staff[0].role).toBe('SP');
    expect(s.staff[3].role).toBe('RP');
    expect(S.swapPlayers(s, sp.id, s.roster[0].id)).toBe(false);
  });
  it('the shop offers pitchers and they cost by overall', () => {
    let arms = 0, total = 0;
    for (let seed = 40; seed < 70; seed++) {
      const s = S.newSeason(null, { team: 'nym', seed });
      for (const p of s.shop) { total++; if (p.role) { arms++; expect(S.price(p)).toBeGreaterThan(0); } }
    }
    expect(arms / total).toBeGreaterThan(0.2);
    expect(arms / total).toBeLessThan(0.5);
  });
  it('the opponent\'s starter is one of its real arms, in its own rotation', () => {
    const s = S.newSeason(null, { team: 'nym', seed: 30 });
    const setup = S.gameSetup(s);
    const them = MLB_TEAMS.find((t) => t.id === setup.opponent.id);
    const sp = armsOf(them).filter((p) => p.role === 'SP').map((p) => p.id);
    expect(sp).toContain(setup.oppPitcher.id);
    const seen = new Set();
    for (let i = 0; i < 3; i++) { seen.add(S.opposingStarter(them, i).id); }
    expect(seen.size).toBe(3);
  });
});
