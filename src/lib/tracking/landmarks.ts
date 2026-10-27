import type { HandLandmarkerResult } from "@mediapipe/tasks-vision";
import type { Handedness, RawHand } from "../hand/types";

/** MediaPipe's result as plain hands. Shared by the tracker worker and the main-thread fallback. */
export function toRawHands(result: Pick<HandLandmarkerResult, "landmarks" | "worldLandmarks" | "handedness">): RawHand[] {
  const hands: RawHand[] = result.landmarks.map((landmarks, i) => ({
    // Checked against a recorded (unmirrored) webcam clip: tasks-vision 1.x labels the user's
    // actual hand for unmirrored frames, despite older docs describing a selfie-mirror convention.
    handedness: (result.handedness[i]?.[0]?.categoryName === "Right" ? "Right" : "Left") as Handedness,
    score: result.handedness[i]?.[0]?.score ?? 0,
    landmarks: landmarks.map(({ x, y, z }) => ({ x, y, z })),
    worldLandmarks: (result.worldLandmarks[i] ?? []).map(({ x, y, z }) => ({ x, y, z })),
  }));
  return dedupeHandedness(hands);
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
