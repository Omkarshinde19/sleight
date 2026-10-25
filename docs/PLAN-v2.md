# Sleight v2 — feel, fixes, features

v1 works end to end, but the hands *feel* wrong: they flicker, stretch, flip, whip and drop things.
Almost all of it traces back to a handful of root causes in the hand pipeline, not the scenes. v2 fixes
those first, then polishes animation, then adds features worth showing off.

Reviewed: `src/lib/hand/*`, `src/lib/tracking/{processor,camera}.ts`, `HandTrackingProvider`,
`ChromeHand`, `HandPhysics`, `Balls`, `LandingStage`, plus the deployed site (sleight-vr95.vercel.app).

## Status (2026-10-25)

Phases 1–2 are built: Feel panel (debug overlay, `window.__sleight.feel`), B1 coasting, B2 hand tracks,
B4 shared interpolated pose, B3 rigid skeleton. Measured on `public/sessions/demo.json` (old → new):
bone-length variation ±9.6 % → ±0.9 %; hand blinking out 13 → 6 times (the rest are gaps > 250 ms);
0 label flips (1.6 bad raw labels/min overruled). Resting jitter is unchanged at ~9 mm (it was never
in scope; it's B6/depth noise). Also fixed on the way: the grab anchor followed the gesture, so a claw
passing through "pinch" for a frame yanked a held ball ~14 cm; the anchor point is now chosen at grab
time. Still to do: the three webcam reference recordings (needs your camera, `R` in camera mode).

**Update (2026-10-26), from a recorded arcade session** (`src/lib/hand/__fixtures__/arcade-session.json`):
- Held balls slipped because they still collided with the rack and the other balls, fighting the grab
  joint (up to 9 cm). Held balls now touch nothing; the hand carrying them is kept clear instead.
- Balls were caught 2.5–24 cm from the palm; they now ease into the palm (cradle).
- A lone hand mislabelled by MediaPipe kept its label until both hands swapped ~0.1 s later. The pair is
  now labelled when the second hand appears (raw labels + which side of the frame), and any relabel moves
  all per-hand state (filters, skeleton, poses, what's held) with the physical hand.
- A1 done early for the Arcade: the robot hand is pushed rigidly out of the rack, stand, balls and floor,
  with a ghost of the real hand; fingers wrap a held ball. Fingers inside resting balls: 934 → 0 frames;
  inside the held ball: 1325 → 13.
- Industrial furniture is not blocked yet: upright webcam hands pinch chips with the palm below the bench
  top. Needs a layout change (raise the tray and socket) or fingers-first blocking.

## 0. Measure first (½ day)

"Feels stupid" is not testable. Add a **Feel** panel to the debug overlay, fed by the processor:

| Metric | What it catches | Target |
|---|---|---|
| Joint jitter at rest (mm RMS, scene) | shaky fingers | < 2 mm |
| Bone-length variance (% of length) | rubber fingers | < 1 % (after fix: 0) |
| Handedness flips / min | inside-out hands, swapped hands | 0 |
| Dropout frames / min, longest gap (ms) | hand popping, dropped balls | logged |
| Render frames per tracker frame | stutter | 2 at 60 Hz, interpolated |
| Grab→release unintended (count) | balls falling out of the hand | 0 |

Record three reference sessions with `R` (still hand, fast flick throw, wrist rotation) and commit them
as fixtures, so every fix below gets a before/after number and a Vitest regression.

## 1. Bugs (root causes, in priority order)

### B1 — One missed detection drops whatever you hold  ★ biggest
`processor.process()` only returns hands seen *this* frame, and `HandPhysics` does
`if (!h) release(hand, rt, false)`. A fast flick blurs the hand, MediaPipe misses one frame, and the ball
is released **with zero velocity** — exactly during a throw. The hand also vanishes for that frame
(`ChromeHand`: `visible = !!h`).
**Fix:** keep a *coasting* hand in the processor for up to ~200 ms after a miss (last pose, velocity
decaying), flagged `lost: true`. Physics keeps the grab while coasting; if the hand is lost while moving
fast, release **as a throw** using the history. Only after the grace period does it disappear (see A2).

### B2 — Hand identity follows MediaPipe's label, which flickers
Channels, filters and physics runtimes are keyed by `"Left"/"Right"` per frame. When the label swaps, the
hand inherits the other channel's filter state (jumps), the dorsal side flips (`if (hand === "Right")
dorsal.negate()` → armour plates on the palm, hand turned inside out), and a held ball is dropped.
**Fix:** assign detections to persistent tracks by nearest previous wrist (Hungarian on 2×2 is trivial),
and decide handedness by a vote over the last ~20 frames weighted by score, not per frame. Derive the
dorsal direction from the geometry + the *track's* stable handedness.

### B3 — Rubber fingers
Every bone is drawn between raw world landmarks, whose lengths change frame to frame (MediaPipe guesses
z per frame). Fingers visibly stretch and shrink, especially when pinching.
**Fix:** calibrate bone lengths per track (median over the first steady second, saved with the depth
reference), then rebuild the hand by FK: keep each bone's *direction* from the tracker, use the fixed
length. Clamp joint angles to anatomical limits (no hyperextension, no sideways PIP/DIP bend) — this
kills the "broken finger" frames.

### B4 — 30 Hz pose shown at 60 Hz, and two different hands
`ChromeHand` reads the store directly, so it shows each tracker pose for two render frames, then jumps.
`HandPhysics` separately low-passes the same data (`FOLLOW_TAU`), so the colliders and a held ball lag
the visible hand by ~30 ms — the ball looks like it's on a rubber band.
**Fix:** one `PoseInterpolator` per track, sampled at render time (`t_render − ~1 frame`, Hermite between
the last two tracker frames, short velocity extrapolation when late). Both the mesh and the physics read
the *same* interpolated pose. Remove `FOLLOW_TAU` smoothing from physics.

### B5 — Forearm whips around
The forearm points along `wrist − middleMCP`, so bending only the wrist swings the whole arm, and pointing
your fingers down sends the forearm up through the ceiling.
**Fix:** a virtual elbow: shoulder anchors just below and behind the camera per side; solve a 2-bone IK
(shoulder → elbow → wrist) with the wrist as the target, plus a lag spring on the elbow. The forearm then
moves like an arm, and the wrist bends on its own. Clamp wrist flexion to ±70°.

### B6 — Depth lurches when the wrist rotates
Depth comes from apparent palm size; turning the hand edge-on shrinks it, so the hand shoots away. The z
filter is very slow (`minCutoff 0.4`), so it then drifts back.
**Fix:** weight palm segments by how face-on they are (use world-landmark normal vs camera axis), ignore
size changes while the palm normal is rotating fast, add a small z dead-zone, and raise z `beta` so real
pushes still come through quickly.

### B7 — Smaller ones
- **GC hitches:** `ChromeHand` and `LandingStage` allocate ~100 `Vector3`s per hand per frame
  (`clone()`, `new`, `J = joints.map(toV)`). Preallocate scratch vectors.
- **Backspin is fixed** at `{x:-6}` world-space; spin about `cross(up, throwDir)` instead.
- **Release lag:** grip smoothing (`GRIP_TAU`) + gesture dwell delay the release ~100 ms; release on
  grip *velocity* (fingers opening fast) as well as the threshold.
- **Landing hands** lerp roll/pitch/yaw separately (gimbal wobble, wrist spins the long way round) and
  overlap the headline at ~800 px wide; use quaternion slerp and scrub keyframes with `scroll.local`
  instead of discrete chapters + exp lerp. The demo ball snaps back into the hand at each loop.
- **Scenes load ~8 s black** on the deployed site. Show the blueprint loader with real progress, and
  prefetch the MediaPipe WASM + model when the user hovers a scene link on the landing page.
- Console: `THREE.Clock` deprecated, `PCFSoftShadowMap` removed (falls back silently), unused CSS
  preloads. Cheap cleanups.

## 2. Animation polish

- **A1 — Grasp wrap.** Hands pass through the ball/chip visually (`propNoHand`). While holding, pull each
  fingertip chain onto the object's surface (visual-only IK, CCD on the 3 finger joints), so fingers wrap
  the ball and pinch the chip edges. Single biggest "looks real" win.
- **A2 — Materialize / dissolve.** When a track appears: blueprint wireframe draws on over ~250 ms, then a
  chrome sweep. When it's lost past the grace period: dissolve to cyan lines and fade. Replaces popping.
- **A3 — Secondary motion.** Tendon cables and hoses lag slightly behind (spring), knuckle plates slide on
  flex, a tiny servo settle (overshoot) when a gesture locks in. Subtle — 2–4 mm.
- **A4 — Contact feedback.** Grab: brief rim-light pulse + a ring decal at the contact. Collisions with
  tools: small sparks. Score: chrome flash on the hand.
- **A5 — Idle life.** In the sim/landing hands, micro breathing and finger drift so they never freeze.

## 3. Features worth showing off

1. **Calibration ritual (onboarding).** A ghost hand outline: "match it". It's your depth reference,
   bone-length calibration and lighting check in one 3-second moment, and it teaches the gestures.
   Replaces the silent "first steady frames" calibration.
2. **Tracking coach.** Live hints from data we already have: too dark / backlit (frame luminance),
   too close / far (apparent scale), hand half out of frame (landmarks at the edge), low confidence.
3. **Procedural sound.** WebAudio, no assets: servo whine pitched by finger speed, clicks on gesture
   lock, ball bounce/rim/swish, chip seat clunk, scalpel scrape. Sells "robot hand" more than visuals.
4. **Challenge modes + local bests.** Arcade 60 s shot clock with moving hoop; Industrial timed
   assembly line; Theatre precision run scored on coverage/mm. Best scores in `localStorage`.
5. **Ghost replay.** Replay your best run as a translucent ghost hand (we already record landmarks, so
   it's privacy-safe), and "share" exports the landmark JSON or a canvas video clip.
6. **Two-hand moves.** Pass the ball hand to hand; a heavy crate in Industrial that needs both hands.
7. **Adaptive quality.** Measure frame time for 2 s, then pick a tier (DPR, shadows, iridescence,
   segment counts) — keeps phones and mid-range laptops smooth.

## Order of work

| Phase | Items | Done when |
|---|---|---|
| 1. Measure | §0 | Feel panel + 3 fixture sessions committed |
| 2. Stop the bugs | B1, B2, B4, B3 | 0 unintended drops and 0 handedness flips on the fixtures; bone variance 0 |
| 3. Arm & depth | B5, B6, B7 | No forearm whip on the rotation fixture; depth stable within ±3 cm while rotating |
| 4. Feel | A1, A2, A3, A4 | Fingers wrap the ball in a screenshot; no popping on dropouts |
| 5. Features | 1, 2, 3 first; then 4–7 | Each with an e2e check, like v1 |

Each phase ends with a live-webcam check by you, since that's the one thing CI can't do.
