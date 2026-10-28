import { apparentScale, DepthEstimator } from "../hand/depth";
import { FeelMeter } from "../hand/feel";
import { GestureClassifier, handFeatures, type HandFeatures } from "../hand/gestures";
import { anchorInScene, DEFAULT_WORKSPACE, jointsInScene, palmCenter, type Workspace } from "../hand/mapping";
import { OneEuro, PointsFilter } from "../hand/oneEuro";
import { add, clamp, LM, lerp, type Gesture, type Handedness, type Point, type RawFrame, type RawHand } from "../hand/types";
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
  /** Part of the hand is at the edge of the camera frame, about to leave it. */
  nearEdge: boolean;
}

interface HandChannel {
  image: PointsFilter;
  world: PointsFilter;
  anchor: PointsFilter;
  classifier: GestureClassifier;
  depth: DepthEstimator;
  /** Collecting steady frames for a new depth reference. */
  calibrating: boolean;
  /** The depth reference came from a saved calibration (so no "hold still" prompt is needed). */
  restored: boolean;
  /** When calibration started seeing this hand (s), and its recent scales, for the timeout. */
  calibratingSince: number | null;
  recentScales: number[];
  /** Apparent scale, smoothed: raw, it varies ±7–16 % frame to frame, more than "steady" allows. */
  scale: OneEuro;
  /** Last frame's smoothed scale, image palm position and time, to tell a steady hand from a moving one. */
  lastScale: number;
  lastPalm: Point | null;
  lastT: number;
  /** Precision mode: the anchor before scaling, and how far scaling has moved the hand from it. */
  precisionIn: Point | null;
  precisionOff: Point;
  precise: boolean;
  history: MotionHistory;
  lastSeen: number;
  /** Fixed bone lengths for this hand; kept across short losses (it's the same person). */
  skeleton: Skeleton;
  /** Last real (not coasting) output, for coasting through missed frames. */
  last: TrackedHand | null;
}

/** Steady frames (median) that make a depth reference. */
const CALIBRATION_SAMPLES = 12;
/**
 * A frame counts as steady if the smoothed apparent size changes < 60 %/s and the palm moves < 30 % of
 * the frame per second. Rates, not per-frame changes: at 13 tracker fps a hand moves 2.3x further
 * between frames than at 30, and calibration never finished.
 */
const STEADY_SCALE_RATE = 0.6;
const STEADY_SPEED = 0.3;
/** If the hand is never still enough, calibrate after this long from the median of the last ~2 s. */
const CALIBRATION_TIMEOUT_S = 4;
const RECENT_SCALES = 40;
/** A landmark this close to the frame's border (fraction of the frame) means the hand is leaving it. */
const EDGE_MARGIN = 0.02;
/** Precision mode: smoothing while holding (minCutoff Hz), and how fast the scaling offset relaxes after. */
const PRECISE_SMOOTHING = { anchor: 0.5, world: 0.8 };
const PRECISION_RELAX_S = 0.25;
const PRECISION_MAX_OFFSET = 0.2;
const STORAGE_KEY = "sleight.depthReference.v1";
/** Forget a hand's filter state after this long without a detection (longer than any coast). */
const LOST_AFTER_MS = 500;
/**
 * Keep showing a hand this long after the tracker loses it. Fast moves blur the hand and MediaPipe
 * drops a frame or a few; without this, the hand blinked out and a held ball fell out mid-throw.
 * At least COAST_FRAMES tracker frames, and HOLD_COAST_MS while it holds something (gaps of 300 ms
 * dropped balls in a 13 fps session).
 */
export const COAST_MS = 250;
const COAST_FRAMES = 3;
export const HOLD_COAST_MS = 450;
/** While coasting, the hand carries on with its velocity, slowing with this time constant (s). */
const COAST_TAU = 0.06;
const COAST_MAX_DRIFT = 0.05;

/**
 * One Euro settings (minCutoff Hz, beta per unit/s of speed). `world` shapes the hand (metres,
 * wrist-relative), `anchor` places it (scene metres; z is depth, which is noisier), `image` is only the
 * debug overlay (normalised image units). Picked by feel in arcade from three candidates: on the recorded
 * arcade session the palm trails the tracker by ~25 ms (was 110 ms) at about 2.3x the frame-to-frame
 * shake. The betas are large because speeds here are in metres per second, not pixels.
 */
const SMOOTHING = {
  image: { minCutoff: 1.5, beta: 0.03 },
  world: { minCutoff: 1.5, beta: 40 },
  anchor: { minCutoff: 1.0, beta: 25 },
  anchorZ: { minCutoff: 0.6, beta: 3 },
};

/** How long a new gesture must hold before it takes over: three frames at 30 fps. */
const GESTURE_DWELL_SEC = 0.06;

const newChannel = (): HandChannel => ({
  image: new PointsFilter(21, SMOOTHING.image.minCutoff, SMOOTHING.image.beta),
  world: new PointsFilter(21, SMOOTHING.world.minCutoff, SMOOTHING.world.beta),
  anchor: new PointsFilter(1, SMOOTHING.anchor.minCutoff, SMOOTHING.anchor.beta, SMOOTHING.anchorZ),
  classifier: new GestureClassifier(3, GESTURE_DWELL_SEC),
  depth: new DepthEstimator(),
  calibrating: true,
  restored: false,
  calibratingSince: null,
  recentScales: [],
  scale: new OneEuro(1.0, 0),
  lastScale: 0,
  lastPalm: null,
  lastT: 0,
  precisionIn: null,
  precisionOff: { x: 0, y: 0, z: 0 },
  precise: false,
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
  /** Smoothed time between tracker frames, ms. */
  private frameInterval = 33;
  private lastFrameT: number | null = null;
  /** Whether a hand is holding something (set by the owner from the grab system). */
  holding: (hand: Handedness) => boolean = () => false;

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
      if (ref && ref > 0) {
        ch.depth.reference = ref;
        ch.restored = true;
      }
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
      ch.restored = false;
      ch.calibratingSince = null;
      ch.recentScales = [];
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
    return Object.values(this.channels).some((c) => c.calibrating && !c.restored && c.lastSeen !== -Infinity);
  }

  process(frame: RawFrame): Partial<Record<Handedness, TrackedHand>> {
    const out: Partial<Record<Handedness, TrackedHand>> = {};
    const tSec = frame.t / 1000;
    this.feel.frame(frame.t);
    if (this.lastFrameT !== null && frame.t > this.lastFrameT)
      this.frameInterval += 0.1 * (clamp(frame.t - this.lastFrameT, 8, 150) - this.frameInterval);
    this.lastFrameT = frame.t;
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
      if (ch.last) this.feel.missed(h);
      const missing = frame.t - ch.lastSeen;
      const coastMs = this.holding(h) ? HOLD_COAST_MS : Math.max(COAST_MS, COAST_FRAMES * this.frameInterval);
      if (ch.last && missing <= coastMs) out[h] = coast(ch.last, missing / 1000);
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
    ch.scale.reset();
    ch.history.clear();
    ch.precisionIn = null;
    ch.precisionOff = { x: 0, y: 0, z: 0 };
  }

  private processHand(raw: RawHand, ch: HandChannel, tSec: number, aspect: number): TrackedHand {
    // Precision mode (holding something, in a scene that has it): smooth harder.
    const precise = !!this.workspace.precision && this.holding(raw.handedness);
    if (precise !== ch.precise) {
      ch.precise = precise;
      ch.anchor.tune(precise ? PRECISE_SMOOTHING.anchor : SMOOTHING.anchor.minCutoff, SMOOTHING.anchor.beta);
      ch.world.tune(precise ? PRECISE_SMOOTHING.world : SMOOTHING.world.minCutoff, SMOOTHING.world.beta);
    }
    const image = ch.image.filter(raw.landmarks, tSec);
    const world = ch.world.filter(raw.worldLandmarks, tSec);

    // Depth: a reference distance comes from steady frames only (a hand still moving into view
    // would set it wrong for the whole session), and from the saved calibration meanwhile.
    const rawScale = apparentScale(raw.landmarks, raw.worldLandmarks, aspect);
    const s = rawScale > 0 ? ch.scale.filter(rawScale, tSec) : 0;
    const palmImg = palmCenter(image);
    if (ch.calibrating && s > 0) this.calibrate(ch, s, palmImg, tSec);
    ch.lastScale = s;
    ch.lastPalm = palmImg;
    const depth = ch.depth.reference !== null ? ch.depth.relativeDepth(rawScale) : 0;

    const rawAnchor = anchorInScene(palmCenter(raw.landmarks), depth, this.workspace);
    const [filtered] = ch.anchor.filter([rawAnchor], tSec);
    const anchor = this.scaleMotion(ch, filtered, precise, tSec);
    ch.lastT = tSec;
    // The robot hand is drawn from a rigid skeleton: fixed bone lengths, real joint limits.
    if (!this.synthetic) ch.skeleton.observe(raw.worldLandmarks);
    const joints = jointsInScene(this.synthetic ? world : ch.skeleton.solve(world, raw.handedness), anchor, this.workspace);

    const features = handFeatures(world);
    const gesture = ch.classifier.update(features, tSec);

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
      nearEdge: raw.landmarks.some((p) => p.x < EDGE_MARGIN || p.x > 1 - EDGE_MARGIN || p.y < EDGE_MARGIN || p.y > 1 - EDGE_MARGIN),
    };
  }

  private calibrate(ch: HandChannel, s: number, palm: Point, tSec: number) {
    ch.calibratingSince ??= tSec;
    ch.recentScales.push(s);
    if (ch.recentScales.length > RECENT_SCALES) ch.recentScales.shift();
    const dt = tSec - ch.lastT;
    const steady =
      ch.lastPalm !== null &&
      ch.lastScale > 0 &&
      dt > 0 &&
      Math.abs(s / ch.lastScale - 1) / dt < STEADY_SCALE_RATE &&
      Math.hypot(palm.x - ch.lastPalm.x, palm.y - ch.lastPalm.y) / dt < STEADY_SPEED;
    if (steady) ch.depth.addCalibrationSample(s);
    let done = ch.depth.sampleCount >= CALIBRATION_SAMPLES && ch.depth.finishCalibration();
    // A hand that never holds still (mid-surgery) still gets a reference: its typical recent distance.
    if (!done && tSec - ch.calibratingSince > CALIBRATION_TIMEOUT_S) {
      const sorted = [...ch.recentScales].sort((a, b) => a - b);
      ch.depth.reference = sorted[Math.floor(sorted.length / 2)];
      done = true;
    }
    if (done) {
      ch.calibrating = false;
      ch.calibratingSince = null;
      ch.recentScales = [];
      if (this.persist) this.save();
    }
  }

  /**
   * Precision mode's motion scaling. Each frame's movement is scaled by between `scale` (slow, careful
   * moves) and 1 (fast moves, so reaching across the scene isn't slowed down). The difference builds up
   * as an offset from the tracked position, which relaxes away once the hand lets go.
   */
  private scaleMotion(ch: HandChannel, anchor: Point, precise: boolean, tSec: number): Point {
    const p = this.workspace.precision;
    const prev = ch.precisionIn;
    const dt = prev ? tSec - ch.lastT : 0;
    ch.precisionIn = anchor;
    const off = ch.precisionOff;
    if (!p || !prev || dt <= 0) return add(anchor, off);
    if (precise) {
      const d = { x: anchor.x - prev.x, y: anchor.y - prev.y, z: anchor.z - prev.z };
      const speed = Math.hypot(d.x, d.y, d.z) / dt;
      const u = clamp(speed / p.fullSpeed, 0, 1);
      const k = p.scale + (1 - p.scale) * u * u * (3 - 2 * u);
      off.x += (k - 1) * d.x;
      off.y += (k - 1) * d.y;
      off.z += (k - 1) * d.z;
      const len = Math.hypot(off.x, off.y, off.z);
      if (len > PRECISION_MAX_OFFSET) {
        off.x *= PRECISION_MAX_OFFSET / len;
        off.y *= PRECISION_MAX_OFFSET / len;
        off.z *= PRECISION_MAX_OFFSET / len;
      }
    } else {
      const decay = Math.exp(-dt / PRECISION_RELAX_S);
      off.x *= decay;
      off.y *= decay;
      off.z *= decay;
    }
    return add(anchor, off);
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
