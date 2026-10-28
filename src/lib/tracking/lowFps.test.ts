import { describe, expect, it } from "vitest";
import { GestureClassifier, handFeatures } from "../hand/gestures";
import { anchorInScene, DEFAULT_WORKSPACE, jointsInScene, type Workspace } from "../hand/mapping";
import { POSES, synthHand } from "../hand/synth";
import { LM, type RawFrame } from "../hand/types";
import { MotionHistory, throwVelocity } from "../hand/velocity";
import { COAST_MS, HandProcessor, HOLD_COAST_MS } from "./processor";
import demo from "../../../public/sessions/demo.json";

/**
 * The tracker ran at 11–19 fps in recorded camera sessions (the GPU shared with a heavy scene), not the
 * 30 the tuning assumed. These run the same logic at that rate.
 */
const frames = (demo as { frames: RawFrame[] }).frames;
/** Every second frame of the ~29 fps demo: ~14 fps. */
const slow = frames.filter((_, i) => i % 2 === 0);

const synth = (imageX: number, imageY: number, pose = POSES.open) =>
  synthHand({ handedness: "Right", pose, imageX, imageY, distance: 0.5, orientation: { pitch: 0, yaw: 0, roll: 0 } });

describe("throw velocity at 13 fps", () => {
  it("fits at least four samples, so one noisy frame can't set the throw", () => {
    // a steady 1 m/s upward move, with ±1 cm of tracker noise on alternate frames
    const run = (minSamples: number) => {
      const h = new MotionHistory(12);
      for (let i = 0; i < 12; i++) {
        const t = i / 13;
        h.push({ x: 0, y: t + (i % 2 ? 0.01 : -0.01), z: 0 }, t);
      }
      return throwVelocity(h, { windowSec: 0.12, lookbackSec: 0.35, gain: 1, maxSpeed: 20, minSamples }).y;
    };
    expect(Math.abs(run(2) - 1)).toBeGreaterThan(0.2);
    expect(Math.abs(run(4) - 1)).toBeLessThan(0.15);
  });
});

describe("gesture dwell at 13 fps", () => {
  it("switches after ~60 ms (two frames here), not three frames (230 ms)", () => {
    const c = new GestureClassifier(3, 0.06);
    const open = handFeatures(synth(0.5, 0.5).worldLandmarks);
    const fist = handFeatures(synth(0.5, 0.5, POSES.fist).worldLandmarks);
    let t = 0;
    for (let i = 0; i < 4; i++) c.update(fist, (t += 1 / 13));
    expect(c.gesture).toBe("fist");
    c.update(open, (t += 1 / 13));
    expect(c.gesture).toBe("fist");
    c.update(open, (t += 1 / 13));
    expect(c.gesture).toBe("open");
  });
});

describe("HandProcessor at 14 fps", () => {
  it("finishes depth calibration on a real session from steady frames, well before the timeout", () => {
    const p = new HandProcessor();
    const start = slow.findIndex((f) => f.hands.length > 0);
    let doneAt: number | null = null;
    for (const f of slow) {
      p.process(f);
      if (doneAt === null && !p.isCalibrating && f.t > slow[start].t) doneAt = f.t;
    }
    expect(doneAt).not.toBeNull();
    // 1.6 s here; the per-frame steadiness test it replaces took 3 s at 14 fps and 5 s at 10 fps
    expect(doneAt! - slow[start].t).toBeLessThan(2500);
  });

  it("calibrates a hand that never holds still, after a few seconds", () => {
    const p = new HandProcessor();
    for (let i = 0; i < 13 * 6; i++) {
      const t = (i * 1000) / 13;
      const h = synth(0.5 + 0.25 * Math.sin(t / 300), 0.5);
      p.process({ t, aspect: 4 / 3, hands: [h] });
      if (i === 13) expect(p.isCalibrating).toBe(true);
    }
    expect(p.isCalibrating).toBe(false);
  });

  it("coasts for three frames, and longer while holding something", () => {
    const hold = new HandProcessor();
    hold.holding = () => true;
    const free = new HandProcessor();
    const start = slow.findIndex((f) => f.hands.some((h) => h.handedness === "Right"));
    for (let i = start; i < start + 20; i++) {
      hold.process(slow[i]);
      free.process(slow[i]);
    }
    const t = slow[start + 19].t;
    const gap = Math.max(COAST_MS, 3 * 70) + 40;
    expect(gap).toBeLessThan(HOLD_COAST_MS);
    expect(free.process({ t: t + gap, aspect: 1.5, hands: [] }).Right).toBeUndefined();
    expect(hold.process({ t: t + gap, aspect: 1.5, hands: [] }).Right?.lost).toBe(true);
  });

  it("flags a hand at the edge of the camera frame", () => {
    const p = new HandProcessor();
    expect(p.process({ t: 0, aspect: 4 / 3, hands: [synth(0.5, 0.5)] }).Right?.nearEdge).toBe(false);
    expect(p.process({ t: 70, aspect: 4 / 3, hands: [synth(0.5, 0.06)] }).Right?.nearEdge).toBe(true);
  });
});

describe("precision mode", () => {
  const ws: Workspace = { ...DEFAULT_WORKSPACE, precision: { scale: 0.5, fullSpeed: 0.35 } };
  /** Scene palm travel for an image move from x=0.5 to `to`, in `steps` frames at 13 fps. */
  const travel = (holding: boolean, to: number, steps: number) => {
    const p = new HandProcessor(ws);
    p.holding = () => holding;
    p.setSynthetic(true);
    let first = null as number | null;
    let last = 0;
    for (let i = 0; i <= steps + 30; i++) {
      const x = 0.5 + (to - 0.5) * Math.min(1, i / steps);
      const palm = p.process({ t: (i * 1000) / 13, aspect: 4 / 3, hands: [synth(x, 0.5)] }).Right!.palm.x;
      first ??= palm;
      last = palm;
    }
    return Math.abs(last - first!);
  };

  it("halves slow moves while holding", () => {
    const slowMove = travel(true, 0.53, 40); // ~5 cm/s in the scene
    expect(slowMove / travel(false, 0.53, 40)).toBeLessThan(0.65);
  });

  it("leaves fast moves alone", () => {
    const fast = travel(true, 0.8, 4);
    expect(fast / travel(false, 0.8, 4)).toBeGreaterThan(0.8);
  });

  it("lets the hand settle back where it really is after letting go", () => {
    const p = new HandProcessor(ws);
    p.setSynthetic(true);
    let holding = true;
    p.holding = () => holding;
    let t = 0;
    for (let i = 0; i <= 40; i++) p.process({ t: (t = (i * 1000) / 13), aspect: 4 / 3, hands: [synth(0.5 + 0.03 * (i / 40), 0.5)] });
    holding = false;
    let palm = 0;
    for (let i = 1; i <= 26; i++) palm = p.process({ t: t + (i * 1000) / 13, aspect: 4 / 3, hands: [synth(0.53, 0.5)] }).Right!.palm.x;
    const free = new HandProcessor(ws);
    free.setSynthetic(true);
    let real = 0;
    for (let i = 0; i <= 40; i++) real = free.process({ t: (i * 1000) / 13, aspect: 4 / 3, hands: [synth(0.53, 0.5)] }).Right!.palm.x;
    expect(Math.abs(palm - real)).toBeLessThan(0.005);
  });
});

describe("workspace mapping", () => {
  it("stretches the middle of the frame over the workspace, leaving an edge margin", () => {
    const ws = { ...DEFAULT_WORKSPACE, edge: 0.1 };
    expect(anchorInScene({ x: 0.1, y: 0.5, z: 0 }, 0, ws).x).toBeCloseTo(ws.center.x + ws.width / 2, 6);
    expect(anchorInScene({ x: 0.5, y: 0.9, z: 0 }, 0, ws).y).toBeCloseTo(ws.center.y - ws.height / 2, 6);
  });

  it("tilt turns an upright hand's fingers into the scene", () => {
    const w = synth(0.5, 0.5).worldLandmarks;
    const dir = (ws: Workspace) => {
      const j = jointsInScene(w, { x: 0, y: 0, z: 0 }, ws);
      return { y: j[LM.MIDDLE_TIP].y - j[LM.WRIST].y, z: j[LM.MIDDLE_TIP].z - j[LM.WRIST].z };
    };
    const upright = dir(DEFAULT_WORKSPACE);
    expect(upright.y).toBeGreaterThan(Math.abs(upright.z));
    const tilted = dir({ ...DEFAULT_WORKSPACE, tilt: Math.PI / 2 });
    expect(-tilted.z).toBeGreaterThan(Math.abs(tilted.y));
  });
});
