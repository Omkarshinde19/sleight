import { describe, expect, it } from "vitest";
import { FeelMeter } from "../hand/feel";
import type { Handedness, RawFrame } from "../hand/types";
import { applySmoothingPreset, COAST_MS, HandProcessor, SMOOTHING } from "./processor";
import demo from "../../../public/sessions/demo.json";
import arcade from "../hand/__fixtures__/arcade-session.json";

/** The committed demo session: 38 s of a real MacBook webcam through MediaPipe, both hands. */
const frames = (demo as { frames: RawFrame[] }).frames;

function replay(p: HandProcessor, fs: RawFrame[] = frames) {
  return fs.map((f) => p.process(f));
}

describe("HandProcessor on the real demo recording", () => {
  it("rigid robot hands: bone lengths stop varying", () => {
    const feel = new FeelMeter();
    replay(new HandProcessor(undefined, feel));
    const s = feel.stats();
    console.log(`bones ±${s.boneCvRawPct.toFixed(1)}% raw → ±${s.boneCvPct.toFixed(1)}%, flips ${s.labelFlipsPerMin.toFixed(1)}/min, fixes ${s.labelFixesPerMin.toFixed(1)}/min, dropouts ${s.dropoutsPerMin.toFixed(1)}/min (bridged ${s.bridgedPerMin.toFixed(1)}), jitter ${s.jitterMm?.toFixed(1)} mm`);
    expect(s.boneCvRawPct).toBeGreaterThan(5);
    expect(s.boneCvPct).toBeLessThan(s.boneCvRawPct / 3);
  });

  it("never swaps the two hands, though the tracker's labels do", () => {
    const feel = new FeelMeter();
    const out = replay(new HandProcessor(undefined, feel));
    expect(feel.stats().labelFixesPerMin).toBeGreaterThan(0);
    // each output hand moves continuously: no frame-to-frame jump across the image
    for (const h of ["Left", "Right"] as Handedness[]) {
      for (let i = 1; i < out.length; i++) {
        const a = out[i - 1][h];
        const b = out[i][h];
        if (a && b) expect(Math.abs(a.palm.x - b.palm.x)).toBeLessThan(0.35);
      }
    }
  });

  it("bridges short dropouts instead of blinking the hand out", () => {
    const out = replay(new HandProcessor());
    let bridged = 0;
    frames.forEach((f, i) => {
      for (const h of ["Left", "Right"] as Handedness[]) {
        if (out[i][h]?.lost) bridged++;
        // a hand missing for a single frame between two detections is always still shown
        const seen = (j: number) => frames[j]?.hands.some((x) => x.handedness === h);
        if (!seen(i) && seen(i - 1) && seen(i + 1) && frames[i + 1].t - frames[i - 1].t <= COAST_MS) expect(out[i][h]).toBeDefined();
      }
    });
    expect(bridged).toBeGreaterThan(0);
  });

  it("lets a hand go once it has been gone longer than the coast time", () => {
    const p = new HandProcessor();
    const start = frames.findIndex((f) => f.hands.length === 2);
    for (let i = start; i < start + 30; i++) p.process(frames[i]);
    const t = frames[start + 29].t;
    expect(p.process({ t: t + 100, aspect: 1.5, hands: [] }).Right?.lost).toBe(true);
    expect(p.process({ t: t + COAST_MS + 50, aspect: 1.5, hands: [] }).Right).toBeUndefined();
  });
});

describe("HandProcessor when the hands' labels are exchanged", () => {
  it("keeps each hand where it was: no jump across the scene", () => {
    // a lone right hand mislabelled "Left" (as MediaPipe often does), then the left hand comes in
    const start = frames.findIndex((f) => f.hands.length === 2);
    const pair = frames.slice(start, start + 60);
    const alone = pair.slice(0, 15).map((f) => {
      const right = f.hands.find((h) => h.handedness === "Right")!;
      return { ...f, hands: [{ ...right, handedness: "Left" as Handedness }] };
    });
    let swaps = 0;
    const p = new HandProcessor(undefined, undefined, () => swaps++);
    const out = [...alone, ...pair.slice(15)].map((f) => p.process(f));
    expect(swaps).toBe(1);
    const lastAlone = out[14].Left!.palm;
    const firstPair = out[15].Right!.palm;
    expect(Math.hypot(firstPair.x - lastAlone.x, firstPair.y - lastAlone.y)).toBeLessThan(0.1);
  });
});

describe("HandProcessor on a real arcade session (two hands, grabs and throws)", () => {
  // 47 s from a MacBook webcam; the right hand enters alone, mislabelled "Left" by MediaPipe.
  const session = (arcade as { frames: RawFrame[] }).frames;

  it("never jumps a hand across the scene, though the tracker mislabels hands", () => {
    let swaps = 0;
    const p = new HandProcessor(undefined, undefined, () => swaps++);
    const swappedAt = new Set<number>();
    const frames = session.map((f, i) => {
      const before = swaps;
      const out = p.process(f);
      if (swaps !== before) swappedAt.add(i);
      return out;
    });
    // the lone mislabelled hand is relabelled once, when the other hand comes in (state moves with it)
    expect(swaps).toBe(1);
    const other = (h: Handedness): Handedness => (h === "Left" ? "Right" : "Left");
    for (const h of ["Left", "Right"] as Handedness[]) {
      for (let i = 1; i < frames.length; i++) {
        // follow the physical hand: across a relabel it carries on under the other label
        const a = frames[i - 1][swappedAt.has(i) ? other(h) : h];
        const b = frames[i][h];
        // fast throws move the palm ~15 cm a frame; a swap moved it ~40 cm sideways
        if (a && b) expect(Math.abs(a.palm.x - b.palm.x)).toBeLessThan(0.2);
      }
    }
  });

  it("puts the right hand on the right once both hands are in view", () => {
    const p = new HandProcessor();
    const frames = session.map((f) => p.process(f));
    const both = frames.filter((f) => f.Left && f.Right && !f.Left.lost && !f.Right.lost);
    const wrongSide = both.filter((f) => f.Right!.palm.x < f.Left!.palm.x).length;
    expect(wrongSide / both.length).toBeLessThan(0.01);
  });
});

describe("smoothing presets", () => {
  it("switches settings by name, ignores unknown names, and goes back to today's", () => {
    const today = structuredClone(SMOOTHING);
    expect(applySmoothingPreset("nope")).toBe(false);
    expect(SMOOTHING).toEqual(today);
    expect(applySmoothingPreset("F")).toBe(true);
    expect(SMOOTHING.anchor.beta).toBe(25);
    expect(SMOOTHING.image).toEqual(today.image);
    expect(applySmoothingPreset("today")).toBe(true);
    expect(SMOOTHING).toEqual(today);
  });
});
