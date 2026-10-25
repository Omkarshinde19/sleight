import { interactionGroups } from "@react-three/rapier";

/**
 * Collision layers.
 * - WORLD: floors, walls, fixtures
 * - HAND: palm and fingertip colliders
 * - PROP: anything loose that hands can push or pick up
 * - HELD: a prop while it is attached to a hand (so the fingers wrapped round it don't shove it)
 * - TOOL: surgical instruments: driven by a hand, they are what touches the patient
 * - ANATOMY: the patient. Tools and props hit it; hands pass through (and raise a sterile-field breach).
 */
export const LAYER = { WORLD: 0, HAND: 1, PROP: 2, HELD: 3, TOOL: 4, ANATOMY: 5 } as const;

export const GROUPS = {
  world: interactionGroups(LAYER.WORLD, [LAYER.HAND, LAYER.PROP, LAYER.HELD, LAYER.TOOL]),
  hand: interactionGroups(LAYER.HAND, [LAYER.WORLD, LAYER.PROP]),
  prop: interactionGroups(LAYER.PROP, [LAYER.WORLD, LAYER.HAND, LAYER.PROP, LAYER.HELD, LAYER.TOOL, LAYER.ANATOMY]),
  /** A prop that hands pass through: it only moves when grabbed (no accidental knocks off a rack). */
  propNoHand: interactionGroups(LAYER.PROP, [LAYER.WORLD, LAYER.PROP, LAYER.HELD, LAYER.TOOL, LAYER.ANATOMY]),
  held: interactionGroups(LAYER.HELD, [LAYER.WORLD, LAYER.PROP, LAYER.HELD, LAYER.ANATOMY]),
  /**
   * A held prop that touches nothing. Contacts with the rack or other balls fought the grab joint and
   * made a held ball wobble up to 9 cm in the hand; the hand itself is kept out of solid things instead.
   */
  heldFree: interactionGroups(LAYER.HELD, []),
  tool: interactionGroups(LAYER.TOOL, [LAYER.WORLD, LAYER.PROP, LAYER.ANATOMY]),
  anatomy: interactionGroups(LAYER.ANATOMY, [LAYER.PROP, LAYER.HELD, LAYER.TOOL]),
};
