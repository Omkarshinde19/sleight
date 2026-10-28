import type { HandLandmarkerResult } from "@mediapipe/tasks-vision";

/** Messages to the tracker worker (public/tracker-worker.js). */
export type TrackerRequest =
  /** `probe`: time both delegates on the first frames with a hand and keep the faster one. */
  | { type: "init"; numHands: number; prefer: "GPU" | "CPU"; probe: boolean }
  /** `t`: the camera's capture time, performance.now() clock, ms. The bitmap is transferred. */
  | { type: "frame"; bitmap: ImageBitmap; t: number };

/** Messages back from the tracker worker. */
export type TrackerReply =
  /** Sent once loaded and again whenever the delegate changes; `settled` once the probe is done. */
  | { type: "ready"; delegate: "GPU" | "CPU"; settled: boolean }
  /** `result`: MediaPipe's result as plain data (only the fields toRawHands reads). */
  | { type: "result"; t: number; result: Pick<HandLandmarkerResult, "landmarks" | "worldLandmarks" | "handedness">; detectMs: number; width: number; height: number }
  | { type: "error"; fatal: boolean; message: string };
