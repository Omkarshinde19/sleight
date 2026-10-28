# Sleight v3: Blender assets and the "Sound Waves" UI

> **2026-10-28:** the industrial room is removed; the site has the arcade and the theatre.
>
> **Progress (2026-10-28):** Step 0 and Steps 1.1–1.3 are done and live, plus the arcade feel fixes
> (smoothing, tracker worker, capture-time stamps, following forearm, skeleton flip fix). Next: the
> surgery room. Hand-off: `docs/HANDOFF-theatre.md`.

**Status (2026-10-28):** Step 0 setup is done — Blender 5.2.3 LTS installed, `uv` installed, the
"MCP for Blender" add-on (v1.8) enabled, its server listening on `127.0.0.1:9876`, and the `blender`
MCP server registered in Claude Code (`claude mcp list` → ✔ Connected). Nothing is committed yet from
Step 0 onward; building starts in a fresh session (see `docs/HANDOFF-blender.md`).

## Open — pending the user's input (do NOT finalize without it)

The user has more to say on two things. Begin all three phases, but pause and ask before locking these:

- **UI (Step 2): colours and style.** The palette below (jet / hot pink / chartreuse) and the poster
  styling are a draft. The user wants to adjust the colours (and possibly other UI choices). Confirm the
  exact tokens with them before writing `globals.css` tokens or recolouring scenes.
- **The algorithm.** The user has changes/input on the hand-tracking + hand-driving algorithm (how the
  tracked landmarks drive the skeleton/skinned hand — Step 1.2 and the v2 pipeline). Get this before
  finalizing 1.2 or touching the tracking/skeleton code.

Everything else in this plan stands. Step 0 (pipeline) and the Blender modelling in Step 1 that doesn't
depend on the algorithm change can proceed immediately.

**What "switching to Blender" means.** Blender is where the 3D *assets* get made: models, rigs,
materials, lighting references. It doesn't run in a browser. The site keeps running on three.js / React
Three Fiber, with MediaPipe and Rapier exactly as now. What changes is that the robot hands, props and
scenes stop being built from cylinders and spheres in code and become real models exported from
Blender as glTF (`.glb`), which three.js loads natively. Everything stays free: Blender (GPL),
glTF, gltf-transform (MIT), Poly Haven (CC0).

---

## Step 0: Install Blender and connect it to the repo

| # | Task | Commit |
|---|---|---|
| 0.1 | ✅ **Done.** Blender 5.2.3 LTS installed at `/Applications/Blender.app`; headless export verified (test cube → `.glb`, +Y up, metre scale, PBR material intact). | none (machine setup) |
| 0.2 | Repo layout: `assets/blender/` (source `.blend` files), `assets/textures/`, `public/models/` (exported `.glb`), `scripts/blender/` (Python export scripts) | `chore(assets): folders for Blender sources and exported models` |
| 0.3 | **Git LFS** for `.blend`, `.hdr`, `.exr`, large textures (`.gitattributes`). `.blend` files grow fast; GitHub rejects files over 100 MB, and LFS's free quota is 1 GB. | `chore(git): track Blender sources and HDRIs with Git LFS` |
| 0.4 | Headless export script: `blender -b assets/blender/hand.blend --python scripts/blender/export.py` writes `public/models/robot-hand.glb` with the right axes (+Y up), scale (metres) and names. Same command every time, so exports are reproducible. | `feat(assets): headless Blender → glTF export script` |
| 0.5 | Compress exports with **gltf-transform** (meshopt geometry, KTX2/WebP textures) so phones load fast: `npm run assets` runs export + compress. | `build(assets): compress glTF with gltf-transform` |
| 0.6 | ✅ **Done.** "MCP for Blender" v1.8 add-on enabled, server on `127.0.0.1:9876`, registered in Claude Code with telemetry off (`--env DISABLE_TELEMETRY=true`). Blender tools load in a fresh session. | `docs: how to connect Blender MCP` |
| 0.7 | Smoke test: export a cube from Blender, load it in `/lab` with drei's `useGLTF`, check scale and orientation match. | `test(assets): exported glTF loads at the right scale and orientation` |

Done when one command turns a `.blend` into a compressed `.glb` that shows up correctly in the Lab.

## Step 1: Move the 3D content to Blender

The tracking, physics and grab system stay as they are. Only what you *see* changes.

| # | Task | Notes |
|---|---|---|
| 1.1 | **Rigged robot hand.** Model one hand with a 21-bone armature named after MediaPipe's landmarks (`WRIST`, `THUMB_CMC` … `PINKY_TIP`), plus a forearm. Mirror it for the left hand. | Bone names are the contract between Blender and code. |
| 1.2 | ✅ **Done (2026-10-28):** `HandRig` + `RobotHand` replace `ChromeHand` everywhere (see docs/BLENDER.md). **Drive the skinned hand from the tracker.** Each frame, turn each bone to point along the matching tracked bone (the rigid skeleton from v2 already gives fixed lengths). This replaces the procedural `ChromeHand` geometry. Physics colliders don't change. ⛔ **The user has input on this algorithm — get it first (see Open section).** | Keep the old `ChromeHand` behind a flag until the new one matches. |
| 1.3 | **Materials.** Chrome stays: physical metal + iridescence in Blender, exported as glTF PBR with extensions three.js reads (clearcoat, iridescence). The rain and snow shader patch keeps working on top. | Weather uniforms reapply on the loaded material. |
| 1.4 | **Lighting.** A free Poly Haven HDRI for reflections, instead of only procedural light strips. | ~1–2 MB at 1k resolution |
| 1.5 | **Props.** Basketball, hoop, rack, scalpel and forceps, operating table. Collider shapes stay in code; the models are visual only. | One commit per prop |
| 1.6 | **Landing animations.** Keyframe the landing-page hand poses in Blender (or Theatre.js) instead of hand-tuned numbers in `LandingStage.tsx`. | Smoother than the current per-chapter interpolation |
| 1.7 | **Performance budget.** Hand under 15k triangles, scene under 4 MB compressed, 60 fps on an M-series Mac, 30 fps on an iPhone. Checked in e2e. | |

## Step 2: Convert the UI to the new palette and style

⛔ **Colours and style are a draft — confirm with the user before writing any tokens or recolouring.**

Reference: the "SOUND WAVES" poster. Bold, very wide grotesk type in hot pink, chartreuse liquid
blobs, halftone dots, a black-and-white photo, small wide-tracked uppercase labels, numbered
section index (01–04), outlined pill buttons.

**Palette (replaces ink / violet / ember / cyan):**

| Token | Colour | Use |
|---|---|---|
| `--jet` | `#0B0B0B` Jet Black | Background, panels |
| `--pink` | `#FF2DA8` Hot Pink | Headlines, primary actions, the right hand's accents |
| `--lime` | `#D4FF3F` Chartreuse | Highlights, live data (callouts, scores), the left hand's accents |
| `--bone` | `#F2F2F2` (derived) | Body text on black |

Contrast: pink on black and lime on black both pass for body text; **never pink text on lime** (or the
reverse) for small type. That pairing is only for big shapes. Dark mode is the only mode; this palette
is black-first.

| # | Task |
|---|---|
| 2.1 | Design tokens in `globals.css` (colours, type scale, spacing); remove the old gradient |
| 2.2 | Type: a very wide heavy display face (free candidates: **Unbounded**, **Archivo Expanded Black**), plus a clean sans for UI with wide-tracked uppercase labels |
| 2.3 | Liquid blob layer: an animated metaball shader in pink and lime behind the hero (could react to your hands) |
| 2.4 | Halftone treatment: a halftone-dot shader for hero imagery and renders of the robot hands from Blender |
| 2.5 | Landing page rebuilt in the poster's layout: giant split headline, left label stack, numbered chapter index on the right, round arrow "explore" button |
| 2.6 | HUD and scene chrome: frosted glass becomes solid black panels with pink/lime outlines; outlined pill buttons |
| 2.7 | 3D scenes recoloured to match: floor grid, hoop, machine accents, theatre lights |
| 2.8 | Screenshots in the README refreshed; visual check on phone and desktop |

Each row is one or more small commits (`style(tokens)…`, `feat(landing)…`, `style(hud)…`).

## What's needed from you

Answered: ✅ Blender installed · ✅ Blender MCP set up · disk is tight (~7.9 GB free — deleting the
Blender `.dmg` in Downloads frees ~0.5 GB).

Still open (the new session will ask as it reaches each):

1. **UI colours / style** — the draft palette and poster styling, to adjust before Step 2. *(pending)*
2. **The algorithm** — your changes to the hand-tracking / hand-driving pipeline, before Step 1.2. *(pending)*
3. **Git LFS OK?** (0.3) — uses your GitHub LFS quota (1 GB free). Default: yes.
4. **The hand's look** — keep chrome, or restyle to black chrome with pink/lime accents? Reference images help.
5. **Imagery** — your own photos, free Unsplash, or halftone renders of the robot hands (recommended).
6. **Fonts** — OK with free Google Fonts look-alikes? The poster's exact face is likely paid.
