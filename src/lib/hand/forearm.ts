import type { Point } from "./types";

/**
 * Where the robot forearm points. It used to be "straight back from the knuckles", so every wobble of
 * the wrist swung the whole ~40 cm arm (up to 540°/s on the recorded arcade session). Now the forearm
 * hangs toward an elbow below the hand and toward you, like an arm propped on a desk, which follows the
 * wrist with a short lag; 30 % of the hand's own direction is blended in so the wrist never kinks
 * (bend stays under ~60°). On the recorded session: worst swing 301°/s, typical wrist bend 22°.
 */

/** Where the elbow sits relative to the wrist. Distances are in hand-scale units (× the hand's scale). */
export interface ElbowPlacement {
  below: number;
  towardViewer: number;
  /** Fraction of the way from the wrist toward the scene's centre line (x = 0). */
  toCentre: number;
}

/** Scenes: under the hand and toward you, like an arm propped on a desk. */
export const SCENE_ELBOW: ElbowPlacement = { below: 0.37, towardViewer: 0.23, toCentre: 0.4 };
/** Landing hero: behind the hand and a little below, so the arm stays off the headline and copy. */
export const LANDING_ELBOW: ElbowPlacement = { below: 0.06, towardViewer: -0.25, toCentre: 0 };

/** How quickly the elbow follows the wrist, s. Slower is worse: the arm then pivots round a lagging elbow. */
const ELBOW_TAU = 0.25;
/** Share of the hand's own direction (knuckles → wrist) in the forearm direction. */
const HAND_BLEND = 0.3;

const norm = (p: Point): Point => {
  const l = Math.hypot(p.x, p.y, p.z) || 1;
  return { x: p.x / l, y: p.y / l, z: p.z / l };
};

export class ForearmFollower {
  private elbow: Point | null = null;

  constructor(private placement: ElbowPlacement = SCENE_ELBOW) {}

  /** Unit direction from the wrist toward the elbow. `dtSec` is the time since the last call. */
  update(wrist: Point, middleMcp: Point, dtSec: number, scale: number): Point {
    const { below, towardViewer, toCentre } = this.placement;
    const target = { x: wrist.x * (1 - toCentre), y: wrist.y - below * scale, z: wrist.z + towardViewer * scale };
    const e = this.elbow;
    const k = e ? 1 - Math.exp(-Math.max(0, dtSec) / ELBOW_TAU) : 1;
    this.elbow = e ? { x: e.x + (target.x - e.x) * k, y: e.y + (target.y - e.y) * k, z: e.z + (target.z - e.z) * k } : target;
    const toElbow = norm({ x: this.elbow.x - wrist.x, y: this.elbow.y - wrist.y, z: this.elbow.z - wrist.z });
    const back = norm({ x: wrist.x - middleMcp.x, y: wrist.y - middleMcp.y, z: wrist.z - middleMcp.z });
    return norm({
      x: toElbow.x * (1 - HAND_BLEND) + back.x * HAND_BLEND,
      y: toElbow.y * (1 - HAND_BLEND) + back.y * HAND_BLEND,
      z: toElbow.z * (1 - HAND_BLEND) + back.z * HAND_BLEND,
    });
  }

  /** The hand went away: the next update starts the elbow straight at its target. */
  reset() {
    this.elbow = null;
  }
}
