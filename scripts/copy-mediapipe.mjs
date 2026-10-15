// Copies MediaPipe's WASM runtime into public/ so the tracker is served from our own origin.
// No CDN request means webcam processing never depends on (or talks to) a third party.
import { cpSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const from = join(root, "node_modules/@mediapipe/tasks-vision/wasm");
const to = join(root, "public/mediapipe/wasm");
mkdirSync(to, { recursive: true });
cpSync(from, to, { recursive: true });
console.log("copied MediaPipe WASM → public/mediapipe/wasm");
