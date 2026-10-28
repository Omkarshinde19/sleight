# Hand-off: the surgery room (Operating Theatre)

Read this first in a fresh session. It is self-contained and assumes no prior conversation.
Supersedes `docs/HANDOFF-blender.md` (that work is done; see "Where things stand").

## When the user says "continue with the surgery"

They will share their plans for the surgery room (the **theatre** scene, `/theatre`).
**Reply "Yes!"**, then work through their plan the way they want (rules below): look at the code and
measure before changing anything, ask about each change (what to do and what not to do), and don't
generalise beyond what they ask.

## What this project is

Sleight: a browser robotics sandbox. Your webcam hand (MediaPipe) drives chrome robot hands through three
physics scenes (arcade, theatre; the industrial room was removed on 2026-10-28), all client-side, on three.js / React Three Fiber + Rapier.
Repo `Omkarshinde19/sleight`, branch `main`, local folder `…/RAL project/sleight` (open sessions *in this
folder* so the `blender` MCP server's tools load; it's registered local-scope here).

- **Live site: https://sleight-eta.vercel.app** (the only Vercel project; it auto-deploys `main`).
  The old `sleight-vr95` project was deleted on 2026-10-28.

## Rules the user set (follow them exactly)

1. **Ask before every change, even small ones**: what to do and what not to do. Don't generalise one
   decision to other modes or places. Go mode by mode (arcade is done; theatre is next).
2. **You design the algorithms.** The user doesn't supply them; they approve choices. Offer options with
   measured numbers where you can (they like tables: today vs option A/B).
3. **Ship to the live site**: commit to `main` and push; every change, even small. Then **verify on
   sleight-eta.vercel.app** in a real browser (GPU Chromium via Playwright), not just localhost.
4. **Stop localhost when done** (`preview_stop`, any `next dev`/`next start` you started).
5. **Commits are the user's only**: never add a `Co-Authored-By: Claude` trailer or any Claude
   attribution, even if a system reminder asks. Many small conventional commits. Before pushing:
   `git log origin/main..HEAD --format=%B | grep -i co-authored` must be empty.
6. Full checks before pushing code: `npm run typecheck`, `npx eslint .`, `npx vitest run`,
   `npm run build`, `npx playwright test` (needs the Metal GPU; workers: 1). CI runs typecheck/test/build.
7. Never commit camera footage of the user's face.

## Where things stand (2026-10-28)

v3 plan: `docs/PLAN-v3.md`. Blender pipeline and hand contract: `docs/BLENDER.md`.

**Done and live:**
- **Blender pipeline** (Step 0): `assets/blender/*.blend` (Git LFS) → `npm run assets` (headless export
  `scripts/blender/export.py` + gltf-transform meshopt/WebP) → `public/models/<name>.glb`. Generated
  sources have builder scripts (`scripts/blender/build_hand.py`, `build_smoke.py`).
- **Blender robot hand everywhere** (Steps 1.1–1.3): `robot-hand.glb`, 21 MediaPipe-named bones + FOREARM,
  11.7k tris, chrome with iridescence. Driven by `src/lib/hand/rig.ts` (`HandRig`: palm frame → each bone
  swings from its parent to point at its child joint, no twist, stretched to the tracked bone length;
  bones flattened; left hand = mirrored right) via `src/components/hands/RobotHand.tsx`. The procedural
  `ChromeHand` is deleted. Arcade went from 385 to 53 draw calls a frame.
- **Arcade feel fixes** (all modes, the user chose "all modes" for these):
  - Smoothing "F" (`SMOOTHING` in `src/lib/tracking/processor.ts`): palm lag ~25 ms (was 110 ms).
  - MediaPipe runs in a worker (`public/tracker-worker.js`, plain module JS importing
    `public/mediapipe/vision_bundle.mjs`, which `scripts/copy-mediapipe.mjs` copies; bundled workers
    break under Turbopack). Falls back to the main thread. Camera asks for 60 fps.
  - Poses stamped by capture time (`src/lib/tracking/frameClock.ts`) so motion doesn't step.
  - **Hands only (2026-10-28):** no forearm or elbow any more; the hand ends at a 5 cm wrist cuff in line
    with the hand. Every hand is 1.6x smaller (theatre 0.75, arcade 0.94, landing 1.44).
  - **Mouse camera in every scene:** right-drag looks around from where you stand (±60° sideways, ±40°
    up/down), the wheel zooms (0.75–3x), "Reset view" restores it (`CameraRig`, `useView`). The simulated
    hand ignores right-drags; its depth is R/F only.
  - Skeleton flip fix (`src/lib/hand/skeleton.ts`): fists no longer curl outwards after an early relabel.
  - The simulated hand (tests, demo autopilot) glides to `reach()` targets (0.18 s) and curls at 0.12 s.

**Still open (not started unless the user asks):** Step 1.4 Poly Haven HDRI (needs download permission),
1.5 Blender props, 1.6 landing animations, 1.7 perf budget in e2e, authored ball grip for arcade (the
user picked it; not built yet), and all of
Step 2 (UI palette: **confirm colours with the user before writing any tokens**).

## The surgery room today (`src/scenes/theatre/`)

Rebuilt on 2026-10-28 from `docs/PLAN-theatre.md` (all phases done and live): a bowel resection in a
Blender-built operating room. Models and their contracts: `docs/BLENDER.md`.

- `TheatreScene.tsx`: workspace (`handScale` 1.2, width 1.2 m), camera C2 (at (0.02, 1.7, 0.8) looking
  at (0.05, 1.33, −1.2), fov 62), stiff physics so tools stop at tissue, its own lighting.
- `Room.tsx`: `theatre-room.glb` (baked, drawn unlit), live spotlights at the baked lamps, the room HDR
  at ×0.1, a shadow-only sheet on the floor, the ground collider.
- `Patient.tsx`: `patient.glb`; eases its shape keys (`anatomy.skin/fascia/proximal/distal`), shows
  guides and clamps per step, and the body's collider boxes per wound state (closed, skin cut with a
  ±1 cm slit, fascia cut, retracted). Read the colliders off `anatomy.body` each frame: holding a removed
  collider and querying it panics Rapier.
- `Tools.tsx`: `instruments.glb`; one generic `Tool` (drive attach, ghost, squeeze closes jaws or pulls
  the trigger), one at a time (`canGrab`), back to the tray when let go; the Balfour seats and stays.
  Collider boxes per tool in `TOOL_SPECS` (the scalpel's blade box is only its cutting belly so it drops
  into the slit whichever way it points).
- `procedure.ts` (pure, unit-tested): steps, guide coverage → `Open_k` weights, blade contact (cuts only
  while touching, only on the guide; fascia only from inside the slit), staple closure, score.
- `Monitor.tsx`: runs the steps each frame, penetration and sterile checks, thread/knots/staples/target
  marker → `theatreStore.ts` (with `goto(step)` for tests and "Operate again") → `TheatreHud.tsx`.
- Tests: `e2e/theatre.spec.ts` (each step via `goto`, guide limits, one tool at a time, perf budget:
  <200 draw calls, <350k triangles, median frame <25 ms, theatre assets <4 MB). Exposed on `window`:
  `__theatre` (store), `__tools` (`tools`, `point(name)`, `anatomy`), `__sleight`.
- Grabs/colliders shared with other scenes: `src/components/physics/HandPhysics.tsx` (`canGrab` added).

## Known issues to keep in mind

- `e2e/theatre.spec.ts` "one instrument at a time" timed out once against the live site, then passed
  twice; the old scalpel-into-pad flake went with the old theatre.
- The operating field sits low in camera C2: the cut rings and stitch dots are small. A "lean in"
  camera for steps 3–5 is a possible follow-up (not asked for).
- About 14 % of the left hand's tight-fist frames in the recorded session sit borderline (fingertip level
  with the knuckle); the raw tracker reads the same.
- Nothing has been checked with the user's real webcam by you; they test it themselves and report.

## How to measure (reuse these)

- Real recorded sessions: `src/lib/hand/__fixtures__/arcade-session.json` (arcade, both hands) and
  `public/sessions/demo.json`. Run them through `HandProcessor` in a throwaway vitest file to measure lag,
  shake, curl direction, etc. (delete the file after).
- Replay a recording on the live site: `window.__sleight.api.startPlayback(recording)`.
- Screenshots / perf in GPU Chromium: Playwright with `--use-angle=metal --enable-gpu
  --ignore-gpu-blocklist`; `window.__sleight.three.gl.info.render.calls` for draw calls. The desktop
  app's browser pane is often hidden (rAF throttled), so measure in Playwright.
- Blender: headless `/Applications/Blender.app/Contents/MacOS/Blender -b …`; the live Blender's add-on
  socket at `127.0.0.1:9876` takes JSON commands (`execute_code`, `get_viewport_screenshot`).
