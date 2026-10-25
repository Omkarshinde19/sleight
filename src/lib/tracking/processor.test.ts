import { describe, expect, it } from "vitest";
import { FeelMeter } from "../hand/feel";
import type { Handedness, RawFrame } from "../hand/types";
import { COAST_MS, HandProcessor } from "./processor";
import demo from "../../../public/sessions/demo.json";

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
