import { create } from "zustand";
import type { Handedness } from "@/lib/hand/types";
import type { TrackedHand } from "@/lib/tracking/processor";
import type { SourceKind } from "@/lib/tracking/source";

export type TrackerStatus = "idle" | "loading" | "running" | "denied" | "error";

export interface HandStore {
  source: SourceKind | null;
  status: TrackerStatus;
  error: string | null;
  delegate: "GPU" | "CPU" | null;
  /** Latest processed hands. Read with getState() inside useFrame; don't subscribe to it in React. */
  hands: Partial<Record<Handedness, TrackedHand>>;
  trackerFps: number;
  latencyMs: number;
  /** Name of what each hand is holding, if anything (set by the grab system). */
  holding: Partial<Record<Handedness, string | null>>;
  recording: boolean;
  calibrating: boolean;
  /** Counts Left/Right label exchanges, so per-hand state elsewhere (the grab system) can follow. */
  labelSwaps: number;
  debug: boolean;
  set: (patch: Partial<HandStore>) => void;
}

export const useHandStore = create<HandStore>((set) => ({
  source: null,
  status: "idle",
  error: null,
  delegate: null,
  hands: {},
  trackerFps: 0,
  latencyMs: 0,
  holding: {},
  recording: false,
  calibrating: false,
  labelSwaps: 0,
  debug: false,
  set: (patch) => set(patch),
}));

export const handStore = useHandStore;
