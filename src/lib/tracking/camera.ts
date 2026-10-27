import type { HandLandmarker } from "@mediapipe/tasks-vision";
import type { Handedness, RawFrame, RawHand } from "../hand/types";
import type { TrackingSource } from "./source";

export class CameraError extends Error {
  constructor(
    message: string,
    public reason: "denied" | "unavailable" | "tracker",
  ) {
    super(message);
  }
}

/** Webcam + MediaPipe HandLandmarker, all in this tab. Frames are never uploaded anywhere. */
export class CameraSource implements TrackingSource {
  readonly kind = "camera";
  video?: HTMLVideoElement;
  delegate?: "GPU" | "CPU";
  private landmarker?: HandLandmarker;
  private stream?: MediaStream;
  private running = false;
  private frameHandle = 0;

  constructor(private numHands: number) {}

  async start(emit: (frame: RawFrame) => void) {
    // Ask for the camera and load the tracker in parallel. If either fails, release the other,
    // otherwise a half-started camera stays locked and the next attempt can't open it.
    const cam = this.openCamera();
    const tracker = this.loadTracker(this.preferGpu ? "GPU" : "CPU");
    let stream: MediaStream;
    let landmarker: HandLandmarker;
    try {
      [stream, landmarker] = await Promise.all([cam, tracker]);
    } catch (e) {
      cam.then((s) => s.getTracks().forEach((t) => t.stop())).catch(() => {});
      tracker.then((l) => l.close()).catch(() => {});
      throw e;
    }
    this.stream = stream;
    this.landmarker = landmarker;
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
    const tick = () => {
      if (!this.running) return;
      if (video.readyState >= 2 && video.videoWidth > 0 && video.currentTime !== lastVideoTime) {
        lastVideoTime = video.currentTime;
        const t0 = performance.now();
        try {
          const result = this.landmarker!.detectForVideo(video, t0);
          failures = 0;
          const hands: RawHand[] = result.landmarks.map((landmarks, i) => ({
            // Checked against a recorded (unmirrored) webcam clip: tasks-vision 1.x labels the user's
            // actual hand for unmirrored frames, despite older docs describing a selfie-mirror convention.
            handedness: (result.handedness[i]?.[0]?.categoryName === "Right" ? "Right" : "Left") as Handedness,
            score: result.handedness[i]?.[0]?.score ?? 0,
            landmarks: landmarks.map(({ x, y, z }) => ({ x, y, z })),
            worldLandmarks: (result.worldLandmarks[i] ?? []).map(({ x, y, z }) => ({ x, y, z })),
          }));
          emit({
            t: t0,
            hands: dedupeHandedness(hands),
            aspect: video.videoWidth / video.videoHeight || 4 / 3,
            latencyMs: performance.now() - t0,
          });
        } catch (e) {
          // A GPU context that dies after a reload throws on every frame: fall back to the CPU once.
          if (++failures === 5) void this.fallBackToCpu(e as Error);
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

  private schedule(fn: () => void) {
    const v = this.video as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number };
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
    this.running = false;
    window.removeEventListener("pagehide", this.onPageHide);
    const v = this.video as (HTMLVideoElement & { cancelVideoFrameCallback?: (h: number) => void }) | undefined;
    if (v?.cancelVideoFrameCallback) v.cancelVideoFrameCallback(this.frameHandle);
    cancelAnimationFrame(this.frameHandle);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.landmarker?.close();
    this.landmarker = undefined;
    this.video = undefined;
  }
}

/** Two detections can occasionally get the same label; keep the more confident one. */
function dedupeHandedness(hands: RawHand[]): RawHand[] {
  if (hands.length < 2 || hands[0].handedness !== hands[1].handedness) return hands;
  const [a, b] = hands;
  // Same label: the unmirrored frame shows the user's right hand on the image's left.
  const ax = a.landmarks[0].x;
  const bx = b.landmarks[0].x;
  return [
    { ...a, handedness: ax < bx ? "Right" : "Left" },
    { ...b, handedness: ax < bx ? "Left" : "Right" },
  ];
}
