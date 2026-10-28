// MediaPipe hand tracking off the main thread, so detection never holds up drawing.
// A plain module worker, deliberately unbundled: bundlers boot workers as classic scripts, which can't
// run MediaPipe's ES module. Message types: src/lib/tracking/trackerProtocol.ts. The main thread turns
// results into hands (src/lib/tracking/landmarks.ts), so that logic lives in one place.
//
// Frames arrive as ImageBitmaps stamped with the camera's capture time, one at a time. GPU runs through
// OffscreenCanvas; after repeated GPU failures it reloads on the CPU.
//
// Which delegate is faster depends on the machine and on the scene: the GPU delegate shares the GPU with
// the 3D scene, and in a heavy scene it measured 45-70 ms a frame (11-19 fps) on an M-series MacBook.
// So with `probe`, the worker times both delegates on real frames with a hand in them and keeps the
// faster one.

import { FilesetResolver, HandLandmarker } from "/mediapipe/vision_bundle.mjs";

let landmarker = null;
let delegate = "GPU";
let numHands = 2;
let failures = 0;
let lastT = -Infinity;
/** Delegate probe: timings per delegate on frames with a hand, the other landmarker while it's timed. */
let probe = null;
/** Frames with a hand to skip (warm-up: shader compiles, first allocations), then frames to time. */
const PROBE_SKIP = 8;
const PROBE_FRAMES = 20;

let fileset = null;
const make = async (d) => {
  // the module build of the WASM loader: classic importScripts isn't available in module workers
  fileset ??= await FilesetResolver.forVisionTasks("/mediapipe/wasm", true);
  // MediaPipe clears self.ModuleFactory once a landmarker is built, and the ES-module loader that sets
  // it only runs on its first import: put it back for a second landmarker ("ModuleFactory not set").
  self.ModuleFactory ??= (await import(fileset.wasmLoaderPath)).default;
  return HandLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: "/models/hand_landmarker.task", delegate: d },
    runningMode: "VIDEO",
    numHands,
    // Low tracking confidence keeps a fast, blurred hand tracked from the last frame instead of
    // dropping it and re-running the palm detector (which is also the slow part).
    minHandDetectionConfidence: 0.5,
    minHandPresenceConfidence: 0.4,
    minTrackingConfidence: 0.3,
  });
};

async function load(prefer) {
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
      if (msg.probe) probe = { times: { GPU: [], CPU: [] }, skip: PROBE_SKIP, other: null, loading: false };
      self.postMessage({ type: "ready", delegate, settled: !probe });
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
    const detectMs = performance.now() - t0;
    failures = 0;
    self.postMessage({ type: "result", t, result, detectMs, ...size });
    if (probe && result.landmarks.length) timeDelegate(detectMs);
  } catch (err) {
    self.postMessage({ type: "result", t, result: EMPTY, detectMs: 0, ...size });
    // A GPU context that dies throws on every frame: fall back to the CPU once.
    if (++failures === 5) {
      if (delegate === "CPU") self.postMessage({ type: "error", fatal: true, message: String(err?.message ?? err) });
      else {
        probe?.other?.close();
        probe = null;
        landmarker?.close();
        landmarker = null;
        try {
          await load("CPU");
          self.postMessage({ type: "ready", delegate, settled: true });
        } catch (e2) {
          self.postMessage({ type: "error", fatal: true, message: String(e2?.message ?? e2) });
        }
      }
    }
  } finally {
    bitmap.close();
  }
};

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

/** Record a timing for the running delegate; once both are timed, keep the faster one. */
function timeDelegate(ms) {
  if (probe.skip > 0) {
    probe.skip--;
    return;
  }
  const times = probe.times[delegate];
  times.push(ms);
  if (times.length < PROBE_FRAMES) return;
  const other = delegate === "GPU" ? "CPU" : "GPU";
  if (probe.times[other].length >= PROBE_FRAMES) {
    // Both timed: we're on the second one. Go back to the first if it was clearly faster.
    const keepOther = median(probe.times[other]) < median(times) * 0.9;
    if (keepOther && probe.other) {
      landmarker.close();
      landmarker = probe.other;
      delegate = other;
    } else probe.other?.close();
    probe = null;
    self.postMessage({ type: "ready", delegate, settled: true });
    return;
  }
  if (probe.loading) return;
  // Load the other delegate without holding up frames, then swap to it and time it.
  probe.loading = true;
  make(other).then(
    (lm) => {
      if (!probe) return lm.close();
      probe.other = landmarker;
      landmarker = lm;
      delegate = other;
      probe.skip = PROBE_SKIP;
      self.postMessage({ type: "ready", delegate, settled: false });
    },
    () => {
      // the other delegate can't run here: keep this one
      probe = null;
      self.postMessage({ type: "ready", delegate, settled: true });
    },
  );
}
