# Player models: real-looking people - design

Date: 2026-10-02. Owner's request (asleep, waived every approval: "don't ask for any permissions ... free reign ... make this a
professional game"): "up the graphics quality ... like the players ... real hands, real mitts, more muscles, more limbs ... look more
like real people. Faces, etcetera." Then general bug checks.

## What success looks like
- Up close (the batter from the catcher's view, the pitcher, catcher and umpire, the Ready card moments) every player reads as an
  athlete: shaped shoulders, arms with biceps / triceps / forearms, legs with quads and calves, a neck, a real face (brow, eyes with
  lids and irises, nose with nostrils, lips, cheekbones, jaw, ears), hands with fingers and knuckles, a fielder's glove that looks
  like a stitched leather glove (fingers, thumb, webbing, pocket, laces) and a catcher's mitt that looks like one.
- Nothing about play changes: every pose, the IK, the grip on the bat, the measured clearances (bat vs head ~0.19 ft, grip error
  0.00 ft, pitcher hand at the release point) stay as they are. The joint hierarchy, `DIM`, `GRIP`, `makePose`, `Person.apply`, the
  `Person` API (`handWorld`, `gloveWorld`, `batBarrelWorld`, `root`, `pose`, `dispose`, `setShadows`) are unchanged.
- Phones keep running: polygon budget per figure (full detail) about 2x today's, fielders and phones scaled down by the existing
  `detail` factor; draw calls per figure stay near today's (one merged mesh per bone per material).
- No asset files: everything is still generated in code (the project rule).

## Approaches considered
1. **Sculpted rigid segments (chosen).** Keep one rigid piece per bone, but build each piece from a *loft*: a smooth closed surface
   swept along the bone through elliptical cross-sections whose size and offset vary along its length, with per-angle bumps for muscles.
   Overlapping, rounded joint ends hide the seams (sleeves and baggy pants hide the shoulder and hip joints, as real uniforms do).
   Low risk (animation untouched), big visual gain, cheap to render.
2. Procedural skinned mesh (one continuous body, `SkinnedMesh`, bones = the joint groups). Smoothest joints, but linear-blend skinning
   collapses at the shoulders and wrists in the extreme swing / throw poses this game uses, and every clearance would need
   re-measuring. More risk for a gain that the uniform mostly hides.
3. A downloaded rigged human (glTF). Breaks the "generated in code" rule, needs retargeting onto the procedural poses, licensing.

## Design
### New module `src/render/anatomy.js` (geometry only, no game logic)
- `loft(rings, opts)`: rings `{ y, rx, rz, x?, z?, bumps? }` (bumps: `[{ a, w, h }]` = angle round the axis, angular width, height
  as a share of the radius) -> a closed `BufferGeometry` with smooth normals, UVs (u round, v along) and rounded end caps. Cached by
  key like the other shapes.
- Builders returning `mergeParts` part lists (`{ geo, color, x, y, z, rx, ry, rz, sx, sy, sz, ao }`), so rig.js keeps one merged mesh
  per bone:
  - `upperArmParts`, `foreArmParts`, `thighParts`, `shinParts`, `neckParts` - lofted muscle shapes (deltoid cap, biceps, triceps,
    brachioradialis bulge by the elbow tapering to a slim wrist; quads, knee cap, calf bulge, Achilles taper).
  - `headParts(o)` - a lofted head (cranium, brow ridge, cheekbones, jaw, chin, back of the skull), lofted nose with nostrils, upper and
    lower lip, eyes (white, iris, pupil, a tiny catch-light, upper eyelid), eyebrows, ears with a rim; hair / cap / helmet as today.
  - `handParts(kind, side)` - a palm with a thenar pad, four fingers of three phalanges each with knuckles, a thumb of two; kinds:
    `relaxed` (fielders, runners), `fist` (batters - the fingers wrap the handle round `GRIP.point`, as today), `ball` (cupped).
  - `gloveParts(kind)` - fielder's glove: lofted leather shell, four finger stalls, a thumb, an open lattice web, a deep pocket, lace
    rolls round the edge, a wrist strap and a logo patch; `mitt` for the catcher: round padded mitt with a thick rim and laces.
- Materials (rig.js): the vertex-coloured material is split by surface - `fabric` (uniforms, rough), `skin` (a touch of sheen, smoother),
  `leather` (gloves, belts, shoes; semi-gloss), `gloss` (helmets, buttons, eyes). Each bone keeps one merged mesh per material it uses.
  Jerseys keep their canvas texture; a shared, code-drawn fabric normal map (weave + soft folds) goes on jersey and pants.
- Torso: the V-taper lathe becomes a loft with chest, shoulder blades, a spine groove and a narrower waist, still carrying the jersey
  texture (front at u = 0.25 - same UV convention, so the lettering stays where it is).

### Level of detail
`detail` (1 = batter, pitcher, catcher, umpire; .62 = fielders, runners; x .75 on phones) sets the ring count and segments of every
loft and how many finger segments are built (low detail: fingers merge into a mitten shape, no catch-light, no nostrils).

### Checks (all must pass before it ships)
- `npm test`, build, smoke (8 scenarios), `hudqa`, `playqa`, `leakqa` (shape / texture counts must stay flat across 12 games).
- A throwaway in-browser measurement (as for every earlier rig change): bat vs head clearance across the swing, grip error at the
  nine zone spots, bunt grip, pitcher hand at release - unchanged from today's numbers.
- Triangles per figure (renderer.info) at full and low detail, recorded in CLAUDE.md.
- Screenshots: batter from the catcher's view, a close-up of hands on the bat, pitcher face-on, a fielder's glove, the catcher's mitt,
  runners - at day and night.

### Out of scope
Facial animation, cloth simulation, skinned joints, per-player face shapes beyond skin / hair colour (a small deterministic variation of
nose / jaw / brow width per jersey number is in scope: it keeps every player from looking like a twin).
