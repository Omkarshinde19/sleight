import { apparentScale, DepthEstimator } from "../hand/depth";
import { GestureClassifier, handFeatures, type HandFeatures } from "../hand/gestures";
import { anchorInScene, DEFAULT_WORKSPACE, jointsInScene, palmCenter, type Workspace } from "../hand/mapping";
import { PointsFilter } from "../hand/oneEuro";
import { add, LM, lerp, type Gesture, type Handedness, type Point, type RawFrame, type RawHand } from "../hand/types";
import { MotionHistory } from "../hand/velocity";

export interface TrackedHand {
  handedness: Handedness;
  gesture: Gesture;
  features: HandFeatures;
  /** Smoothed image landmarks (for the debug skeleton). */
  image: Point[];
  /** 21 joints in scene metres. */
  joints: Point[];
  /** Palm centre in the scene. */
  palm: Point;
  /** Where a grab attaches: between thumb and index tips when pinching, the palm otherwise. */
  grip: Point;
  /** Relative depth (0 = calibrated distance). */
  depth: number;
  /** Instant palm velocity, m/s. */
  velocity: Point;
  history: MotionHistory;
}

interface HandChannel {
  image: PointsFilter;
  world: PointsFilter;
  anchor: PointsFilter;
  classifier: GestureClassifier;
  depth: DepthEstimator;
  /** Collecting steady frames for a new depth reference. */
  calibrating: boolean;
  /** Last frame's apparent scale and image palm position, to tell a steady hand from a moving one. */
  lastScale: number;
  lastPalm: Point | null;
  history: MotionHistory;
  lastSeen: number;
}

/** Steady frames (median) that make a depth reference. */
const CALIBRATION_SAMPLES = 12;
/** A frame counts as steady if apparent size changed < 3% and the palm moved < 1.2% of the frame. */
const STEADY_SCALE = 0.03;
const STEADY_MOVE = 0.012;
const STORAGE_KEY = "sleight.depthReference.v1";
/** Forget a hand (and its filter state) after this long without a detection. */
const LOST_AFTER_MS = 300;

const newChannel = (): HandChannel => ({
  // Image landmarks: light smoothing for the overlay. World: a bit more, since it drives the robot.
  image: new PointsFilter(21, 1.5, 0.03),
  world: new PointsFilter(21, 1.0, 0.04),
  // The anchor drives position: depth (z) is noisy, so it gets a much lower cutoff.
  anchor: new PointsFilter(1, 1.0, 0.6, { minCutoff: 0.4, beta: 0.15 }),
  classifier: new GestureClassifier(3),
  depth: new DepthEstimator(),
  calibrating: true,
  lastScale: 0,
  lastPalm: null,
  history: new MotionHistory(12),
  lastSeen: -Infinity,
});

function readSaved(): Partial<Record<Handedness, number>> | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const v = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    return v && typeof v === "object" ? v : null;
  } catch {
    return null;
  }
}

/** Turns raw tracker frames into smoothed, classified hands in scene space. */
export class HandProcessor {
  private channels: Record<Handedness, HandChannel> = { Left: newChannel(), Right: newChannel() };
  private persist = false;

  constructor(public workspace: Workspace = DEFAULT_WORKSPACE) {}

  /**
   * Remember depth calibration across reloads (camera only). The saved reference is used straight
   * away, so a refresh doesn't depend on catching the hand perfectly still in the first frames;
   * a fresh steady-hand calibration then replaces it.
   */
  setPersistence(on: boolean) {
    this.persist = on;
    if (!on) return;
    const saved = readSaved();
    for (const [h, ch] of Object.entries(this.channels) as [Handedness, HandChannel][]) {
      const ref = saved?.[h];
      if (ref && ref > 0) ch.depth.reference = ref;
    }
  }

  /**
   * Start a fresh depth calibration from the next steady frames. Until it completes, the previous
   * reference (if any) keeps depth working, so nothing jumps.
   */
  recalibrate() {
    for (const ch of Object.values(this.channels)) {
      const previous = ch.depth.reference;
      ch.depth = new DepthEstimator();
      ch.depth.reference = previous;
      ch.calibrating = true;
      ch.lastPalm = null;
    }
  }

  /** Forget everything, including any saved calibration (a new session from scratch). */
  reset() {
    this.channels = { Left: newChannel(), Right: newChannel() };
  }

  get isCalibrating() {
    return Object.values(this.channels).some((c) => c.calibrating && c.lastSeen !== -Infinity);
  }

  process(frame: RawFrame): Partial<Record<Handedness, TrackedHand>> {
    const out: Partial<Record<Handedness, TrackedHand>> = {};
    const tSec = frame.t / 1000;
    for (const raw of frame.hands) {
      const ch = this.channels[raw.handedness];
      if (frame.t - ch.lastSeen > LOST_AFTER_MS) this.resetChannel(ch);
      ch.lastSeen = frame.t;
      out[raw.handedness] = this.processHand(raw, ch, tSec, frame.aspect);
    }
    for (const [h, ch] of Object.entries(this.channels) as [Handedness, HandChannel][]) {
      if (!out[h] && frame.t - ch.lastSeen > LOST_AFTER_MS) ch.classifier.reset();
    }
    return out;
  }

  private save() {
    try {
      const data: Partial<Record<Handedness, number>> = readSaved() ?? {};
      for (const [h, ch] of Object.entries(this.channels) as [Handedness, HandChannel][]) if (ch.depth.reference) data[h] = ch.depth.reference;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
      // private mode / storage blocked: calibration just won't survive a reload
    }
  }

  private resetChannel(ch: HandChannel) {
    ch.image.reset();
    ch.world.reset();
    ch.anchor.reset();
    ch.history.clear();
  }

  private processHand(raw: RawHand, ch: HandChannel, tSec: number, aspect: number): TrackedHand {
    const image = ch.image.filter(raw.landmarks, tSec);
    const world = ch.world.filter(raw.worldLandmarks, tSec);

    // Depth: a reference distance comes from steady frames only (a hand still moving into view
    // would set it wrong for the whole session), and from the saved calibration meanwhile.
    const s = apparentScale(raw.landmarks, raw.worldLandmarks, aspect);
    const palmImg = palmCenter(raw.landmarks);
    if (ch.calibrating && s > 0) {
      const steady =
        ch.lastPalm !== null &&
        ch.lastScale > 0 &&
        Math.abs(s / ch.lastScale - 1) < STEADY_SCALE &&
        Math.hypot(palmImg.x - ch.lastPalm.x, palmImg.y - ch.lastPalm.y) < STEADY_MOVE;
      if (steady) ch.depth.addCalibrationSample(s);
      if (ch.depth.sampleCount >= CALIBRATION_SAMPLES && ch.depth.finishCalibration()) {
        ch.calibrating = false;
        if (this.persist) this.save();
      }
    }
    ch.lastScale = s;
    ch.lastPalm = palmImg;
    const depth = ch.depth.reference !== null ? ch.depth.relativeDepth(s) : 0;

    const rawAnchor = anchorInScene(palmCenter(raw.landmarks), depth, this.workspace);
    const [anchor] = ch.anchor.filter([rawAnchor], tSec);
    const joints = jointsInScene(world, anchor, this.workspace);

    const features = handFeatures(world);
    const gesture = ch.classifier.update(features);

    const palm = lerp(lerp(joints[LM.WRIST], joints[LM.MIDDLE_MCP], 0.55), lerp(joints[LM.INDEX_MCP], joints[LM.PINKY_MCP], 0.5), 0.5);
    const grip =
      gesture === "pinch" ? lerp(joints[LM.THUMB_TIP], joints[LM.INDEX_TIP], 0.5) : add(palm, { x: 0, y: 0, z: 0 });

    ch.history.push(palm, tSec);
    return {
      handedness: raw.handedness,
      gesture,
      features,
      image,
      joints,
      palm,
      grip,
      depth,
      velocity: ch.history.instant(),
      history: ch.history,
    };
  }
}
