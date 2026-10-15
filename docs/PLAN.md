# Sleight — plan

Your real hand, tracked by the webcam, drives chrome robot hands in three physics scenes.
100% client-side: webcam frames are processed in the browser and never leave the device.

## Design: "Chrome Lab"

Direction B (engineering drawing) applied to chrome hands and frosted glass.

- **Palette:** ink `#07080C`, glass `rgba(255,255,255,0.08)`, gradient indigo `#2B2F8F` → violet `#6A4BC4`
  → ember `#E2553A`, bone `#ECEAE4`, instrument cyan `#7FE3F0` for annotations.
- **Type:** Instrument Serif (display, italic for emphasis), Geist (UI), Geist Mono (numbers, callouts).
- **Hands:** mirror-chrome `MeshPhysicalMaterial` with thin-film iridescence, lit by procedural
  light strips (drei `Lightformer`) — no HDR download.
- **Signature effect:** live blueprint callouts. Dimension lines and joint-angle labels
  (`INDEX PIP 42°`, `GRIP 0.81`) follow the hand in real time.
- **Weather:** rain wets the chrome (beaded droplets, darker clearcoat) and the hands dry when it stops;
  snow settles on upward-facing surfaces and melts.

## Stack and why

| Concern | Choice | Why |
|---|---|---|
| App | Next.js 16 (App Router), React 19, TS | Static landing page, one lazy client-only route per scene, native on Vercel |
| Tracking | MediaPipe Tasks Vision HandLandmarker, GPU delegate → CPU fallback | WASM + model self-hosted from `/public` so no third-party request |
| 3D | three.js via @react-three/fiber 9 + drei 10 | |
| Physics | @react-three/rapier 2 | CCD, kinematic bodies with velocity, fixed/spring/revolute joints with motors |
| Per-frame state | zustand store read inside `useFrame` | No React re-render at 30–60 Hz |
| Tests | Vitest (maths, classifier), Playwright (browser smoke, fake camera) | |

### Rapier vs cannon-es

Rapier wins on all three scenes: kinematic hands report real velocity so pushes and throws are correct;
CCD stops a thin scalpel tunnelling; revolute motors give levers spring + damping for free.
Note that CCD does not stop a *kinematic* body — it goes where it is told. So in the theatre, a tool is a
**dynamic** body driven toward the hand by velocity (a PD controller), and the anatomy blocks it.
A ghost shows where the hand wants the tool to be.

## Architecture

```
src/lib/hand/         pure maths, unit-tested
  types.ts            landmark indices, HandFrame
  oneEuro.ts          One Euro filter (scalar + vec3)
  gestures.ts         features + classifier with hysteresis and dwell
  velocity.ts         ring buffer, throw velocity (regression over last ~100 ms)
  depth.ts            depth from apparent palm size, calibration
  mapping.ts          landmarks → scene space
  synth.ts            parametric hand: pose → 21 landmarks (used by simulated mode and fixtures)
src/lib/tracking/     sources that all emit the same RawFrame
  camera.ts           webcam + HandLandmarker
  playback.ts         recorded JSON sessions
  simulated.ts        keyboard + mouse virtual hands
src/state/handStore.ts  latest processed hands, gesture, velocity, fps, latency
src/components/
  tracking/HandTrackingProvider.tsx   source lifecycle, smoothing, gestures
  hands/ChromeHand.tsx                rendered robot hand
  physics/HandColliders.tsx           kinematic palm + fingertip colliders, grab joints
  hud/DebugOverlay.tsx, hud/Callouts.tsx
  weather/                            rain, snow, wetness
src/app/(scenes)/arcade | industrial | theatre
```

Gestures: `open`, `pinch`, `fist`, `point`. Each has an enter and a (looser) exit threshold and must hold
for N frames to switch, so a grab never flickers.

Grabbing: a fixed joint (Arcade, Industrial chip) or a spring joint (lever) between a kinematic grip
anchor and the object — never teleporting. Throw: release the joint and set the ball's velocity to the
hand's averaged recent velocity × gain.

## Simulated hand

- **Keyboard + mouse:** mouse moves the hand, wheel = depth, `1–4` (or hold `Space` = fist,
  `Shift` = pinch) set the gesture, `Q/E` roll, `Tab` switches hand.
- **Playback:** recorded sessions (`/public/sessions/*.json`) loop as a demo fallback.
- **Record:** in camera mode, `R` records to a downloadable JSON.

## Milestones (each ends with a browser check)

1. **M1** Tracker, simulated hand, debug overlay. Check: simulated hand moves and changes gesture; fake camera
   from the recorded clip produces landmarks and a gesture label.
2. **M2** Arcade end to end. Check: simulated grab → throw → score.
3. **M3** Industrial. Check: pinch chip into socket; fist pulls lever, lever springs back, machine runs.
4. **M4** Theatre. Check: tool pushed into anatomy never penetrates (measured).
5. **M5** Landing page (scroll story of the three hands), weather, mobile landscape, README, deploy notes.
