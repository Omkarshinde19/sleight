import { describe, expect, it } from "vitest";
import { POSES, synthHand } from "./synth";
import { HandTracker } from "./tracks";
import type { Handedness, RawHand } from "./types";

const hand = (handedness: Handedness, imageX: number, score = 0.95): RawHand => ({
  ...synthHand({ handedness, pose: POSES.open, imageX, imageY: 0.5, distance: 0.5 }),
  score,
});
const labels = (hs: RawHand[]) => hs.map((h) => `${h.handedness}@${h.landmarks[0].x.toFixed(1)}`).sort();

describe("HandTracker", () => {
  it("keeps both hands' labels when the tracker swaps them for a few frames", () => {
    const tr = new HandTracker();
    let flips = 0;
    tr.onFlip = () => flips++;
    const out: string[][] = [];
    for (let f = 0; f < 60; f++) {
      const swapped = f >= 30 && f < 38; // 8 frames of swapped raw labels (like the demo recording)
      const r = hand(swapped ? "Left" : "Right", 0.3);
      const l = hand(swapped ? "Right" : "Left", 0.7);
      out.push(labels(tr.assign([r, l], f * 33, 4 / 3)));
    }
    expect(new Set(out.map((o) => o.join())).size).toBe(1);
    expect(flips).toBe(0);
  });

  it("ignores one hand's label flickering", () => {
    const tr = new HandTracker();
    for (let f = 0; f < 40; f++) {
      const [h] = tr.assign([hand(f % 3 === 1 ? "Left" : "Right", 0.5 + f * 0.002)], f * 33, 4 / 3);
      expect(h.handedness).toBe("Right");
    }
  });

  it("recovers when a hand's very first label was the wrong one", () => {
    const tr = new HandTracker();
    let h: Handedness = "Left";
    for (let f = 0; f < 60; f++) h = tr.assign([hand(f % 3 === 0 ? "Left" : "Right", 0.5)], f * 33, 4 / 3)[0].handedness;
    expect(h).toBe("Right");
  });

  it("does come round when the label is consistently the other way", () => {
    const tr = new HandTracker();
    tr.assign([hand("Right", 0.5)], 0, 4 / 3);
    let last: Handedness = "Right";
    for (let f = 1; f < 40; f++) last = tr.assign([hand("Left", 0.5)], f * 33, 4 / 3)[0].handedness;
    expect(last).toBe("Left");
  });

  it("follows a hand by position through a short gap", () => {
    const tr = new HandTracker();
    tr.assign([hand("Right", 0.3), hand("Left", 0.7)], 0, 4 / 3);
    // the right hand drops out for 200 ms, then comes back mislabelled while the left is in view
    for (let f = 1; f < 7; f++) tr.assign([hand("Left", 0.7)], f * 33, 4 / 3);
    const back = tr.assign([hand("Left", 0.32), hand("Left", 0.7)], 7 * 33, 4 / 3);
    expect(labels(back)).toEqual(["Left@0.7", "Right@0.3"].sort());
  });

  it("gives a new hand its own label when the old hand of that label has left", () => {
    const tr = new HandTracker();
    tr.assign([hand("Right", 0.2)], 0, 4 / 3);
    // reappears far away soon after: still the right hand, not forced to "Left"
    const [h] = tr.assign([hand("Right", 0.85)], 100, 4 / 3);
    expect(h.handedness).toBe("Right");
  });
});
