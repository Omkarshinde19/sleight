import { describe, expect, it } from "vitest";
import { classifyInstant, handFeatures } from "./gestures";
import { BONE_TREE, limitJoint, Skeleton } from "./skeleton";
import { POSES, synthHand } from "./synth";
import { dist, LM, norm, sub, type Handedness, type Point } from "./types";
import gestures from "./__fixtures__/clip-gestures.json";

const toPoints = (w: number[][]) => w.map(([x, y, z]) => ({ x, y, z }));
const synth = (handedness: Handedness, pose = POSES.open) => synthHand({ handedness, pose, imageX: 0.5, imageY: 0.5, distance: 0.5 }).worldLandmarks;
/** Jitter every coordinate by up to ±a (a fake noisy tracker). */
const noisy = (w: Point[], a: number, seed: number) => w.map((p, i) => ({ x: p.x + a * Math.sin(seed * 7.1 + i), y: p.y + a * Math.sin(seed * 3.3 + i * 2), z: p.z + 2 * a * Math.sin(seed * 5.7 + i * 3) }));

describe("Skeleton", () => {
  it("rebuilds the hand with fixed bone lengths once it has learnt them", () => {
    const sk = new Skeleton();
    const lens: number[][] = [];
    for (let f = 0; f < 120; f++) {
      const w = noisy(synth("Right", f % 40 < 20 ? POSES.open : POSES.fist), 0.004, f);
      sk.observe(w);
      const solved = sk.solve(w, "Right");
      if (f >= 45) lens.push(BONE_TREE.map(([a, b]) => dist(solved[a], solved[b])));
    }
    expect(sk.isLocked).toBe(true);
    for (let b = 0; b < BONE_TREE.length; b++) {
      const ls = lens.map((l) => l[b]);
      expect(Math.max(...ls) - Math.min(...ls)).toBeLessThan(1e-9);
    }
  });

  it("leaves a real hand's gesture alone (real webcam fist, open and pinch frames)", () => {
    for (const f of gestures.frames) {
      const w = toPoints(f.world);
      const sk = new Skeleton();
      for (let i = 0; i < 45; i++) sk.observe(w);
      const solved = sk.solve(w, f.handedness as Handedness);
      expect(classifyInstant(handFeatures(solved))).toBe(f.label);
    }
  });

  it("measures flexion toward the palm as positive for both hands", () => {
    for (const h of ["Right", "Left"] as Handedness[]) {
      const w = synth(h, POSES.fist);
      const across = sub(w[LM.INDEX_MCP], w[LM.PINKY_MCP]);
      const a = h === "Right" ? across : { x: -across.x, y: -across.y, z: -across.z };
      const { angle } = limitJoint(norm(sub(w[LM.INDEX_PIP], w[LM.INDEX_MCP])), norm(sub(w[LM.INDEX_DIP], w[LM.INDEX_PIP])), a, "pip");
      expect(angle).toBeGreaterThan(1);
    }
  });

  it("stops a finger bending backwards or sideways at a hinge", () => {
    const parent = { x: 0, y: -1, z: 0 };
    const across = { x: 1, y: 0, z: 0 }; // right hand palm-on: palmar is −z
    const back = norm({ x: 0.3, y: -1, z: 0.8 }); // backwards and sideways
    const { dir } = limitJoint(parent, back, across, "pip");
    expect(Math.abs(dir.x)).toBeLessThan(1e-9);
    expect(dir.z).toBeGreaterThan(0); // back, but only as far as the limit
    expect(Math.atan2(dir.z, -dir.y)).toBeCloseTo(0.17, 2);
  });

  it("works out a wrongly labelled hand instead of freezing its fingers straight", () => {
    const sk = new Skeleton();
    let curled = 0;
    for (let f = 0; f < 200; f++) {
      const w = synth("Right", POSES.fist);
      sk.observe(w);
      const out = sk.solve(w, "Left"); // the label is wrong
      curled = handFeatures(out).grip;
    }
    expect(curled).toBeGreaterThan(0.85);
  });
});
