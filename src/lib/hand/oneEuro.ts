import type { Point } from "./types";

const smoothingFactor = (cutoffHz: number, dt: number) => {
  const tau = 1 / (2 * Math.PI * cutoffHz);
  return 1 / (1 + tau / dt);
};

/**
 * One Euro filter (Casiez et al. 2012): heavy smoothing when the signal is slow,
 * little lag when it moves fast. `minCutoff` trades jitter for lag at rest; `beta` reduces lag in motion.
 */
export class OneEuro {
  private x: number | null = null;
  private dx = 0;
  private tPrev = 0;

  constructor(
    public minCutoff = 1.2,
    public beta = 0.02,
    public dCutoff = 1.0,
  ) {}

  filter(value: number, tSec: number): number {
    if (this.x === null) {
      this.x = value;
      this.tPrev = tSec;
      return value;
    }
    const dt = tSec - this.tPrev;
    if (dt <= 0) return this.x;
    this.tPrev = tSec;
    const dxRaw = (value - this.x) / dt;
    this.dx += smoothingFactor(this.dCutoff, dt) * (dxRaw - this.dx);
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    this.x += smoothingFactor(cutoff, dt) * (value - this.x);
    return this.x;
  }

  reset() {
    this.x = null;
    this.dx = 0;
  }
}

/** One Euro filter over a list of points (e.g. 21 landmarks). */
export class PointsFilter {
  private filters: OneEuro[] = [];

  constructor(
    private count: number,
    private minCutoff: number,
    private beta: number,
    /** Optional separate settings for z, which is noisier in MediaPipe. */
    private z?: { minCutoff: number; beta: number },
  ) {
    for (let i = 0; i < count; i++) {
      this.filters.push(
        new OneEuro(minCutoff, beta),
        new OneEuro(minCutoff, beta),
        new OneEuro(z?.minCutoff ?? minCutoff, z?.beta ?? beta),
      );
    }
  }

  /** Change the x/y settings (z keeps its own), e.g. to smooth harder for precise work. */
  tune(minCutoff: number, beta: number) {
    for (let i = 0; i < this.count; i++)
      for (const f of [this.filters[i * 3], this.filters[i * 3 + 1]]) {
        f.minCutoff = minCutoff;
        f.beta = beta;
      }
  }

  filter(points: Point[], tSec: number): Point[] {
    return points.map((p, i) => ({
      x: this.filters[i * 3].filter(p.x, tSec),
      y: this.filters[i * 3 + 1].filter(p.y, tSec),
      z: this.filters[i * 3 + 2].filter(p.z, tSec),
    }));
  }

  reset() {
    this.filters.forEach((f) => f.reset());
  }
}
