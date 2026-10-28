# The new surgery room: bowel resection and anastomosis

Replaces the current `/theatre` (practice pad + fragments) with a real operating room and a five-step
operation: midline laparotomy → retraction → bowel resection → anastomosis → wound closure.
Planned 2026-10-28. Rules from `docs/HANDOFF-theatre.md` still apply: ask before every change, small
commits on `main`, push, verify on the live site.

## How it's built (our stack, not runtime Blender)

Blender makes the visuals only (`.blend` → `npm run assets` → `.glb`). Grabbing, cutting and stitching
are three.js / Rapier code, like the scalpel and forceps today.

| Idea | How we do it |
|---|---|
| Incision opening / closing | Shape keys in Blender → glTF morph targets, weighted from code by step progress |
| Cutting | No booleans (they don't export). Pre-made seams + morph targets; the resected segment is its own named mesh |
| Where things happen | Named empties exported from Blender (tool tips, jaw pivots, stitch points, light positions) read by code |
| Colliders | Stay in code (as PLAN-v3 1.5) |
| Balfour retractor | One self-retaining frame with two lateral blades (not two hooks) |
| Scalpel | #3 handle with a #10 blade |

## Decisions (2026-10-28)

1. **Replace `/theatre` in place.** The old room stays in git history.
2. **Look: between matte and glossy, game-like.** Stylised, slightly saturated colours. Tissue roughness
   ~0.5 with soft sheen and little clearcoat; instruments brushed steel (~0.35), not mirror chrome.
3. **One tool at a time.** Both hands together hold at most one instrument; put it back on the Mayo tray
   to swap (HUD hint).
4. **Guides on every step, and tools never act beyond them.** Scalpel opens tissue only between the
   guide's ends (elsewhere the skin stops it, no mark); scissors cut only at the cut rings; the needle
   only through stitch points; staples only on their marks. Off-guide attempts count as "strays" in
   the HUD, never damage.
5. **Lighting baked in Blender.** The static room is baked (Cycles) into its textures and drawn
   unlit; a 360° environment rendered from the table lights reflections; moving things (patient,
   tools, hands) get live lights placed at the `LIGHT_*` empties so everything matches.
6. **Disk isn't a constraint.** ~4K baked textures are fine; still compressed by `npm run assets`.

## Phases

### Phase 0: Asset contract
- "Theatre contract" section in `docs/BLENDER.md`: node, morph and empty names the code relies on
  (`Skin.Open`, `Fascia.Open`, `Bowel.Approximate`, `SCALPEL_EDGE`, `JAW_L`/`JAW_R`, `STITCH_01..08`,
  `STAPLE_01..10`, `LIGHT_*`, …). Written as each phase defines them.
- Three models, so the room appears first: `theatre-room.glb`, `patient.glb`, `instruments.glb`, each
  rebuilt by a builder script in `scripts/blender/` (like `build_hand.py`).

### Phase 1: The room (`build_theatre_room.py` → `theatre-room.glb`)
Styled after the reference photo of a hybrid operating room:
- Blue-violet wall panels, a grid of LED ceiling panels, a ceiling boom with twin round surgical lights.
- Wall monitor and boom-mounted monitors, sliding doors, light floor with the round inlay.
- The photo's scenic mural becomes a soft gradient panel (no copyrighted or branded imagery).
- Baked lighting (decision 5); `LIGHT_*` empties for the live lights; environment map from the table.
- Removes `Floor`, `Lamp` and the floating tray stands from the theatre. 60 fps budget checked in e2e.

### Phase 2: Patient and anatomy (`patient.glb`)
- Draped patient with an abdominal window. Layers: skin → fascia → peritoneal cavity.
- Skin and fascia morphs: `Open`, `Retracted`, `Closed`.
- Bowel after the reference image: colon framing the cavity, coiled small bowel, mesentery.
- One stretch split into `Bowel_Proximal`, `Bowel_Necrotic` (dark, dusky, swollen) and `Bowel_Distal`,
  with cut-ring markers and an `Approximate` morph bringing the healthy ends together.
- Two pre-placed bowel clamps holding the necrotic loop.
- Contract test like `src/lib/assets/robotHand.test.ts`.

### Phase 3: Instruments (`instruments.glb`)
- #3 scalpel + #10 blade, Balfour retractor, Adson forceps, Metzenbaum scissors, Mayo-Hegar needle
  driver with curved needle, skin stapler. Mayo stand + tray, kidney dish for the specimen.
- Named pivots and tips; jawed tools have hinged jaws the code opens and closes.

### Phase 4: Procedure engine (code)
- Step state machine in `theatreStore`: Incision → Retraction → Resection → Anastomosis → Closure.
- HUD: step checklist, per-step metrics, strays, sterile breaches.
- One generic `Tool` component (glb node + code colliders + "drive" attach + ghost + squeeze to close
  jaws) replaces the hand-written `Scalpel` and `Forceps`. One-tool-at-a-time rule.
- Sterile field kept: hands never touch the patient.
- Practice pad, fragments and the old theatre e2e tests removed.

### Phases 5–9: The operation (one step per phase, each shipped and verified live)

| Phase | Step | Interaction |
|---|---|---|
| 5 | Midline laparotomy | Pinch the scalpel, trace the midline guide. Covered guide opens `Skin.Open`, then `Fascia.Open` on a second pass. Reuses `incision.ts` coverage/accuracy. Never opens past the guide ends. |
| 6 | Retraction | Carry the Balfour to the wound and release: it snaps in (like the chip into its socket) and blends to `Retracted`, exposing the bowel. |
| 7 | Resection | Scissors close (fist) at each cut ring while the clamps hold the loop. Swap to forceps, lift the dead segment into the kidney dish. |
| 8 | Anastomosis | Needle driver: needle tip through `STITCH_01..08` in order. Each stitch draws a thread segment (tube along a curve) and advances `Bowel.Approximate`. |
| 9 | Closure | Stapler: squeeze on each `STAPLE_xx` mark. A staple appears and `Closed` advances. Final score. |

### Phase 10: Finish
Performance budget in e2e, phone-width pass, README screenshot, new hand-off doc.
