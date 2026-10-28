# Blender asset pipeline

Blender makes the models; the site still renders with three.js. Source files live in `assets/blender/`
(Git LFS), the exported, compressed models in `public/models/` (plain git, so Vercel needs no LFS).

## Build the models

```bash
npm run assets            # every assets/blender/<name>.blend → public/models/<name>.glb
npm run assets -- hand    # just one
```

Each file is exported headlessly by `scripts/blender/export.py` (+Y up, 1 Blender unit = 1 m, modifiers
applied, skins and actions kept, cameras and lights left out, objects hidden from renders left out),
then compressed by gltf-transform (meshopt geometry, WebP textures). Names of nodes, bones and materials
are kept: code looks them up by name. `BLENDER=/path/to/blender` overrides the binary.

Generated sources have a builder script beside the exporter, e.g.
`blender -b --factory-startup --python scripts/blender/build_smoke.py` rebuilds `smoke.blend`.

## Conventions

- Scene units metric, unit scale 1.0 (the exporter refuses anything else).
- Model in Blender's Z-up; the exporter converts. Blender (x, y, z) → three.js (x, z, −y).
- `smoke.blend` / `smoke.glb` is the reference asset; `src/lib/assets/smoke.test.ts` and the Lab e2e
  test check that names, scale and orientation survive the pipeline. Re-run both after changing export
  or compression flags.

## Blender MCP (driving the open Blender from Claude Code)

- Blender: 3D view → N panel → "MCP for Blender" → Start MCP Server (listens on `127.0.0.1:9876`).
- The `blender` MCP server is registered with **local scope for the `sleight/` folder**
  (`claude mcp get blender`). Start Claude Code sessions in `sleight/`, not the parent folder, or its
  tools won't load. To load it everywhere instead:
  `claude mcp add -s user blender --env DISABLE_TELEMETRY=true -- uvx mcp-for-blender`.
- Without the tools, the add-on socket still accepts JSON commands such as
  `{"type": "get_scene_info", "params": {}}` and `{"type": "execute_code", "params": {"code": "…"}}`.

## Robot hand contract (`robot-hand.glb`)

Built by `scripts/blender/build_hand.py`; pinned by `src/lib/assets/robotHand.test.ts`.

- Armature `RobotHand`: 21 bones named after MediaPipe's landmarks (`WRIST`, `THUMB_CMC` …
  `INDEX_FINGER_MCP` … `PINKY_TIP`) plus `FOREARM` (elbow → wrist, parent of `WRIST`). Finger roots
  are children of `WRIST`. Bone *X* starts at landmark *X* and points at the next landmark; `*_TIP`
  bones are 12 mm nubs.
- Rest pose (three.js axes): open right hand, wrist at the origin, fingers +Y, back of the hand +Z,
  palm −Z, thumb on −X. That's the frame the tracker puts a right hand in, palm to the webcam.
- Bone axes: local +Y along the bone, local +Z toward the back of the hand (thumbnail for the thumb).
- Real-hand size (metres); the scene's `handScale` scales it up.
- One skinned mesh, every rigid part weighted 100 % to one bone; materials `Chrome`, `Gunmetal`,
  `Copper`, `Muscle` (thin film → `KHR_materials_iridescence`, coat → `KHR_materials_clearcoat`).
- Only a right hand is modelled; a left hand is solved as a mirrored right hand and drawn mirrored.

## Driving it (`src/lib/hand/rig.ts`, `src/components/hands/RobotHand.tsx`)

Each frame `HandRig` takes the same settled joints the physics colliders use. The palm frame (+Y to the
middle knuckle, +X toward the pinky, +Z back of the hand) orients the wrist; every other bone starts
from its parent's orientation and swings, by the smallest rotation, to point at its child joint, so no
bone twists on its own. Each bone stretches to the tracked bone length; thickness follows the hand
scale. Bones are flattened under one root so stretching never shears children. The forearm is aimed
by `ForearmFollower` and grows until it leaves the screen.

## Theatre room contract (`theatre-room.glb`)

Built by `scripts/blender/build_theatre_room.py`; pinned by `src/lib/assets/theatreRoom.test.ts`.

- A 7 × 7 m room, 3 m ceiling, centred on the operating table (three.js x −0.1, z −0.4); the viewer
  faces the front wall (−z), where the sliding doors are. Floor top at y 0.
- One mesh per material, named `Room_<Material>` (`Room_Floor`, `Room_Wall`, `Room_LedPanel`, …).
  `src/scenes/theatre/Room.tsx` draws it as exported; only the floor meshes receive shadows.
- Visual only: the ground collider is in code. The painting on the front wall, right of the doors (`Room_Painting`), is
  textured from `assets/textures/painting.jpg`, packed into the `.blend` and exported as WebP.
