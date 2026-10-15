import { describe, expect, it } from "vitest";
import { classifyInstant, GestureClassifier, handFeatures, THRESHOLDS } from "./gestures";
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
    // Find a pose part-way from pinch to open whose pinch distance sits between enter and exit.
    const { enter, exit } = THRESHOLDS.pinch;
    const loose = Array.from({ length: 41 }, (_, i) => handFeatures(world(lerpPose(POSES.pinch, POSES.open, i / 40)))).find(
      (f) => f.pinchDistance > enter && f.pinchDistance < exit,
    )!;
    expect(loose).toBeDefined();
    expect(classifyInstant(loose, "none")).not.toBe("pinch");
    expect(classifyInstant(loose, "pinch")).toBe("pinch");
  });
});

it("drops to none for an in-between claw instead of sticking to open", () => {
  const claw = handFeatures(world(lerpPose(POSES.open, POSES.fist, 0.6)));
  expect(claw.grip).toBeGreaterThan(THRESHOLDS.open.gripExit);
  expect(classifyInstant(claw, "open")).not.toBe("open");
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
