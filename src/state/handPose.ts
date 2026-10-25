import { PoseInterpolator, type PoseSnapshot } from "@/lib/hand/interpolate";
import type { Handedness } from "@/lib/hand/types";
import type { TrackedHand } from "@/lib/tracking/processor";

/**
 * Render-time hand poses, shared by the robot hand mesh and the physics colliders so they never
 * disagree. The tracking provider pushes every processed frame; consumers sample at their own time.
 * Inactive (e.g. on the landing page, which writes poses straight into the hand store) → consumers
 * fall back to the store's joints.
 */
const interpolators: Record<Handedness, PoseInterpolator> = { Left: new PoseInterpolator(), Right: new PoseInterpolator() };
const cache: Record<Handedness, { t: number; pose: PoseSnapshot | null }> = { Left: { t: -1, pose: null }, Right: { t: -1, pose: null } };

export const handPose = {
  active: false,

  push(hands: Partial<Record<Handedness, TrackedHand>>, tMs: number) {
    this.active = true;
    for (const h of ["Left", "Right"] as Handedness[]) {
      const hand = hands[h];
      if (hand) interpolators[h].push(hand, tMs);
      else interpolators[h].reset();
      cache[h].t = -1;
    }
  },

  /** Interpolated pose for `hand` at `tMs` (performance.now() time), or null. */
  sample(hand: Handedness, tMs: number = performance.now()): PoseSnapshot | null {
    if (!this.active) return null;
    const c = cache[hand];
    if (c.t !== tMs) {
      c.pose = interpolators[hand].sample(tMs);
      c.t = tMs;
    }
    return c.pose;
  },

  reset() {
    this.active = false;
    interpolators.Left.reset();
    interpolators.Right.reset();
    cache.Left.t = cache.Right.t = -1;
  },
};
