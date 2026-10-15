import { interactionGroups } from "@react-three/rapier";

/**
 * Collision layers.
 * - WORLD: floors, walls, fixtures, anatomy
 * - HAND: palm and fingertip colliders
 * - PROP: anything loose that hands can push or pick up
 * - HELD: a prop while it is attached to a hand (so the fingers wrapped round it don't shove it)
 */
export const LAYER = { WORLD: 0, HAND: 1, PROP: 2, HELD: 3, TOOL: 4 } as const;

export const GROUPS = {
  world: interactionGroups(LAYER.WORLD, [LAYER.HAND, LAYER.PROP, LAYER.HELD, LAYER.TOOL]),
  hand: interactionGroups(LAYER.HAND, [LAYER.WORLD, LAYER.PROP]),
  prop: interactionGroups(LAYER.PROP, [LAYER.WORLD, LAYER.HAND, LAYER.PROP, LAYER.HELD, LAYER.TOOL]),
  held: interactionGroups(LAYER.HELD, [LAYER.WORLD, LAYER.PROP, LAYER.HELD]),
  /** Surgical tools: driven by a hand, but only ever touch the world (anatomy, tray). */
  tool: interactionGroups(LAYER.TOOL, [LAYER.WORLD, LAYER.PROP]),
};
