import { CLAW, lerpPose, POSES, synthHand, type HandPose, type Orientation } from "../hand/synth";
import type { Workspace } from "../hand/mapping";
import { clamp, type Gesture, type Handedness, type Point, type RawFrame } from "../hand/types";
import type { TrackingSource } from "./source";

type PoseName = Exclude<Gesture, "none"> | "claw";
const SIM_POSES = { ...POSES, claw: CLAW };

export interface SimHandState {
  handedness: Handedness;
  visible: boolean;
  /** Normalised, unmirrored camera image coordinates (as the webcam would see it). */
  imageX: number;
  imageY: number;
  distance: number;
  target: PoseName;
  pose: HandPose;
  orientation: Orientation;
}

/** A scripted move: the hand goes through these keyframes, relative to where it started. */
export interface MotionKey {
  /** Seconds from the start of the script. */
  at: number;
  dx?: number;
  dy?: number;
  /** Change in distance from the camera, metres (negative = toward the screen). */
  dDistance?: number;
  gesture?: PoseName;
}

const ASPECT = 4 / 3;
const NEAR = 0.3;
const FAR = 0.85;
/** reach() glides the hand there with this time constant (s): a careful reach, not a teleport. */
const REACH_TAU = 0.18;

/**
 * Keyboard + mouse virtual hands. They are synthesised as real landmarks and fed through the same
 * processing as the webcam, so every scene works (and can be tested) without a camera.
 */
export class SimulatedSource implements TrackingSource {
  readonly kind = "sim";
  hands: Record<Handedness, SimHandState> = {
    Right: this.initial("Right", 0.36),
    Left: this.initial("Left", 0.64),
  };
  active: Handedness = "Right";
  private raf = 0;
  private running = false;
  private lastT = 0;
  private held = new Set<string>();
  private cleanup: (() => void)[] = [];
  private scripts: { hand: Handedness; keys: MotionKey[]; t0: number; from: SimHandState }[] = [];
  /** Where reach() is taking each hand. Direct moves (mouse, set, scripts) cancel it. */
  private goals: Partial<Record<Handedness, Pick<SimHandState, "imageX" | "imageY" | "distance">>> = {};

  constructor(
    private surface: HTMLElement,
    twoHands: boolean,
  ) {
    this.hands.Left.visible = twoHands;
  }

  private initial(handedness: Handedness, imageX: number): SimHandState {
    return {
      handedness,
      visible: true,
      imageX,
      imageY: 0.55,
      distance: 0.5,
      target: "open",
      pose: POSES.open,
      orientation: { pitch: 0, yaw: 0, roll: 0 },
    };
  }

  async start(emit: (frame: RawFrame) => void) {
    this.running = true;
    this.bindInput();
    this.lastT = performance.now();
    const loop = () => {
      if (!this.running) return;
      const now = performance.now();
      const dt = Math.min(0.05, (now - this.lastT) / 1000);
      this.lastT = now;
      this.step(now, dt);
      emit({ t: now, aspect: ASPECT, latencyMs: 0, hands: this.frameHands() });
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.cleanup.forEach((f) => f());
    this.cleanup = [];
  }

  frameHands() {
    return Object.values(this.hands)
      .filter((h) => h.visible)
      .map((h) =>
        synthHand({
          handedness: h.handedness,
          pose: h.pose,
          orientation: h.orientation,
          imageX: h.imageX,
          imageY: h.imageY,
          distance: h.distance,
          aspect: ASPECT,
        }),
      );
  }

  /** Set a hand directly (used by tests and the demo autopilot). */
  set(hand: Handedness, patch: Partial<Omit<SimHandState, "handedness" | "pose">>) {
    if ("imageX" in patch || "imageY" in patch || "distance" in patch) delete this.goals[hand];
    Object.assign(this.hands[hand], patch);
  }

  /**
   * Move a hand so its palm lands on a scene point: the inverse of the scene mapping, assuming depth
   * was calibrated at the starting distance (0.5 m). Used by tests and the demo autopilot.
   */
  reach(hand: Handedness, p: Point, ws: Workspace, calibratedDistance = 0.5) {
    this.hands[hand].visible = true;
    this.goals[hand] = {
      imageX: clamp(0.5 - (p.x - ws.center.x) / ws.width, 0.02, 0.98),
      imageY: clamp(0.5 - (p.y - ws.center.y) / ws.height, 0.02, 0.98),
      distance: clamp(calibratedDistance * (1 + (p.z - ws.center.z) / ws.depthGain), NEAR, FAR),
    };
  }

  /** Play a scripted motion, e.g. a throw. */
  play(hand: Handedness, keys: MotionKey[]) {
    this.scripts = this.scripts.filter((s) => s.hand !== hand);
    delete this.goals[hand];
    this.scripts.push({ hand, keys, t0: performance.now(), from: { ...this.hands[hand] } });
  }

  /** A forward-and-up flick, releasing at the end. */
  throwFlick(hand: Handedness = this.active) {
    this.play(hand, [
      { at: 0, gesture: "fist" },
      { at: 0.25, dy: 0.1, dDistance: 0.1, gesture: "fist" },
      // swing forward and up, opening the hand on the way (follow-through continues)
      { at: 0.45, dy: -0.26, dDistance: -0.1, gesture: "open" },
      { at: 0.6, dy: -0.44, dDistance: -0.17, gesture: "open" },
      { at: 0.9, dy: -0.46, dDistance: -0.18, gesture: "open" },
    ]);
  }

  private step(now: number, dt: number) {
    for (const s of this.scripts) {
      const t = (now - s.t0) / 1000;
      const keys = s.keys;
      let i = keys.findIndex((k) => k.at > t);
      if (i === -1) i = keys.length;
      const a = keys[Math.max(0, i - 1)];
      const b = keys[Math.min(keys.length - 1, i)];
      const k = b.at > a.at ? clamp((t - a.at) / (b.at - a.at), 0, 1) : 1;
      const h = this.hands[s.hand];
      const mix = (av = 0, bv = 0) => av + (bv - av) * k;
      h.imageX = s.from.imageX + mix(a.dx, b.dx);
      h.imageY = s.from.imageY + mix(a.dy, b.dy);
      h.distance = clamp(s.from.distance + mix(a.dDistance, b.dDistance), NEAR, FAR);
      if (a.gesture) h.target = a.gesture;
    }
    this.scripts = this.scripts.filter((s) => (now - s.t0) / 1000 <= s.keys[s.keys.length - 1].at);

    const glide = 1 - Math.exp(-dt / REACH_TAU);
    for (const [hand, goal] of Object.entries(this.goals) as [Handedness, NonNullable<(typeof this.goals)[Handedness]>][]) {
      const h = this.hands[hand];
      h.imageX += (goal.imageX - h.imageX) * glide;
      h.imageY += (goal.imageY - h.imageY) * glide;
      h.distance += (goal.distance - h.distance) * glide;
      if (Math.abs(goal.imageX - h.imageX) + Math.abs(goal.imageY - h.imageY) + Math.abs(goal.distance - h.distance) < 1e-4) {
        Object.assign(h, goal);
        delete this.goals[hand];
      }
    }

    // Fingers move toward the target pose with a ~120 ms time constant (a real hand closes in ~0.3 s).
    const blend = 1 - Math.exp(-dt / 0.12);
    for (const h of Object.values(this.hands)) h.pose = lerpPose(h.pose, SIM_POSES[h.target], blend);

    // Held keys
    const h = this.hands[this.active];
    if (this.held.has("q")) h.orientation.roll += dt * 1.6;
    if (this.held.has("e")) h.orientation.roll -= dt * 1.6;
    if (this.held.has("w")) h.orientation.pitch = clamp(h.orientation.pitch + dt * 1.6, -1.2, 1.2);
    if (this.held.has("s")) h.orientation.pitch = clamp(h.orientation.pitch - dt * 1.6, -1.2, 1.2);
    if (this.held.has("a")) h.orientation.yaw = clamp(h.orientation.yaw + dt * 1.6, -1.2, 1.2);
    if (this.held.has("d")) h.orientation.yaw = clamp(h.orientation.yaw - dt * 1.6, -1.2, 1.2);
    if (this.held.has("r")) h.distance = clamp(h.distance - dt * 0.35, NEAR, FAR);
    if (this.held.has("f")) h.distance = clamp(h.distance + dt * 0.35, NEAR, FAR);
  }

  private grabGesture(): PoseName {
    return this.held.has("shift") ? "pinch" : "fist";
  }

  private bindInput() {
    const el = this.surface;
    const on = <K extends keyof WindowEventMap>(target: Window | HTMLElement, type: K, fn: (e: WindowEventMap[K]) => void, opts?: AddEventListenerOptions) => {
      target.addEventListener(type, fn as EventListener, opts);
      this.cleanup.push(() => target.removeEventListener(type, fn as EventListener));
    };

    on(el, "pointermove", (e) => {
      if (e.buttons & 2) return; // right-drag looks around (CameraRig)
      const r = el.getBoundingClientRect();
      const h = this.hands[this.active];
      delete this.goals[this.active];
      // The screen is a mirror: pointer on the right = the user's right = the image's left.
      h.imageX = clamp(1 - (e.clientX - r.left) / r.width, 0.05, 0.95);
      h.imageY = clamp((e.clientY - r.top) / r.height, 0.05, 0.95);
    });
    on(el, "pointerdown", (e) => {
      if (e.button === 0) this.hands[this.active].target = this.grabGesture();
    });
    on(window, "pointerup", (e) => {
      if (e.button === 0) this.hands[this.active].target = "open";
    });
    on(window, "keydown", (e) => {
      if ((e.target as HTMLElement)?.closest?.("input, textarea, select")) return;
      const key = e.key.toLowerCase();
      this.held.add(key);
      const h = this.hands[this.active];
      const poses: Record<string, PoseName> = { "1": "open", "2": "pinch", "3": "fist", "4": "point", "5": "claw" };
      if (poses[key]) h.target = poses[key];
      else if (key === " ") {
        h.target = this.grabGesture();
        e.preventDefault();
      } else if (key === "tab") {
        this.active = this.active === "Right" ? "Left" : "Right";
        this.hands[this.active].visible = true;
        e.preventDefault();
      } else if (key === "h") {
        const other = this.active === "Right" ? "Left" : "Right";
        this.hands[other].visible = !this.hands[other].visible;
      } else if (key === "t") this.throwFlick();
      else if (key === "0") Object.assign(h.orientation, { pitch: 0, yaw: 0, roll: 0 });
    });
    on(window, "keyup", (e) => {
      const key = e.key.toLowerCase();
      this.held.delete(key);
      if (key === " ") this.hands[this.active].target = "open";
    });
    on(window, "blur", () => this.held.clear());
  }
}
