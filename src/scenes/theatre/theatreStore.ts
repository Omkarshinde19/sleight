import { create } from "zustand";

interface TheatreState {
  /** Share of the guide line the incision has covered, 0 … 1. */
  coverage: number;
  /** Mean distance of the cut from the guide line, mm. */
  accuracyMm: number | null;
  retrieved: number;
  /** Deepest current tool-into-anatomy overlap, mm (contact solver slop), and the session max. */
  penetrationMm: number;
  maxPenetrationMm: number;
  /** True while any tool is touching the patient. */
  contact: boolean;
  breach: boolean;
  breaches: number;
  set: (p: Partial<TheatreState>) => void;
  reset: () => void;
}

const initial = { coverage: 0, accuracyMm: null, retrieved: 0, penetrationMm: 0, maxPenetrationMm: 0, contact: false, breach: false, breaches: 0 };

export const useTheatre = create<TheatreState>((set) => ({
  ...initial,
  set: (p) => set(p),
  reset: () => set(initial),
}));
