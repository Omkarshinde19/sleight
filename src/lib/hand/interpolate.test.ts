import { describe, expect, it } from "vitest";
import { PoseInterpolator, type PoseSnapshot } from "./interpolate";

const at = (x: number): PoseSnapshot => {
  const p = { x, y: 0, z: 0 };
  return { joints: Array.from({ length: 21 }, () => ({ ...p })), palm: { ...p }, grip: { ...p } };
};

/** Push 30 Hz poses of something moving at `speed` m/s and sample at 60 Hz. */
function run(speed: number, frames = 30) {
  const ip = new PoseInterpolator();
  const xs: number[] = [];
  for (let i = 0; i < frames; i++) {
    const t = i * 33.3;
    ip.push(at(speed * (t / 1000)), t);
    xs.push(ip.sample(t)!.palm.x, ip.sample(t + 16.7)!.palm.x);
  }
  return xs;
}

describe("PoseInterpolator", () => {
  it("returns the pose as-is until there are two", () => {
    const ip = new PoseInterpolator();
    expect(ip.sample(0)).toBeNull();
    ip.push(at(0.5), 0);
    expect(ip.sample(10)!.palm.x).toBe(0.5);
  });

  it("turns 30 Hz steps into even 60 Hz motion", () => {
    const xs = run(1).slice(10); // after the start-up transient
    const steps = xs.slice(1).map((x, i) => x - xs[i]);
    const mean = steps.reduce((s, d) => s + d, 0) / steps.length;
    // shown raw, the steps would alternate 33 mm and 0 mm
    for (const d of steps) expect(Math.abs(d - mean)).toBeLessThan(mean * 0.15);
    expect(mean).toBeCloseTo(1 * 0.01667, 3);
  });

  it("stays close behind the newest pose (about half a tracker frame)", () => {
    const xs = run(1);
    const newest = 1 * (29 * 33.3) / 1000;
    expect(newest - xs[xs.length - 2]).toBeLessThan(0.025);
  });

  it("does not overshoot far when the hand stops", () => {
    const ip = new PoseInterpolator();
    let max = 0;
    for (let i = 0; i < 18; i++) {
      ip.push(at(Math.min(i, 9) * 0.033), i * 33.3); // moving at 1 m/s, then still
      for (let dt = 0; dt < 33; dt += 8) max = Math.max(max, ip.sample(i * 33.3 + dt)!.palm.x);
    }
    expect(max - 9 * 0.033).toBeLessThan(0.03);
    expect(ip.sample(17 * 33.3)!.palm.x).toBeCloseTo(9 * 0.033, 3);
  });
});
