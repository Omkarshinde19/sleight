import { describe, expect, it } from "vitest";
import { penetration, pushOut, type Obstacle } from "./depenetrate";

const shelf: Obstacle = { kind: "box", c: { x: 0, y: 0.8, z: -0.28 }, h: { x: 0.42, y: 0.015, z: 0.16 } };
const ball: Obstacle = { kind: "sphere", c: { x: 0, y: 0.93, z: -0.28 }, r: 0.12 };

describe("penetration", () => {
  it("is null when clear", () => {
    expect(penetration({ x: 0, y: 2, z: 0 }, 0.02, shelf)).toBeNull();
    expect(penetration({ x: 0, y: 0.5, z: 0 }, 0.02, { kind: "floor", y: 0 })).toBeNull();
  });
  it("pushes out of a sphere along the radius", () => {
    const p = penetration({ x: 0, y: 1.0, z: -0.28 }, 0.01, ball)!;
    expect(p.dir.y).toBeCloseTo(1);
    expect(p.depth).toBeCloseTo(0.12 + 0.01 - 0.07);
  });
  it("pushes a point inside a box out through the nearest face", () => {
    const p = penetration({ x: 0.3, y: 0.81, z: -0.28 }, 0.01, shelf)!;
    expect(p.dir).toEqual({ x: 0, y: 1, z: 0 });
    expect(p.depth).toBeCloseTo(0.005 + 0.01);
  });
});

describe("pushOut", () => {
  it("lifts a hand pressed into a ball sitting on a shelf until every part is clear", () => {
    const probes = [
      { p: { x: 0.0, y: 0.98, z: -0.28 }, r: 0.03 },
      { p: { x: 0.25, y: 0.8, z: -0.28 }, r: 0.01 }, // a fingertip in the shelf
    ];
    const off = pushOut(probes, [shelf, ball]);
    for (const pr of probes) {
      const p = { x: pr.p.x + off.x, y: pr.p.y + off.y, z: pr.p.z + off.z };
      for (const o of [shelf, ball]) expect(penetration(p, pr.r, o)?.depth ?? 0).toBeLessThan(1e-3);
    }
  });
  it("doesn't move a hand that's clear", () => {
    expect(pushOut([{ p: { x: 0, y: 1.5, z: 0 }, r: 0.03 }], [shelf, ball, { kind: "floor", y: 0 }])).toEqual({ x: 0, y: 0, z: 0 });
  });
});
