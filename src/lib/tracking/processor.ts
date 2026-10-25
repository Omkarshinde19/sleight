import { apparentScale, DepthEstimator } from "../hand/depth";
import { FeelMeter } from "../hand/feel";
import { GestureClassifier, handFeatures, type HandFeatures } from "../hand/gestures";
import { anchorInScene, DEFAULT_WORKSPACE, jointsInScene, palmCenter, type Workspace } from "../hand/mapping";
import { PointsFilter } from "../hand/oneEuro";
import { add, LM, lerp, type Gesture, type Handedness, type Point, type RawFrame, type RawHand } from "../hand/types";
import { Skeleton } from "../hand/skeleton";
import { HandTracker } from "../hand/tracks";
import { MotionHistory, regressionVelocity } from "../hand/velocity";

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
  /**
   * The tracker missed this hand for a moment and this is its last pose, drifting on with its
   * velocity (see COAST_MS). Grabs hold through it; nothing new is grabbed.
   */
  lost: boolean;
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
  /** Fixed bone lengths for this hand; kept across short losses (it's the same person). */
  skeleton: Skeleton;
  /** Last real (not coasting) output, for coasting through missed frames. */
  last: TrackedHand | null;
}

/** Steady frames (median) that make a depth reference. */
const CALIBRATION_SAMPLES = 12;
/** A frame counts as steady if apparent size changed < 3% and the palm moved < 1.2% of the frame. */
const STEADY_SCALE = 0.03;
const STEADY_MOVE = 0.012;
const STORAGE_KEY = "sleight.depthReference.v1";
/** Forget a hand's filter state after this long without a detection. */
const LOST_AFTER_MS = 300;
/**
 * Keep showing a hand this long after the tracker loses it. Fast moves blur the hand and MediaPipe
 * drops a frame or a few; without this, the hand blinked out and a held ball fell out mid-throw.
 */
export const COAST_MS = 250;
/** While coasting, the hand carries on with its velocity, slowing with this time constant (s). */
const COAST_TAU = 0.06;
const COAST_MAX_DRIFT = 0.05;

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
  skeleton: new Skeleton(),
  last: null,
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
  private tracker = new HandTracker();
  /**
   * The simulated hand is synthesised: its Left/Right labels are right and its bones already rigid,
   * so it skips the tracker's label vote and the skeleton. Real (camera, recorded) hands are tracked
   * by position with voted labels (HandTracker) and rebuilt on a rigid skeleton (Skeleton).
   */
  private synthetic = false;

  setSynthetic(on: boolean) {
    this.synthetic = on;
  }

  constructor(
    public workspace: Workspace = DEFAULT_WORKSPACE,
    public feel: FeelMeter = new FeelMeter(COAST_MS),
    /** Told when the two hands' labels are exchanged, so state kept per label elsewhere can follow. */
    private onSwap?: () => void,
  ) {
    this.wireTracker();
  }

  private wireTracker() {
    this.tracker.onFlip = () => this.feel.labelFlip();
    this.tracker.onFix = () => this.feel.labelFix();
    // A relabel moves everything learnt about a hand (filters, skeleton, history) with that hand.
    this.tracker.onSwap = () => {
      [this.channels.Left, this.channels.Right] = [this.channels.Right, this.channels.Left];
      this.channels.Left.skeleton.relabel();
      this.channels.Right.skeleton.relabel();
      this.feel.swap();
      this.onSwap?.();
    };
  }

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
    this.tracker.reset();
    this.feel.reset();
  }

  get isCalibrating() {
    return Object.values(this.channels).some((c) => c.calibrating && c.lastSeen !== -Infinity);
  }

  process(frame: RawFrame): Partial<Record<Handedness, TrackedHand>> {
    const out: Partial<Record<Handedness, TrackedHand>> = {};
    const tSec = frame.t / 1000;
    this.feel.frame(frame.t);
    const detections = this.synthetic ? frame.hands : this.tracker.assign(frame.hands, frame.t, frame.aspect);
    for (const raw of detections) {
      const ch = this.channels[raw.handedness];
      if (out[raw.handedness]) continue; // two detections with one label (trusted sources only)
      if (frame.t - ch.lastSeen > LOST_AFTER_MS) this.resetChannel(ch);
      ch.lastSeen = frame.t;
      const hand = this.processHand(raw, ch, tSec, frame.aspect);
      ch.last = hand;
      out[raw.handedness] = hand;
      this.feel.detected(raw.handedness, frame.t, raw.worldLandmarks, hand.joints, hand.palm);
    }
    for (const [h, ch] of Object.entries(this.channels) as [Handedness, HandChannel][]) {
      if (out[h]) continue;
      const missing = frame.t - ch.lastSeen;
      if (ch.last && missing <= COAST_MS) out[h] = coast(ch.last, missing / 1000);
      else if (ch.last) {
        ch.last = null;
        this.feel.forget(h);
      }
      if (missing > LOST_AFTER_MS) ch.classifier.reset();
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
    // The robot hand is drawn from a rigid skeleton: fixed bone lengths, real joint limits.
    if (!this.synthetic) ch.skeleton.observe(raw.worldLandmarks);
    const joints = jointsInScene(this.synthetic ? world : ch.skeleton.solve(world, raw.handedness), anchor, this.workspace);

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
      lost: false,
    };
  }
}

/** A lost hand's last pose, carried on by its recent velocity, slowing down. */
function coast(last: TrackedHand, dtSec: number): TrackedHand {
  const v = regressionVelocity(last.history.recent(0.1));
  const k = COAST_TAU * (1 - Math.exp(-dtSec / COAST_TAU));
  let off = { x: v.x * k, y: v.y * k, z: v.z * k };
  const d = Math.hypot(off.x, off.y, off.z);
  if (d > COAST_MAX_DRIFT) off = { x: (off.x * COAST_MAX_DRIFT) / d, y: (off.y * COAST_MAX_DRIFT) / d, z: (off.z * COAST_MAX_DRIFT) / d };
  const slow = Math.exp(-dtSec / COAST_TAU);
  return {
    ...last,
    joints: last.joints.map((p) => add(p, off)),
    palm: add(last.palm, off),
    grip: add(last.grip, off),
    velocity: { x: v.x * slow, y: v.y * slow, z: v.z * slow },
    lost: true,
  };
}
