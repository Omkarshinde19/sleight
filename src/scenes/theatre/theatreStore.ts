import { create } from "zustand";
import { GUIDE_SAMPLES, STAPLE_COUNT, STEPS, type Step } from "./procedure";

export type Layer = "skin" | "fascia";
export type Specimen = "inside" | "held" | "dish";

interface TheatreState {
  step: Step;
  /** Incision: which layer the scalpel is opening, and the guide samples cut in each. */
  layer: Layer;
  skinCut: boolean[];
  fasciaCut: boolean[];
  skinCoverage: number;
  fasciaCoverage: number;
  /** Mean distance of the blade from the guide line while cutting, mm (null before the first cut). */
  accuracyMm: number | null;
  /** Retraction: the Balfour is seated and the wound held open. */
  retracted: boolean;
  /** Resection: both ends of the dead segment cut, and where the specimen is. */
  rings: { proximal: boolean; distal: boolean };
  specimen: Specimen;
  /** Anastomosis: stitches placed, in order. */
  stitches: number;
  /** Closure: which staple marks have a staple. */
  staples: boolean[];
  /** Attempts off the guides: cutting beside the line, closing scissors away from a ring, … */
  strays: number;
  /** A short, current instruction or warning for the HUD. */
  notice: string | null;
  /** Deepest current tool-into-anatomy overlap, mm (contact solver slop), and the session max. */
  penetrationMm: number;
  maxPenetrationMm: number;
  /** True while any tool is touching the patient. */
  contact: boolean;
  breach: boolean;
  breaches: number;
  startedAt: number;
  finishedAt: number | null;
  /** Bumped by goto() so the scene resets what it drew for a step (tests and "restart"). */
  epoch: number;
  set: (p: Partial<TheatreState>) => void;
  /** Start over, or jump to the start of a step with everything before it done (tests, practice). */
  goto: (step: Step) => void;
}

const fresh = () => ({
  step: "incision" as Step,
  layer: "skin" as Layer,
  skinCut: Array<boolean>(GUIDE_SAMPLES).fill(false),
  fasciaCut: Array<boolean>(GUIDE_SAMPLES).fill(false),
  skinCoverage: 0,
  fasciaCoverage: 0,
  accuracyMm: null,
  retracted: false,
  rings: { proximal: false, distal: false },
  specimen: "inside" as Specimen,
  stitches: 0,
  staples: Array<boolean>(STAPLE_COUNT).fill(false),
  strays: 0,
  notice: null,
  penetrationMm: 0,
  maxPenetrationMm: 0,
  contact: false,
  breach: false,
  breaches: 0,
  startedAt: typeof performance !== "undefined" ? performance.now() : 0,
  finishedAt: null,
});

export const useTheatre = create<TheatreState>((set, get) => ({
  ...fresh(),
  epoch: 0,
  set: (p) => set(p),
  goto: (step) => {
    const s = fresh();
    const at = STEPS.indexOf(step);
    const past = (k: Step) => at > STEPS.indexOf(k);
    if (past("incision")) {
      s.skinCut.fill(true);
      s.fasciaCut.fill(true);
      s.skinCoverage = s.fasciaCoverage = 1;
      s.layer = "fascia";
    }
    if (past("retraction")) s.retracted = true;
    if (past("resection")) {
      s.rings = { proximal: true, distal: true };
      s.specimen = "dish";
    }
    if (past("anastomosis")) s.stitches = 8;
    if (past("closure")) s.staples.fill(true);
    // the retractor comes out when closure starts
    if (step === "closure" || step === "done") s.retracted = false;
    set({ ...s, step, epoch: get().epoch + 1 });
  },
}));
