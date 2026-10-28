import { INCISION, INCISION_NODES, MID_Z, skinHeight } from "./layout";

/** The operation, in order. */
export const STEPS = ["incision", "retraction", "resection", "anastomosis", "closure", "done"] as const;
export type Step = (typeof STEPS)[number];

export const STEP_TITLES: Record<Step, string> = {
  incision: "Midline laparotomy",
  retraction: "Retraction",
  resection: "Bowel resection",
  anastomosis: "Anastomosis",
  closure: "Wound closure",
  done: "Done",
};

export const STITCH_COUNT = 8;
export const STAPLE_COUNT = 10;
/** Share of the guide that must be cut before a layer opens fully. */
export const CUT_DONE = 0.9;

/** Samples along the incision guide, every 2.5 mm. */
export const GUIDE_SAMPLES = 65;
export const sampleX = (i: number) => INCISION.from + ((INCISION.to - INCISION.from) * i) / (GUIDE_SAMPLES - 1);
const NODE_STEP = (INCISION.to - INCISION.from) / (INCISION_NODES - 1);
export const nodeX = (k: number) => INCISION.from + k * NODE_STEP;

/** Tent weight of shape key Open_k at x (the keys sum to the whole cut). Same as tent() in build_patient.py. */
export const tent = (k: number, x: number) => Math.max(0, 1 - Math.abs(x - nodeX(k)) / NODE_STEP);

/** Marks the guide samples within `tolerance` (along x) of a cut at x. Returns whether any were new. */
export function markCut(covered: boolean[], x: number, tolerance = 0.004): boolean {
  let changed = false;
  for (let i = 0; i < GUIDE_SAMPLES; i++) {
    if (!covered[i] && Math.abs(sampleX(i) - x) <= tolerance) {
      covered[i] = true;
      changed = true;
    }
  }
  return changed;
}

export const coverageOf = (covered: boolean[]) => covered.filter(Boolean).length / GUIDE_SAMPLES;

/** How open each Open_k key should be: the tent-weighted share of its stretch that has been cut. */
export function nodeWeights(covered: boolean[]): number[] {
  return Array.from({ length: INCISION_NODES }, (_, k) => {
    let sum = 0;
    let cut = 0;
    for (let i = 0; i < GUIDE_SAMPLES; i++) {
      const w = tent(k, sampleX(i));
      sum += w;
      if (covered[i]) cut += w;
    }
    return sum ? cut / sum : 0;
  });
}

export type BladeContact = "cut" | "off" | "none";

/**
 * What a scalpel touching the patient does: "cut" when its edge is on the guide line (and, for a deeper
 * layer, at least `depth` under the skin's surface: only possible in the slit already cut), "off" when
 * it touches the skin anywhere else, "none" when it isn't touching. The guide is a hard limit: past its
 * ends or beside it, nothing is cut.
 */
export function bladeContact(p: { x: number; y: number; z: number }, touching: boolean, depth = -0.01, lateral = 0.006): BladeContact {
  if (!touching) return "none";
  const onLine = Math.abs(p.z - MID_Z) <= lateral && p.x >= INCISION.from - 0.002 && p.x <= INCISION.to + 0.002;
  if (onLine) return skinHeight(p.x, MID_Z) - p.y >= depth ? "cut" : "none";
  const onSkin = Math.abs(p.x) < 0.2 && Math.abs(p.z - MID_Z) < 0.16;
  return onSkin ? "off" : "none";
}

/**
 * How open the skin should stay as staples go in: each staple closes the cut around it (2 cm either
 * side, fading). All staples in closes it completely.
 */
export function closureWeights(staples: number[], all: boolean): number[] {
  return Array.from({ length: INCISION_NODES }, (_, k) => {
    if (all) return 0;
    const x = nodeX(k);
    const closed = staples.reduce((m, s) => Math.max(m, 1 - Math.abs(x - s) / 0.02), 0);
    return 1 - Math.max(0, closed);
  });
}

export interface Report {
  accuracyMm: number | null;
  strays: number;
  breaches: number;
  maxPenetrationMm: number;
  seconds: number;
}

/** 100 points, less for straying off the guides, touching the patient, cutting off the line, pushing in. */
export function score(r: Report): { score: number; grade: string } {
  let s = 100;
  s -= 3 * r.strays;
  s -= 8 * r.breaches;
  if (r.accuracyMm !== null) s -= Math.max(0, r.accuracyMm - 1) * 4;
  s -= Math.max(0, r.maxPenetrationMm - 2) * 2;
  const score = Math.max(0, Math.round(s));
  const grade = score >= 90 ? "A" : score >= 75 ? "B" : score >= 60 ? "C" : "D";
  return { score, grade };
}
