import type { HandLandmarkerResult } from "@mediapipe/tasks-vision";

/** Messages to the tracker worker (public/tracker-worker.js). */
export type TrackerRequest =
  | { type: "init"; numHands: number; prefer: "GPU" | "CPU" }
  /** `t`: the camera's capture time, performance.now() clock, ms. The bitmap is transferred. */
  | { type: "frame"; bitmap: ImageBitmap; t: number };

/** Messages back from the tracker worker. */
export type TrackerReply =
  | { type: "ready"; delegate: "GPU" | "CPU" }
  /** `result`: MediaPipe's result as plain data (only the fields toRawHands reads). */
  | { type: "result"; t: number; result: Pick<HandLandmarkerResult, "landmarks" | "worldLandmarks" | "handedness">; detectMs: number; width: number; height: number }
  | { type: "error"; fatal: boolean; message: string };
