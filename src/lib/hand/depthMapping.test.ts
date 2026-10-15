import { describe, expect, it } from "vitest";
import { apparentScale, DepthEstimator } from "./depth";
import { anchorInScene, DEFAULT_WORKSPACE, jointsInScene } from "./mapping";
import { OneEuro } from "./oneEuro";
import { POSES, synthHand } from "./synth";
import { dist, LM } from "./types";

const hand = (distance: number, imageX = 0.5, pitch = 0) =>
  synthHand({ handedness: "Right", pose: POSES.open, imageX, imageY: 0.5, distance, orientation: { pitch, yaw: 0, roll: 0 } });

describe("depth from apparent palm size", () => {
  it("grows as the hand approaches", () => {
    const near = hand(0.35);
    const far = hand(0.7);
    expect(apparentScale(near.landmarks, near.worldLandmarks, 4 / 3)).toBeGreaterThan(
      apparentScale(far.landmarks, far.worldLandmarks, 4 / 3),
    );
  });

  it("reports the fractional distance change from calibration", () => {
    const est = new DepthEstimator();
    const ref = hand(0.5);
    for (let i = 0; i < 6; i++) est.addCalibrationSample(apparentScale(ref.landmarks, ref.worldLandmarks, 4 / 3));
    expect(est.finishCalibration()).toBe(true);
    const far = hand(0.75);
    expect(est.relativeDepth(apparentScale(far.landmarks, far.worldLandmarks, 4 / 3))).toBeCloseTo(0.5, 1);
    const near = hand(0.4);
    expect(est.relativeDepth(apparentScale(near.landmarks, near.worldLandmarks, 4 / 3))).toBeCloseTo(-0.2, 1);
  });

  it("barely changes when the hand tilts at a fixed distance", () => {
    const flat = hand(0.5);
    const tilted = hand(0.5, 0.5, 0.6);
    const a = apparentScale(flat.landmarks, flat.worldLandmarks, 4 / 3);
    const b = apparentScale(tilted.landmarks, tilted.worldLandmarks, 4 / 3);
    expect(Math.abs(b / a - 1)).toBeLessThan(0.1);
  });
});

describe("scene mapping", () => {
  it("mirrors x so moving your hand right moves the robot right", () => {
    const left = anchorInScene({ x: 0.8, y: 0.5, z: 0 }, 0, DEFAULT_WORKSPACE); // image right = user's left
    expect(left.x).toBeLessThan(0);
  });

  it("puts the hand deeper into the scene as it approaches the camera", () => {
    expect(anchorInScene({ x: 0.5, y: 0.5, z: 0 }, -0.2, DEFAULT_WORKSPACE).z).toBeLessThan(0);
  });

  it("keeps the hand's size, scaled, and its handedness", () => {
    const h = hand(0.5);
    const j = jointsInScene(h.worldLandmarks, { x: 0, y: 1, z: 0 }, DEFAULT_WORKSPACE);
    const real = dist(h.worldLandmarks[LM.WRIST], h.worldLandmarks[LM.MIDDLE_TIP]);
    expect(dist(j[LM.WRIST], j[LM.MIDDLE_TIP])).toBeCloseTo(real * DEFAULT_WORKSPACE.handScale, 6);
    // first person, palm toward the camera: a right hand's thumb is on the user's left
    expect(j[LM.THUMB_TIP].x).toBeLessThan(j[LM.PINKY_TIP].x);
    // fingers point up
    expect(j[LM.MIDDLE_TIP].y).toBeGreaterThan(j[LM.WRIST].y);
  });
});

describe("OneEuro", () => {
  it("smooths jitter at rest and follows a fast move", () => {
    const f = new OneEuro(1.2, 0.05);
    for (let i = 0; i < 60; i++) f.filter(i % 2 ? 0.01 : -0.01, i / 60);
    expect(Math.abs(f.filter(0.01, 1))).toBeLessThan(0.01);
    let out = 0;
    for (let i = 0; i < 20; i++) out = f.filter(1 + i * 0.2, 1 + (i + 1) / 60);
    expect(out).toBeGreaterThan(3.5); // target 4.8; lag stays small while moving fast
  });
});
