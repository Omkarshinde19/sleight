import type { Point } from "./types";

/**
 * Turns ~30 Hz tracker poses into a smooth pose at any render time.
 *
 * Shown as-is, each tracker pose sits on screen for two 60 Hz frames and then jumps. Instead we draw
 * the pose half a tracker frame in the past, interpolating between the last two poses (and briefly
 * extrapolating when a frame is late). When a new pose arrives, the small mismatch between the old and
 * new curves is faded out over ~50 ms, so the motion never steps.
 */
export interface PoseSnapshot {
  joints: Point[];
  palm: Point;
  grip: Point;
}

/** How far behind the newest pose we draw, in tracker frames. 0.5 = ~16 ms at 30 Hz. */
const DELAY_FRAMES = 0.5;
/** Extrapolate at most this far past the newest pose, in tracker frames. */
const MAX_EXTRAPOLATION = 0.75;
/** Time constant for fading out the correction when a new pose arrives, ms. */
const CORRECTION_TAU = 45;

interface Stamped extends PoseSnapshot {
  t: number;
}

const POINTS = 23; // 21 joints + palm + grip
const flatten = (s: PoseSnapshot, out: Float64Array) => {
  const put = (p: Point, i: number) => {
    out[i * 3] = p.x;
    out[i * 3 + 1] = p.y;
    out[i * 3 + 2] = p.z;
  };
  s.joints.forEach(put);
  put(s.palm, 21);
  put(s.grip, 22);
  return out;
};

export class PoseInterpolator {
  private a: Stamped | null = null;
  private b: Stamped | null = null;
  /** Smoothed time between poses, ms. */
  interval = 33;
  private correction = new Float64Array(POINTS * 3);
  private correctionT = 0;
  private scratch = new Float64Array(POINTS * 3);
  private scratch2 = new Float64Array(POINTS * 3);
  private older = new Float64Array(POINTS * 3);

  get hasPose() {
    return this.b !== null;
  }

  push(s: PoseSnapshot, tMs: number) {
    if (this.b && tMs <= this.b.t) return;
    // what we would have drawn now, before this pose arrived
    const before = this.b ? this.evaluate(tMs, this.scratch) : null;
    if (this.b) {
      const dt = tMs - this.b.t;
      this.interval += 0.2 * (Math.min(100, Math.max(8, dt)) - this.interval);
    }
    this.a = this.b;
    this.b = { joints: s.joints.map((p) => ({ ...p })), palm: { ...s.palm }, grip: { ...s.grip }, t: tMs };
    if (before) {
      const after = this.evaluate(tMs, this.scratch2);
      const decay = Math.exp(-(tMs - this.correctionT) / CORRECTION_TAU);
      for (let i = 0; i < before.length; i++) this.correction[i] = this.correction[i] * decay + before[i] - after[i];
      this.correctionT = tMs;
    }
  }

  reset() {
    this.a = this.b = null;
    this.correction.fill(0);
  }

  /** The pose to draw at `tMs`, or null if there is none. */
  sample(tMs: number): PoseSnapshot | null {
    if (!this.b) return null;
    const flat = this.evaluate(tMs, this.scratch);
    const decay = Math.exp(-Math.max(0, tMs - this.correctionT) / CORRECTION_TAU);
    const at = (i: number): Point => ({
      x: flat[i * 3] + this.correction[i * 3] * decay,
      y: flat[i * 3 + 1] + this.correction[i * 3 + 1] * decay,
      z: flat[i * 3 + 2] + this.correction[i * 3 + 2] * decay,
    });
    return { joints: Array.from({ length: 21 }, (_, i) => at(i)), palm: at(21), grip: at(22) };
  }

  /** The uncorrected curve: interpolate a → b at t − delay, extrapolating a little past b. */
  private evaluate(tMs: number, out: Float64Array): Float64Array {
    const b = this.b!;
    flatten(b, out);
    const a = this.a;
    if (!a) return out;
    const span = b.t - a.t;
    if (span <= 0) return out;
    const u = Math.min(1 + (MAX_EXTRAPOLATION * this.interval) / span, (tMs - this.interval * DELAY_FRAMES - a.t) / span);
    const k = Math.max(0, u);
    const fa = flatten(a, this.older);
    for (let i = 0; i < out.length; i++) out[i] = fa[i] + (out[i] - fa[i]) * k;
    return out;
  }
}
