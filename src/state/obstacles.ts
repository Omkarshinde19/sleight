import { useEffect, useRef } from "react";
import type { Obstacle } from "@/lib/physics/depenetrate";
import type { Handedness, Point } from "@/lib/hand/types";

/**
 * Solid shapes the robot hands are kept out of (see depenetrate.ts). Scenes register what's solid;
 * the patient in the theatre deliberately isn't, since a hand in the patient is the point there.
 */
export const obstacles = new Map<string, () => Obstacle | null>();

/** What each hand is cradling (moves and pushes out with the hand, and the fingers wrap round it). */
export const heldSpheres: Partial<Record<Handedness, () => { c: Point; r: number } | null>> = {};

export function swapHeldSpheres() {
  [heldSpheres.Left, heldSpheres.Right] = [heldSpheres.Right, heldSpheres.Left];
}

/** Register a solid shape for as long as the calling component is mounted. Return null to skip it. */
export function useObstacle(id: string, get: () => Obstacle | null) {
  const ref = useRef(get);
  useEffect(() => {
    ref.current = get;
  });
  useEffect(() => {
    obstacles.set(id, () => ref.current());
    return () => void obstacles.delete(id);
  }, [id]);
}
