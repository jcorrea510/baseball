// The League's teams and stars: the thirty big-league clubs with their real names, cities and colours, their best hitters
// with their real names and last season's numbers (batting average, home runs, stolen bases) - their Contact / Power / Speed
// ratings are worked out from those numbers (see ratingsFromStats) - and their best pitchers, rated from their lines (see
// pitcherRatings). The game is for the owner's personal use only (see Credits).
// Pure data and small helpers (no graphics, no DOM).
import { CONFIG } from '../config.js';
import { createRng } from '../util/rng.js';
import { SKINS } from './teams.js';
import { realNumber, lookOf } from './looks.js';

// strength tiers: 1 (rebuilding) .. 5 (the team to beat). A team's CPU strength rating comes from it (see config.season.tierRating).
// stars: [name, position, batting average, home runs, stolen bases, bats] - last season's numbers
// arms: the club's best three starters and two relievers, [name, role 'SP' | 'RP', throws, ERA, strikeouts per 9 innings, walks per 9,
// average fastball (mph), the pitches he throws, innings] - last season's lines as remembered at the time of writing (there was no
// way to look them up: correct a line here if one is off - the ratings follow by themselves, see pitcherRatings). His real pitches
// are put onto the game's types: four-seam = fastball, two-seam / sinker = sinker, cutter, slider / sweeper = slider, curve /
// knuckle-curve = curveball, change = changeup, splitter / forkball = splitter, and the heater only for a reliever who averages
// 98+. Where the table is short of a starter or a reliever (no name remembered for sure), armsOf adds a generated arm.
const T = (id, city, nick, abbr, league, division, color, color2, tier, stars, arms) => ({ id, city, nick, abbr, league, division, color, color2, tier, stars, arms });
const FB = 'fastball', SI = 'sinker', CT = 'cutter', SL = 'slider', CB = 'curveball', CH = 'changeup', SPL = 'splitter', HT = 'heater';

export const MLB_TEAMS = [
  // ---- American League East
  T('bal', 'Baltimore', 'Orioles', 'BAL', 'AL', 'East', '#df4601', '#111111', 2, [['Gunnar Henderson', 'SS', 0.274, 17, 30, 'L'], ['Jackson Holliday', '2B', 0.242, 17, 17, 'L'], ['Adley Rutschman', 'C', 0.220, 9, 0, 'S'], ['Jordan Westburg', '3B', 0.265, 17, 2, 'R']],
    [['Trevor Rogers', 'SP', 'L', 1.81, 8.6, 2.3, 92.4, [FB, SI, CH, SL], 109.2],
     ['Dean Kremer', 'SP', 'R', 4.19, 7.7, 2.6, 94, [FB, CT, SPL, SI], 171.2],
     ['Tomoyuki Sugano', 'SP', 'R', 4.64, 6, 2, 92, [SPL, FB, SI, SL], 157],
     ['Félix Bautista', 'RP', 'R', 2.60, 13.2, 4.4, 98.4, [FB, SPL, HT], 34.2],
     ['Keegan Akin', 'RP', 'L', 3.41, 9, 3.6, 93, [FB, SL, CH], 60.2]]),
  T('bos', 'Boston', 'Red Sox', 'BOS', 'AL', 'East', '#bd3039', '#0c2340', 3, [['Jarren Duran', 'LF', 0.256, 16, 24, 'L'], ['Trevor Story', 'SS', 0.263, 25, 31, 'R'], ['Roman Anthony', 'RF', 0.292, 8, 4, 'L'], ['Wilyer Abreu', 'CF', 0.247, 22, 6, 'L']],
    [['Garrett Crochet', 'SP', 'L', 2.59, 11.2, 2.2, 96.6, [FB, CT, SL, SI], 205.1],
     ['Brayan Bello', 'SP', 'R', 3.35, 7, 3.3, 95, [SI, FB, CH, CT], 166.2],
     ['Lucas Giolito', 'SP', 'R', 3.41, 8.4, 3.5, 93.5, [FB, SL, CH, CB], 145],
     ['Aroldis Chapman', 'RP', 'L', 1.17, 12.3, 2.6, 98.4, [FB, SPL, HT], 61.1],
     ['Garrett Whitlock', 'RP', 'R', 2.25, 11.4, 2.6, 95.2, [SI, SL, CH], 72]]),
  T('nyy', 'New York', 'Yankees', 'NYY', 'AL', 'East', '#0c2340', '#c4ced3', 4, [['Aaron Judge', 'RF', 0.331, 53, 12, 'R'], ['Cody Bellinger', 'LF', 0.272, 29, 13, 'L'], ['Trent Grisham', 'CF', 0.235, 34, 4, 'L'], ['Giancarlo Stanton', 'DH', 0.273, 24, 0, 'R'], ['Ben Rice', '1B', 0.255, 26, 3, 'L']],
    [['Max Fried', 'SP', 'L', 2.86, 8.7, 2.4, 94.5, [FB, SI, CB, CT], 195.1],
     ['Carlos Rodón', 'SP', 'L', 3.09, 9.6, 3.7, 94.6, [FB, SL, CH, CB], 195.1],
     ['Cam Schlittler', 'SP', 'R', 2.96, 10, 3, 97.8, [FB, CT, CB, SI], 73],
     ['David Bednar', 'RP', 'R', 2.19, 12.3, 2.5, 96.5, [FB, CB, SPL], 61.2],
     ['Luke Weaver', 'RP', 'R', 3.62, 9.8, 3, 95.6, [FB, CH, CT], 62.1]]),
  T('tb', 'Tampa Bay', 'Rays', 'TB', 'AL', 'East', '#092c5c', '#8fbce6', 2, [['Junior Caminero', '3B', 0.264, 45, 7, 'R'], ['Yandy Díaz', '1B', 0.300, 25, 3, 'R'], ['Jonathan Aranda', '2B', 0.316, 14, 0, 'L'], ['Chandler Simpson', 'CF', 0.295, 0, 44, 'R']],
    [['Drew Rasmussen', 'SP', 'R', 2.76, 8.3, 2.1, 96, [FB, CT, SI, SL], 150],
     ['Ryan Pepiot', 'SP', 'R', 3.86, 8.7, 3.1, 95.4, [FB, CH, SL, CT], 167.2],
     ['Shane Baz', 'SP', 'R', 4.87, 9.4, 3.5, 97, [FB, CB, CH, CT], 166.1],
     ['Pete Fairbanks', 'RP', 'R', 2.83, 9.5, 3, 97.6, [FB, SL], 60.1],
     ['Garrett Cleavinger', 'RP', 'L', 2.35, 12.4, 3, 96, [FB, SL, CT], 61.1]]),
  T('tor', 'Toronto', 'Blue Jays', 'TOR', 'AL', 'East', '#134a8e', '#e8291c', 4, [['Vladimir Guerrero Jr.', '1B', 0.292, 23, 6, 'R'], ['Bo Bichette', 'SS', 0.311, 18, 4, 'R'], ['George Springer', 'DH', 0.309, 32, 18, 'R'], ['Daulton Varsho', 'CF', 0.238, 20, 3, 'L'], ['Ernie Clement', '3B', 0.277, 9, 6, 'R']],
    [['Kevin Gausman', 'SP', 'R', 3.59, 8.9, 2.4, 94.5, [FB, SPL, SL], 193],
     ['Chris Bassitt', 'SP', 'R', 3.96, 8.4, 2.7, 92.5, [SI, CT, CB, FB], 170.1],
     ['José Berríos', 'SP', 'R', 4.17, 7.8, 3, 93.3, [SI, FB, CB, CH], 166],
     ['Jeff Hoffman', 'RP', 'R', 4.37, 11.9, 3, 95.8, [FB, SL, SPL], 68],
     ['Louis Varland', 'RP', 'R', 2.97, 9.9, 2.3, 97.5, [FB, CB, SL], 75]]),
  // ---- American League Central
  T('cws', 'Chicago', 'White Sox', 'CWS', 'AL', 'Central', '#27251f', '#c4ced4', 1, [['Luis Robert Jr.', 'CF', 0.223, 14, 33, 'R'], ['Colson Montgomery', 'SS', 0.239, 21, 1, 'L'], ['Andrew Benintendi', 'LF', 0.240, 20, 1, 'L'], ['Kyle Teel', 'C', 0.271, 8, 3, 'L']],
    [['Shane Smith', 'SP', 'R', 3.81, 8.7, 3.3, 96, [FB, CH, SL, CB], 146.1],
     ['Davis Martin', 'SP', 'R', 4.10, 7.2, 3, 94, [FB, SL, CH, CT], 142.2],
     ['Jonathan Cannon', 'SP', 'R', 5.04, 6.6, 3.1, 94.5, [SI, FB, CT, CH], 119],
     ['Grant Taylor', 'RP', 'R', 4.66, 11.5, 3.4, 99, [FB, SL, HT], 36.2]]),
  T('cle', 'Cleveland', 'Guardians', 'CLE', 'AL', 'Central', '#00385d', '#e50022', 3, [['José Ramírez', '3B', 0.283, 30, 44, 'S'], ['Steven Kwan', 'LF', 0.272, 11, 21, 'L'], ['Kyle Manzardo', '1B', 0.234, 27, 0, 'L']],
    [['Gavin Williams', 'SP', 'R', 3.06, 9.8, 4.5, 96.6, [FB, CB, SL, CT], 167.2],
     ['Tanner Bibee', 'SP', 'R', 4.24, 7.9, 2.7, 94.4, [FB, SL, CH, CT], 182.1],
     ['Slade Cecconi', 'SP', 'R', 4.30, 7.9, 2.8, 94, [FB, CB, SL, CH], 132],
     ['Cade Smith', 'RP', 'R', 2.29, 12.9, 2.3, 96.6, [FB, SPL, SL], 70.2],
     ['Hunter Gaddis', 'RP', 'R', 2.48, 9.4, 3, 95, [SL, FB, CH], 65.1]]),
  T('det', 'Detroit', 'Tigers', 'DET', 'AL', 'Central', '#0c2340', '#fa4616', 4, [['Riley Greene', 'LF', 0.258, 36, 2, 'L'], ['Spencer Torkelson', '1B', 0.240, 31, 1, 'R'], ['Kerry Carpenter', 'RF', 0.252, 26, 0, 'L'], ['Gleyber Torres', '2B', 0.256, 16, 4, 'R']],
    [['Tarik Skubal', 'SP', 'L', 2.21, 11.1, 1.5, 97.6, [FB, CH, SI, SL], 195.1],
     ['Casey Mize', 'SP', 'R', 3.87, 8, 2.4, 95.2, [FB, SPL, SI, SL], 139.2],
     ['Jack Flaherty', 'SP', 'R', 4.64, 10.5, 3.5, 93, [FB, SL, CB, SI], 161],
     ['Will Vest', 'RP', 'R', 3.01, 10, 2.6, 96.4, [FB, SI, SL], 68.2],
     ['Tyler Holton', 'RP', 'L', 4.04, 7.5, 2.6, 92.4, [SI, CH, CT], 64.1]]),
  T('kc', 'Kansas City', 'Royals', 'KC', 'AL', 'Central', '#004687', '#bd9b60', 3, [['Bobby Witt Jr.', 'SS', 0.295, 23, 38, 'R'], ['Vinnie Pasquantino', '1B', 0.264, 32, 0, 'L'], ['Maikel Garcia', '3B', 0.286, 16, 23, 'R'], ['Salvador Perez', 'C', 0.236, 30, 0, 'R']],
    [['Kris Bubic', 'SP', 'L', 2.55, 9.4, 3, 92, [FB, CH, SL, CB], 116.1],
     ['Michael Wacha', 'SP', 'R', 3.86, 7, 2.5, 93, [FB, CH, SI, CT], 172.1],
     ['Seth Lugo', 'SP', 'R', 4.15, 7.9, 3, 92, [FB, CB, SI, SL], 145.1],
     ['Carlos Estévez', 'RP', 'R', 2.45, 8.3, 3.3, 96.2, [FB, SL, CH], 66],
     ['Lucas Erceg', 'RP', 'R', 2.64, 8.8, 3, 97.6, [SI, CH, SL], 61.1]]),
  T('min', 'Minnesota', 'Twins', 'MIN', 'AL', 'Central', '#002b5c', '#d31145', 2, [['Byron Buxton', 'CF', 0.264, 35, 24, 'R'], ['Royce Lewis', '3B', 0.237, 13, 12, 'R'], ['Trevor Larnach', 'RF', 0.250, 17, 1, 'L']],
    [['Joe Ryan', 'SP', 'R', 3.42, 10, 2, 94, [FB, SL, SPL, SI], 171],
     ['Pablo López', 'SP', 'R', 2.74, 8.8, 2.8, 95, [FB, SL, CH, CB], 75.2],
     ['Bailey Ober', 'SP', 'R', 5.10, 7.6, 2, 90, [FB, CH, SL], 146.1],
     ['Cole Sands', 'RP', 'R', 3.50, 10.4, 2.7, 94, [FB, SPL, CB], 70]]),
  // ---- American League West
  T('hou', 'Houston', 'Astros', 'HOU', 'AL', 'West', '#002d62', '#eb6e1f', 3, [['Jeremy Peña', 'SS', 0.304, 17, 20, 'R'], ['Jose Altuve', '2B', 0.265, 26, 10, 'R'], ['Yordan Alvarez', 'DH', 0.273, 6, 1, 'L'], ['Carlos Correa', '3B', 0.276, 13, 0, 'R']],
    [['Hunter Brown', 'SP', 'R', 2.43, 10.5, 3, 96.6, [FB, CB, SI, SL], 185.1],
     ['Framber Valdez', 'SP', 'L', 3.66, 8.8, 3.3, 94, [SI, CB, CH, CT], 192],
     ['Josh Hader', 'RP', 'L', 2.05, 12.6, 2.2, 95, [FB, SL, CH], 52.2],
     ['Bryan Abreu', 'RP', 'R', 2.39, 12.8, 3.8, 97.2, [SL, FB, CB], 71.2]]),
  T('laa', 'Los Angeles', 'Angels', 'LAA', 'AL', 'West', '#ba0021', '#003263', 2, [['Mike Trout', 'DH', 0.232, 26, 2, 'R'], ['Zach Neto', 'SS', 0.257, 26, 26, 'R'], ['Jo Adell', 'RF', 0.236, 37, 5, 'R'], ['Taylor Ward', 'LF', 0.228, 36, 3, 'R']],
    [['Yusei Kikuchi', 'SP', 'L', 3.99, 8.9, 3.9, 94.6, [FB, SL, CB, CH], 178.1],
     ['José Soriano', 'SP', 'R', 4.26, 8.5, 4.1, 97.6, [SI, CB, SPL, SL], 169],
     ['Tyler Anderson', 'SP', 'L', 4.56, 7, 3, 89.5, [CH, FB, CT], 136],
     ['Kenley Jansen', 'RP', 'R', 2.59, 8.3, 2.9, 93, [CT, SI, SL], 59],
     ['Reid Detmers', 'RP', 'L', 4.24, 11, 3.4, 95.2, [FB, SL, CB], 61.2]]),
  T('ath', 'Sacramento', 'Athletics', 'ATH', 'AL', 'West', '#003831', '#efb21e', 2, [['Nick Kurtz', '1B', 0.290, 36, 2, 'L'], ['Brent Rooker', 'DH', 0.262, 30, 6, 'R'], ['Shea Langeliers', 'C', 0.277, 31, 1, 'R'], ['Jacob Wilson', 'SS', 0.311, 13, 4, 'R'], ['Lawrence Butler', 'RF', 0.234, 21, 23, 'L']],
    [['Jeffrey Springs', 'SP', 'L', 4.11, 7.7, 2.9, 91, [FB, CH, SL, SI], 171],
     ['Luis Severino', 'SP', 'R', 4.54, 7.1, 3.1, 95.6, [FB, SI, SL, CT], 162.1],
     ['Jacob Lopez', 'SP', 'L', 4.08, 10, 3.5, 90.5, [FB, SL, CT, CH], 120]]),
  T('sea', 'Seattle', 'Mariners', 'SEA', 'AL', 'West', '#0c2c56', '#00857c', 4, [['Cal Raleigh', 'C', 0.247, 60, 14, 'S'], ['Julio Rodríguez', 'CF', 0.267, 32, 30, 'R'], ['Eugenio Suárez', '3B', 0.228, 49, 3, 'R'], ['Josh Naylor', '1B', 0.295, 20, 30, 'L'], ['Randy Arozarena', 'LF', 0.238, 27, 31, 'R']],
    [['Bryan Woo', 'SP', 'R', 2.94, 9, 1.7, 95.5, [FB, SI, SL, CH], 186.2],
     ['Logan Gilbert', 'SP', 'R', 3.44, 11.5, 2, 95.5, [FB, SL, SPL, CB], 131],
     ['George Kirby', 'SP', 'R', 4.21, 9.1, 2, 96, [FB, SI, SL, CB], 126],
     ['Andrés Muñoz', 'RP', 'R', 1.73, 11.8, 3.5, 98, [SL, FB, HT], 62.1],
     ['Matt Brash', 'RP', 'R', 2.47, 12, 4.5, 97.5, [SL, SI, CB], 47.1]]),
  T('tex', 'Texas', 'Rangers', 'TEX', 'AL', 'West', '#003278', '#c0111f', 3, [['Corey Seager', 'SS', 0.271, 21, 3, 'L'], ['Wyatt Langford', 'LF', 0.241, 22, 22, 'R'], ['Josh Jung', '3B', 0.251, 14, 4, 'R'], ['Marcus Semien', '2B', 0.230, 15, 11, 'R']],
    [['Jacob deGrom', 'SP', 'R', 2.97, 9.6, 1.9, 97.6, [FB, SL, CH, CB], 172.2],
     ['Nathan Eovaldi', 'SP', 'R', 1.73, 9.2, 1.7, 95, [FB, SPL, CB, CT], 130],
     ['Merrill Kelly', 'SP', 'R', 3.52, 8.6, 2.4, 92.4, [FB, CH, CT, CB], 184],
     ['Shawn Armstrong', 'RP', 'R', 2.31, 9.5, 2.3, 95, [CT, FB, SI], 74],
     ['Robert Garcia', 'RP', 'L', 2.95, 10.5, 2.6, 94, [FB, CH, SL], 61]]),
  // ---- National League East
  T('atl', 'Atlanta', 'Braves', 'ATL', 'NL', 'East', '#13274f', '#ce1141', 2, [['Ronald Acuña Jr.', 'RF', 0.290, 21, 9, 'R'], ['Matt Olson', '1B', 0.272, 29, 0, 'L'], ['Drake Baldwin', 'C', 0.274, 19, 0, 'L'], ['Michael Harris II', 'CF', 0.249, 20, 20, 'L'], ['Ozzie Albies', '2B', 0.240, 16, 14, 'S']],
    [['Chris Sale', 'SP', 'L', 2.58, 11.5, 2.5, 94.6, [SL, FB, SI, CH], 125.2],
     ['Spencer Schwellenbach', 'SP', 'R', 3.09, 8.9, 1.4, 96.5, [FB, SL, SPL, CB], 110.2],
     ['Spencer Strider', 'SP', 'R', 4.45, 9.8, 3.4, 95.6, [FB, SL, CB, CH], 125.1],
     ['Raisel Iglesias', 'RP', 'R', 3.21, 10.2, 2.1, 95.6, [FB, CH, SL], 70],
     ['Dylan Lee', 'RP', 'L', 2.03, 10.5, 2.5, 92.5, [SL, FB, CH], 69]]),
  T('mia', 'Miami', 'Marlins', 'MIA', 'NL', 'East', '#00a3e0', '#111111', 2, [['Kyle Stowers', 'LF', 0.288, 25, 6, 'L'], ['Xavier Edwards', 'SS', 0.283, 3, 27, 'S'], ['Agustín Ramírez', 'C', 0.231, 21, 16, 'R'], ['Otto Lopez', '2B', 0.246, 15, 16, 'R']],
    [['Edward Cabrera', 'SP', 'R', 3.53, 10.1, 3.5, 96.6, [CH, CB, SI, FB], 137.2],
     ['Eury Pérez', 'SP', 'R', 4.25, 10, 2.9, 97.6, [FB, SL, CB, CH], 95.1],
     ['Sandy Alcantara', 'SP', 'R', 5.36, 7.3, 3.3, 97.6, [SI, FB, CH, SL], 174.2],
     ['Ronny Henriquez', 'RP', 'R', 2.65, 11.6, 3.4, 97, [SI, SL, CH], 71]]),
  T('nym', 'New York', 'Mets', 'NYM', 'NL', 'East', '#002d72', '#ff5910', 3, [['Juan Soto', 'RF', 0.263, 43, 38, 'L'], ['Francisco Lindor', 'SS', 0.267, 31, 31, 'S'], ['Pete Alonso', '1B', 0.272, 38, 1, 'R'], ['Brandon Nimmo', 'LF', 0.262, 25, 13, 'L']],
    [['Kodai Senga', 'SP', 'R', 3.02, 9.2, 4.1, 95.3, [FB, SPL, CT, SL], 113.1],
     ['David Peterson', 'SP', 'L', 4.22, 8.2, 3.3, 92, [SI, FB, SL, CH], 168.2],
     ['Clay Holmes', 'SP', 'R', 3.53, 6.9, 3.8, 94.5, [SI, SL, CH, SPL], 165.2],
     ['Edwin Díaz', 'RP', 'R', 1.63, 13.4, 2.9, 97.5, [SL, FB], 66.1],
     ['Tyler Rogers', 'RP', 'R', 1.98, 6, 1, 82.8, [SI, SL], 77]]),
  T('phi', 'Philadelphia', 'Phillies', 'PHI', 'NL', 'East', '#e81828', '#002d72', 4, [['Kyle Schwarber', 'DH', 0.240, 56, 10, 'L'], ['Trea Turner', 'SS', 0.304, 15, 36, 'R'], ['Bryce Harper', '1B', 0.261, 27, 12, 'L'], ['Alec Bohm', '3B', 0.287, 11, 6, 'R'], ['J.T. Realmuto', 'C', 0.257, 12, 7, 'R']],
    [['Cristopher Sánchez', 'SP', 'L', 2.50, 9.6, 2, 95, [SI, CH, SL], 202],
     ['Zack Wheeler', 'SP', 'R', 2.71, 11.2, 2, 95.6, [FB, SL, SI, SPL], 149.2],
     ['Jesús Luzardo', 'SP', 'L', 3.92, 10.6, 2.7, 96.6, [FB, SL, CH, SI], 183.2],
     ['Jhoan Duran', 'RP', 'R', 2.18, 10.2, 2.2, 100.2, [SPL, FB, HT], 74.1],
     ['Matt Strahm', 'RP', 'L', 2.74, 10, 3, 92.5, [FB, SL, CB], 62.1]]),
  T('wsh', 'Washington', 'Nationals', 'WSH', 'NL', 'East', '#ab0003', '#14225a', 1, [['James Wood', 'LF', 0.256, 31, 15, 'L'], ['CJ Abrams', 'SS', 0.257, 19, 31, 'L'], ['Dylan Crews', 'RF', 0.214, 10, 17, 'R']],
    [['MacKenzie Gore', 'SP', 'L', 4.17, 10.5, 3.7, 95.5, [FB, CB, SL, CH], 159.2],
     ['Jake Irvin', 'SP', 'R', 5.70, 6.7, 3, 92.5, [FB, CB, SI, CH], 180],
     ['Mitchell Parker', 'SP', 'L', 5.68, 6.4, 3.9, 91.5, [FB, SPL, CB], 165]]),
  // ---- National League Central
  T('chc', 'Chicago', 'Cubs', 'CHC', 'NL', 'Central', '#0e3386', '#cc3433', 4, [['Kyle Tucker', 'RF', 0.266, 22, 25, 'L'], ['Pete Crow-Armstrong', 'CF', 0.247, 31, 35, 'L'], ['Seiya Suzuki', 'DH', 0.245, 32, 5, 'R'], ['Michael Busch', '1B', 0.261, 34, 4, 'L'], ['Nico Hoerner', '2B', 0.297, 7, 29, 'R']],
    [['Matthew Boyd', 'SP', 'L', 3.21, 8.3, 2.3, 92, [FB, CH, SL, SI], 179.2],
     ['Cade Horton', 'SP', 'R', 2.67, 7.8, 2.9, 95.5, [FB, SL, CB, CH], 118],
     ['Shota Imanaga', 'SP', 'L', 3.73, 7.5, 1.5, 91, [FB, SPL, SL, CB], 144.2],
     ['Daniel Palencia', 'RP', 'R', 2.91, 10.6, 2.8, 99.6, [FB, SL, HT], 52.2],
     ['Brad Keller', 'RP', 'R', 2.07, 9.2, 2.8, 97, [FB, SI, SL], 69.2]]),
  T('cin', 'Cincinnati', 'Reds', 'CIN', 'NL', 'Central', '#c6011f', '#111111', 3, [['Elly De La Cruz', 'SS', 0.264, 22, 37, 'S'], ['Spencer Steer', '1B', 0.238, 21, 6, 'R'], ['TJ Friedl', 'CF', 0.261, 14, 12, 'L']],
    [['Hunter Greene', 'SP', 'R', 2.76, 11.5, 2.2, 99.5, [FB, SL, SPL], 107.2],
     ['Andrew Abbott', 'SP', 'L', 2.87, 8.2, 2.5, 93, [FB, SL, CH, CB], 166.1],
     ['Nick Lodolo', 'SP', 'L', 3.33, 8.7, 1.7, 93.5, [SI, CB, CH, FB], 156.2],
     ['Emilio Pagán', 'RP', 'R', 2.88, 10.2, 2.6, 95.6, [FB, SPL, CT], 68.2],
     ['Tony Santillan', 'RP', 'R', 2.44, 10.5, 3.7, 96.5, [FB, SL, SPL], 70]]),
  T('mil', 'Milwaukee', 'Brewers', 'MIL', 'NL', 'Central', '#12284b', '#ffc52f', 4, [['Christian Yelich', 'LF', 0.264, 29, 16, 'L'], ['Jackson Chourio', 'CF', 0.270, 21, 21, 'R'], ['Brice Turang', '2B', 0.288, 18, 24, 'L'], ['William Contreras', 'C', 0.260, 17, 6, 'R']],
    [['Freddy Peralta', 'SP', 'R', 2.70, 10.4, 3.4, 94.5, [FB, CH, CB, SL], 176.2],
     ['Quinn Priester', 'SP', 'R', 3.32, 7.5, 2.8, 94, [SI, SL, CB, CH], 157.1],
     ['Brandon Woodruff', 'SP', 'R', 3.20, 11.8, 1.5, 93, [FB, SI, CH, SL], 64.2],
     ['Trevor Megill', 'RP', 'R', 2.49, 12.6, 2.7, 99, [FB, CB, HT], 47],
     ['Abner Uribe', 'RP', 'R', 1.67, 11.5, 4, 98.6, [SI, SL, HT], 75.2]]),
  T('pit', 'Pittsburgh', 'Pirates', 'PIT', 'NL', 'Central', '#27251f', '#fdb827', 1, [['Oneil Cruz', 'CF', 0.200, 20, 38, 'L'], ['Bryan Reynolds', 'RF', 0.245, 16, 5, 'S'], ['Andrew McCutchen', 'DH', 0.239, 13, 5, 'R']],
    [['Paul Skenes', 'SP', 'R', 1.97, 10.4, 2.2, 98.2, [FB, SL, SPL, SI], 187.2],
     ['Mitch Keller', 'SP', 'R', 4.19, 7.4, 2.5, 95, [FB, SI, SL, CB], 176.1],
     ['Mike Burrows', 'SP', 'R', 3.94, 9.2, 3, 95, [FB, SL, CH, CB], 96],
     ['Dennis Santana', 'RP', 'R', 2.18, 8.9, 2.4, 96, [SI, SL, FB], 70.1]]),
  T('stl', 'St. Louis', 'Cardinals', 'STL', 'NL', 'Central', '#c41e3a', '#0c2340', 2, [['Alec Burleson', 'RF', 0.290, 18, 5, 'L'], ['Iván Herrera', 'C', 0.284, 19, 8, 'R'], ['Willson Contreras', '1B', 0.257, 20, 3, 'R'], ['Masyn Wynn', 'SS', 0.253, 9, 6, 'R']],
    [['Sonny Gray', 'SP', 'R', 4.28, 9.9, 1.9, 92.5, [FB, SL, SI, CB], 180.2],
     ['Matthew Liberatore', 'SP', 'L', 4.21, 7.3, 1.9, 94, [FB, SL, CB, SI], 151.2],
     ['Miles Mikolas', 'SP', 'R', 4.84, 6, 2.3, 93, [FB, SL, SI, CB], 156],
     ["Riley O'Brien", 'RP', 'R', 2.06, 10.5, 3.8, 97.5, [SI, SL, CB], 48],
     ['JoJo Romero', 'RP', 'L', 3.10, 8.5, 4, 94, [SI, SL, CH], 61]]),
  // ---- National League West
  T('ari', 'Arizona', 'Diamondbacks', 'ARI', 'NL', 'West', '#a71930', '#30ced8', 3, [['Corbin Carroll', 'RF', 0.259, 31, 32, 'L'], ['Ketel Marte', '2B', 0.283, 28, 4, 'S'], ['Geraldo Perdomo', 'SS', 0.290, 20, 27, 'S'], ['Gabriel Moreno', 'C', 0.285, 9, 2, 'R']],
    [['Ryne Nelson', 'SP', 'R', 3.39, 7.4, 2.4, 95.5, [FB, SL, CB, CT], 151.1],
     ['Zac Gallen', 'SP', 'R', 4.83, 8.3, 3.1, 93, [FB, CB, CH, SL], 192],
     ['Brandon Pfaadt', 'SP', 'R', 5.13, 7.6, 1.9, 93.5, [FB, SL, CH, SI], 181.1]]),
  T('col', 'Colorado', 'Rockies', 'COL', 'NL', 'West', '#33006f', '#c4ced4', 1, [['Hunter Goodman', 'C', 0.278, 31, 1, 'R'], ['Jordan Beck', 'LF', 0.258, 16, 19, 'R'], ['Brenton Doyle', 'CF', 0.233, 15, 18, 'R'], ['Ezequiel Tovar', 'SS', 0.253, 6, 3, 'R']],
    [['Kyle Freeland', 'SP', 'L', 4.98, 7.2, 2.6, 90, [FB, SL, CB, SI], 162.2],
     ['Chase Dollander', 'SP', 'R', 6.52, 7.8, 4.1, 96.6, [FB, CB, SL, SI], 121],
     ['Germán Márquez', 'SP', 'R', 6.70, 6.6, 3.2, 94.5, [FB, CB, SI, SL], 126],
     ['Victor Vodnik', 'RP', 'R', 3.02, 8.5, 3.6, 98.6, [SI, CH, HT], 62.2]]),
  T('lad', 'Los Angeles', 'Dodgers', 'LAD', 'NL', 'West', '#005a9c', '#c4ced4', 5, [['Shohei Ohtani', 'DH', 0.282, 55, 20, 'L'], ['Freddie Freeman', '1B', 0.295, 24, 6, 'L'], ['Will Smith', 'C', 0.296, 17, 0, 'R'], ['Mookie Betts', 'SS', 0.258, 20, 8, 'R'], ['Teoscar Hernández', 'RF', 0.247, 25, 3, 'R']],
    [['Yoshinobu Yamamoto', 'SP', 'R', 2.49, 10.4, 3, 95.5, [FB, SPL, CB, CT], 173.2],
     ['Blake Snell', 'SP', 'L', 2.35, 11.4, 3.8, 95.5, [FB, CH, CB, SL], 61.1],
     ['Tyler Glasnow', 'SP', 'R', 3.19, 11.2, 3.9, 96.6, [FB, CB, SL, SI], 90.1],
     ['Alex Vesia', 'RP', 'L', 3.02, 12.2, 3.8, 93.5, [FB, SL, CH], 59.2],
     ['Tanner Scott', 'RP', 'L', 4.74, 10.4, 3, 96.6, [SL, FB], 57]]),
  T('sd', 'San Diego', 'Padres', 'SD', 'NL', 'West', '#2f241d', '#ffc425', 4, [['Fernando Tatis Jr.', 'RF', 0.268, 25, 32, 'R'], ['Manny Machado', '3B', 0.275, 27, 14, 'R'], ['Jackson Merrill', 'CF', 0.264, 16, 1, 'L'], ['Xander Bogaerts', 'SS', 0.263, 11, 20, 'R']],
    [['Nick Pivetta', 'SP', 'R', 2.87, 9.4, 2.6, 94.5, [FB, CB, SL, CT], 181.2],
     ['Dylan Cease', 'SP', 'R', 4.55, 11.5, 3.8, 97, [SL, FB, CB, CH], 168],
     ['Michael King', 'SP', 'R', 3.44, 9.6, 3.1, 93.5, [FB, SI, SL, CH], 73.1],
     ['Robert Suarez', 'RP', 'R', 2.97, 9.2, 1.7, 98.5, [FB, CH, HT], 69.2],
     ['Mason Miller', 'RP', 'R', 2.63, 15.2, 3.8, 101.2, [FB, SL, HT], 61.2]]),
  T('sf', 'San Francisco', 'Giants', 'SF', 'NL', 'West', '#fd5a1e', '#27251f', 3, [['Rafael Devers', '1B', 0.252, 35, 1, 'L'], ['Willy Adames', 'SS', 0.225, 30, 12, 'R'], ['Heliot Ramos', 'LF', 0.256, 21, 7, 'R'], ['Matt Chapman', '3B', 0.231, 21, 6, 'R']],
    [['Logan Webb', 'SP', 'R', 3.22, 9.7, 2, 92.5, [SI, CH, SL, FB], 207],
     ['Robbie Ray', 'SP', 'L', 3.65, 9.8, 3.4, 93.5, [FB, SL, CB, CH], 182.1],
     ['Justin Verlander', 'SP', 'R', 3.85, 8.6, 3.1, 94.5, [FB, SL, CB, CH], 152],
     ['Randy Rodríguez', 'RP', 'R', 1.78, 12, 3, 96.5, [FB, SL], 50.2],
     ['Ryan Walker', 'RP', 'R', 4.11, 9.5, 2.8, 94, [SI, SL], 61.1]]),
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
    number: realNumber(name) ?? [24, 7, 12, 27, 99, 2, 44, 19, 3, 8][(k * 3 + team.abbr.charCodeAt(0)) % 10], // (his real number when the look table knows it)
    pos, hand: bats === 'L' ? 'L' : 'R', switch: bats === 'S',
    skin: lookOf({ name }).skin, // (the picture uses looks.js lookOf; kept for older code)
    scale: +(0.97 + rng.range(0, 0.06)).toFixed(3), build: +(0.97 + rng.range(0, 0.1)).toFixed(3),
    con, pow, spd, real: { avg, hr, sb }, // (last season's real numbers)
  };
}
export const starsOf = (t) => t.stars.map((row, k) => starPlayer(t, row, k, createRng(t.id.charCodeAt(0) * 131 + k * 17 + t.id.charCodeAt(t.id.length - 1))));
export const allStars = () => MLB_TEAMS.flatMap((t) => starsOf(t));

// ---------------------------------------------------------------------------------------------------------------
// Pitchers
// ---------------------------------------------------------------------------------------------------------------
/** Innings as written in a box score (109.2 = 109 and two thirds) as a plain number. */
const realInnings = (ip) => Math.floor(ip) + Math.round((ip - Math.floor(ip)) * 10) / 3;
/** A value on the straight line through two points ({ from: [a, b], to: [A, B] }), carried on past them. */
const along = (v, { from, to }) => to[0] + ((v - from[0]) / (from[1] - from[0])) * (to[1] - to[0]);

/** Velocity / Control / Stuff / Stamina (1-99) from an `arms` row (config.season.realArms). */
export function pitcherRatings(row, cfg = CONFIG) {
  const [, role, , , k9, bb9, velo, , ip] = row;
  const R = cfg.season.realArms;
  const c = (v) => Math.max(R.min, Math.min(R.max, Math.round(v)));
  return { vel: c(along(velo, R.velo)), ctl: c(along(bb9, R.bb9)), stf: c(along(k9, R.k9)), sta: c(along(realInnings(ip), R.ip[role] || R.ip.SP)) };
}

const ARM_NUMBERS = [31, 45, 54, 58, 35, 47, 62, 41, 22, 39, 57, 66];
/** The look of the k-th arm of a team (skin, height, build, jersey number - his real one when looks.js knows it), the same every time. */
function armLook(team, k, name = '') {
  const rng = createRng(team.id.charCodeAt(0) * 173 + k * 29 + team.id.charCodeAt(team.id.length - 1) * 7 + 0x5eed);
  return {
    number: realNumber(name) ?? ARM_NUMBERS[(k * 5 + team.abbr.charCodeAt(0)) % ARM_NUMBERS.length],
    skin: name ? lookOf({ name }).skin : SKINS[(team.abbr.charCodeAt(0) + k * 5 + team.abbr.charCodeAt(1)) % SKINS.length],
    scale: +(1.0 + rng.range(0, 0.07)).toFixed(3), build: +(0.98 + rng.range(0, 0.08)).toFixed(3),
  };
}

/** A real pitcher (an `arms` row) as a pitcher object (the shape game/pitching.js uses), with last season's line in `real`. */
export function armPlayer(team, row, k) {
  const [name, role, throws, era, k9, bb9, velo, pitches, ip] = row;
  return {
    id: `${team.id}-p${k}`, name, short: shortName(name), team: team.abbr, teamId: team.id, star: true, role, hand: throws === 'L' ? 'L' : 'R',
    ...pitcherRatings(row), pitches: [...pitches], ...armLook(team, k, name),
    real: { era, k9, bb9, velo, ip }, // (last season's real line)
  };
}

/** A generated arm for a club short of real names: ratings around the club's tier (realArms.filler), pitches like Sandlot's staff. */
function fillerArm(team, role, k, used, cfg = CONFIG) {
  const R = cfg.season.realArms, F = R.filler, S = cfg.pitching.staff;
  const rng = createRng(team.id.charCodeAt(0) * 389 + k * 61 + team.id.charCodeAt(team.id.length - 1) * 11 + 0xa2f);
  let name;
  do { name = rng.pick(FIRST_NAMES) + ' ' + rng.pick(LAST_NAMES); } while (used.has(name));
  used.add(name);
  const rating = () => Math.max(1, Math.min(99, Math.round(rng.gauss(F.base + F.perTier * team.tier, F.sd))));
  const n = role === 'SP' ? S.starterPitches : rng.int(S.relieverPitches[0], S.relieverPitches[1]);
  const others = S.pool.filter((t) => t !== 'fastball');
  const pitches = ['fastball'];
  while (pitches.length < Math.min(n, S.pool.length)) pitches.push(others.splice(rng.int(0, others.length - 1), 1)[0]);
  return {
    id: `${team.id}-p${k}`, name, short: shortName(name), team: team.abbr, teamId: team.id, star: false, role, hand: rng.chance(F.left) ? 'L' : 'R',
    vel: rating(), ctl: rating(), stf: rating(), pitches, ...armLook(team, k),
    sta: Math.max(1, Math.min(99, Math.round(along(F.ip[role], R.ip[role]) + rng.gauss(0, F.sd)))),
  };
}

/**
 * A club's five arms: its three starters (the table's order: the ace first) then its two relievers. Real ones from the table; a
 * club short of real names gets generated arms in the empty places.
 */
export function armsOf(team, cfg = CONFIG) {
  const used = new Set((team.arms || []).map((r) => r[0]));
  const out = [];
  for (const [role, n] of [['SP', 3], ['RP', 2]]) {
    const rows = (team.arms || []).filter((r) => r[1] === role).slice(0, n);
    for (const r of rows) out.push(armPlayer(team, r, out.length));
    for (let i = rows.length; i < n; i++) out.push(fillerArm(team, role, out.length, used, cfg));
  }
  return out;
}
/** Every club's real arms (no generated ones), e.g. for the shop. */
export const allArms = () => MLB_TEAMS.flatMap((t) => armsOf(t).filter((p) => p.real));

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
