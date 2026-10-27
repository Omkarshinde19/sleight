import type { HandLandmarker } from "@mediapipe/tasks-vision";
import type { RawFrame } from "../hand/types";
import { toRawHands } from "./landmarks";
import type { TrackingSource } from "./source";
import type { TrackerReply, TrackerRequest } from "./trackerProtocol";

/** What requestVideoFrameCallback reports; captureTime is when the webcam took the frame. */
interface FrameMeta {
  captureTime?: number;
  mediaTime?: number;
}

export class CameraError extends Error {
  constructor(
    message: string,
    public reason: "denied" | "unavailable" | "tracker",
  ) {
    super(message);
  }
}

/**
 * Webcam + MediaPipe HandLandmarker, all in this tab. Frames are never uploaded anywhere.
 * Detection runs in a worker (public/tracker-worker.js) so it never holds up drawing; if the worker can't
 * start, it runs on the main thread as before. Frames are stamped with the camera's capture time.
 */
export class CameraSource implements TrackingSource {
  readonly kind = "camera";
  video?: HTMLVideoElement;
  delegate?: "GPU" | "CPU";
  /** Whether detection runs in the worker (false = main-thread fallback). */
  inWorker = false;
  private landmarker?: HandLandmarker;
  private worker?: Worker;
  private stream?: MediaStream;
  private running = false;
  /** stop() was called, possibly while start() was still loading. */
  private stopped = false;
  private frameHandle = 0;

  constructor(private numHands: number) {}

  async start(emit: (frame: RawFrame) => void) {
    // Ask for the camera and load the tracker in parallel. If either fails, release the other,
    // otherwise a half-started camera stays locked and the next attempt can't open it.
    const cam = this.openCamera();
    const tracker = this.startWorker(this.preferGpu ? "GPU" : "CPU").catch((e: Error) => {
      console.warn(`Hand tracker worker unavailable (${e.message}); tracking on the main thread.`);
      return this.loadTracker(this.preferGpu ? "GPU" : "CPU");
    });
    let stream: MediaStream;
    let backend: Worker | HandLandmarker;
    try {
      [stream, backend] = await Promise.all([cam, tracker]);
    } catch (e) {
      cam.then((s) => s.getTracks().forEach((t) => t.stop())).catch(() => {});
      tracker.then((b) => (b instanceof Worker ? b.terminate() : b.close())).catch(() => {});
      throw e;
    }
    if (this.stopped) {
      stream.getTracks().forEach((t) => t.stop());
      if (backend instanceof Worker) backend.terminate();
      else backend.close();
      return;
    }
    this.stream = stream;
    if (backend instanceof Worker) {
      this.worker = backend;
      this.inWorker = true;
    } else this.landmarker = backend;
    // Free the camera the moment this page goes away, so a refresh can reopen it straight away.
    window.addEventListener("pagehide", this.onPageHide);

    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.autoplay = true;
    video.srcObject = stream;
    try {
      await video.play();
    } catch {
      // Safari can refuse play() outside a gesture even for muted video; frames still arrive once
      // metadata is in, so wait for that instead of failing.
      await new Promise((r) => video.addEventListener("loadeddata", r, { once: true }));
    }
    this.video = video;
    this.running = true;
    stream.getVideoTracks()[0]?.addEventListener("ended", () => this.onError?.("The camera was disconnected."));

    let lastVideoTime = -1;
    let failures = 0;
    let busy = false;
    const aspect = () => video.videoWidth / video.videoHeight || 4 / 3;
    if (this.worker)
      this.worker.onmessage = (e: MessageEvent<TrackerReply>) => {
        const m = e.data;
        if (m.type === "result") {
          busy = false;
          if (this.running) emit({ t: m.t, hands: toRawHands(m.result), aspect: m.width / m.height || aspect(), latencyMs: m.detectMs });
        } else if (m.type === "ready") this.delegate = m.delegate;
        else if (m.fatal) this.onError?.(`The hand tracker stopped: ${m.message}`);
      };

    const tick = (now: number, meta?: FrameMeta) => {
      if (!this.running) return;
      const mediaTime = meta?.mediaTime ?? video.currentTime;
      if (video.readyState >= 2 && video.videoWidth > 0 && mediaTime !== lastVideoTime) {
        lastVideoTime = mediaTime;
        // when the webcam took the frame (same clock as performance.now); else when it reached us
        const t = meta?.captureTime ?? now;
        const worker = this.worker;
        if (worker) {
          // One frame in flight at a time: a late frame is skipped, never queued (queues add lag).
          if (!busy) {
            busy = true;
            createImageBitmap(video).then(
              (bitmap) => worker.postMessage({ type: "frame", bitmap, t } satisfies TrackerRequest, [bitmap]),
              () => (busy = false),
            );
          }
        } else {
          try {
            const t0 = performance.now();
            const hands = toRawHands(this.landmarker!.detectForVideo(video, t));
            failures = 0;
            emit({ t, hands, aspect: aspect(), latencyMs: performance.now() - t0 });
          } catch (e) {
            // A GPU context that dies after a reload throws on every frame: fall back to the CPU once.
            if (++failures === 5) void this.fallBackToCpu(e as Error);
          }
        }
      }
      this.schedule(tick);
    };
    this.schedule(tick);
  }

  /** Called when the camera fails after starting (unplugged, permission revoked, tracker dead). */
  onError?: (message: string) => void;
  /** Start on the CPU delegate (used after a GPU failure in this browser). */
  preferGpu = true;

  private onPageHide = () => this.stop();

  private async fallBackToCpu(e: Error) {
    if (this.delegate === "CPU") {
      this.onError?.(`The hand tracker stopped: ${e.message}`);
      return;
    }
    try {
      const cpu = await this.loadTracker("CPU");
      this.landmarker?.close();
      this.landmarker = cpu;
    } catch (err) {
      this.onError?.(`The hand tracker stopped: ${(err as Error).message}`);
    }
  }

  private schedule(fn: (now: number, meta?: FrameMeta) => void) {
    const v = this.video as HTMLVideoElement & { requestVideoFrameCallback?: (cb: (now: number, meta: FrameMeta) => void) => number };
    if (v?.requestVideoFrameCallback) this.frameHandle = v.requestVideoFrameCallback(fn);
    else this.frameHandle = requestAnimationFrame(fn);
  }

  private async openCamera() {
    if (!navigator.mediaDevices?.getUserMedia)
      throw new CameraError("This browser has no camera access (it needs HTTPS or localhost).", "unavailable");
    const constraints: MediaStreamConstraints = {
      audio: false,
      // 60 fps where the webcam can do it: twice the samples lets the filters smooth less for the same
      // steadiness. Cameras that can't just give their best (usually 30).
      video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 60 } },
    };
    // Right after a refresh the old page may still hold the camera for a moment ("could not start
    // video source"). That's worth a few quick retries; a denied permission is not.
    for (let attempt = 0; ; attempt++) {
      try {
        return await navigator.mediaDevices.getUserMedia(constraints);
      } catch (e) {
        const name = (e as DOMException)?.name;
        if (name === "NotAllowedError" || name === "SecurityError") throw new CameraError("Camera permission was declined.", "denied");
        const busy = name === "NotReadableError" || name === "AbortError" || name === "TrackStartError";
        if (busy && attempt < 4) {
          await new Promise((r) => setTimeout(r, 350 * (attempt + 1)));
          continue;
        }
        if (busy) throw new CameraError("The camera is busy — close other apps or tabs using it and try again.", "unavailable");
        throw new CameraError("No usable camera was found.", "unavailable");
      }
    }
  }

  /** Start the tracker worker; rejects if it can't load (then the main thread runs MediaPipe). */
  private startWorker(prefer: "GPU" | "CPU") {
    if (typeof Worker === "undefined" || typeof OffscreenCanvas === "undefined" || typeof createImageBitmap === "undefined")
      return Promise.reject(new Error("no worker support"));
    return new Promise<Worker>((resolve, reject) => {
      const worker = new Worker("/tracker-worker.js", { type: "module" });
      const fail = (message: string) => {
        worker.terminate();
        reject(new Error(message));
      };
      worker.onerror = (e) => fail(e.message || "worker failed to start");
      worker.onmessage = (e: MessageEvent<TrackerReply>) => {
        if (e.data.type === "ready") {
          this.delegate = e.data.delegate;
          worker.onerror = null;
          resolve(worker);
        } else if (e.data.type === "error") fail(e.data.message);
      };
      worker.postMessage({ type: "init", numHands: this.numHands, prefer } satisfies TrackerRequest);
    });
  }

  private async loadTracker(prefer: "GPU" | "CPU") {
    const { FilesetResolver, HandLandmarker } = await import("@mediapipe/tasks-vision");
    const fileset = await FilesetResolver.forVisionTasks("/mediapipe/wasm");
    const make = (delegate: "GPU" | "CPU") =>
      HandLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: "/models/hand_landmarker.task", delegate },
        runningMode: "VIDEO",
        numHands: this.numHands,
        minHandDetectionConfidence: 0.5,
        minHandPresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });
    if (prefer === "GPU") {
      try {
        const lm = await make("GPU");
        this.delegate = "GPU";
        return lm;
      } catch {
        // fall through to CPU
      }
    }
    try {
      const lm = await make("CPU");
      this.delegate = "CPU";
      return lm;
    } catch (e) {
      throw new CameraError(`The hand tracker failed to load: ${(e as Error).message}`, "tracker");
    }
  }

  stop() {
    this.stopped = true;
    this.running = false;
    window.removeEventListener("pagehide", this.onPageHide);
    const v = this.video as (HTMLVideoElement & { cancelVideoFrameCallback?: (h: number) => void }) | undefined;
    if (v?.cancelVideoFrameCallback) v.cancelVideoFrameCallback(this.frameHandle);
    cancelAnimationFrame(this.frameHandle);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.landmarker?.close();
    this.landmarker = undefined;
    this.worker?.terminate();
    this.worker = undefined;
    this.inWorker = false;
    this.video = undefined;
  }
}
