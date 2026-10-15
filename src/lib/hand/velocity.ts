import type { Point } from "./types";

interface Sample {
  t: number; // seconds
  p: Point;
}

/** Fixed-size history of positions, newest last. */
export class MotionHistory {
  private samples: Sample[] = [];

  constructor(private capacity = 12) {}

  push(p: Point, tSec: number) {
    const last = this.samples[this.samples.length - 1];
    if (last && tSec <= last.t) return;
    this.samples.push({ t: tSec, p: { ...p } });
    if (this.samples.length > this.capacity) this.samples.shift();
  }

  /** Velocity between the last two samples (units / s). */
  instant(): Point {
    const n = this.samples.length;
    if (n < 2) return { x: 0, y: 0, z: 0 };
    const a = this.samples[n - 2];
    const b = this.samples[n - 1];
    const dt = b.t - a.t;
    return { x: (b.p.x - a.p.x) / dt, y: (b.p.y - a.p.y) / dt, z: (b.p.z - a.p.z) / dt };
  }

  /** Samples within `windowSec` of the newest one. */
  recent(windowSec: number): Sample[] {
    const n = this.samples.length;
    if (!n) return [];
    const tEnd = this.samples[n - 1].t;
    return this.samples.filter((s) => tEnd - s.t <= windowSec + 1e-9);
  }

  clear() {
    this.samples = [];
  }
}

/**
 * Least-squares slope of position over time for each axis. A regression rather than first-minus-last,
 * so one jittery frame at release time can't dominate the throw.
 */
export function regressionVelocity(samples: Sample[]): Point {
  const n = samples.length;
  if (n < 2) return { x: 0, y: 0, z: 0 };
  const tMean = samples.reduce((s, x) => s + x.t, 0) / n;
  let denom = 0;
  const num = { x: 0, y: 0, z: 0 };
  const mean = {
    x: samples.reduce((s, x) => s + x.p.x, 0) / n,
    y: samples.reduce((s, x) => s + x.p.y, 0) / n,
    z: samples.reduce((s, x) => s + x.p.z, 0) / n,
  };
  for (const s of samples) {
    const dt = s.t - tMean;
    denom += dt * dt;
    num.x += dt * (s.p.x - mean.x);
    num.y += dt * (s.p.y - mean.y);
    num.z += dt * (s.p.z - mean.z);
  }
  if (denom < 1e-12) return { x: 0, y: 0, z: 0 };
  return { x: num.x / denom, y: num.y / denom, z: num.z / denom };
}

export interface ThrowOptions {
  /** How far back to look, seconds. */
  windowSec: number;
  /** Scene-velocity multiplier: hand speeds are small, a basketball throw is not. */
  gain: number | Point;
  /** Cap on the result's magnitude (units / s). */
  maxSpeed: number;
}

export const DEFAULT_THROW: ThrowOptions = { windowSec: 0.12, gain: { x: 1.6, y: 1.9, z: 2.4 }, maxSpeed: 14 };

/** Velocity handed to a released object: recent average hand velocity × gain, capped. */
export function throwVelocity(history: MotionHistory, opts: ThrowOptions = DEFAULT_THROW): Point {
  const v = regressionVelocity(history.recent(opts.windowSec));
  const g = typeof opts.gain === "number" ? { x: opts.gain, y: opts.gain, z: opts.gain } : opts.gain;
  const out = { x: v.x * g.x, y: v.y * g.y, z: v.z * g.z };
  const speed = Math.hypot(out.x, out.y, out.z);
  if (speed > opts.maxSpeed) {
    const k = opts.maxSpeed / speed;
    out.x *= k;
    out.y *= k;
    out.z *= k;
  }
  return out;
}
