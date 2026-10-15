import { describe, expect, it } from "vitest";
import { HandProcessor } from "../tracking/processor";
import type { RawFrame } from "./types";
import { classifyInstant, handFeatures } from "./gestures";
import { OneEuro } from "./oneEuro";
import { MotionHistory, throwVelocity } from "./velocity";
import gestures from "./__fixtures__/clip-gestures.json";
import still from "./__fixtures__/clip-still.json";

/** Real MediaPipe landmarks from a 38 s MacBook webcam clip, labelled by eye. */
const toPoints = (w: number[][]) => w.map(([x, y, z]) => ({ x, y, z }));

describe("gesture classifier on real webcam landmarks", () => {
  for (const label of ["open", "fist", "pinch"] as const) {
    const frames = gestures.frames.filter((f) => f.label === label);
    it(`recognises every labelled ${label} frame (${frames.length} frames)`, () => {
      const got = frames.map((f) => classifyInstant(handFeatures(toPoints(f.world))));
      expect(got).toEqual(frames.map(() => label));
    });
  }

  it("never reads a real fist as a pinch, even with the thumb near the index", () => {
    for (const f of gestures.frames.filter((f) => f.label === "fist"))
      expect(classifyInstant(handFeatures(toPoints(f.world)), "pinch")).not.toBe("pinch");
  });
});

describe("smoothing and velocity on a real, nearly still hand", () => {
  const frames = still.frames as RawFrame[];

  it("One Euro cuts frame-to-frame jitter of the image landmarks", () => {
    const f = new OneEuro(1.5, 0.03);
    const raw: number[] = [];
    const smooth: number[] = [];
    frames.forEach((fr) => {
      const x = fr.hands[0]?.landmarks[8].x;
      if (x === undefined) return;
      raw.push(x);
      smooth.push(f.filter(x, fr.t / 1000));
    });
    const stepNoise = (xs: number[]) => xs.slice(1).reduce((s, x, i) => s + Math.abs(x - xs[i]), 0) / (xs.length - 1);
    expect(stepNoise(smooth)).toBeLessThan(stepNoise(raw) * 0.75);
  });

  it("gives a held, nearly still hand a gentle throw, not a launch", () => {
    const p = new HandProcessor();
    let history: MotionHistory | undefined;
    for (const fr of frames) history = p.process(fr).Right?.history ?? history;
    const v = throwVelocity(history!);
    expect(Math.hypot(v.x, v.y, v.z)).toBeLessThan(2.5);
  });
});
