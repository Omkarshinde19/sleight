import { create } from "zustand";

interface IndustrialState {
  seated: boolean;
  /** Live chip-to-socket alignment while the chip is near the socket. */
  alignment: { dx: number; dz: number; yawDeg: number; tiltDeg: number } | null;
  /** 0 … 1 for each lever. */
  levers: [number, number];
  parts: number;
  seat: () => void;
  setAlignment: (a: IndustrialState["alignment"]) => void;
  setLever: (i: 0 | 1, v: number) => void;
  stamped: () => void;
  reset: () => void;
}

export const useIndustrial = create<IndustrialState>((set) => ({
  seated: false,
  alignment: null,
  levers: [0, 0],
  parts: 0,
  seat: () => set({ seated: true, alignment: null }),
  setAlignment: (alignment) => set({ alignment }),
  setLever: (i, v) => set((s) => {
    if (Math.abs(s.levers[i] - v) < 0.005) return s;
    const levers = [...s.levers] as [number, number];
    levers[i] = v;
    return { levers };
  }),
  stamped: () => set((s) => ({ parts: s.parts + 1 })),
  reset: () => set({ seated: false, alignment: null, levers: [0, 0], parts: 0 }),
}));
