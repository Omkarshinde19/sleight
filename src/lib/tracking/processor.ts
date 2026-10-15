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
  calibrationFrames: number;
  history: MotionHistory;
  lastSeen: number;
}

const AUTO_CALIBRATION_FRAMES = 10;
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
  calibrationFrames: 0,
  history: new MotionHistory(12),
  lastSeen: -Infinity,
});

/** Turns raw tracker frames into smoothed, classified hands in scene space. */
export class HandProcessor {
  private channels: Record<Handedness, HandChannel> = { Left: newChannel(), Right: newChannel() };
  private calibrating = false;

  constructor(public workspace: Workspace = DEFAULT_WORKSPACE) {}

  /** Start a fresh depth calibration: the next few frames define the neutral distance. */
  recalibrate() {
    for (const ch of Object.values(this.channels)) {
      ch.depth = new DepthEstimator();
      ch.calibrationFrames = 0;
    }
    this.calibrating = true;
  }

  get isCalibrating() {
    return this.calibrating;
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
    if (this.calibrating && Object.values(this.channels).every((c) => c.calibrationFrames >= AUTO_CALIBRATION_FRAMES || c.lastSeen === -Infinity))
      this.calibrating = false;
    return out;
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

    // Depth: the first frames (or a requested recalibration) set the neutral distance.
    const s = apparentScale(raw.landmarks, raw.worldLandmarks, aspect);
    let depth = 0;
    if (ch.calibrationFrames < AUTO_CALIBRATION_FRAMES) {
      ch.depth.addCalibrationSample(s);
      if (++ch.calibrationFrames === AUTO_CALIBRATION_FRAMES) ch.depth.finishCalibration();
    } else depth = ch.depth.relativeDepth(s);

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
