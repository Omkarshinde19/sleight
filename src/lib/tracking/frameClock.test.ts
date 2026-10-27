import { describe, expect, it } from "vitest";
import { FrameClock } from "./frameClock";

const spread = (xs: number[]) => {
  const gaps = xs.slice(1).map((x, i) => x - xs[i]);
  return Math.max(...gaps) - Math.min(...gaps);
};

describe("FrameClock", () => {
  it("keeps the camera's even spacing when detection time wobbles", () => {
    const c = new FrameClock();
    const capture = Array.from({ length: 120 }, (_, i) => 1000 + i * 33.3);
    // arrival = capture + 25 ms pipeline + 8..22 ms detection
    const arrival = capture.map((t, i) => t + 25 + (i % 2 ? 22 : 8));
    const stamps = capture.map((t, i) => c.stamp(t, arrival[i]));
    const late = stamps.slice(60); // once the average delay has settled
    expect(spread(arrival.slice(60))).toBeGreaterThan(25);
    expect(spread(late)).toBeLessThan(3);
    late.forEach((s, i) => expect(Math.abs(s - arrival[60 + i])).toBeLessThan(10));
  });

  it("re-syncs when the source clock jumps (a recording loops)", () => {
    const c = new FrameClock();
    c.stamp(0, 5000);
    c.stamp(33, 5033);
    const s = c.stamp(10, 5066); // looped back to its start
    expect(s).toBeGreaterThan(5033);
    expect(s).toBeLessThan(5100);
  });

  it("never goes backwards", () => {
    const c = new FrameClock();
    let last = -Infinity;
    for (const [t, now] of [[0, 40], [33, 50], [34, 51], [66, 100], [67, 101]]) {
      const s = c.stamp(t, now);
      expect(s).toBeGreaterThan(last);
      last = s;
    }
  });
});
