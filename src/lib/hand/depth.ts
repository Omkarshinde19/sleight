import { LM, type Point } from "./types";

/** Segments that are rigid-ish in the palm. At least one tends to lie flat to the camera whatever the wrist does. */
const PALM_SEGMENTS = [
  [LM.WRIST, LM.INDEX_MCP],
  [LM.WRIST, LM.MIDDLE_MCP],
  [LM.WRIST, LM.PINKY_MCP],
  [LM.INDEX_MCP, LM.PINKY_MCP],
] as const;

/**
 * Apparent palm scale: image length / metric length, taking the largest ratio over the palm segments.
 * Image lengths use height-normalised units so the result doesn't depend on the frame's aspect ratio.
 * Bigger = closer to the camera. Using the max limits the effect of foreshortening when the hand tilts.
 */
export function apparentScale(image: Point[], world: Point[], aspect: number): number {
  let best = 0;
  for (const [a, b] of PALM_SEGMENTS) {
    const dx = (image[a].x - image[b].x) * aspect;
    const dy = image[a].y - image[b].y;
    const img = Math.hypot(dx, dy);
    const met = Math.hypot(world[a].x - world[b].x, world[a].y - world[b].y, world[a].z - world[b].z);
    if (met > 1e-4) best = Math.max(best, img / met);
  }
  return best;
}

/**
 * Relative depth from apparent palm scale. Distance to the camera is proportional to 1 / scale, so
 * `reference / scale - 1` is the fractional change in distance from the calibrated pose:
 * 0 at calibration, negative when the hand moves toward the camera, positive when it moves away.
 */
export class DepthEstimator {
  reference: number | null = null;
  private samples: number[] = [];

  /** Feed calibration samples (hold the hand still at a comfortable distance). */
  addCalibrationSample(scale: number) {
    if (scale > 0) this.samples.push(scale);
  }

  /** Finish calibration with the median of the samples, which ignores a few bad frames. */
  finishCalibration(): boolean {
    if (this.samples.length < 5) return false;
    const sorted = [...this.samples].sort((a, b) => a - b);
    this.reference = sorted[Math.floor(sorted.length / 2)];
    this.samples = [];
    return true;
  }

  /** Without calibration, adopt the first frame we see as the neutral distance. */
  relativeDepth(scale: number): number {
    if (scale <= 0) return 0;
    if (this.reference === null) this.reference = scale;
    return this.reference / scale - 1;
  }
}
