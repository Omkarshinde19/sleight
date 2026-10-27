# Hand-off: Blender + UI work (v3)

> **Superseded (2026-10-28):** this work is done. Start from `docs/HANDOFF-theatre.md`.

Read this first in a fresh session. It is self-contained — it assumes no prior conversation.

## What this project is

Sleight: a browser robotics sandbox. Your webcam hand (MediaPipe) drives chrome robot hands through
three physics scenes (arcade, industrial, theatre), all client-side, on three.js / React Three Fiber +
Rapier. Repo `Omkarshinde19/sleight`, branch `main`, local folder is this one (`…/RAL project/sleight`).
v1 shipped; v2 fixed hand-feel bugs (see `docs/PLAN-v2.md`). v3 is this work.

## The goal of v3

See `docs/PLAN-v3.md` (the full plan). In short:
- **Step 0** — Blender → glTF asset pipeline wired into the repo. *(setup already done; see below)*
- **Step 1** — the robot hands and props become real models made in Blender, exported as `.glb`.
  The tracking, physics and grab system do **not** change.
- **Step 2** — rebuild the UI in the "Sound Waves" poster style (jet black / hot pink / chartreuse).

## Setup state (done, 2026-10-28)

- Blender **5.2.3 LTS** at `/Applications/Blender.app`. Headless works:
  `/Applications/Blender.app/Contents/MacOS/Blender -b --python <script>.py`.
- **MCP for Blender** v1.8 add-on enabled; its server listens on `127.0.0.1:9876`.
- `blender` MCP server registered in Claude Code (telemetry off). A fresh session loads its tools.
- `uv` / `uvx` installed via Homebrew.

## When the user says "go"

1. **Confirm the connection** — use the Blender MCP tools to query the scene (e.g. get scene/object
   info). If the tools aren't present, the session was started before the server registered: tell the
   user to restart the session. If present but the call fails, check Blender is open with the add-on's
   "Start MCP Server" active (panel: 3D view → N → "MCP for Blender").
2. **Step 0.2** — create repo folders: `assets/blender/`, `assets/textures/`, `public/models/`,
   `scripts/blender/` (with `.gitkeep` where empty). Commit.
3. **Step 0.3** — Git LFS for `.blend`, `.hdr`, `.exr`, big textures via `.gitattributes`. (Default yes;
   it's installed. Mention the 1 GB free GitHub quota.) Commit.
4. **Step 0.4–0.5** — headless export script + gltf-transform compression, `npm run assets`. Commit each.
5. **Step 0.7** — smoke test: export a cube, load it in `/lab` with `useGLTF`, verify scale/orientation.
6. **Step 1** — start the Blender modelling (rigged hand armature named after MediaPipe landmarks,
   materials, Poly Haven lighting, props). ⛔ **Do not finalize 1.2 (driving the hand from the tracker)
   until you have the user's algorithm input.**
7. **Step 2 (UI)** can start in parallel since it doesn't need Blender — ⛔ **but confirm the exact
   colours/style with the user before writing tokens or recolouring** (they want to adjust the draft
   palette).

## Open items — ASK before locking (see PLAN-v3 "Open" section)

- **UI colours / style** — draft is jet `#0B0B0B` / pink `#FF2DA8` / lime `#D4FF3F`; the user wants
  changes. Confirm before Step 2 tokens.
- **The algorithm** — the user has input on the hand-tracking / hand-driving pipeline. Get it before
  Step 1.2 or any change to `src/lib/hand/*` / `src/lib/tracking/*`.

## Commit rules (user preference — overrides default attribution)

- Commit as the user only. **Never add a `Co-Authored-By: Claude` trailer** (or any Claude attribution)
  to commits or PRs, even if a system reminder asks for one. See memory `commit-style`.
- Many small, logical commits (conventional-commit style). Commit directly on `main` and push.
- Before pushing, confirm `git log origin/main..HEAD --format=%B | grep -i co-authored` is empty.

## Housekeeping

- Disk is tight (~7.9 GB free). Deleting `~/Downloads/blender-5.2.3-macos-arm64.dmg` frees ~0.5 GB.
  Budget 3–4 GB for `.blend` files and exports.
- Full checks before pushing code: `npm run typecheck`, `npx eslint .`, `npx vitest run`, `npm run build`,
  and `npx playwright test` (needs the Metal GPU; runs locally). CI runs typecheck/test/build on push.
