import { describe, expect, it } from "vitest";
import { MotionHistory, regressionVelocity, throwVelocity } from "./velocity";

const fill = (h: MotionHistory, v: { x: number; y: number; z: number }, frames: number, fps = 30, noise = 0) => {
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 2;
  for (let i = 0; i < frames; i++) {
    const t = i / fps;
    h.push({ x: v.x * t + rand() * noise, y: v.y * t + rand() * noise, z: v.z * t + rand() * noise }, t);
  }
};

describe("regressionVelocity", () => {
  it("recovers a constant velocity exactly", () => {
    const h = new MotionHistory(12);
    fill(h, { x: 1.5, y: -0.5, z: 2 }, 10);
    const v = regressionVelocity(h.recent(1));
    expect(v.x).toBeCloseTo(1.5, 9);
    expect(v.y).toBeCloseTo(-0.5, 9);
    expect(v.z).toBeCloseTo(2, 9);
  });

  it("returns zero with fewer than two samples", () => {
    const h = new MotionHistory();
    h.push({ x: 1, y: 1, z: 1 }, 0);
    expect(regressionVelocity(h.recent(1))).toEqual({ x: 0, y: 0, z: 0 });
  });

  it("is less thrown off by one bad frame than first-minus-last", () => {
    const h = new MotionHistory();
    fill(h, { x: 1, y: 0, z: 0 }, 5);
    h.push({ x: 0.133 + 0.08, y: 0, z: 0 }, 5 / 30); // the release frame jumps 8 cm
    const reg = regressionVelocity(h.recent(0.2)).x;
    const naive = h.instant().x;
    expect(Math.abs(reg - 1)).toBeLessThan(Math.abs(naive - 1));
  });
});

describe("throwVelocity", () => {
  it("averages only the recent window", () => {
    const h = new MotionHistory(30);
    // slow for a second, then fast for the last 4 frames
    for (let i = 0; i < 30; i++) h.push({ x: i * 0.001, y: 0, z: 0 }, i / 30);
    const x0 = 29 * 0.001;
    for (let i = 1; i <= 4; i++) h.push({ x: x0 + i * 0.1, y: 0, z: 0 }, (29 + i) / 30);
    const v = throwVelocity(h, { windowSec: 0.1, gain: 1, maxSpeed: 100 });
    expect(v.x).toBeCloseTo(3, 6); // 0.1 m per 1/30 s
  });

  it("applies per-axis gain and caps the speed", () => {
    const h = new MotionHistory();
    fill(h, { x: 0, y: 1, z: -2 }, 6);
    const v = throwVelocity(h, { windowSec: 0.2, gain: { x: 1, y: 2, z: 3 }, maxSpeed: 100 });
    expect(v.y).toBeCloseTo(2, 6);
    expect(v.z).toBeCloseTo(-6, 6);
    const capped = throwVelocity(h, { windowSec: 0.2, gain: 10, maxSpeed: 5 });
    expect(Math.hypot(capped.x, capped.y, capped.z)).toBeCloseTo(5, 6);
  });

  it("stays near the true velocity with tracker noise", () => {
    const h = new MotionHistory();
    fill(h, { x: 0, y: 2, z: 0 }, 6, 30, 0.004);
    const v = throwVelocity(h, { windowSec: 0.2, gain: 1, maxSpeed: 100 });
    expect(v.y).toBeGreaterThan(1.6);
    expect(v.y).toBeLessThan(2.4);
  });
});

describe("throwVelocity with lookback", () => {
  it("finds the swing even when release is detected after the hand has stopped", () => {
    const h = new MotionHistory();
    // 6 frames swinging at 2 m/s up, then 4 frames held still (gesture latency)
    let y = 0;
    for (let i = 0; i < 6; i++) h.push({ x: 0, y: (y = i * (2 / 30)), z: 0 }, i / 30);
    for (let i = 6; i < 10; i++) h.push({ x: 0, y, z: 0 }, i / 30);
    const naive = throwVelocity(h, { windowSec: 0.1, gain: 1, maxSpeed: 100 });
    const peak = throwVelocity(h, { windowSec: 0.1, lookbackSec: 0.35, gain: 1, maxSpeed: 100 });
    expect(Math.abs(naive.y)).toBeLessThan(1);
    expect(peak.y).toBeCloseTo(2, 1);
  });

  it("ignores motion older than the lookback", () => {
    const h = new MotionHistory();
    for (let i = 0; i < 6; i++) h.push({ x: i * 0.1, y: 0, z: 0 }, i / 30); // fast, long ago
    for (let i = 6; i < 22; i++) h.push({ x: 0.5, y: 0, z: 0 }, i / 30); // then 0.5 s still
    const v = throwVelocity(h, { windowSec: 0.1, lookbackSec: 0.3, gain: 1, maxSpeed: 100 });
    expect(Math.hypot(v.x, v.y, v.z)).toBeLessThan(0.05);
  });
});
