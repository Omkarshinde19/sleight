import { clamp01, dist, LM, type Gesture, type Point } from "./types";

export interface HandFeatures {
  /** Wrist → middle MCP, metres. Everything else is normalised by this, so it is scale-free. */
  palmSize: number;
  /** Thumb tip ↔ index tip distance / palm size. ~0.1 touching, ~0.9+ open. */
  pinchDistance: number;
  /** 0 = straight, 1 = fully curled, for thumb, index, middle, ring, pinky. */
  curl: [number, number, number, number, number];
  /** Mean curl of index..pinky. */
  grip: number;
}

const FINGER_JOINTS = [
  [LM.INDEX_MCP, LM.INDEX_TIP],
  [LM.MIDDLE_MCP, LM.MIDDLE_TIP],
  [LM.RING_MCP, LM.RING_TIP],
  [LM.PINKY_MCP, LM.PINKY_TIP],
] as const;

// tip-to-wrist / mcp-to-wrist: ~2.0 for a straight finger, ~1.0 or less when curled into the palm.
const STRAIGHT_RATIO = 1.9;
const CURLED_RATIO = 1.05;

/** Rotation-invariant features from metric world landmarks. */
export function handFeatures(world: Point[]): HandFeatures {
  const wrist = world[LM.WRIST];
  const palmSize = dist(wrist, world[LM.MIDDLE_MCP]) || 1e-6;

  const fingerCurl = FINGER_JOINTS.map(([mcp, tip]) => {
    const ratio = dist(world[tip], wrist) / (dist(world[mcp], wrist) || 1e-6);
    return clamp01((STRAIGHT_RATIO - ratio) / (STRAIGHT_RATIO - CURLED_RATIO));
  });

  // Thumb: tip distance to the pinky MCP shrinks as the thumb folds across the palm.
  const thumbReach = dist(world[LM.THUMB_TIP], world[LM.PINKY_MCP]) / palmSize;
  const thumbCurl = clamp01((1.25 - thumbReach) / (1.25 - 0.55));

  const curl = [thumbCurl, ...fingerCurl] as HandFeatures["curl"];
  return {
    palmSize,
    pinchDistance: dist(world[LM.THUMB_TIP], world[LM.INDEX_TIP]) / palmSize,
    curl,
    grip: (fingerCurl[0] + fingerCurl[1] + fingerCurl[2] + fingerCurl[3]) / 4,
  };
}

/**
 * Thresholds. Each gesture has an `enter` and a looser `exit` value, so a hand sitting near a boundary
 * doesn't flip back and forth (hysteresis). Checked against real webcam landmarks in src/lib/hand/__fixtures__.
 */
export const THRESHOLDS = {
  pinch: { enter: 0.34, exit: 0.5 },
  /** Pinch is only a pinch if the index is not folded right into a fist. */
  pinchMaxIndexCurl: 0.8,
  fist: { enter: 0.68, exit: 0.52 },
  point: { indexMax: 0.3, indexExit: 0.42, othersMin: 0.6, othersExit: 0.48 },
  open: { gripMax: 0.32, gripExit: 0.42 },
} as const;

/** Instant classification. `current` loosens the thresholds of the gesture we're already in. */
export function classifyInstant(f: HandFeatures, current: Gesture = "none"): Gesture {
  const T = THRESHOLDS;
  const [, index, middle, ring, pinky] = f.curl;
  const others = (middle + ring + pinky) / 3;

  const pinchLimit = current === "pinch" ? T.pinch.exit : T.pinch.enter;
  if (f.pinchDistance < pinchLimit && index < T.pinchMaxIndexCurl) return "pinch";

  const fistLimit = current === "fist" ? T.fist.exit : T.fist.enter;
  if (f.grip > fistLimit && index > fistLimit - 0.1) return "fist";

  const pointIdx = current === "point" ? T.point.indexExit : T.point.indexMax;
  const pointOthers = current === "point" ? T.point.othersExit : T.point.othersMin;
  if (index < pointIdx && others > pointOthers) return "point";

  const openLimit = current === "open" ? T.open.gripExit : T.open.gripMax;
  if (f.grip < openLimit) return "open";

  // In between (a loose claw, a hand turning): no gesture. Exit thresholds above already gave the
  // current gesture its slack, so holding on any longer would make it sticky.
  return "none";
}

/**
 * Debounced classifier: a new gesture must win `dwellFrames` frames in a row before it takes over.
 * Combined with the enter/exit thresholds this keeps grabs from flickering.
 *
 * With `dwellSec` and frame times, it's a time instead: the gesture must win for that long (and at
 * least two frames). Three frames is 66 ms at 30 fps but 230 ms at 13 fps, which held a ball so long
 * after the fingers opened that the throw had already slowed down.
 */
export class GestureClassifier {
  gesture: Gesture = "none";
  private candidate: Gesture = "none";
  private candidateFrames = 0;
  private candidateSince = 0;

  constructor(
    private dwellFrames = 3,
    private dwellSec: number | null = null,
  ) {}

  update(f: HandFeatures, tSec?: number): Gesture {
    const next = classifyInstant(f, this.gesture);
    if (next === this.gesture) {
      this.candidateFrames = 0;
      return this.gesture;
    }
    if (next === this.candidate && this.candidateFrames > 0) this.candidateFrames++;
    else {
      this.candidate = next;
      this.candidateFrames = 1;
      this.candidateSince = tSec ?? 0;
    }
    const won =
      this.dwellSec !== null && tSec !== undefined
        ? this.candidateFrames >= 2 && tSec - this.candidateSince >= this.dwellSec - 1e-6
        : this.candidateFrames >= this.dwellFrames;
    if (won) {
      this.gesture = next;
      this.candidateFrames = 0;
    }
    return this.gesture;
  }

  reset() {
    this.gesture = "none";
    this.candidate = "none";
    this.candidateFrames = 0;
  }
}

export const isGrabGesture = (g: Gesture) => g === "pinch" || g === "fist";
