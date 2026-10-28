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
  `INDEX_FINGER_MCP` … `PINKY_TIP`) plus `FOREARM` (a 5 cm wrist cuff behind the wrist, parent of `WRIST`; there is no forearm). Finger roots
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
scale. Bones are flattened under one root so stretching never shears children. The cuff carries on
straight back from the knuckles through the wrist, at its modelled length.

## Marker empties

`npm run assets` prunes unused data but keeps empty leaf nodes, so Blender empties arrive as named
nodes: light positions, tool tips, stitch points. Compression (quantisation) rewrites the transforms
of *mesh* nodes, so anything code turns or reads as a pivot (a jaw's hinge) is an empty with its mesh
as a child.

## Theatre room contract (`theatre-room.glb`)

Built by `scripts/blender/build_theatre_room.py`, then lit by `bake_theatre_room.py` (Cycles on the
GPU, ~6 min at 4096 px):

```bash
blender -b --factory-startup --python scripts/blender/build_theatre_room.py
blender -b assets/blender/theatre-room.blend --python scripts/blender/bake_theatre_room.py
npm run assets -- theatre-room
```

The bake adds lights only for the bake (an area light under every LED panel, a spot in each lamp head),
stand-ins whose shadows land on the floor (table, patient, tray), joins the static room into
`Room_Baked` with lightmap UVs, bakes diffuse light, exposes it ×0.1 with a soft shoulder into an sRGB
texture, and renders a 360° HDR from the table to `public/env/theatre-room.hdr` (used at ×0.1 too).
Pinned by `src/lib/assets/theatreRoom.test.ts`.

- A 7 × 7 m room, 3 m ceiling, centred on the operating table (three.js x −0.1, z −0.4); the viewer
  faces the front wall (−z), where the sliding doors are. Floor top at y 0.
- `Room_Baked` is drawn unlit (`MeshBasicMaterial`, no tone mapping); a shadow-only sheet over the floor
  takes the live shadows. The glowing parts (`Room_LedPanel`, `Room_LampLED`, `Room_VitalsScreen`,
  `Room_ControlLight`), `Room_DoorGlass` and `Room_Painting` stay separate and lit live.
- `LIGHT_Surgical_A`/`_B` and their `_TARGET`s: where the twin surgical lights hang and aim. The code
  puts its live spotlights there.
- Visual only: the ground collider is in code. The painting on the front wall, right of the doors (`Room_Painting`), is
  textured from `assets/textures/painting.jpg`, packed into the `.blend` and exported as WebP.

## Patient contract (`patient.glb`)

Built by `scripts/blender/build_patient.py`. The patient lies along x (head at −x), midline z −0.4.
`skin_height()` there and `skinHeight()` in `src/scenes/theatre/layout.ts` are the same function.

- `Skin`, `Fascia`: shape keys `Open_0` … `Open_6` open the incision section by section along the guide
  (x −0.08 … 0.08); they are tents that sum to the whole cut, so code sets each to how much of its
  stretch has been cut. `Retracted` pulls the wound wide on top of a full open. Nothing opens outside
  the guide.
- `Bowel_Proximal`, `Bowel_Distal`: `Approximate` slides their cut ends together at x 0.
  `Bowel_Necrotic` is the dead segment, moved by code (into the forceps, into the dish).
- `Clamp_Proximal`/`_Distal`, `Guide_Incision`, `Guide_CutRings`, `Guide_Stitches`, `Guide_Staples`:
  shown per step by code.
- Empties: `INCISION_From`/`To`, `CUT_Proximal`/`Distal`, `STITCH_01` … `08` (in order), `STAPLE_01` … `10`.
- Visual only: the body's colliders are boxes in `Patient.tsx`, rebuilt as the wound opens.

## Instruments contract (`instruments.glb`)

Built by `scripts/blender/build_instruments.py`. Each tool (`Scalpel`, `Forceps`, `Scissors`,
`NeedleDriver`, `Stapler`, `Balfour`) is a root node where it rests on the Mayo tray; in its frame the
tip points along −z and the top is +y, the origin is where it's held.

- Hinges (empties): `Forceps_JAW_L`/`R`, `Scissors_JAW_L`/`R`, `NeedleDriver_JAW_L`/`R` turn about y;
  `Stapler_TRIGGER` about x.
- Working points (empties): `Scalpel_EDGE`, `Forceps_TIP`, `Scissors_TIP`, `NeedleDriver_TIP` (the
  needle's point), `Stapler_TIP`, `Balfour_SEAT`.
- `MayoTray` and `KidneyDish` are fixtures. Colliders are boxes in `src/scenes/theatre/Tools.tsx`.
