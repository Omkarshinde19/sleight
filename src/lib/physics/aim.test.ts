import { describe, expect, it } from "vitest";
import { assistThrow, ballisticVelocity, minimumSpeed, projectile, velocityForAngle } from "./aim";
import type { Point } from "../hand/types";

const from: Point = { x: 0.2, y: 1.2, z: 0 };
const hoop: Point = { x: 0, y: 2.3, z: -3.1 };

/** Closest the arc gets to the target point. */
function miss(v: Point, target = hoop) {
  let best = Infinity;
  for (let t = 0; t < 3; t += 0.001) {
    const p = projectile(from, v, t);
    best = Math.min(best, Math.hypot(p.x - target.x, p.y - target.y, p.z - target.z));
  }
  return best;
}

describe("ballisticVelocity", () => {
  it("hits the target at the requested speed", () => {
    const v = ballisticVelocity(from, hoop, 7.5)!;
    expect(Math.hypot(v.x, v.y, v.z)).toBeCloseTo(7.5, 6);
    expect(miss(v)).toBeLessThan(0.01);
    expect(v.y).toBeGreaterThan(0); // a lob, not a line drive
  });

  it("returns null when the speed can't reach", () => {
    expect(ballisticVelocity(from, hoop, minimumSpeed(from, hoop) * 0.95)).toBeNull();
    expect(ballisticVelocity(from, hoop, minimumSpeed(from, hoop) * 1.01)).not.toBeNull();
  });
});

describe("velocityForAngle", () => {
  it("hits the target at the given angle", () => {
    for (const deg of [35, 50, 65]) {
      const v = velocityForAngle(from, hoop, (deg * Math.PI) / 180)!;
      expect(miss(v)).toBeLessThan(0.01);
      expect((Math.atan2(v.y, Math.hypot(v.x, v.z)) * 180) / Math.PI).toBeCloseTo(deg, 6);
    }
  });

  it("is impossible below the line of sight", () => {
    expect(velocityForAngle(from, hoop, 0.1)).toBeNull();
  });
});

describe("assistThrow", () => {
  it("lifts a flat throw to a real shot's arc", () => {
    const helped = assistThrow({ x: 0, y: 4.5, z: -6.7 }, from, hoop, { strength: 1, maxAngleDeg: 35, minSpeed: 1, minArcDeg: 48 });
    expect((Math.atan2(helped.y, Math.hypot(helped.x, helped.z)) * 180) / Math.PI).toBeCloseTo(48, 3);
    expect(miss(helped)).toBeLessThan(0.02);
  });

  it("fixes an over-powered throw without flattening its arc", () => {
    const raw = { x: 0, y: 6.5, z: -6.5 }; // 45°, far too strong
    const helped = assistThrow(raw, { x: 0, y: 1.2, z: 0 }, { x: 0, y: 2.3, z: -3.1 }, { strength: 1, maxAngleDeg: 35, minSpeed: 1, minArcDeg: 40 });
    expect(Math.hypot(helped.x, helped.y, helped.z)).toBeLessThan(Math.hypot(raw.x, raw.y, raw.z));
    expect((Math.atan2(helped.y, Math.hypot(helped.x, helped.z)) * 180) / Math.PI).toBeCloseTo(45, 3);
  });

  it("brings a roughly aimed throw closer", () => {
    const raw = { x: 0.9, y: 4.2, z: -5 };
    const helped = assistThrow(raw, from, hoop);
    expect(miss(helped)).toBeLessThan(miss(raw));
  });

  it("at half strength roughly halves the miss", () => {
    const raw = { x: 0.6, y: 5.5, z: -5.2 };
    const half = assistThrow(raw, from, hoop, { strength: 0.5, maxAngleDeg: 35, minSpeed: 1, minArcDeg: 0 });
    expect(miss(half)).toBeLessThan(miss(raw) * 0.6);
    expect(miss(half)).toBeGreaterThan(miss(raw) * 0.3);
  });

  it("leaves a throw in the wrong direction alone", () => {
    const sideways = { x: 6, y: 3, z: -0.5 };
    expect(assistThrow(sideways, from, hoop)).toEqual(sideways);
  });

  it("leaves a gentle drop alone", () => {
    const drop = { x: 0, y: -0.5, z: -0.6 };
    expect(assistThrow(drop, from, hoop)).toEqual(drop);
  });

  it("at full strength is a perfect throw", () => {
    const helped = assistThrow({ x: 0.3, y: 4, z: -5.5 }, from, hoop, { strength: 1, maxAngleDeg: 40, minSpeed: 1, minArcDeg: 40 });
    expect(miss(helped)).toBeLessThan(0.02);
  });
});
