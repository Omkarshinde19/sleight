/** MediaPipe hand landmark indices. */
export const LM = {
  WRIST: 0,
  THUMB_CMC: 1,
  THUMB_MCP: 2,
  THUMB_IP: 3,
  THUMB_TIP: 4,
  INDEX_MCP: 5,
  INDEX_PIP: 6,
  INDEX_DIP: 7,
  INDEX_TIP: 8,
  MIDDLE_MCP: 9,
  MIDDLE_PIP: 10,
  MIDDLE_DIP: 11,
  MIDDLE_TIP: 12,
  RING_MCP: 13,
  RING_PIP: 14,
  RING_DIP: 15,
  RING_TIP: 16,
  PINKY_MCP: 17,
  PINKY_PIP: 18,
  PINKY_DIP: 19,
  PINKY_TIP: 20,
} as const;

/** Joint chains from wrist to tip, used for drawing and for the robot hand's bones. */
export const FINGERS = [
  [LM.WRIST, LM.THUMB_CMC, LM.THUMB_MCP, LM.THUMB_IP, LM.THUMB_TIP],
  [LM.INDEX_MCP, LM.INDEX_PIP, LM.INDEX_DIP, LM.INDEX_TIP],
  [LM.MIDDLE_MCP, LM.MIDDLE_PIP, LM.MIDDLE_DIP, LM.MIDDLE_TIP],
  [LM.RING_MCP, LM.RING_PIP, LM.RING_DIP, LM.RING_TIP],
  [LM.PINKY_MCP, LM.PINKY_PIP, LM.PINKY_DIP, LM.PINKY_TIP],
] as const;

export const BONES: ReadonlyArray<readonly [number, number]> = [
  ...FINGERS.flatMap((chain) => chain.slice(1).map((j, i) => [chain[i], j] as const)),
  [LM.WRIST, LM.INDEX_MCP],
  [LM.INDEX_MCP, LM.MIDDLE_MCP],
  [LM.MIDDLE_MCP, LM.RING_MCP],
  [LM.RING_MCP, LM.PINKY_MCP],
  [LM.PINKY_MCP, LM.WRIST],
];

export interface Point {
  x: number;
  y: number;
  z: number;
}

/** The user's actual hand (already corrected for MediaPipe's selfie-mirror labelling). */
export type Handedness = "Left" | "Right";

export interface RawHand {
  handedness: Handedness;
  score: number;
  /** Normalised image coordinates, unmirrored camera frame (x right, y down). */
  landmarks: Point[];
  /** Metric (metres), origin near the hand centre, camera axes (x right, y down, z away from camera). */
  worldLandmarks: Point[];
}

export interface RawFrame {
  /** Milliseconds, monotonic within a session. */
  t: number;
  hands: RawHand[];
  /** Image aspect ratio (width / height) of the source frame. */
  aspect: number;
  /** Time the tracker spent on this frame, ms. */
  latencyMs?: number;
}

export type Gesture = "none" | "open" | "pinch" | "fist" | "point";

export const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const add = (a: Point, b: Point): Point => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const scale = (a: Point, s: number): Point => ({ x: a.x * s, y: a.y * s, z: a.z * s });
export const lerp = (a: Point, b: Point, t: number): Point => add(a, scale(sub(b, a), t));
export const len = (a: Point) => Math.hypot(a.x, a.y, a.z);
export const dist = (a: Point, b: Point) => len(sub(a, b));
export const dot = (a: Point, b: Point) => a.x * b.x + a.y * b.y + a.z * b.z;
export const cross = (a: Point, b: Point): Point => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
export const norm = (a: Point): Point => {
  const l = len(a) || 1;
  return scale(a, 1 / l);
};
export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const clamp01 = (v: number) => clamp(v, 0, 1);
