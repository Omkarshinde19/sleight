import { describe, expect, it } from "vitest";
import { POSES, synthHand } from "./synth";
import { dist, FINGERS, LM, type Point } from "./types";
import { wrapAround } from "./wrap";

const fist = synthHand({ handedness: "Right", pose: POSES.fist, imageX: 0.5, imageY: 0.5, distance: 0.5 }).worldLandmarks;
// a ball pressed into the curled fingers, in front of the palm (−z is toward the camera here)
const centre: Point = { x: 0, y: -0.06, z: -0.045 };
const R = 0.04;

describe("wrapAround", () => {
  it("brings every finger joint out onto the ball", () => {
    const inside = fist.filter((p) => dist(p, centre) < R).length;
    expect(inside).toBeGreaterThan(0);
    const out = wrapAround(fist, centre, R, 0.004);
    for (const chain of FINGERS) for (const j of chain.slice(1)) if (j !== LM.THUMB_CMC) expect(dist(out[j], centre)).toBeGreaterThan(R + 0.004 - 2e-3);
  });

  it("keeps the bone lengths", () => {
    const out = wrapAround(fist, centre, R, 0.004);
    for (const chain of FINGERS) for (let k = 1; k < chain.length; k++) expect(dist(out[chain[k]], out[chain[k - 1]])).toBeCloseTo(dist(fist[chain[k]], fist[chain[k - 1]]), 6);
  });

  it("leaves a hand that isn't touching the ball alone", () => {
    expect(wrapAround(fist, { x: 1, y: 1, z: 1 }, R, 0.004)).toEqual(fist);
  });
});
