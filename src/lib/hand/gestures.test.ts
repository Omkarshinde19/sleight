import { describe, expect, it } from "vitest";
import { classifyInstant, GestureClassifier, handFeatures } from "./gestures";
import { lerpPose, POSES, synthHand, type HandPose } from "./synth";
import type { Gesture, Handedness } from "./types";

const world = (pose: HandPose, handedness: Handedness = "Right", roll = 0, pitch = 0, yaw = 0) =>
  synthHand({ handedness, pose, imageX: 0.5, imageY: 0.5, distance: 0.5, orientation: { roll, pitch, yaw } })
    .worldLandmarks;

describe("handFeatures", () => {
  it("reads an open hand as uncurled with a wide pinch", () => {
    const f = handFeatures(world(POSES.open));
    expect(f.grip).toBeLessThan(0.15);
    expect(f.pinchDistance).toBeGreaterThan(0.7);
  });

  it("reads a fist as fully curled", () => {
    expect(handFeatures(world(POSES.fist)).grip).toBeGreaterThan(0.85);
  });

  it("is scale-free and rotation-invariant", () => {
    const a = handFeatures(world(POSES.point));
    const b = handFeatures(world(POSES.point, "Left", 0.7, -0.4, 0.5));
    expect(b.grip).toBeCloseTo(a.grip, 6);
    expect(b.pinchDistance).toBeCloseTo(a.pinchDistance, 6);
  });
});

describe("classifyInstant", () => {
  const cases: [Gesture, HandPose][] = [
    ["open", POSES.open],
    ["pinch", POSES.pinch],
    ["fist", POSES.fist],
    ["point", POSES.point],
  ];
  for (const [label, pose] of cases) {
    for (const hand of ["Left", "Right"] as const) {
      it(`classifies a ${hand.toLowerCase()} ${label}`, () => {
        expect(classifyInstant(handFeatures(world(pose, hand, 0.3, 0.2, -0.3)))).toBe(label);
      });
    }
  }

  it("holds a pinch while the fingers drift apart a little (hysteresis)", () => {
    // ~40% of the way from pinch to open: past the enter threshold but inside the exit threshold
    const loose = handFeatures(world(lerpPose(POSES.pinch, POSES.open, 0.3)));
    expect(classifyInstant(loose, "none")).not.toBe("pinch");
    expect(classifyInstant(loose, "pinch")).toBe("pinch");
  });
});

describe("GestureClassifier", () => {
  it("needs the dwell frames before switching", () => {
    const c = new GestureClassifier(3);
    const open = handFeatures(world(POSES.open));
    const fist = handFeatures(world(POSES.fist));
    for (let i = 0; i < 3; i++) c.update(open);
    expect(c.gesture).toBe("open");
    expect(c.update(fist)).toBe("open");
    expect(c.update(fist)).toBe("open");
    expect(c.update(fist)).toBe("fist");
  });

  it("ignores a single-frame glitch in the middle of a grab", () => {
    const c = new GestureClassifier(3);
    const fist = handFeatures(world(POSES.fist));
    const open = handFeatures(world(POSES.open));
    const seq = [fist, fist, fist, fist, open, fist, fist, open, open, fist];
    const out = seq.map((f) => c.update(f));
    expect(out.slice(3)).toEqual(Array(7).fill("fist"));
  });
});
