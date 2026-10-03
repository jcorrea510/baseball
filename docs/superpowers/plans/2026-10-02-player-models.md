# Player Models Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Players that look like real athletes (shaped muscles, faces, hands with fingers, real gloves and mitts) with no change to animation or play.

**Architecture:** A new geometry module (`src/render/anatomy.js`) lofts smooth body parts from cross-section tables and returns `mergeParts` part lists; `src/render/rig.js` swaps its primitive parts for these, keeping the joint groups, `DIM`, `GRIP`, `apply()` and the `Person` API. Materials split by surface (fabric / skin / leather / gloss).

**Tech Stack:** three.js 0.186 (BufferGeometry, MeshStandardMaterial / MeshPhysicalMaterial), Vitest, Playwright (throwaway QA in `qa-output/`).

**Spec:** `docs/superpowers/specs/2026-10-02-player-models-design.md`

## Global Constraints
- No asset files: every shape and texture is generated in code.
- Unchanged: `DIM`, `GRIP`, `SCALARS`, `VECTORS`, `makePose`, `mixPose`, `copyPose`, `solveTwoBone`, `Person.apply`, `handWorld`, `gloveWorld`, `batBarrelWorld`, `batWorldMatrix`, `place`, `dispose`, `setShadows`, the joint groups (`pelvisG`, `spine`, `headG`, `arms[].{sh,upper,elbow,wrist}`, `legs[].{hip,thigh,knee,ankle}`).
- Jersey texture UV convention unchanged: the front of the shirt is at u = 0.25.
- Full-detail figure: at most ~2x today's triangles; draw calls per figure about today's (one merged mesh per bone per material).
- `leakqa` shape / texture counts stay flat across 12 games (today 230 / 32 - the new baseline is whatever the first run after this work prints, and it must not grow game to game).
- Grip error 0.00 ft at the nine zone spots, bat-head clearance >= 0.19 ft, pitcher hand within 0.03 ft of the release point (re-measured).

## Review Focus
- A left-handed batter or pitcher (`mirror`, root scale.x = -1): lofted parts must not turn inside out (normals) - the figure is mirrored as a whole. Test: Task 1 checks a mirrored mesh still has outward normals after the -1 scale (three flips face winding for negative determinants; check `side` / rendering in the screenshots of Task 7).
- Phones (`detail` .47 for fielders): lofts with very few rings must stay closed and smooth. Test: Task 1 `loft at minimum detail is still closed`.
- Very wide or narrow players (`build` .9-1.15): torso scaling must not open gaps at the shoulders. Screenshot check in Task 7 with build 1.15.
- Catcher / umpire gear over the new torso and shins: no part coinciding with another (z-fighting). Screenshot check in Task 7.
- Memory: geometry cached by key; per-figure merged geometry disposed in `dispose()` (leakqa in Task 7).

---

### Task 1: The loft builder
**Files:** Create `src/render/anatomy.js`; Test `tests/anatomy.test.js`
**Interfaces:** Produces `loft(rings, { seg = 16, cap = true, key })` -> `THREE.BufferGeometry` (cached when `key` given). Ring: `{ y, rx, rz, x = 0, z = 0, bumps = [] }`, bump `{ a, w, h }` (angle, angular half-width, height as a share of the radius; cosine falloff). u runs round (0 = +z front, so a jersey front at u = 0.25 is an option `uStart`), v along.
- [ ] Test `loft makes a closed surface`: position count = rings x (seg + 1) + 2 caps; every normal has length 1 +- 1e-3; bounding box matches the widest ring.
- [ ] Test `a bump makes it bigger there`: the vertex at the bump angle on that ring is further from the axis than without the bump by h x radius.
- [ ] Test `loft at minimum detail is still closed` (seg 6, 3 rings).
- [ ] Implement; smooth along v with Catmull-Rom between rings (`sub` rings per span, default 2).
- [ ] `npx vitest run tests/anatomy.test.js` passes; commit.

### Task 2: Arms, legs, neck and torso
**Files:** Modify `src/render/anatomy.js` (add `upperArmParts(o)`, `foreArmParts(o)`, `thighParts(o)`, `shinParts(o)`, `torsoGeometry(dl)`), `src/render/rig.js:139-159, 415-526`
**Interfaces:** `o = { side, dl, colors: { skin, arm, sleeve, trim, pants, socks }, B }` -> part lists for `mergeParts`; `torsoGeometry(dl)` keeps the lathe's UV convention.
- [ ] Upper arm: deltoid cap (front / side / back heads as bumps), biceps (front bump peaking at 60% down), triceps (back bump, 35-55%), sleeve as a loft just outside the arm with trim ring. Forearm: brachioradialis bulge near the elbow, taper to a slim wrist 0.085 ft radius, elbow point.
- [ ] Thigh: baggy pant loft (quad bulge front, hamstring back), knee; shin: calf bulge (back, 25-45% down), Achilles taper, sock bands, pant cuff.
- [ ] Torso loft: chest (front bumps), shoulder blades (back), waist narrowing; neck with trapezius slope.
- [ ] Throwaway `qa-output/rigmeasure.mjs`: grip error at the nine zone spots, bat-head clearance over the swing, pitcher hand at release - same numbers as before.
- [ ] `npm test`, screenshots of batter + pitcher; commit.

### Task 3: Faces
**Files:** `src/render/anatomy.js` (`headParts(o)`), `src/render/rig.js:367-413`
**Interfaces:** `o = { dl, skin, hair, eye, lip, variant (0..1 from jersey number), helmet, cap... }` -> parts relative to `headG`.
- [ ] Lofted head (brow ridge, cheekbones, jaw, chin), nose loft with nostrils, lips, eyes (white, iris, pupil, catch-light, upper lid), brows, ears with rim; small per-number variation of nose / jaw / brow width.
- [ ] Cap and helmet sit on the new skull without poking through (screenshot from front, side, back).
- [ ] Commit.

### Task 4: Hands
**Files:** `src/render/anatomy.js` (`handParts(kind, side, o)`), `src/render/rig.js:437-485`
**Interfaces:** kinds `relaxed` | `fist` | `ball`; positions from the wrist; `fist` wraps the handle through `GRIP.point` (the batter's grip stays where it is).
- [ ] Palm with thenar pad, four fingers x 3 phalanges with knuckle spheres, thumb x 2; batting gloves for batters (colour `u.gloves`), bare skin otherwise; low detail: mitten.
- [ ] Close-up screenshot of hands on the bat; grip error unchanged; commit.

### Task 5: Gloves and the catcher's mitt
**Files:** `src/render/anatomy.js` (`gloveParts(kind, o)`), `src/render/rig.js:439-452`
- [ ] Fielder's glove: shell, four finger stalls, thumb, lattice web, pocket, lace roll, strap, patch. Mitt: round, thick padded rim, laces, strap.
- [ ] `gloveWorld()` still returns the pocket (check the ball lands in it on a catch, screenshot); commit.

### Task 6: Materials
**Files:** `src/render/rig.js` (material split), `src/render/textures.js` (`fabricNormal()` canvas normal map)
- [ ] `_merged` takes a material per part group; parts carry `mat: 'fabric' | 'skin' | 'leather' | 'gloss'`; one mesh per material per bone.
- [ ] Fabric normal map (weave + soft folds) on jerseys and pants; skin a touch of sheen; commit.

### Task 7: Level of detail, budget, leaks, docs
**Files:** `src/render/rig.js`, `CLAUDE.md`
- [ ] Triangles per figure (renderer.info) full / .62 / .47 recorded; leakqa flat; hudqa, playqa, smoke, build pass.
- [ ] Screenshots: batter (catcher's view), hands on bat, pitcher face-on, fielder glove, catcher mitt, runner, build 1.15, left-handed batter, day + night.
- [ ] CLAUDE.md "The players" section updated; commit and push.
