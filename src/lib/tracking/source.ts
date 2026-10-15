import type { RawFrame } from "../hand/types";

export type SourceKind = "camera" | "sim" | "playback";

/** Anything that produces hand frames: the webcam tracker, the simulated hand, a recording. */
export interface TrackingSource {
  readonly kind: SourceKind;
  start(emit: (frame: RawFrame) => void): Promise<void>;
  stop(): void;
  /** Camera only: the live video element, for the debug inset. */
  video?: HTMLVideoElement;
  /** Camera only: which MediaPipe delegate is running. */
  delegate?: "GPU" | "CPU";
}

export interface Recording {
  version: 1;
  aspect: number;
  recordedAt: string;
  frames: RawFrame[];
}
