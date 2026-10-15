import { create } from "zustand";

export type AssistLevel = "off" | "fair" | "strong";
/** Fraction of the miss the assist removes. */
export const ASSIST_STRENGTH: Record<AssistLevel, number> = { off: 0, fair: 0.5, strong: 0.85 };

export interface ThrowRecord {
  speed: number;
  angleDeg: number;
  assisted: boolean;
  /** What the hand alone gave, before aim assist. */
  raw: { x: number; y: number; z: number };
  from: { x: number; y: number; z: number };
}

interface ArcadeState {
  score: number;
  streak: number;
  best: number;
  attempts: number;
  lastThrow: ThrowRecord | null;
  /** Flash message: "SWISH", "MISS"… */
  flash: { text: string; at: number } | null;
  assist: AssistLevel;
  scored: () => void;
  missed: () => void;
  threw: (t: ThrowRecord) => void;
  setAssist: (level: AssistLevel) => void;
  reset: () => void;
}

export const useArcade = create<ArcadeState>((set) => ({
  score: 0,
  streak: 0,
  best: 0,
  attempts: 0,
  lastThrow: null,
  flash: null,
  assist: "strong",
  scored: () =>
    set((s) => {
      const streak = s.streak + 1;
      return { score: s.score + 1, streak, best: Math.max(s.best, streak), flash: { text: streak >= 3 ? `${streak} IN A ROW` : "SCORE", at: performance.now() } };
    }),
  missed: () => set({ streak: 0, flash: { text: "MISS", at: performance.now() } }),
  threw: (t) => set((s) => ({ attempts: s.attempts + 1, lastThrow: t })),
  setAssist: (assist) => set({ assist }),
  reset: () => set({ score: 0, streak: 0, attempts: 0, lastThrow: null, flash: null }),
}));
