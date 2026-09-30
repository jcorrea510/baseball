// The file names the game understands in public/sounds/umpire/ (no imports: the build script uses this too).
//
//     strike.mp3    "Strike!"                     (any strike; strike1 / strike2 are used first when they exist)
//     strike1.mp3   "Strike one!"                 (the first strike of a count)
//     strike2.mp3   "Strike two!"
//     playball.mp3  "Play ball!"                  (the start of a game)
//     ball.mp3      "Ball!"                       (also used for ball four, unless ball4.mp3 exists)
//     strike3.mp3   "Strike three! You're out!"
//     foul.mp3      "Foul ball!"
//     out.mp3       "Out!"
//     safe.mp3      "Safe!"
//     ball4.mp3     (optional) "Ball four!"
//     strike_b.mp3, strike_c.mp3 ...  (optional) more takes of the same call: a call, an underscore and ONE letter; one take is
//                                     picked at random each time
// .mp3, .wav and .ogg all work; capital letters do not matter.

/** Which recordings can play each call, best first. */
export const FILES_FOR = {
  strike: ['strike'],
  strikeSwing: ['strike'],
  strike1: ['strike1', 'strike'],
  strike2: ['strike2', 'strike'],
  playball: ['playball'],
  strike3: ['strike3'],
  strike3Swing: ['strike3'],
  ball: ['ball'],
  ball4: ['ball4', 'ball'],
  foul: ['foul'],
  safe: ['safe'],
  out: ['out'],
};
/** Every call name that can have a recording. */
export const FILE_NAMES = ['strike', 'strike1', 'strike2', 'ball', 'strike3', 'foul', 'out', 'safe', 'ball4', 'playball'];
export const FILE_EXTENSIONS = ['mp3', 'wav', 'ogg'];

/** "Strike_B.MP3" -> { name: 'strike', take: 'b' };  anything the game does not understand -> null. */
export function parseUmpireFile(file) {
  const m = /^([a-z0-9]+?)(?:_([a-z]))?\.(mp3|wav|ogg)$/i.exec(String(file).trim());
  if (!m) return null;
  const name = m[1].toLowerCase();
  if (!FILE_NAMES.includes(name)) return null;
  return { name, take: (m[2] || '').toLowerCase() };
}
