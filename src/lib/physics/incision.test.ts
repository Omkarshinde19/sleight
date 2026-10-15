import { describe, expect, it } from "vitest";
import { coverage, distToSegment, meanDeviation } from "./incision";

const A = { x: 0, z: 0 };
const B = { x: 0.18, z: 0 };
const line = (from: number, to: number, z = 0, n = 60) =>
  Array.from({ length: n + 1 }, (_, i) => ({ x: from + ((to - from) * i) / n, z }));

describe("incision scoring", () => {
  it("measures distance to the guide segment, clamped at its ends", () => {
    expect(distToSegment({ x: 0.09, z: 0.003 }, A, B)).toBeCloseTo(0.003, 9);
    expect(distToSegment({ x: 0.2, z: 0 }, A, B)).toBeCloseTo(0.02, 9);
  });

  it("gives full coverage for a cut along the whole line", () => {
    expect(coverage(line(0, 0.18), A, B)).toBe(1);
  });

  it("gives about half coverage for half the line", () => {
    expect(coverage(line(0, 0.09), A, B)).toBeGreaterThan(0.45);
    expect(coverage(line(0, 0.09), A, B)).toBeLessThan(0.6);
  });

  it("doesn't count a parallel cut that's off by more than the tolerance", () => {
    expect(coverage(line(0, 0.18, 0.01), A, B)).toBe(0);
    expect(meanDeviation(line(0, 0.18, 0.01), A, B)).toBeCloseTo(0.01, 9);
  });

  it("has no deviation without a cut", () => {
    expect(meanDeviation([], A, B)).toBeNull();
  });
});
