// MediaPipe hand tracking off the main thread, so detection (~11 ms a frame) never holds up drawing.
// A plain module worker, deliberately unbundled: bundlers boot workers as classic scripts, which can't
// run MediaPipe's ES module. Message types: src/lib/tracking/trackerProtocol.ts. The main thread turns
// results into hands (src/lib/tracking/landmarks.ts), so that logic lives in one place.
//
// Frames arrive as ImageBitmaps stamped with the camera's capture time, one at a time. GPU runs through
// OffscreenCanvas; after repeated GPU failures it reloads on the CPU.

import { FilesetResolver, HandLandmarker } from "/mediapipe/vision_bundle.mjs";

let landmarker = null;
let delegate = "GPU";
let numHands = 2;
let failures = 0;
let lastT = -Infinity;

async function load(prefer) {
  // the module build of the WASM loader: classic importScripts isn't available in module workers
  const fileset = await FilesetResolver.forVisionTasks("/mediapipe/wasm", true);
  const make = (d) =>
    HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: "/models/hand_landmarker.task", delegate: d },
      runningMode: "VIDEO",
      numHands,
      minHandDetectionConfidence: 0.5,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
  if (prefer === "GPU") {
    try {
      landmarker = await make("GPU");
      delegate = "GPU";
      return;
    } catch {
      // fall through to CPU
    }
  }
  landmarker = await make("CPU");
  delegate = "CPU";
}

const plain = (r) => ({
  landmarks: r.landmarks.map((hand) => hand.map(({ x, y, z }) => ({ x, y, z }))),
  worldLandmarks: r.worldLandmarks.map((hand) => hand.map(({ x, y, z }) => ({ x, y, z }))),
  handedness: r.handedness.map((cats) => cats.map(({ categoryName, score }) => ({ categoryName, score }))),
});
const EMPTY = { landmarks: [], worldLandmarks: [], handedness: [] };

self.onmessage = async (e) => {
  const msg = e.data;
  if (msg.type === "init") {
    numHands = msg.numHands;
    try {
      await load(msg.prefer);
      self.postMessage({ type: "ready", delegate });
    } catch (err) {
      self.postMessage({ type: "error", fatal: true, message: String(err?.message ?? err) });
    }
    return;
  }
  if (msg.type !== "frame") return;
  const { bitmap, t } = msg;
  const size = { width: bitmap.width, height: bitmap.height };
  try {
    if (!landmarker) throw new Error("tracker not loaded");
    // VIDEO mode needs strictly increasing timestamps
    const ts = Math.max(t, lastT + 0.001);
    lastT = ts;
    const t0 = performance.now();
    const result = plain(landmarker.detectForVideo(bitmap, ts));
    failures = 0;
    self.postMessage({ type: "result", t, result, detectMs: performance.now() - t0, ...size });
  } catch (err) {
    self.postMessage({ type: "result", t, result: EMPTY, detectMs: 0, ...size });
    // A GPU context that dies throws on every frame: fall back to the CPU once.
    if (++failures === 5) {
      if (delegate === "CPU") self.postMessage({ type: "error", fatal: true, message: String(err?.message ?? err) });
      else {
        landmarker?.close();
        landmarker = null;
        try {
          await load("CPU");
          self.postMessage({ type: "ready", delegate });
        } catch (e2) {
          self.postMessage({ type: "error", fatal: true, message: String(e2?.message ?? e2) });
        }
      }
    }
  } finally {
    bitmap.close();
  }
};
