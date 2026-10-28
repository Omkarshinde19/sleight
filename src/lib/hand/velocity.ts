import type { Point } from "./types";

interface Sample {
  t: number; // seconds
  p: Point;
}

/** Fixed-size history of positions, newest last. */
export class MotionHistory {
  private samples: Sample[] = [];

  constructor(private capacity = 24) {}

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

  /** Samples within `windowSec` of the newest one, plus `extra` older ones before them if there are. */
  recent(windowSec: number, extra = 0): Sample[] {
    const n = this.samples.length;
    if (!n) return [];
    const tEnd = this.samples[n - 1].t;
    const first = this.samples.findIndex((s) => tEnd - s.t <= windowSec + 1e-9);
    return this.samples.slice(Math.max(0, first - extra));
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
  /** Length of the averaging window, seconds. */
  windowSec: number;
  /**
   * How far before the release to search for the fastest window. Releases are detected a few frames
   * after the fingers open (gesture dwell + smoothing), by which time the hand has often slowed.
   */
  lookbackSec?: number;
  /** Scene-velocity multiplier: hand speeds are small, a basketball throw is not. */
  gain: number | Point;
  /** Cap on the result's magnitude (units / s). */
  maxSpeed: number;
  /**
   * Fewest samples in a window, whatever its length. At 13 tracker fps a 120 ms window holds one or two
   * frames, and a fit through two noisy points threw anywhere from 1 to 7 m/s.
   */
  minSamples?: number;
}

export const DEFAULT_THROW: ThrowOptions = { windowSec: 0.12, lookbackSec: 0.35, gain: { x: 1.6, y: 1.9, z: 2.4 }, maxSpeed: 14, minSamples: 4 };

/** The samples ending at index `end`: those within `windowSec` of it, and at least `minSamples` of them. */
function windowEndingAt(samples: Sample[], end: number, windowSec: number, minSamples: number): Sample[] {
  const tEnd = samples[end].t;
  let start = end;
  while (start > 0 && (tEnd - samples[start - 1].t <= windowSec + 1e-9 || end - start + 1 < minSamples)) start--;
  return samples.slice(start, end + 1);
}

/** The fastest `windowSec`-long regression velocity among the samples (sliding window). */
export function peakVelocity(samples: Sample[], windowSec: number, minSamples = 2): Point {
  let best = regressionVelocity(windowEndingAt(samples, samples.length - 1, windowSec, minSamples));
  let bestSpeed = Math.hypot(best.x, best.y, best.z);
  for (let end = samples.length - 2; end >= 1; end--) {
    const win = windowEndingAt(samples, end, windowSec, minSamples);
    // windows cut short by the start of the history are noisier than the rest: skip them
    if (win.length < Math.max(2, Math.min(minSamples, samples.length))) continue;
    const v = regressionVelocity(win);
    const speed = Math.hypot(v.x, v.y, v.z);
    if (speed > bestSpeed) {
      best = v;
      bestSpeed = speed;
    }
  }
  return best;
}

/** Velocity handed to a released object: recent (peak) average hand velocity × gain, capped. */
export function throwVelocity(history: MotionHistory, opts: ThrowOptions = DEFAULT_THROW): Point {
  const min = opts.minSamples ?? 2;
  const samples = history.recent(Math.max(opts.windowSec, opts.lookbackSec ?? 0), min - 1);
  if (samples.length < 2) return { x: 0, y: 0, z: 0 };
  const v = opts.lookbackSec
    ? peakVelocity(samples, opts.windowSec, min)
    : regressionVelocity(windowEndingAt(samples, samples.length - 1, opts.windowSec, min));
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
