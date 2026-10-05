// ============================================================================
//  SANDLOT - config.js
//  EVERY tunable number in the game lives here. If something feels too hard,
//  too easy, too slow or too fast, this is the file to change.
//
//  Units: distances in FEET, speeds in MPH unless a name says "fps" (feet per
//  second), times in SECONDS unless a name ends in "Ms" (milliseconds).
//
//  Coordinate system (used everywhere in the game code):
//    origin  = back tip of home plate
//    +x      = toward first base / right field   (left of the screen when you
//              look from the pitcher's side; RIGHT of the screen from behind
//              the plate)
//    -z      = toward the pitcher / center field (the way the camera looks)
//    +y      = up
//    spray angle: 0 = straight to center, negative = left field, positive = right field
// ============================================================================

export const MPH = 1.4666667; // feet per second in one mph

export const CONFIG = {
  // --------------------------------------------------------------------------
  //  Ballpark geometry
  // --------------------------------------------------------------------------
  field: {
    baseDistance: 90,
    moundDistance: 60.5, // from the back tip of the plate to the rubber
    moundHeight: 0.85,
    // Fence distance (ft) at a few spray angles; the game smooths between them.
    // Make the numbers smaller to make home runs easier.
    fencePoints: [
      [-45, 315],
      [-22.5, 362],
      [0, 390],
      [22.5, 362],
      [45, 315],
    ],
    fenceHeight: 10, // ball must clear this to be a home run
    warningTrack: 18, // dirt strip in front of the wall
    foulPoleHeight: 48,
    // Grandstand behind the fence (drives both the drawing and where a home run lands)
    stands: { slope: 0.62, depth: 70 },
  },

  // Ballparks. Sandlot Park is the field above. The big-league parks have their real shapes and wall heights - distances
  // down the left-field line, left-center, center, right-center and the right-field line (ft), wall heights at the same five
  // places - made `scale` times as big so home runs stay about as common as at Sandlot Park. `extra`: more [spray angle, ft]
  // points for odd corners (Fenway's triangle, Oracle's Triples Alley). `air`: x the air drag - thinner air at Coors Field carries the ball, the damp night air at Oracle Park holds it up.
  // `wall`: the padding colour. Each club plays its League home games in its own park.
  parks: {
    scale: 0.96,
    // Citi Field's home-run apple: its top hat stands `back` ft behind the centre-field fence at `angle` deg (just behind the batter's
    // eye, the brim over the hedge at `hatTop` ft), the apple (radius `r`) hidden inside; a home run by the home team brings it up
    // in `rise` s, it stays `stay` s and sinks back in `sink` s
    apple: { angle: 5, back: 16, hatR: 13, hatTop: 44, r: 10, rise: 2.5, stay: 9, sink: 3 },
    list: {
      sandlot: { name: 'Sandlot Park', wall: '#0f3d24' },
      bal: { name: 'Camden Yards', fence: [333, 384, 400, 373, 318], walls: [13, 13, 7, 7, 25], wall: '#123a2a' },
      bos: { name: 'Fenway Park', fence: [310, 379, 390, 380, 302], walls: [37, 37, 17, 5, 3], extra: [[16, 420]], wall: '#1f5232' },
      nyy: { name: 'Yankee Stadium', fence: [318, 399, 408, 385, 314], walls: [8, 8, 8, 8, 8], wall: '#14213a' },
      tb: { name: 'Tropicana Field', fence: [315, 370, 404, 370, 322], walls: [11, 9, 9, 9, 11], wall: '#1b2a49' },
      tor: { name: 'Rogers Centre', fence: [328, 368, 400, 359, 328], walls: [14, 12, 10, 12, 14], wall: '#163a6b' },
      cws: { name: 'Rate Field', fence: [330, 377, 400, 372, 335], walls: [8, 8, 8, 8, 8], wall: '#1b1d22' },
      cle: { name: 'Progressive Field', fence: [325, 370, 400, 375, 325], walls: [19, 19, 9, 9, 9], wall: '#173248' },
      det: { name: 'Comerica Park', fence: [345, 370, 412, 365, 330], walls: [7, 7, 7, 7, 8], wall: '#14243a' },
      kc: { name: 'Kauffman Stadium', fence: [330, 387, 410, 387, 330], walls: [9, 9, 9, 9, 9], wall: '#1a3554' },
      min: { name: 'Target Field', fence: [339, 377, 404, 365, 328], walls: [8, 8, 8, 23, 23], wall: '#1d2633' },
      hou: { name: 'Daikin Park', fence: [315, 362, 409, 373, 326], walls: [21, 21, 10, 10, 7], wall: '#1f2a3c' },
      laa: { name: 'Angel Stadium', fence: [330, 387, 396, 370, 330], walls: [5, 8, 8, 18, 18], wall: '#163b2c' },
      ath: { name: 'Sutter Health Park', fence: [330, 388, 403, 388, 325], walls: [8, 8, 8, 8, 8], wall: '#174233' },
      sea: { name: 'T-Mobile Park', fence: [331, 378, 401, 381, 326], walls: [8, 8, 8, 8, 8], wall: '#14342e' },
      tex: { name: 'Globe Life Field', fence: [329, 372, 407, 374, 326], walls: [14, 8, 8, 8, 8], wall: '#152d4f' },
      atl: { name: 'Truist Park', fence: [335, 385, 400, 375, 325], walls: [6, 6, 8, 16, 16], wall: '#14234a' },
      mia: { name: 'loanDepot park', fence: [344, 386, 400, 387, 335], walls: [7, 7, 11, 7, 7], wall: '#11303d' },
      nym: { name: 'Citi Field', fence: [335, 370, 408, 375, 330], walls: [8, 8, 8, 8, 8], wall: '#151a1f' },
      phi: { name: 'Citizens Bank Park', fence: [329, 374, 401, 369, 330], walls: [11, 11, 6, 13, 13], wall: '#183d2a' },
      wsh: { name: 'Nationals Park', fence: [337, 377, 402, 370, 335], walls: [8, 8, 8, 14, 14], wall: '#1b2440' },
      chc: { name: 'Wrigley Field', fence: [355, 368, 400, 368, 353], walls: [11.5, 11.5, 11.5, 11.5, 11.5], wall: '#2c5a24' },
      cin: { name: 'Great American Ball Park', fence: [328, 379, 404, 370, 325], walls: [12, 12, 8, 8, 8], wall: '#1a1d23' },
      mil: { name: 'American Family Field', fence: [344, 371, 400, 374, 345], walls: [8, 8, 8, 8, 8], wall: '#1a2a44' },
      pit: { name: 'PNC Park', fence: [325, 383, 399, 375, 320], walls: [6, 6, 10, 21, 21], wall: '#191c21' },
      stl: { name: 'Busch Stadium', fence: [336, 375, 400, 375, 335], walls: [8, 8, 8, 8, 8], wall: '#143a28' },
      ari: { name: 'Chase Field', fence: [330, 374, 407, 374, 334], walls: [8, 8, 25, 8, 8], wall: '#202024' },
      col: { name: 'Coors Field', fence: [347, 390, 415, 375, 350], walls: [8, 8, 8, 14, 17], wall: '#173326', air: 0.96 },
      lad: { name: 'Dodger Stadium', fence: [330, 375, 395, 375, 330], walls: [8, 8, 8, 8, 8], wall: '#123a6b' },
      sd: { name: 'Petco Park', fence: [334, 357, 396, 382, 322], walls: [8, 8, 8, 8, 8], wall: '#12283f' },
      sf: { name: 'Oracle Park', fence: [339, 364, 399, 415, 309], walls: [8, 8, 8, 20, 25], wall: '#18291f', air: 1.08 },
    },
    // How each park LOOKS (only the picture - the field above is what plays). Every key is optional:
    //   seats: seat colour (or a list from the bottom rows up: Dodger Stadium's pastel levels); facade: the colour of the back of
    //   the stands; decks: extra upper decks round the infield (0-2); frieze: a white frieze along the roof (Yankee Stadium);
    //   roof: 'dome' (closed) or 'open' (a retractable roof stacked open beyond the outfield); backdrop: what you see beyond the
    //   outfield ('skyline', 'mountains', 'snowpeaks', 'desert', 'hills', 'trees', 'water' - a list for several); wallStyle:
    //   'ivy' or 'brick' (else padded in the wall colour); mow: the grass pattern ('stripes', 'checker', 'diamond', 'waves',
    //   'turf'); grass / dirt: tints; features: the park's landmarks (built in render/parkLook.js).
    looks: {
      sandlot: { backdrop: ['trees'], mow: 'stripes' },
      bal: { seats: '#1f5a36', facade: '#6e3a2a', backdrop: ['skyline'], features: ['warehouse'], mow: 'stripes' },
      bos: { seats: '#26553a', facade: '#2a3a30', backdrop: ['skyline'], features: ['citgo'], mow: 'checker', decks: 0 },
      nyy: { seats: '#1c3770', facade: '#c9ccd0', decks: 2, frieze: true, backdrop: ['skyline'], mow: 'stripes' },
      tb: { seats: '#1d3d70', roof: 'dome', features: ['catwalks'], mow: 'turf', grass: '#3f8f4a' },
      tor: { seats: '#1f4b8f', roof: 'open', backdrop: ['skyline'], features: ['cntower'], mow: 'turf', grass: '#3c8a4c' },
      cws: { seats: '#2b2e35', facade: '#17191d', decks: 1, backdrop: ['skyline'], mow: 'diamond' },
      cle: { seats: '#1f3a5f', decks: 1, backdrop: ['skyline'], mow: 'stripes' },
      det: { seats: '#1f4b39', backdrop: ['skyline'], features: ['fountain'], mow: 'checker' },
      kc: { seats: '#1d4c8c', backdrop: ['hills'], features: ['fountains', 'crown'], mow: 'diamond' },
      min: { seats: '#22314c', facade: '#b5a888', backdrop: ['skyline'], mow: 'stripes' },
      hou: { seats: '#1b2d50', roof: 'dome', features: ['train'], mow: 'stripes' },
      laa: { seats: '#7c1f2c', backdrop: ['mountains'], features: ['rocks', 'bigA'], mow: 'checker' },
      ath: { seats: '#2a5a3c', decks: 0, backdrop: ['trees', 'hills'], features: ['berm'], mow: 'stripes' },
      sea: { seats: '#1e405f', roof: 'open', backdrop: ['skyline', 'water'], mow: 'waves' },
      tex: { seats: '#1d3b6e', roof: 'dome', mow: 'stripes' },
      atl: { seats: '#1d2f56', decks: 1, backdrop: ['skyline', 'trees'], mow: 'diamond' },
      mia: { seats: '#14708f', roof: 'dome', features: ['palms'], mow: 'stripes', grass: '#4f9a4f' },
      nym: { seats: '#1f4a3a', facade: '#6c3427', decks: 1, backdrop: ['skyline'], features: ['apple'], mow: 'checker' },
      phi: { seats: '#1f3a6e', backdrop: ['skyline'], features: ['bell'], mow: 'stripes' },
      wsh: { seats: '#1f305c', backdrop: ['skyline'], features: ['capitol'], mow: 'waves' },
      chc: { seats: '#1f5234', facade: '#264530', wallStyle: 'ivy', decks: 0, features: ['rooftops'], mow: 'stripes' },
      cin: { seats: '#a3222b', backdrop: ['hills', 'water'], features: ['smokestacks'], mow: 'checker' },
      mil: { seats: '#1d3a67', roof: 'dome', mow: 'diamond' },
      pit: { seats: '#1d2e4b', facade: '#5b3a2a', backdrop: ['skyline', 'water'], features: ['bridge'], mow: 'checker' },
      stl: { seats: '#a3272c', facade: '#6b3527', decks: 1, backdrop: ['skyline'], features: ['arch'], mow: 'diamond' },
      ari: { seats: '#1f5250', roof: 'open', backdrop: ['desert'], features: ['pool'], mow: 'stripes' },
      col: { seats: '#255a3b', decks: 1, backdrop: ['snowpeaks'], features: ['pines', 'purpleRow'], mow: 'stripes' },
      lad: { seats: ['#f2d36b', '#e8a04f', '#7fc6d6', '#3f7fc4'], decks: 2, backdrop: ['hills'], features: ['palms', 'pavilions'], mow: 'checker' },
      sd: { seats: '#1d3653', backdrop: ['skyline'], features: ['westernMetal', 'palms'], mow: 'stripes', dirt: '#b98a5c' },
      sf: { seats: '#1f4a38', facade: '#6e3a2a', backdrop: ['water'], features: ['cove', 'bottle'], mow: 'checker' },
    },
  },

  // --------------------------------------------------------------------------
  //  Physics for the batted ball
  // --------------------------------------------------------------------------
  physics: {
    gravity: 32.174, // ft/s^2
    ballRadius: 0.1208, // ft (1.45 in)
    dragK: 0.0017, // air drag (higher = ball dies in the air sooner)
    magnusK: 2.55e-5, // lift from backspin (higher = ball carries farther)
    groundRestitution: 0.42, // how bouncy the grass is
    bounceSoftFrom: 30, bounceSoftTo: 75, bounceHardKeep: 0.89, // ...a ball landing faster than bounceSoftFrom ft/s keeps less, down to bounceHardKeep x at bounceSoftTo
    trackRestitution: 0.93, // the warning track's dirt keeps this share of the grass's bounce
    groundFriction: 0.8, // fraction of sideways speed kept each bounce
    rollDecel: 13, // ft/s^2 slowing of a rolling ball
    stopSpeed: 0.8, // ft/s: below this a rolling ball is "stopped"
    wallRestitution: 0.34,
    wallFriction: 0.72,
    netHeight: 28, // ft: the backstop net behind home plate (a foul ball back over the catcher hits it, or goes over into the crowd)
    dt: 1 / 240, // fixed physics step (do not tie to frame rate)
    maxTime: 16,
  },

  // --------------------------------------------------------------------------
  //  Pitching
  // --------------------------------------------------------------------------
  pitch: {
    releaseZ: -54.5, // ball leaves the hand ~6 ft in front of the rubber
    contactZ: -1.0, // the plane where timing is measured (front-center of plate)
    catchZ: 1.15, // where the catcher's mitt sits
    // A foul tip: a ball that glances off the bat and carries on straight back INTO the catcher's mitt (spray beyond `spray`
    // degrees, launch inside `launch`, and still within `mittX` ft of the middle and `mittY` ft high as it reaches him) - a strike,
    // and strike three with two strikes. Anything that misses the mitt (over his head, into the dirt, off to the side) is a foul ball.
    foulTip: { spray: 150, launch: [-12, 18], mittX: 1.3, mittY: [0.9, 3.9] },
    drag: 0.085, // fraction of speed a pitch loses on the way to the plate
    zoneBottom: 1.55, // strike zone (ft above ground)
    zoneTop: 3.4,
    zoneHalfWidth: 0.708 + 0.121, // half the plate + one ball radius (edge counts)
    // How far from the middle of the zone the pitcher's targets are, in 'zone widths' (1.0 = the edge of the zone; the bat can
    // reach out to timing.reachRatio, and hits only weakly beyond timing.chaseRatio).
    locations: { edge: [0.9, 1.3], chase: [1.3, 1.9], waste: [1.9, 2.9] },
    // Where the batter is: a pitch crossing this far inside (ft from the middle of the plate, toward him) at this height hits him
    hitBatter: { inner: 1.75, outer: 3.3, low: 0.6, high: 5.3 },
    wasteMinRatio: 1.75, // a 'waste' pitch is never wilder in the wrong direction than this: it stays out of reach
    ballScale: 1.5, // pitches are drawn a bit bigger so they are easy to track
    // Seeing the ball (all of it is picture only): a thin dark rim keeps a white ball visible against clouds, dirt and crowd; a soft
    // shadow right under it on the ground shows where it is and when it passes the plate; a short streak behind it shows its curve and
    // speed. No glow.
    rimColor: 0x0b1230, rimOpacity: 0.78, rimScale: 1.16,
    shadowOpacity: 0.6, shadowRadius: 0.5,
    trailColor: 0xdfe9ff, trailSize: 0.36, trailSeconds: 0.11, trailStrength: 0.6, // (a longer streak shows which way it is heading)
    // ...and on screen at least this many pixels across (or this fraction of the screen height, whichever is bigger) while it still
    // grows as it comes in: at release a real-size ball is only ~2.5 px on a phone held sideways. Only the picture: timing is unchanged.
    minScreenPx: 6,
    handMinScreenPx: 3.5, // the ball in the pitcher's throwing hand is drawn at least this big, so you can see which hand it is in
    minScreenFrac: 0.009,
    // Movement is measured at the plate. breakArm: feet toward the pitcher's
    // throwing-arm side (negative = glove side). hop: feet of "extra rise"
    // (negative = extra drop) compared with plain gravity.
    types: {
      fastball: { label: 'Fastball', code: 'FB', speedDelta: 0, breakArm: 0.32, hop: 0.55, spinRpm: 2200, spin: 'back', armSlot: 0, glove: 0 },
      changeup: { label: 'Changeup', code: 'CH', speedDelta: -12, breakArm: 0.85, hop: -0.15, spinRpm: 1400, spin: 'back', armSlot: -0.05, glove: 1 },
      curveball: { label: 'Curveball', code: 'CB', speedDelta: -17, breakArm: -0.55, hop: -1.95, spinRpm: 2500, spin: 'top', armSlot: 0.22, glove: 2 },
      slider: { label: 'Slider', code: 'SL', speedDelta: -7, breakArm: -0.95, hop: -0.5, spinRpm: 2400, spin: 'side', armSlot: -0.16, glove: 3 },
      // The three a real pitcher's arsenal can add (never in the level mixes - only in a pitcher's own list): a sinker runs arm side and
      // dives, a cutter slides a little to the glove side and stays up, a splitter tumbles down with a little arm-side fade.
      sinker: { label: 'Sinker', code: 'SI', speedDelta: -2, breakArm: 0.7, hop: -0.25, spinRpm: 2150, spin: 'back', armSlot: 0, glove: 0 },
      cutter: { label: 'Cutter', code: 'CT', speedDelta: -4, breakArm: -0.35, hop: 0.35, spinRpm: 2400, spin: 'side', armSlot: 0, glove: 3 },
      splitter: { label: 'Splitter', code: 'SP', speedDelta: -9, breakArm: 0.3, hop: -1.2, spinRpm: 1200, spin: 'back', armSlot: -0.03, glove: 1 },
      heater: { label: 'Heater', code: 'HT', speedDelta: 0, breakArm: 0.1, hop: 0.9, spinRpm: 2500, spin: 'back', armSlot: 0.05, glove: 0 },
    },
    heaterSpeed: [100, 104],
    arsenalFast: 0.45, // a pitcher with his own list of pitches throws his fastball (and sinker) this share of the time; his other pitches split the rest
    windup: { ready: 0.3 }, // (per-difficulty windup lengths are below)
    // The pitch guide: a soft circle over the strike zone that guesses where the pitch will cross the plate. It fades in part of the
    // way through the flight, is a little off, and at first assumes the pitch will not break (curveballs and sliders only show where
    // they end up late). How early / how exact it is depends on the level: see `difficulty.<level>.guide`.
    guide: {
      color: 0xffe8a6, // soft warm white (never green or red: the colour must not give the call away)
      radiusStart: 0.42, // ft: the circle's size when it appears (a ball is 0.24 ft across)...
      radiusEnd: 0.16, // ...closing in to just bigger than the ball by the time the guess has homed in (`sharpen` of each level)
      maxAlpha: 0.62, // how see-through it stays even when fully faded in
    },
  },

  // --------------------------------------------------------------------------
  //  Pitching  (you throw the computer's half: aim a dot, then tap as a shrinking ring meets it)
  // --------------------------------------------------------------------------
  pitching: {
    // The timing ring. It shrinks onto the aimed dot; the tap is graded by how many milliseconds off the moment of meeting it was.
    ring: {
      time: 0.9, // seconds the ring takes to shrink (a fastball from an average pitcher)
      hitAt: 0.75, // the ring meets the dot this share of the way through its time
      perfect: 40, // ms either side of the meeting that still counts as PERFECT
      good: 90, // ms either side that counts as GOOD
      ok: 160, // ms either side that counts as OK (anything later or earlier, or no tap, is WILD)
    },
    delivery: 1.1, // seconds from the tap to the ball leaving the hand
    nextPitch: 1.5, // seconds between a result and the next aiming screen
    // What each grade does to the pitch: `speed` = share of full speed, `brk` = share of the pitch's break,
    // `miss` = how far (feet, one standard deviation) it can miss the dot.
    grades: {
      perfect: { speed: 1, brk: 1, miss: 0.05 },
      good: { speed: 0.98, brk: 0.9, miss: 0.15 },
      ok: { speed: 0.94, brk: 0.7, miss: 0.3 },
      wild: { speed: 0.9, brk: 1, miss: 0.7 },
    },
    // A wild pitch is either a "hang" (floats over the middle with hardly any break) or a "sail" (misses the dot by a lot).
    hang: {
      share: 0.5, // chance a wild pitch is a hang
      pull: 0.6, // how far toward the middle of the zone it is pulled (0 = stays on the dot, 1 = dead centre)
      up: 0.35, // feet it then rises
      brk: 0.3, // share of its break it keeps
    },
    // How much faster the ring shrinks for each pitch (a harder pitch is harder to time).
    ringSpeed: { fastball: 1, sinker: 1, changeup: 1.05, cutter: 1.05, slider: 1.1, splitter: 1.1, curveball: 1.15, heater: 1.3 },
    control: 0.15, // ring time is this much longer / shorter (share) for a pitcher with Control 99 / 1
    velo: [86, 100], // fastball speed (mph) for Velocity 1 / 99
    stuff: [0.8, 1.2], // how much a pitch breaks (share of normal) for Stuff 1 / 99
    // Stamina: a pitcher has a tank that each pitch drains; below `tireFrom` of a full tank he gets tired.
    stamina: {
      starter: [60, 95], // size of a starter's tank for Stamina 1 / 99
      reliever: [20, 35], // size of a reliever's tank for Stamina 1 / 99
      cost: 1, // what an ordinary pitch costs
      risp: 1.2, // times the cost with a runner in scoring position
      threeBalls: 1.15, // times the cost on a three-ball count
      heater: 1.3, // times the cost of the heater
      tireFrom: 0.4, // the tank share below which he starts to tire
      tireRing: 0.35, // fully tired: the ring shrinks this much faster
      tireVelo: 4, // fully tired: mph lost
      tireBreak: 0.2, // fully tired: share of the break lost
      tireMiss: 0.3, // fully tired: misses this much further
    },
    painted: 0.15, // a pitch this close (feet) to the edge of the zone counts as PAINTED
    // The big moments of pitching (app.js): your strikeout gets a short slow-motion beat, the crowd roars and an inning-ending one is celebrated.
    moments: {
      punchOutScale: 0.3, // speed of that slow motion (1 = normal)
      punchOutDuration: 0.35, // real seconds it lasts (it eases back to normal speed)
      punchOutDelay: 0.05, // real seconds after the called strike before it starts
      roar: { level: 0.85, seconds: 3 }, // the crowd's roar for your strikeout
      cheer: { level: 0.45, seconds: 2 }, // the cheer for any other out you make
      groanHit: 0.5, // how loud the groan is for one of their hits (a homer: x 1.6)
    },
    catcherArm: { rookie: 0.9, pro: 1, allstar: 1.05 }, // your catcher's throwing, by level
    fieldErrorScale: { rookie: 0.6, pro: 0.8, allstar: 1 }, // how often your fielders boot a ball, by level
    // Sandlot's own pitchers (teams.makeStaff: the staff when you have no League club): ratings drawn around `mean` (spread `sd`).
    staff: {
      starters: 2, relievers: 2,
      mean: 50, sd: 8,
      starterPitches: 3, // a starter throws his fastball and this many pitches in all
      relieverPitches: [2, 3], // a reliever throws between this many
      pool: ['fastball', 'changeup', 'curveball', 'slider'], // what they can throw (the fastball always)
    },
    badges: { strikeouts: 10 }, // strikeouts in one game for the "10 K" badge
    // Sim (skip an inning): how the pitches are graded when the computer plays them for you.
    sim: {
      grades: { perfect: 0.25, good: 0.4, ok: 0.27, wild: 0.08 }, // chance of each grade
      wildMax: 250, // ms: a simulated WILD tap lands between the OK window and this far from the moment (early or late)
      clearBatter: 0.5, // ft: it never aims closer to the batter than this inside the line where a pitch hits him (its misses would hit him far too often)
      step: 0.25, // s of engine time per step while Sim finishes a half (nothing is drawn; every play is fast-forwarded)
      chunk: 6, // batters played at a time before it checks whether to pull the pitcher
      pullAt: 0.15, // the tank share at which a simmed pitcher is replaced
    },
  },

  // --------------------------------------------------------------------------
  //  The computer's batter when you pitch (game/cpuBatter.js). Shared numbers; each level's own are in difficulty.<level>.cpuBat.
  //  Balanced with scripts/pitchfeel.mjs (the bands in tests/pitchfeel.test.js: an average person gives up about the old simulated half's
  //  runs on each level, a good one clearly fewer, a new one clearly more, Pro strikeouts 20-35%).
  // --------------------------------------------------------------------------
  cpuBat: {
    readTime: 0.22, // s before the swing must start that he judges where the pitch will cross
    readGuide: 'pro', // ...starting from this level's pitch guide on every level (your guide changes with the level; his read only by his readSd)
    breakRead: 0.6, // his read gets this much worse per foot the pitch breaks (x(1 + this x break in ft))
    // Share of his read / timing error each grade of YOUR pitch causes (the hang floats over the middle: easy to square up). Wide on purpose:
    // a PERFECT tap is clearly harder to hit than a GOOD one, so a good pitcher gives up clearly fewer runs (pitchfeel good <= .75 x average).
    gradeFactor: { perfect: 2.0, good: 1.2, ok: 0.8, hang: 0.5, sail: 1 },
    fadeOut: 1.4, // x his read error on a pitch that starts in the zone and finishes outside it (the slider off the corner)
    fadePull: 0.2, // ...and his read is also pulled this share of the way back toward where that pitch started (x the grade factor, at most all the way): he sees a strike and chases it
    // His chance to swing, by where he THINKS the pitch will cross (zoneBoxRatio bands in `bands`). "Two" = two strikes.
    swing: {
      zone: 0.72, zoneTwo: 0.9, // a strike
      edge: 0.18, edgeTwo: 0.45, // on the corner (a ball he reads as a ball: he mostly takes it - he still chases many he misreads as strikes)
      chase: 0.08, chaseTwo: 0.22, // tempting but out of the zone
      waste: 0.03, // way out of reach
      threeOhHeart: 0.3, // 3-0: he takes everything except a pitch he thinks is right down the middle, and only a power hitter...
      threeOhPower: 70, // ...with at least this Power rating
      aheadHeart: 1.15, aheadEdge: 0.6, // ahead in the count (2-0, 3-1): more swings at the heart, fewer on the corners
      aheadBy: 2, // balls minus strikes that counts as "ahead" (3-0 has its own rule)
      starChase: 0.4, // a Contact 99 star swings this much less (share) on the corner and chase rows (a Contact 1 hitter this much more)
      bands: { heart: 0.5, zone: 1, edge: 1.3, chase: 1.9 }, // where heart / strike / corner / chase end (cpuBatter.zoneBoxRatio: 1 = the edge of the umpire's zone)
    },
    changeBias: 6, // ms of timing error per mph the pitch is slower (early) or faster (late) than his last two pitches
    changeCap: 70, // ms: the most that speed change can throw his timing off (at 9 / 90 every change of speed was a sure miss: K came from the pitch order alone)
    edgeTiming: 12, // ms late added when he thinks it is on the edge...
    edgeFrom: 0.9, // ...meaning a perceived zoneBoxRatio above this
    protectSd: 0.8, // two strikes: timing spread x this (he just tries to make contact)...
    protectSpeed: 0.92, // ...and his bat speed x this (more fouls) - the engine uses this
    under: 0.25, // how far under the middle of the ball he aims (share of his sweet zone: fly balls)
    strengthSd: 0.12, // a batter with no ratings: errors x(1 - this x team strength k)
    strengthEv: 2, // ...and exit velocity +this many mph x k
  },

  // --------------------------------------------------------------------------
  //  Swing timing  (the heart of the game)
  //  errorMs = (when the bat reaches the plate) - (when the ball crosses it)
  //  negative = early, positive = late
  // --------------------------------------------------------------------------
  timing: {
    perfectMs: 20,
    goodMs: 42,
    earlyMs: 80, // beyond "good", up to here = weak/foul contact
    lateMs: 56, // late window is shorter (the catcher has the ball by then)
    swingDelay: 0.115, // seconds from pressing the button until the bat is at the plate
    decideTime: 0.22, // s a person needs to see where a pitch is going and press (used to judge how readable the pitch guide is)
    inputDelayMaxMs: 150, // the Settings "Swing timing" adjustment goes up to this (ms taken off every press on a laggy screen)
    inputDelayStepMs: 10,
    followThrough: 0.42,
    // Visual limits on how far in front of / behind the plate the bat can meet the ball
    reachEarly: 0.03,
    reachLate: 0.012,
    minSwingTime: 0.05,
    // Contact zone: how far outside the strike zone the bat can still reach
    reachRatio: 1.48, // 1.0 = zone edge. beyond this the bat whiffs
    chaseRatio: 1.14, // beyond this, contact is capped at "weak"
    zoneHalfHeight: 0.92,
    zoneCenterY: 2.5,
  },

  // --------------------------------------------------------------------------
  //  Contact: how timing + pitch location become exit velocity / angles
  // --------------------------------------------------------------------------
  contact: {
    maxExitVelocity: 112, // mph: about the hardest a ball comes off the bat (for the "how well was it hit" readouts)
    exitVelocityFloor: 38,
    spray: {
      // Where the barrel faces at contact comes from the timing: right on time it faces centre field; early it is out front and
      // pulls the ball (this many degrees at the edge of the early / late window), late it is behind and sends it the other way.
      timingMax: 40,
      timingCurve: 1.3,
    },
  },

  // --------------------------------------------------------------------------
  //  The swing (game/contact.js): you aim the sweet spot of the bat with the cursor and time the swing. Timing gives the barrel its
  //  speed and direction; where the bat meets the ball (under it, square, on top) and where on the barrel decide the rest, through the
  //  real collision in physics/bat.js.
  // --------------------------------------------------------------------------
  swing: {
    batSpeed: 75, // mph: the barrel's speed at the sweet spot on a perfectly timed swing (a big-league average)
    q: 0.2, // collision efficiency (exit speed = q x pitch speed + (1 + q) x bat speed, head on): turns extra exit speed into bat speed
    // fraction of that speed the barrel has when it meets the ball, across each timing window (from its centre to its edge)
    timingSpeed: { perfect: [1.0, 0.98], good: [0.95, 0.86], weak: [0.84, 0.66] },
    attack: 10, // degrees: the barrel is moving slightly upward through the zone (an uppercut) at the middle of the zone...
    attackPerFt: 5, // ...more on a low pitch, less on a high one (degrees per foot below / above the middle)
    attackRange: [2, 18],
    // The swing is "on plane": an early swing meets the ball out in front where it is higher, but the barrel is higher there too.
    // Only this share of the difference in height is left over against where the bat was aimed (counted up to planeEarly / planeLate s off)
    onPlane: 0.85, planeEarly: 0.1, planeLate: 0.07,
    maxGraze: 0.97, // (at the very edge of the window the bat just grazes the ball)
    handleSlow: 0.3, // in on the hands the bat is moving this much slower (at the very end of the window)
    offBarrel: 0.45, // ...and off the sweet spot it bounces this much less at the edge of the window
    offBarrelMass: 0.6, // ...and more of the bat recoils
    pullBias: 12, // degrees: a well-timed swing meets the ball a touch out front and sends it a little toward the pull side (left-centre for a right-handed hitter)
    endSpray: 7, // degrees: off the end of the bat the ball goes this much more the other way (in on the hands, pulled)
    chase: { from: 1.15, to: 1.6, speedLoss: 0.22 }, // reaching for a ball out of the zone (zone widths) costs bat speed
    squared: [-0.3, 0.62], // a ball hit inside this part of the window (and near the sweet spot) counts as squared up for the grade
    squaredAlong: 0.45,
    // aim help (difficulty.<level>.aimAssist = how much): where the bat meets the ball, as a share of the sweet zone, is pulled back
    // into `band` (under the ball's middle +, on top -: from a low line drive to a high fly) and along the bat into +-`alongBand`
    assist: { band: [0.1, 0.8], alongBand: 0.3 },
    noise: { ev: 0.7, launch: { perfect: 0.8, good: 1.2, weak: 2.2 }, spray: { perfect: 2.5, good: 4, weak: 6.5 } }, // degrees / mph of human scatter
    // where the bat can be aimed (the cursor is held inside this box over the plate): feet from the middle of the plate, height range
    reach: { x: 1.9, yMin: 0.85, yMax: 4.5 },
  },

  // The pitching picture (render/pitchAim.js): the target dot, the faint arc of the chosen pitch's break, the shrinking timing ring and
  // the grade flash. All of it is picture only.
  pitchAim: {
    dot: 0.42, // ft: radius of the target dot (the ring shrinks to exactly this size when you should tap)
    dotColor: 0xffffff, dotOpacity: 0.5, rimColor: 0x0a1020, // the dot is a see-through disc with a ring round it and a dark outline
    ringWidth: 0.12, // ft: how thick the timing ring is
    ringColor: 0xffffff, ringOpacity: 0.95,
    ringPerfect: 0xffd24a, // the ring turns this colour while a tap would be PERFECT
    arcSteps: 14, arcFrom: 0.6, // the arc: this many points over the last 40% of the flight (from 60% of it onward)
    arcColor: 0x7fd8ff, arcOpacity: 0.85, arcPointPx: 5,
    flashTime: 1.1, // seconds the grade stays up
    flashRise: 0.7, // ft the word floats up while it fades
    flashSize: [2.6, 0.95], // ft: the word's width and height
    colors: { perfect: '#ffd24a', good: '#7dffb0', ok: '#ffffff', wild: '#ff6a4a' }, // the word's colour per grade
    fade: 0.12, // seconds to fade the dot in / out
  },

  // The see-through bat you aim with (render/batAim.js) and how the cursor / keys / a finger move it
  batAim: {
    color: 0xffffff, opacity: 0.4, spotColor: 0xffe08a, spotOpacity: 0.95,
    tilt: 0.2, tiltRefY: 2.6, tiltPerFt: 0.22, tiltRange: [0.04, 0.6], // radians the barrel dips (more on a low pitch)
    buntTilt: -0.05, // squared around to bunt the bat is held level (barrel a touch up)
    fadeTime: 0.18, // s to fade in / out
    holdAfterSwing: 0.35, fadeAfterSwing: 0.5, // after a swing it stays where it was swung this long, then fades
    follow: 0.03, // s: how closely it follows the cursor (a touch of weight, never a lag you can feel)
    keySpeed: 3.2, // ft/s when moved with the arrow keys / W A S D
    touchGain: 1.15, // a finger drag moves it this many times the distance the finger moves on the plate (so the finger never covers it)
    tapPx: 10, // a finger that moves less than this has not dragged
    showWithin: 9, // the bat shows once the camera is this close to the catcher's view (ft)
  },

  // --------------------------------------------------------------------------
  //  The bat and the collision (physics/bat.js): real sizes and the measured bat-ball numbers
  // --------------------------------------------------------------------------
  bat: {
    barrelRadius: 0.108, // ft (a 2.6 in barrel)
    cor: 0.5, // coefficient of restitution between a wood bat and a baseball at game speeds
    massRatio: 0.25, // ball mass / the bat's effective mass at the sweet spot (the bat gives a little)
    friction: 0.5, // bat-ball friction
    slipKeep: 0.6, // fraction of its slide across the bat a ball keeps (5/7 if a rigid ball rolled; a real one grips a little more)
    spinCarry: 0.25, // share of the pitch's own spin that survives the collision
    spinKeep: 0.35, // a real ball squashes on the bat and leaves with about this share of a rigid ball's spin (measured: ~2,500 rpm for a ball hit 1 in under centre)
  },

  // --------------------------------------------------------------------------
  //  Bunting (B squares the batter around; the swing button pushes the bat at the ball)
  // --------------------------------------------------------------------------
  bunt: {
    windowMs: [45, 115], // ms of timing error: inside the first, a clean bunt; worse up to the second; beyond it the bunt misses
    reachRatio: 1.3, // (zone widths) pitches further out than this cannot be bunted
    // The bat held out square touches the ball only where it really is: ft from the bat's sweet spot to the ball's centre - above /
    // below (ball + barrel radius, plus a hair for the see-through bat), toward the end of the bat, toward the hands. Easier levels
    // (and a better Contact rating) widen it by half their timing help (`touchByLevel`).
    touch: { up: 0.3, tip: 0.95, handle: 0.85 },
    touchByLevel: 0.5,
    exitVelocity: [24, 42], // mph: a soft, well-placed bunt .. one that got away from you
    goodLaunch: -12, // degrees: a good bunt is pushed down into the grass
    popLaunch: 32, // ...a bad one pops up
    launchSpread: 6,
    spray: [4, 22], // degrees off centre (random side) when you do not aim
    aimSpray: [16, 30], // ...and toward the line you aim at (hold left / right)
    sprayNoise: 6,
    foulChance: 0.45, // chance a poor bunt is pushed foul (scaled down for a good one)
    leadMargin: 0.6, // s: on a bunt the fielder only goes after the lead runner when he would beat him by this much (else the sure out at first)
    // Squared around (B), he holds the bat out where you put it: the pitch meets it if the bat is there (inside `touch`). A bat further than `offerDist` ft from the pitch is pulled back (he takes it). His timing is off by about
    // `holdTimingSd` ms. A ball met within `middleW` of the middle of the bat goes back toward the pitcher, nearer the end up a line.
    offerDist: 1.25,
    holdTimingSd: 18,
    middleW: 0.3,
  },

  // --------------------------------------------------------------------------
  //  Difficulty levels
  // --------------------------------------------------------------------------
  difficulty: {
    rookie: {
      label: 'Rookie',
      swingCue: true, // the strike-zone box pulses at the perfect moment to press the button
      windowScale: 1.5,
      // The bat's contact window (ft): how far the ball's centre can be above / below the sweet spot (`up`) and toward the end of the
      // bat / the hands and still be hit. The middle of `up` hits a line drive, a little under it a fly ball, above it a grounder.
      contactWindow: { up: 0.66, tip: 1.05, handle: 0.9 },
      // ...and the sweet zone inside it: how the ball comes off depends on where it is in THIS (smaller) part - beyond it, still
      // inside the contact window, the bat only gets a piece of the ball (a foul tip, a pop-up, a chopper).
      sweetSpot: { up: 0.58, tip: 1.0, handle: 0.85 },
      aimAssist: 0.85, // share of a badly aimed contact pulled back into the good part of the bat (swing.assist): a thumb a little off still makes good contact
      // The computer's batter when YOU pitch (game/cpuBatter.js): his own numbers, never your batting help (balanced with scripts/pitchfeel.mjs).
      cpuBat: {
        readSd: 0.06, // ft: how far off his read of where the pitch will cross is (before break, grade and his ratings change it)
        timingSd: 44, // ms: how far off his swing timing is
        aimSd: 0.055, // ft: how far off he moves the bat from where he read the pitch
        window: { up: 0.5, tip: 0.95, handle: 0.8, sweet: { up: 0.42, tip: 0.9, handle: 0.75 } }, // his bat's contact window (same on every level to start)
        windowScale: 1, // his timing windows (1 = as wide as the level's base)
        aimAssist: 0, // he gets no aim help
      },
      batBonus: 5, // mph of extra bat speed (slower pitches come off the bat slower: this keeps the easy level from being the weakest)
      fastball: [62, 72],
      mix: { fastball: 0.62, changeup: 0.12, curveball: 0.13, slider: 0.13, heater: 0 },
      // Where the computer pitcher throws (odds before the count changes them): 'heart' = in the zone, 'edge' = on the corners,
      // 'chase' = tempting but out of the zone, 'waste' = way out of reach (in the dirt, high heat, way off the plate).
      locations: { heart: 0.68, edge: 0.16, chase: 0.09, waste: 0.07 },
      // Pitch guide (see pitch.guide): fadeIn = fractions of the flight (0 = release, 1 = plate) where it starts and finishes fading in;
      // reveal = where it starts / finishes showing the pitch's break; error = feet the guess is typically off when it first shows; over
      // the `sharpen` part of the flight it homes in until it is exactly where the ball will cross.
      guide: { fadeIn: [0.02, 0.1], reveal: [0.0, 0.2], error: 0.1, sharpen: [0.05, 0.5] },
      pitchPace: 1.25, // the ball takes this many times longer to reach the plate than a real pitch at the speed shown (the speed shown,
      // the timing windows and how hard the ball comes off the bat are unchanged: it is just easier to see and to get the bat on)
      commandSigma: 0.12, // ft of pitcher inaccuracy
      hitBatter: 0.006, // chance a pitch gets away from him, inside at the batter (hit by pitch: your batter takes first base) - about once every 3-5 games
      errorScale: 1.5, // how often the defense makes errors (x fielding.errors)
      catcherArm: 0.74, // x the catcher's exchange time on a steal. Set with each level's windup and pitch speed for steal success ~88% / 75% / 55%
      movementScale: 0.6,
      tellStrength: 1.0,
      announcePitch: true, // the pitch type is shown as he winds up
      typeAtRelease: true, // ...and when it leaves his hand
      windup: 1.3,
      stealBreak: 1.03, // s before the pitch is released that a runner takes off on a steal (the pitcher's first move)
      derbyFoulIsOut: false,
    },
    pro: {
      label: 'Pro',
      windowScale: 1.2,
      contactWindow: { up: 0.53, tip: 0.9, handle: 0.76 },
      sweetSpot: { up: 0.46, tip: 0.82, handle: 0.7 },
      aimAssist: 0.75,
      // The computer's batter when YOU pitch (game/cpuBatter.js): his own numbers, never your batting help (balanced with scripts/pitchfeel.mjs).
      cpuBat: {
        readSd: 0.035, // ft: how far off his read of where the pitch will cross is (before break, grade and his ratings change it)
        timingSd: 32, // ms: how far off his swing timing is
        aimSd: 0.03, // ft: how far off he moves the bat from where he read the pitch
        window: { up: 0.5, tip: 0.95, handle: 0.8, sweet: { up: 0.42, tip: 0.9, handle: 0.75 } }, // his bat's contact window (same on every level to start)
        windowScale: 1, // his timing windows (1 = as wide as the level's base)
        aimAssist: 0, // he gets no aim help
      },
      batBonus: -0.5,
      fastball: [80, 90],
      mix: { fastball: 0.46, changeup: 0.18, curveball: 0.18, slider: 0.18, heater: 0 },
      locations: { heart: 0.52, edge: 0.08, chase: 0.21, waste: 0.19 },
      guide: { fadeIn: [0.03, 0.12], reveal: [0.04, 0.32], error: 0.2, sharpen: [0.08, 0.6] },
      pitchPace: 1.42,
      commandSigma: 0.28,
      hitBatter: 0.008,
      errorScale: 1.0,
      catcherArm: 1.05,
      movementScale: 1.0,
      tellStrength: 0.6,
      announcePitch: false,
      typeAtRelease: true, // the pitch type shows the moment it leaves his hand (a batter reads the spin): a curveball will drop
      windup: 1.15,
      stealBreak: 0.9,
      derbyFoulIsOut: true,
      swingCue: false,
    },
    allstar: {
      label: 'All-Star',
      windowScale: 0.88,
      contactWindow: { up: 0.48, tip: 0.84, handle: 0.72 },
      sweetSpot: { up: 0.41, tip: 0.74, handle: 0.64 },
      aimAssist: 0.6,
      // The computer's batter when YOU pitch (game/cpuBatter.js): his own numbers, never your batting help (balanced with scripts/pitchfeel.mjs).
      cpuBat: {
        readSd: 0.025, // ft: how far off his read of where the pitch will cross is (before break, grade and his ratings change it)
        timingSd: 30, // ms: how far off his swing timing is
        aimSd: 0.025, // ft: how far off he moves the bat from where he read the pitch
        window: { up: 0.5, tip: 0.95, handle: 0.8, sweet: { up: 0.42, tip: 0.9, handle: 0.75 } }, // his bat's contact window (same on every level to start)
        windowScale: 1, // his timing windows (1 = as wide as the level's base)
        aimAssist: 0, // he gets no aim help
      },
      batBonus: -1.5,
      fastball: [88, 98],
      mix: { fastball: 0.36, changeup: 0.18, curveball: 0.17, slider: 0.19, heater: 0.1 },
      locations: { heart: 0.32, edge: 0.15, chase: 0.29, waste: 0.24 },
      guide: { fadeIn: [0.045, 0.15], reveal: [0.05, 0.4], error: 0.26, sharpen: [0.1, 0.7] },
      pitchPace: 1.42,
      commandSigma: 0.42,
      hitBatter: 0.01,
      errorScale: 0.7,
      catcherArm: 1.1,
      movementScale: 1.25,
      tellStrength: 0.28,
      announcePitch: false,
      typeAtRelease: false, // All-Star: read it yourself (arm slot tells)
      windup: 1.05,
      stealBreak: 0.83,
      derbyFoulIsOut: true,
      swingCue: false,
    },
  },

  // Wild pitches: a pitch in the dirt (crossing lower than `lowY` ft) or way wide (`wideX` ft off the middle) with runners on now and then
  // gets past the catcher (`chance` by level - better catchers on the harder levels). It rolls to about `rollTo` ft behind the plate in
  // `rollTime` s; runners see it get by and go `react` s after it reaches the catcher; the man on third goes only if he beats the
  // throw home by `homeMargin` s.
  wildPitch: { lowY: 0.75, wideX: 2.1, chance: { rookie: 0.14, pro: 0.1, allstar: 0.08 }, rollTo: 48, rollTime: 1.25, react: 0.25, homeMargin: 0.2, coverAt: [0.9, 0.9] }, // coverAt: where the pitcher covering home stands (x, z ft: on the plate, a step to the first-base side)

  // --------------------------------------------------------------------------
  //  Pacing (seconds). Keep these short: the game is meant to feel snappy.
  // --------------------------------------------------------------------------
  pace: {
    firstPitchDelay: 0.85, // batter walks up to the plate
    nextPitchDelay: 0.95, // gap between the call and the pitcher starting again (a moment to breathe between pitches)
    afterReady: 0.7, // s between pressing Ready for a new batter and the pitcher starting his windup
    callDisplay: 0.75, // how long the ball/strike call is shown
    playEndPause: 0.8, // pause after a play finishes
    pitcherSet: 0.65, // s the pitcher (and catcher) need to be set once they are back in place: no pitch before it
    fastForward: 4.5, // speed multiplier when you tap to skip a play
    summaryMin: 1.6, // seconds the highlights of a Sim stay up at least (then they go by themselves)
    summaryTail: 0.9, // ...plus this long after the last line has shown
    recapLine: 0.55, // seconds per line of the highlights of a half you simmed
  },

  // --------------------------------------------------------------------------
  //  Game feel
  // --------------------------------------------------------------------------
  feel: {
    hitStopPerfect: 0.075, // freeze frame on perfect contact (seconds of real time)
    hitStopGood: 0.035,
    shakePerfect: 1.0,
    shakeGood: 0.5,
    shakeHomer: 0.7,
    slowMoScale: 0.28, // home-run slow motion speed (1 = normal)
    slowMoDuration: 0.85, // real seconds of slow-mo
    trailMinExitVelocity: 88, // mph needed to get a ball trail
    bigHitExitVelocity: 95, // mph at which the exit velocity/distance callout appears
    bigHitDistance: 250, // ft
  },

  // --------------------------------------------------------------------------
  //  Fielding and baserunning (used to decide hit / out / extra bases)
  // --------------------------------------------------------------------------
  fielding: {
    replanReact: 0.25, // s: when you give a runner an order, the fielders carry on as before for this long, then change their plans
    replanBlend: 0.22, // s: when you send a runner and the play is planned again, a fielder whose job changed eases onto his new run over about this long
    // Where each defender stands. Outfielders are given as [spray degrees, feet from home].
    positions: {
      P: [0, -60.5],
      C: [0, 4.0],
      '1B': [58, -80], // (big-league depth: the corners about 100 ft from home, the middle infielders about 140)
      '2B': [36, -134],
      SS: [-38, -136],
      '3B': [-59, -88],
    },
    outfield: { LF: [-24, 272], CF: [0, 308], RF: [24, 272] },
    // Where they stand for the situation (set before every pitch): with a runner on first and second base open the first baseman
    // holds him on, on the front edge of the bag (`hold1B`); when a double play is on (a runner on first, fewer than two outs) the
    // shortstop and second baseman play double-play depth, a few steps nearer second and in (`dpDepth`).
    align: { hold1B: [60.5, -61.5], dpDepth: { SS: [-28, -126], '2B': [27, -124] } },
    speed: { IF: 20, OF: 22.5, P: 21, C: 17 }, // ft/s, average (effective, includes getting up to speed)
    reaction: { IF: 0.31, OF: 0.41, P: 0.36, C: 0.36 }, // seconds before a fielder reads the ball (outfielders read a ball off the bat a little slower: well-hit balls drop in more often)
    glove: 2.4, // ft: how far a fielder can reach without diving
    diveExtra: 3.0, // extra ft when diving (dive only on low balls)
    groundGlove: 2.9, // ft: an infielder's reach for a ground ball without diving (he stretches and backhands it)...
    groundDive: 3.6, // ...and the extra reach of a dive for one
    attemptMiss: 7, // ft: a ground ball that gets through this close to an infielder still sees him lunge or dive for it
    reachHeight: 8.8, // highest catchable point (ft): a leaping catch
    standReach: 6.2, // ft: how high his glove reaches with both feet on the ground (higher than this he has to jump)
    catchHeight: 5.2, // ft: a fielder who is there in time waits for the ball to come down to about this (chest / head height) before he takes it;
    // if he cannot wait he takes it at the lowest height he still can, and only jumps (up to reachHeight) for a ball he can get no other way - at the wall, say
    groundHeight: 3.2, // a ball this low counts as a ground ball for fielding
    // the infield fly rule (runners on 1st and 2nd or the bases loaded, fewer than two outs): a pop-up at least `apex` ft high that an
    // infielder settles under within `range` ft of home - the batter is out, caught or not; the umpire calls it `callBefore` s before it comes down
    infieldFly: { apex: 45, range: 160, callBefore: 1.0, callAfterApex: 0.3 }, // (the umpire calls it as the ball peaks - a moment after the top of its flight - and at the latest callBefore s before the catch)
    transfer: { IF: 0.36, OF: 0.65, C: 0.4, P: 0.42 },
    homeThrowMargin: 0.45, // s: on a grounder with the runner on third breaking for home, the fielder throws home only when he has him by this much
    pivot: 0.9, // s: the middle infielder turning a double play - catch, clear the sliding runner, throw to first // catch-to-throw time (an outfielder gathers himself and crow-hops)
    throwSpeed: { IF: 120, OF: 100, C: 112, P: 100 }, // ft/s, on average over the whole throw (a long outfield throw is lobbed a little)
    relayDistance: 200, // outfield throws longer than this use a cut-off man
    relayTransfer: 0.3,
    accel: 0.42, // seconds fielders take to get up to running speed (they cannot cover ground instantly)
    brake: 40, // ft/s^2: how hard a fielder can slow down (he eases to a stop instead of halting dead)
    minRunEffort: 0.62, // when a fielder has time to spare he still runs at least this fraction of top speed, then waits
    supportSpeed: 0.85, // backups and base-coverers run at this fraction of top speed
    backupDepth: 24, // ft behind the fielder's spot where a teammate backs him up
    backupTravel: 48, // an outfielder backing up an infield play charges in at most this far
    backupFirst: 30, // ft behind first base (along the throw) where the right fielder backs up an infielder's throw
    catcherLine: [26, -21], // where the catcher runs to, down the first-base line, behind a throw to first with the bases empty
    pitcherBackupTravel: 32, // the pitcher backing up home or third goes at most this far (he has to be back on the rubber for the next pitch)
    // The wall: a fielder's centre never gets closer than `wallMargin` ft to a wall (his glove still reaches it). Running at
    // the wall he brakes at up to `wallBrake` ft/s^2 (bracing against it), so he stops in front of it instead of through it.
    wallMargin: 1.8,
    wallBody: 1.0, // half his body width: while braking his centre may get this close to the wall
    wallBrake: 110,
    jogHome: { speed: 21, accel: 34, brake: 42 }, // ft/s: how fielders return to their spots after a play
    turnRate: 640, // degrees per second a fielder can turn his body
    // Diving: only for balls just out of running reach (glove + diveExtra). He sprints at the ball, launches `airTime` before
    // the glove meets it, lands `landAfter` after the catch, slides, lies there with the ball, then gets up.
    dive: {
      airTime: 0.32, // s airborne before the glove meets the ball
      landAfter: 0.12, // s after the catch that his body touches down
      armReach: 3.4, // ft the glove reaches in front of a layed-out body
      slideDecel: 30, // ft/s^2 sliding along the grass
      landSpeed: 11, // ft/s, top touchdown speed
      hold: 0.1, // s lying with the ball
      getUp: 0.45, // s to get back onto his feet (he pops straight up)
      throwSet: 0.35, // s from on his feet to letting the throw go (he never throws before he is up)
      preferRun: 0.2, // nobody dives for a ball a fielder can simply run to within this many seconds
    },
    // Covering a base: an out needs a fielder standing on the bag WITH the ball before the runner gets there. Whoever is not fielding
    // the ball and is nearest to the play breaks for the bag; the fielder with the ball either carries it there himself (when he
    // is close) or throws to the covering man, and the throw is timed to reach the bag when he does.
    cover: {
      start: 0.3, // s after contact that a fielder assigned to a bag breaks for it (a pitcher covering first leaves the mound at once)
      minSpeed: 20, // ft/s: a fielder sprinting to a bag runs at least this fast (a pitcher covering first is not slow, he is hustling)
      selfDistance: 18, // ft: a fielder who picks the ball up this close to the bag steps on it himself (a first baseman near the bag)
      selfStart: 0.12, // s after he fields it before he starts for the bag with the ball
      carrySpeed: 24, // ft/s: a fielder taking the ball to the bag himself sprints there...
      carryAccel: 0.24, // ...getting up to speed quickly (s), turning for the bag the moment he has the ball
      maxCarry: 45, // ft: farther from the bag than this he throws to whoever is covering instead of running it over
      firstMaxCarry: 95, // ft: a first baseman runs it over himself from up to this far away when that is quicker than the pitcher covering
      selfBonus: 0.25, // s: how much a close fielder prefers taking the bag himself over a throw (it is the natural play)
      firstSelfDistance: 20, // ft: a first baseman who fields it this close to first base takes the bag himself (no flip to the pitcher)
      firstSelfBonus: 0.3, // s: and strongly prefers that to a throw - the pitcher only covers when the first baseman is pulled far off the bag
      traditionBonus: 0.35, // s: the usual man covers unless someone else is clearly quicker (the pitcher covers first when the first baseman is pulled off)
    },
    chaseShare: 0.72, // how much of the way to the ball the OTHER outfielder runs on a ball hit to the outfield (he runs at it too)
    thinForce: 0.1, // s: a force play that beats the runner by less than this is 'thin'...
    thinForceGain: 0.25, // s: ...and the fielder takes the batter at first instead when that out is this much safer
    tagTime: 0.15, // extra time for the catcher to receive a throw and apply the tag at home (he blocks the plate: a throw that beats the runner gets him)
    fastBallPenalty: 0.2, // extra reaction (s) fielders need on the hardest-hit grounders
    closePlay: 0.45, // a runner who beats the throw by less than this many seconds gets a 'Safe!' call
    outMargin: 0.02, // a throw must beat the runner by this many seconds
    tagUpMargin: 0.3, // s: the man on third tags up and goes home by himself on a fly when he beats the throw by this much
    tagUpDepth: 200, // ft: a liner caught this deep is one a runner can tag up on too (not only a fly ball)
    runnerMargin: 0.35, // s: a runner takes an extra base by himself only when he beats the throw by this much (no bang-bang plays he did not ask for)
    // Errors (rare): a grounder bobbled, a fly ball dropped. Chance per chance, x difficulty.<level>.errorScale; hard chances (a smash,
    // a dive, a leap) are `hardFactor` times as likely. The ball pops loose `looseDist` ft and he needs `bobbleTime` / `dropTime` to
    // pick it up again - the batter and runners take whatever that delay gives them. A bobbled grounder always costs the out: when a
    // throw after picking it up would still beat the batter (or a forced runner) by less than `safeMargin` s, the ball squirts further
    // (up to `looseMax` ft) - the picture never shows a throw beating a runner who was called safe.
    errors: { ground: 0.057, fly: 0.018, hardFactor: 2, bobbleTime: 0.95, dropTime: 0.85, looseDist: 5, looseMax: 40, safeMargin: 0.3 },
  },
  // Stealing a base (S / the Steal button before the pitch; quick games only). The runner goes with the pitcher's first move;
  // the catcher's exchange and throw race him to the bag, and the man covering needs a moment to put the tag on. Everything is
  // real timing (the same runner and fielder models as every play), with a little seeded luck in the jump and the exchange.
  steal: {
    jump: { 1: 0.02, 2: 0.03 }, // how much later a runner going to third breaks than one going to second is the difference (the level's stealBreak sets the rest)
    jumpSd: 0.09, // s: how much a jump varies (a good one, a late one)
    transfer: 0.74, // s: the catcher's exchange (catch to release)
    transferSd: 0.07,
    dirtExtra: 0.35, // s more when he has to dig a pitch out of the dirt
    tagTime: 0.12, // s to put the tag on at second or third
    coverReact: 0.35, // s after the runner goes that the infielder covering the bag breaks for it
    noThrow: 0.55, // s: if the runner would beat the throw by more than this, the catcher does not throw
    readFoul: 0.3, // s after contact a runner going with the pitch sees it is foul and pulls up
    readFly: 0.8, // s after contact he has read a fly ball (a line drive he only sees caught)
  },
  // The computer's base running when YOU pitch (game/cpuRunner.js; the test bot's send judgement uses the same code).
  cpuRun: {
    gamble: 0.015, // chance (per look) it sends a runner it should not have - people misjudge too
    look: [0.15, 0.6], // s after the ball is down before it first looks at sending a runner (a random moment in this range)
    every: 0.4, // s between looks after that
    steal: 0.06, // chance a runner with a free base ahead goes on a pitch (an average runner, an even count)
    stealFast: 2, // times as often for the fastest runner (Speed 99)
    stealSlow: 0.3, // times as often for the slowest runner (Speed 1)
    stealCount: 1.5, // times as often on a count that favours the runner (1-0, 2-1)
  },
  runner: {
    speed: 30.2, // ft/s top running speed
    accelTime: 0.42, // s a runner takes to get up to speed from a standstill
    brake: 55, // ft/s^2: how hard he can slow down (he brakes into a base, or slides)
    turnBrake: 30, // ft/s^2: how firmly he eases off for a corner (gentler than the stop at a bag)
    latAccel: 50, // ft/s^2: sideways grip in a turn. Speed in a turn is at most sqrt(latAccel / curvature), so he slows for the corner
    lead: 9, // ft: how far off the bag a runner stands before the pitch
    // What a runner does while the ball is in the air: he waits this long (s) before breaking for the next base (a fly ball or a pop-up
    // might be caught; a grounder he goes on at once).
    read: { ground: 0, line: 0.12, fly: 0.5, pop: 0.7 },
    // Sending runners (you tap a base on the little diamond: the runner behind it goes there - a base only lights up when nobody is
    // already heading for it). You can send them from `sendFrom` s after contact - on a ball in the air every runner does the same
    // whether it will be caught or not, so the diamond gives nothing away - until `sendAfter` s after the fielder is ready to throw.
    // The defense picks where to throw `sendLead` s before he is ready; a runner sent after that is chased by a second throw if it
    // can get him. A runner reacts `sendReact` s after the tap.
    sendFrom: 0.1,
    sendAfter: 0.45,
    sendLead: 0.1,
    sendReact: 0.05,
    sendTag: 0.08, // s for the fielder to catch the throw and put the tag on a runner you sent (a throw that beats him gets him)
    tagLead: 0.1, // s: the tag goes on him this long before he would have touched the bag (he slides into the glove)
    outLinger: 1.7, // s the play goes on after a runner is tagged out, so you see the tag and see him walk off
    walkOffDelay: 1.3, // s after the tag before he gets up and walks to the dugout
    walkOffSpeed: 13, // ft/s: he jogs off (and is gone by the next pitch)
    // The play stays live until it is over: you can send a runner on or call him back as often as you like. The fielders see a runner
    // change his mind `liveRead` s after he does, and answer from wherever the ball is (a rundown). With every runner standing on a
    // bag the play still waits `liveHold` s before it ends, so there is time to send somebody.
    liveRead: 0.2,
    liveHold: 0.9,
    // A fielder with the ball on the bag a runner is heading for walks up the line to tag him (instead of waiting on the bag) when the
    // runner is still `min` s away: he starts `react` s after he has the ball and needs `pickup` s to get going, then `speed` ft/s, never further than `maxOut` ft from the
    // bag, and the tag goes on when his glove is `reach` ft from the runner.
    walkUp: { min: 0.6, react: 0.15, pickup: 0.25, speed: 12, maxOut: 36, reach: 3 },
    // the live play's small numbers: he aims his walk at where the runner will be `aimAhead` s on; a man more than `offBag` ft from
    // the bag steps back on before a tag; a walk shorter than `minWalk` ft (when the runner turns round) or a meeting closer than
    // `minMeet` ft to the bag is no walk at all; a runner within `arrived` s of the bag is there; the man with the ball is ready
    // `afterTag` s after a tag; the defense makes at most `maxPlays` decisions in one play
    live: { aimAhead: 0.4, offBag: 1.5, minWalk: 0.5, minMeet: 1, arrived: 0.05, afterTag: 0.1, maxPlays: 24 },
    // after a play runners stand on their bag and only walk out to their lead `leadAfterSet` s after the pitcher is set again; a runner
    // who holds on a hit goes back to his bag `holdBackDelay` s after the ball is fielded, at `holdBackSpeed` ft/s
    leadAfterSet: 0.6,
    holdBackDelay: 0.3,
    holdBackSpeed: 10,
    autoMargin: 0.05, // s: a runner who would make one more base by this much takes it by himself (as the ball comes down, and again when the window closes)
    // false: on a hit or a ground ball a runner only moves by himself when he is FORCED (the batter pushes him on); a runner with an
    // open base behind him stays put until you tap the base ahead of him. (Runners going with the pitch - a steal - keep going, and the
    // man on third still tags up by himself on a fly ball when it is a sure thing.) true: a free runner takes the next base by himself
    // when it is safe.
    freeAdvance: false,
    autoExtra: false, // false: a runner (the batter too) NEVER takes an extra base by himself - one base (or where he is forced), more only when you send him. true: he takes one more when it is safe by autoMargin
    retreatRead: 0.3, // s after the throw is let go: a runner you sent who sees it will beat him turns back to the bag he left (when he can make it back)
    // On a ball to the outfield a runner rounds his base, pulls up `roundPast` ft beyond it (braking at `roundBrake` ft/s^2) and waits.
    roundPast: 14,
    roundBrake: 30,
    // On a ball in the air (fewer than two outs) a runner on first - or second, unless it is deep - goes `halfway` (a share of the
    // way to the next base) and waits; the man on third, and on second on a ball coming down past `tagDepth` ft, goes back to his bag
    // to tag up (`tagBack` s after contact). Once it is down or caught they react in `downReact` s.
    halfway: 0.45,
    halfwayDepth: [150, 330], // ft: on a fly coming down this shallow he only takes a step (`stayStep`), this deep he goes `halfway`
    stayStep: 0.1,
    halfwayLine: 0.22, // (on a line drive only a few steps - after a moment's freeze, `read.line`)
    // A ball in the air that no fielder gets within `sureHitFeet` ft of is a plain hit: runners read it `sureHitRead` s after contact
    // and go, instead of waiting to see it land.
    sureHitFeet: 10,
    sureHitRead: 0.55,
    contactBreak: 0.15, // s: on a ground ball (fewer than two outs) the runner on third breaks for home this soon after contact
    tagDepth: 320,
    tagBack: 0.12,
    downReact: 0.15,
    tagReact: 0.02, // s after the catch a runner tagging up leaves the bag (he times it)...
    reverseBrake: 75, // ft/s^2: told to turn round, he plants and stops this hard (two quick choppy steps from a sprint, ~0.4 s) before he runs back
    turnKeep: 0.9,
    pivotFrom: 0.6, // radians: a runner whose way changes more than this at once (he turned round) swings his body round over a moment
    pivotRate: 16, // ...this quickly (about a quarter second for a full about-turn) // radians: told to go somewhere nearly the way he is already running, he carries on; anything more and he pulls up and turns
    tagRoll: 19, // ...with a rocking start: he is already moving at this many ft/s as he leaves
    tagWindow: 1.2, // s after a catch you can still send a runner to tag up
    leadThird: 16, // ft: off third he walks off in foul territory as the pitch comes in (a walking lead)
    leadSecond: 22, // ft: the lead off second base (nobody holds him on there, so he takes a much bigger one - and shuffles further as the pitch comes)
    // Rounding a base he keeps running through: he drifts out from the baseline over `turnLen` ft, goes round an arc of radius
    // `turnRadius` ft that touches the bag, and drifts back onto the next baseline over `turnLen` ft. (A smaller radius = a
    // sharper corner; he slows to at most sqrt(latAccel * radius) ft/s there.)
    turnRadius: 11,
    turnLen: 28,
    overrun: 22, // ft the batter runs on past first base when he is running through it (an out)
    batterStart: 0.34, // s after contact the batter leaves the box
    startDelay: 0.04, // runners on base leave almost as soon as the ball is hit (they are already leading off)
    trotSpeed: 21, // ft/s on a home-run trot
    jogSpeed: 20, // ft/s: the walk to first after ball four
    slide: 0.6, // s: a play is 'close' (he slides) when the throw arrives within this of him (either side)
    easeUp: 0.4, // s: once the third out is made, runners still going ease up and coast to a stop (how quickly their speed dies away)
    easeUpReact: 0.15, // s after the third out before the runners ease up
  },

  // --------------------------------------------------------------------------
  //  Modes
  // --------------------------------------------------------------------------
  modes: {
    quick: { innings: 3, extraInningRunner: true },
    derby: {
      outs: 10,
      pitchSpeed: { rookie: 58, pro: 66, allstar: 74 }, // batting-practice fastballs
      evBonus: 14, // extra exit velocity (mph) on a squared-up ball: batting-practice balls jump off the bat
      batBonus: 3, // mph of extra bat speed in the Derby on every level (instead of the level's own)
      windowGrow: 1.75, // the bat's contact window is this much bigger (the pitches are meatballs)
      timingGrow: 1.3, // the timing windows (perfect / good / early / late) are this much wider than the level's own
      locationSigma: 0.24,
      watchAfter: 0.9, // s a ball in the park is watched after it comes down before the next pitch (nobody runs after it: it is an out)
    },
    practice: { speedMin: 45, speedMax: 105, speedDefault: 85, pitcherRating: 50 }, // pitcherRating: the neutral arm you throw with in Practice (Pitch): every rating 50
  },

  // --------------------------------------------------------------------------
  //  Camera and visuals
  // --------------------------------------------------------------------------
  // --------------------------------------------------------------------------
  //  Landing spot ring: a ring lying on the grass where a ball hit in the air comes down (or under the spot where a fielder will catch
  //  it); it shrinks as the ball falls and is at its smallest the moment the flight ends. (Hidden once the ball lands or is caught.)
  // --------------------------------------------------------------------------
  landing: {
    minApex: 14, // ft: only balls hit up into the air get a ring (not grounders or low liners)
    minFlight: 1.0, // s: ...and only if they stay up at least this long
    delay: 0.45, // s after contact before the ring appears (the ball has left the bat)
    fadeIn: 0.3, // s the ring takes to fade in
    fadeOut: 0.18, // s it takes to fade away at the end of the flight (no pop)
    radiusStart: 18, // ft: how big the ring starts
    radiusEnd: 4.0, // ft: how small it is when the flight ends (a little more than a fielder's reach)
    minScreen: 0.02, // the ring is never smaller than this fraction of its distance from the camera, so it stays visible far away
    alpha: 0.85, // how see-through the ring is at its clearest (it lies flat on the grass like a chalk mark)
    color: 0xf4efc0, // soft warm white
  },

  camera: {
    batter: { pos: [0.0, 13.5, 24.0], pitch: -14.5, fov: 36 }, // camera behind the plate; pitch in degrees
    // the catcher's view you bat from (after Ready): through the catcher's eyes, over his glove (the rest of him is hidden)
    catcher: { pos: [0, 3.3, 7.0], look: [0, 1.2, -30], fov: 42, zoom: 5, clearDist: 6, umpireHead: 4.2, mittY: 1.75, mittReach: 0.16, firstDelay: 0.5 }, // zoom = how quickly it moves in; clearDist = the catcher and umpire are hidden while the camera is closer than this (ft) to them (the batting view, and the pull-back after a swing) (umpireHead = his head's height); the catcher's mitt waits low at mittY and reaches for the ball in the last mittReach s
    pitcher: { pos: [-2.4, 8, -67], look: [0, 1.0, 0], fov: 24, ease: 4 }, // the pitching view: behind and above the throwing shoulder (x is for a right-hander; a left-hander is mirrored), looking in at the plate; ease = how quickly it moves in (bigger = quicker)
    minHorizontalFov: 38, // narrow (portrait) screens widen the view to keep this
    keepBall: { marginDeg: 7, maxFov: 64 }, // a ball high in the air stays this far inside the top of the picture (the view widens up to maxFov deg, then tilts up to it)
    highHome: { up: 36, back: 40 }, // ft the camera climbs / backs up from its spot behind the plate while it follows a deep ball
  },
  // --------------------------------------------------------------------------
  //  Sound
  // --------------------------------------------------------------------------
  audio: {
    crowdReact: 0.35, // s after the crack of the bat before the crowd reacts to a big hit (they need a moment to see where it is going)
    // The mix: how loud each channel is at 100% on its slider (Settings has master, effects, umpire and crowd sliders).
    mix: {
      sfx: 1.0, // bat, glove, throws, thuds
      crowd: 1.0, // crowd noise, applause and the ballpark organ
      applause: 0.85, // loudness of a round of applause (before the crowd channel)
      glovePop: 2.4, // the catcher's mitt pop (x the built-in level): one of the signature sounds, so it is up front
      whoosh: 2.4, // the swing whoosh
      ui: 2.5, // menu clicks
    },
    umpire: {
      // The umpire's voice is the recordings in public/sounds/umpire/ (strike, strike1, strike2, strike3, ball, ball4, foul, out, safe,
      // playball, each with optional extra takes strike_b, strike_c...). A call without a recording is silent (he still signals).
      files: { folder: 'sounds/umpire/', level: 0.6, reverb: 0.2, echo: 0.5 }, // loudness of the recordings, stadium reverb and echo
      echo: { taps: [0.17, 0.35], levels: [0.3, 0.15], lowpassHz: 2400 }, // the slap-back off the far stands: delay (s) and loudness of each bounce
    },
  },

  quality: {
    crowdCount: 6500,
    crowdCountMobile: 3200,
    shadowMapSize: 2048,
    shadowMapSizeMobile: 1024,
    // Sharpness = screen dots drawn per layout point (phones have 3; 2 looks sharp at a fraction of the cost). Edges are smoothed
    // on every device. The game draws fewer dots only while it stays slow, and goes back up when it is smooth (render/resolution.js).
    maxPixelRatio: 2,
    maxPixelRatioMobile: 2,
    minPixelRatio: 1, // never blurrier than this (a phone screen's own layout size)...
    minShare: 0.7, // ...or this share of the screen's own dots, whichever is lower (so a plain 1x screen can still step down)
    slowFrameMs: 24, // frames slower than this on average (under ~42 a second) = too slow: draw fewer dots
    smoothFrameMs: 20, // frames faster than this (a 60-a-second screen keeping up) = smooth: draw more dots again
    hiccupMs: 100, // a single frame longer than this (a park loading, the tab hidden) is ignored
    checkEvery: 1.2, // seconds between sharpness checks
    stepDown: 0.85, // how much sharper/blurrier one step is
    stepUp: 1.1,
    helpGain: 0.9, // a step down must make frames at least this much quicker, or it is undone (a phone locked at 30 a second)
    noHelpHold: 60, // seconds before trying a step down again after one that did not help
  },

  // --------------------------------------------------------------------------
  //  Progression
  // --------------------------------------------------------------------------
  // --------------------------------------------------------------------------
  //  Season mode (game/season.js)
  // --------------------------------------------------------------------------
  season: {
    // A star's ratings from his real numbers last season: Contact = conBase + (AVG - conAvg) x conPerPoint per point of average
    // (.300 -> 80, .250 -> 57), Power = powBase + HR x powPerHr (30 HR -> 72, 50 -> 98), Speed = spdBase + SB x spdPerSb
    // (30 SB -> 69), each kept between min and max.
    realStats: { conBase: 35, conAvg: 0.2, conPerPoint: 0.45, powBase: 35, powPerHr: 1.25, spdBase: 38, spdPerSb: 1.05, min: 25, max: 99 },
    // A real pitcher's ratings from his line last season (game/mlb.js pitcherRatings). Each one is a straight line through two
    // points (`from` -> `to`), carried on past them and kept between min and max: Velocity from his average fastball (92 mph ->
    // 50, 99 -> 95), Control from walks per 9 innings (1.5 -> 90, 4.5 -> 35), Stuff from strikeouts per 9 (7 -> 40, 12.5 -> 92),
    // Stamina from his innings - a starter's (60 -> 50, 200 -> 92) and a reliever's (40 -> 20, 80 -> 40) on their own lines, so
    // even a starter who missed half the year outlasts any reliever.
    realArms: {
      velo: { from: [92, 99], to: [50, 95] },
      bb9: { from: [1.5, 4.5], to: [90, 35] },
      k9: { from: [7, 12.5], to: [40, 92] },
      ip: { SP: { from: [60, 200], to: [50, 92] }, RP: { from: [40, 80], to: [20, 40] } },
      min: 20, max: 99,
      // A club with fewer than three real starters / two real relievers in the table gets generated arms: each rating drawn
      // around base + perTier x the club's tier (1-5; tier 3 -> 58, about a real set-up man) with this spread, pitches as
      // Sandlot's own staff (pitching.staff).
      // Stamina: as for a real arm with `ip` innings for his role, give or take the same spread. `left`: the share who throw left-handed.
      filler: { base: 46, perTier: 4, sd: 6, ip: { SP: 140, RP: 60 }, left: 0.25 },
    },
    // A pitcher's overall (roster, shop, prices): this share of each rating. (A hitter's: 40% Contact, 40% Power, 20% Speed.)
    pitcherOverall: { vel: 0.3, ctl: 0.3, stf: 0.3, sta: 0.1 },
    // Your club's pitching staff: `size` arms (the club's real ones), the first `starters` of them starters in a rotation, the rest
    // relievers. A starter whose rest is under `startMin` (1 = fully rested) is skipped and the most rested starter starts. After a
    // game every arm's rest falls by the share of his stamina he used, then recovers `restPerGame` (by role), up to 1.
    staff: { size: 5, starters: 3 },
    startMin: 0.8,
    relieverMin: 0.5, // a reliever whose rest is under this has thrown too much lately: he cannot be brought in today (shown as Rest on the roster)
    restPerGame: { SP: 0.34, RP: 0.6 },
    innings: 6, // innings in a season game
    cycles: { short: 1, full: 2 }, // how many times you play every other team (8 opponents: 8 or 16 games)
    // CPU team strength ratings (50 = the level you picked). Shuffled onto the teams each season; the schedule goes from the
    // weakest opponent to the strongest. `yearStep`: the next season's teams are this much better after a title (half after a
    // playoff trip), up to `yearCap` in all.
    tierRating: { 1: 26, 2: 33, 3: 40, 4: 47, 5: 54 }, // a team's strength from its tier (1 = rebuilding .. 5 = the team to beat); the league is a little gentler than before
    teamJitter: 3,
    yearStep: 4,
    yearCap: 24,
    // How a team's rating changes the game against it. s = (rating - 50) / spread, about -1 (weak) .. +1 (strong).
    strength: {
      spread: 20,
      fastballMph: 2.4, // their pitcher throws this much harder per unit of s
      heartShift: 0.07, // share of pitches moved from the heart of the zone to the edges/chase per unit of s
      commandSigma: 0.15, // x(1 - this*s): better teams hit their spots
      errors: 0.35, // their fielding errors x(1 - this*s)
      catcher: 0.07, // their catcher's exchange x(1 - this*s) (quicker against steals)
    },
    simK: 0.055, // two CPU teams: P(A wins) = 1 / (1 + e^(-simK * (ratingA - ratingB)))
    simRuns: 4.4, // average runs a CPU team scores in a simulated game (for the standings' run totals)
    playoffTeams: 4, // semifinal (1 game): 1 vs 4, 2 vs 3; World Series: best of `finalGames`
    finalGames: 3,
    // Coins: what a game is worth, and the price of players (by overall rating)
    coins: { start: 200, win: 25, marginBonus: 2, marginCap: 10, loss: 10, playoffWin: 50, playoffLoss: 20, title: 150 },
    price: { base: 30, over: 40, power: 1.6, scale: 1.25, round: 5 }, // price = base + scale * (ovr - over)^power
    roster: { size: 12, lineup: 9 },
    starters: { base: 40, perRating: 0.36 }, // the unnamed starters on your team are rated base + perRating x the team's strength (a strong team has better role players)
    bench: 44,
    ratingSd: 9,
    shop: { size: 6, refresh: 2, mean: 60, sd: 9, min: 44, max: 92, starChance: 0.4, pitcherShare: 0.35, relieverStaminaGap: 25 }, // `pitcherShare` of the new offers are pitchers; players on offer (journeymen, and now and then a star from another team); `refresh` are replaced after every game
  },
  // What a batter's ratings (0-99, 50 = average) do in a game. Only Season players have ratings; everyone else is average.
  ratings: {
    conWindow: 0.18, // Contact: timing windows x(1 + this * (con-50)/50)
    powMph: 6, // Power: exit velocity +- this many mph at 99 / 1 (on a well hit ball)
    spdSpeed: 0.08, // Speed: running speed x(1 + this * (spd-50)/50)
  },

  storageKey: 'sandlot.save.v1',
};

export const PITCH_ORDER = ['fastball', 'sinker', 'changeup', 'cutter', 'curveball', 'slider', 'splitter', 'heater'];
export const DIFFICULTIES = ['rookie', 'pro', 'allstar'];
