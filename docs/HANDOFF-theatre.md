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
physics scenes (arcade, industrial, theatre), all client-side, on three.js / React Three Fiber + Rapier.
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
  - Forearm hangs toward an elbow that follows the hand (`src/lib/hand/forearm.ts`, option B: below and
    toward the viewer, 30 % hand blend); in scenes it grows until it leaves the screen; the landing page
    puts the elbow behind the hand (`LANDING_ELBOW`).
  - Skeleton flip fix (`src/lib/hand/skeleton.ts`): fists no longer curl outwards after an early relabel.
  - The simulated hand (tests, demo autopilot) glides to `reach()` targets (0.18 s) and curls at 0.12 s.

**Still open (not started unless the user asks):** Step 1.4 Poly Haven HDRI (needs download permission),
1.5 Blender props, 1.6 landing animations, 1.7 perf budget in e2e, authored ball grip for arcade (the
user picked it; not built yet), elbow IK in the rig (picked; current forearm is code-side), and all of
Step 2 (UI palette: **confirm colours with the user before writing any tokens**).

## The surgery room today (`src/scenes/theatre/`)

- `TheatreScene.tsx`: tighter workspace (`handScale` 1.2, width 1.2 m), surgical lamp, stiffer physics
  (`numSolverIterations: 8`, small allowed error) so tools stop at tissue. Brief: pinch the scalpel and
  cut along the dotted line on the practice pad, then pinch the forceps, squeeze to grip fragments in the
  wound, drop them in the kidney dish. Hands never touch the patient (sterile field).
- `layout.ts`: table, torso, practice pad, 18 cm guide line, wound, instrument tray, kidney dish (metres).
- `Instruments.tsx`: scalpel and forceps (held tools, with a translucent "ghost" when the patient is in
  the way), fragments, tray and dish. `instruments` handles exposed for the monitor and tests.
- `Patient.tsx`: mannequin, drape, dotted guide; `anatomyColliders` for contact depth / sterile checks.
- `Monitor.tsx`: penetration depth (from contact manifolds), sterile-field breaches, incision coverage
  and accuracy, fragments retrieved → `theatreStore.ts` → `TheatreHud.tsx`.
- Tests: `e2e/theatre.spec.ts` (scalpel stops at the pad surface; cuts along the line; forceps move a
  fragment to the dish). Exposed on `window`: `__theatre` (store), `__instruments`, `__sleight`.
- Grabs/colliders shared with other scenes: `src/components/physics/HandPhysics.tsx`.
- The instruments and patient are still code-built geometry (Blender props are Step 1.5).

## Known issues to keep in mind

- `e2e/theatre.spec.ts` "a scalpel pushed 5 cm into the practice pad stops at its surface" flakes about
  1 in 3 runs, with or without the recent hand changes (pre-existing). Industrial "fist can't pick up the
  microchip" flakes ~1 in 17 since the snappier smoothing.
- On the landing page's scrolled "Machinist" chapter the forearm reads as a short stub (elbow behind).
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
