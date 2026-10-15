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
    // Ask for the camera and load the tracker in parallel.
    const [stream, landmarker] = await Promise.all([this.openCamera(), this.loadTracker()]);
    this.stream = stream;
    this.landmarker = landmarker;

    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    await video.play();
    this.video = video;
    this.running = true;

    let lastVideoTime = -1;
    const tick = () => {
      if (!this.running) return;
      if (video.readyState >= 2 && video.currentTime !== lastVideoTime) {
        lastVideoTime = video.currentTime;
        const t0 = performance.now();
        const result = landmarker.detectForVideo(video, t0);
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
      }
      this.schedule(tick);
    };
    this.schedule(tick);
  }

  private schedule(fn: () => void) {
    const v = this.video as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number };
    if (v?.requestVideoFrameCallback) this.frameHandle = v.requestVideoFrameCallback(fn);
    else this.frameHandle = requestAnimationFrame(fn);
  }

  private async openCamera() {
    if (!navigator.mediaDevices?.getUserMedia)
      throw new CameraError("This browser has no camera access (it needs HTTPS or localhost).", "unavailable");
    try {
      return await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } },
      });
    } catch (e) {
      const name = (e as DOMException)?.name;
      if (name === "NotAllowedError" || name === "SecurityError")
        throw new CameraError("Camera permission was declined.", "denied");
      throw new CameraError("No usable camera was found.", "unavailable");
    }
  }

  private async loadTracker() {
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
    try {
      const lm = await make("GPU");
      this.delegate = "GPU";
      return lm;
    } catch {
      try {
        const lm = await make("CPU");
        this.delegate = "CPU";
        return lm;
      } catch (e) {
        throw new CameraError(`The hand tracker failed to load: ${(e as Error).message}`, "tracker");
      }
    }
  }

  stop() {
    this.running = false;
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
