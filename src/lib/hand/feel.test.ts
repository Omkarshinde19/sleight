import { describe, expect, it } from "vitest";
import { FeelMeter } from "./feel";
import { POSES, synthHand } from "./synth";

const w = synthHand({ handedness: "Right", pose: POSES.open, imageX: 0.5, imageY: 0.5, distance: 0.5 }).worldLandmarks;
const palm = { x: 0, y: 0, z: 0 };

describe("FeelMeter dropouts", () => {
  it("doesn't count a slow tracker as dropouts", () => {
    const m = new FeelMeter();
    for (let i = 0; i < 20; i++) {
      m.frame(i * 66);
      m.detected("Right", i * 66, w, w, palm);
    }
    expect(m.stats().longestGapMs).toBe(0);
  });

  it("counts frames that arrive without the hand, and whether coasting bridged them", () => {
    const m = new FeelMeter(250);
    const t = [0, 33, 66, 99, 132, 500, 533];
    const seen = [true, true, false, true, true, false, true];
    t.forEach((ti, i) => {
      m.frame(ti);
      if (seen[i]) m.detected("Right", ti, w, w, palm);
      else m.missed("Right");
    });
    m.frame(6000); // per-minute rates need a few seconds of session
    const s = m.stats();
    expect(s.longestGapMs).toBe(401);
    expect(s.dropoutsPerMin * s.minutes).toBeCloseTo(2);
    expect(s.bridgedPerMin * s.minutes).toBeCloseTo(1);
  });
});
