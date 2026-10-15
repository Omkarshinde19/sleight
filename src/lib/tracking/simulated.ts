import { lerpPose, POSES, synthHand, type HandPose, type Orientation } from "../hand/synth";
import { clamp, type Gesture, type Handedness, type RawFrame } from "../hand/types";
import type { TrackingSource } from "./source";

type PoseName = Exclude<Gesture, "none">;

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
    Object.assign(this.hands[hand], patch);
  }

  /** Play a scripted motion, e.g. a throw. */
  play(hand: Handedness, keys: MotionKey[]) {
    this.scripts = this.scripts.filter((s) => s.hand !== hand);
    this.scripts.push({ hand, keys, t0: performance.now(), from: { ...this.hands[hand] } });
  }

  /** A forward-and-up flick, releasing at the end. */
  throwFlick(hand: Handedness = this.active) {
    this.play(hand, [
      { at: 0, gesture: "fist" },
      { at: 0.25, dy: 0.12, dDistance: 0.12, gesture: "fist" },
      { at: 0.5, dy: -0.18, dDistance: -0.22, gesture: "fist" },
      { at: 0.52, dy: -0.19, dDistance: -0.23, gesture: "open" },
      { at: 0.9, dy: -0.19, dDistance: -0.23, gesture: "open" },
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

    // Fingers move toward the target pose with a ~60 ms time constant.
    const blend = 1 - Math.exp(-dt / 0.06);
    for (const h of Object.values(this.hands)) h.pose = lerpPose(h.pose, POSES[h.target], blend);

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
      const r = el.getBoundingClientRect();
      const h = this.hands[this.active];
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
    on(el, "wheel", (e) => {
      const h = this.hands[this.active];
      h.distance = clamp(h.distance + e.deltaY * 0.0006, NEAR, FAR);
      e.preventDefault();
    }, { passive: false });

    on(window, "keydown", (e) => {
      if ((e.target as HTMLElement)?.closest?.("input, textarea, select")) return;
      const key = e.key.toLowerCase();
      this.held.add(key);
      const h = this.hands[this.active];
      const poses: Record<string, PoseName> = { "1": "open", "2": "pinch", "3": "fist", "4": "point" };
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
