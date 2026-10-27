// Copies MediaPipe's WASM runtime into public/ so the tracker is served from our own origin.
// No CDN request means webcam processing never depends on (or talks to) a third party.
// The ES-module bundle goes too: public/tracker-worker.js imports it unbundled (bundlers boot
// workers as classic scripts, which can't run MediaPipe's `import.meta`).
import { copyFileSync, cpSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const from = join(root, "node_modules/@mediapipe/tasks-vision/wasm");
const to = join(root, "public/mediapipe/wasm");
mkdirSync(to, { recursive: true });
cpSync(from, to, { recursive: true });
copyFileSync(join(root, "node_modules/@mediapipe/tasks-vision/vision_bundle.mjs"), join(root, "public/mediapipe/vision_bundle.mjs"));
console.log("copied MediaPipe WASM and bundle → public/mediapipe");
