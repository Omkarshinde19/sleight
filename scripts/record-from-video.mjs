// Runs the real tracker on a video file by feeding it to Chromium as a fake webcam, and saves the
// session as a Sleight recording (plus a 10 Hz gesture log). Needs `npm run dev` running.
//
//   ffmpeg -i clip.mov -vf scale=640:-2,fps=30 -an -q:v 4 clip.mjpeg
//   node scripts/record-from-video.mjs clip.mjpeg out/session.json 38
//
// Keep raw footage out of the repo: only landmark numbers are ever committed.
import { chromium } from "@playwright/test";
import { writeFileSync } from "node:fs";
const [clip, out, seconds = "8"] = process.argv.slice(2);
const browser = await chromium.launch({
  args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", `--use-file-for-fake-video-capture=${clip}`, "--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"],
});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, permissions: ["camera"], acceptDownloads: true });
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("pageerror:", e.message));
page.on("console", (m) => { if (m.type() === "error") console.log("console error:", m.text()); });
await page.goto("http://localhost:3000/lab?source=camera");
await page.waitForFunction(() => ["running","error","denied"].includes(window.__sleight?.store?.getState().status), null, { timeout: 60000 });
console.log("status:", await page.evaluate(() => { const s = window.__sleight.store.getState(); return [s.status, s.error, s.delegate]; }));
await page.evaluate(() => {
  window.__log = [];
  window.__sleight.api.toggleRecording();
  setInterval(() => { const s = window.__sleight.store.getState(); window.__log.push({ R: s.hands.Right?.gesture, L: s.hands.Left?.gesture, lat: s.latencyMs, fps: s.trackerFps }); }, 100);
});
const dl = page.waitForEvent("download", { timeout: Number(seconds) * 1000 + 30000 });
await page.waitForTimeout(Number(seconds) * 1000);
await page.screenshot({ path: out.replace(/\.json$/, ".png") });
await page.evaluate(() => window.__sleight.api.toggleRecording());
const d = await dl;
await d.saveAs(out);
const log = await page.evaluate(() => window.__log);
writeFileSync(out.replace(/\.json$/, ".log.json"), JSON.stringify(log));
const last = log[log.length - 1];
console.log("tracker fps", last.fps?.toFixed(1), "latency", last.lat?.toFixed(1));
await browser.close();
