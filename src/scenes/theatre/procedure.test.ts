import { describe, expect, it } from "vitest";
import { INCISION, INCISION_NODES, MID_Z, skinHeight } from "./layout";
import { bladeContact, closureWeights, coverageOf, GUIDE_SAMPLES, markCut, nodeWeights, nodeX, sampleX, score, tent } from "./procedure";

describe("incision guide", () => {
  it("the Open_k tents sum to one everywhere along the guide", () => {
    for (let i = 0; i < GUIDE_SAMPLES; i++) {
      const x = sampleX(i);
      const sum = Array.from({ length: INCISION_NODES }, (_, k) => tent(k, x)).reduce((a, b) => a + b);
      expect(sum).toBeCloseTo(1, 6);
    }
  });

  it("a stroke along the whole guide opens every key fully", () => {
    const covered: boolean[] = [];
    for (let x = INCISION.from; x <= INCISION.to + 1e-9; x += 0.003) markCut(covered, x);
    expect(coverageOf(covered)).toBe(1);
    nodeWeights(covered).forEach((w) => expect(w).toBeCloseTo(1, 6));
  });

  it("a cut in the middle opens only the middle", () => {
    const covered: boolean[] = [];
    for (let x = -0.01; x <= 0.01; x += 0.002) markCut(covered, x);
    const w = nodeWeights(covered);
    expect(w[3]).toBeGreaterThan(0.5);
    expect(w[0]).toBe(0);
    expect(w[6]).toBe(0);
  });

  it("the blade cuts only on the guide line, and only while it touches the patient", () => {
    const top = skinHeight(0, MID_Z);
    expect(bladeContact({ x: 0, y: top + 0.001, z: MID_Z }, true)).toBe("cut");
    expect(bladeContact({ x: 0, y: top + 0.02, z: MID_Z }, false)).toBe("none"); // in the air
    expect(bladeContact({ x: 0, y: top, z: MID_Z + 0.03 }, true)).toBe("off"); // beside the line
    expect(bladeContact({ x: INCISION.to + 0.02, y: top, z: MID_Z }, true)).toBe("off"); // past its end
    expect(bladeContact({ x: 0.5, y: top, z: MID_Z }, true)).toBe("none"); // not on the patient's skin
  });

  it("the fascia is cut only from inside the slit", () => {
    const top = skinHeight(0, MID_Z);
    expect(bladeContact({ x: 0, y: top - 0.002, z: MID_Z }, true, 0.005)).toBe("none"); // still on the skin
    expect(bladeContact({ x: 0, y: top - 0.008, z: MID_Z }, true, 0.005)).toBe("cut");
  });
});

describe("closure", () => {
  it("each staple closes the cut around it; all of them close it completely", () => {
    const open = closureWeights([], false);
    open.forEach((w) => expect(w).toBe(1));
    const one = closureWeights([nodeX(3)], false);
    expect(one[3]).toBe(0);
    expect(one[0]).toBe(1);
    closureWeights([0], true).forEach((w) => expect(w).toBe(0));
  });
});

describe("score", () => {
  it("is 100 for a clean operation and drops for strays and breaches", () => {
    expect(score({ accuracyMm: 0.5, strays: 0, breaches: 0, maxPenetrationMm: 1, seconds: 300 })).toEqual({ score: 100, grade: "A" });
    expect(score({ accuracyMm: 0.5, strays: 3, breaches: 2, maxPenetrationMm: 1, seconds: 300 }).score).toBe(75);
  });
});
