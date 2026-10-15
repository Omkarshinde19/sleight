import { add, LM, lerp, norm, scale, sub, type Gesture, type Handedness, type Point, type RawHand } from "./types";

/**
 * A parametric hand that produces the same 21 landmarks as MediaPipe (image + metric world).
 * Drives the simulated-hand mode and synthetic test fixtures, so both go through the real pipeline.
 */
export interface HandPose {
  /** 0 straight … 1 curled, thumb → pinky. */
  curl: [number, number, number, number, number];
  /** 0 … 1: thumb tip pulled onto the index tip. */
  pinch: number;
}

export const POSES: Record<Exclude<Gesture, "none">, HandPose> = {
  open: { curl: [0, 0, 0, 0, 0], pinch: 0 },
  pinch: { curl: [0.3, 0.38, 0.25, 0.25, 0.25], pinch: 1 },
  fist: { curl: [0.9, 1, 1, 1, 1], pinch: 0 },
  point: { curl: [0.8, 0, 1, 1, 1], pinch: 0 },
};

export const lerpPose = (a: HandPose, b: HandPose, t: number): HandPose => ({
  curl: a.curl.map((c, i) => c + (b.curl[i] - c) * t) as HandPose["curl"],
  pinch: a.pinch + (b.pinch - a.pinch) * t,
});

// Right hand, palm facing the camera, fingers up. Camera axes: x right, y down, z away from camera.
// Metres. Thumb sits on +x for a right hand seen from the front.
const MCP: Point[] = [
  { x: 0.024, y: -0.088, z: 0 },
  { x: 0.004, y: -0.094, z: 0 },
  { x: -0.016, y: -0.09, z: 0.002 },
  { x: -0.033, y: -0.079, z: 0.004 },
];
const SPLAY = [0.1, 0.0, -0.09, -0.2]; // radians from straight up
const PHALANX = [
  [0.042, 0.025, 0.022],
  [0.046, 0.028, 0.024],
  [0.043, 0.027, 0.023],
  [0.034, 0.021, 0.02],
];
const BEND = [1.35, 1.75, 1.15]; // max bend per joint, radians (MCP, PIP, DIP)
const TOWARD_CAMERA: Point = { x: 0, y: 0, z: -1 };

function finger(mcp: Point, splay: number, lengths: number[], curl: number): Point[] {
  const d0: Point = { x: Math.sin(splay), y: -Math.cos(splay), z: 0 };
  const pts = [mcp];
  let theta = 0;
  let p = mcp;
  for (let i = 0; i < 3; i++) {
    theta += curl * BEND[i];
    const d = add(scale(d0, Math.cos(theta)), scale(TOWARD_CAMERA, Math.sin(theta)));
    p = add(p, scale(d, lengths[i]));
    pts.push(p);
  }
  return pts;
}

/** Local landmarks (metres, camera axes, wrist at origin) for a right hand. */
export function localRightHand(pose: HandPose): Point[] {
  const out: Point[] = new Array(21);
  out[LM.WRIST] = { x: 0, y: 0, z: 0 };

  const fingers = MCP.map((m, i) => finger(m, SPLAY[i], PHALANX[i], pose.curl[i + 1]));
  fingers.forEach((pts, f) => pts.forEach((p, j) => (out[LM.INDEX_MCP + f * 4 + j] = p)));

  // Thumb: swings from out-and-up toward the palm as it curls.
  const cmc: Point = { x: 0.022, y: -0.026, z: -0.01 };
  const open = norm({ x: 0.5, y: -0.82, z: -0.28 });
  const across = norm({ x: -0.55, y: -0.45, z: -0.7 });
  const lengths = [0.032, 0.03, 0.026];
  let p = cmc;
  out[LM.THUMB_CMC] = cmc;
  for (let i = 0; i < 3; i++) {
    const d = norm(lerp(open, across, Math.min(1, pose.curl[0] * (0.6 + 0.3 * i))));
    p = add(p, scale(d, lengths[i]));
    out[LM.THUMB_MCP + i] = p;
  }

  if (pose.pinch > 0) {
    const target = add(out[LM.INDEX_TIP], { x: 0.006, y: 0.004, z: -0.004 });
    const mcp = out[LM.THUMB_MCP];
    const ipTarget = add(lerp(mcp, target, 0.55), { x: 0.012, y: 0, z: -0.012 });
    out[LM.THUMB_TIP] = lerp(out[LM.THUMB_TIP], target, pose.pinch);
    out[LM.THUMB_IP] = lerp(out[LM.THUMB_IP], ipTarget, pose.pinch);
  }
  return out;
}

export interface Orientation {
  /** Radians. Pitch tips fingers toward/away from the camera, yaw turns the palm, roll spins in-plane. */
  pitch: number;
  yaw: number;
  roll: number;
}

function rotate(p: Point, o: Orientation): Point {
  // roll about z, then pitch about x, then yaw about y
  let { x, y, z } = p;
  const [cr, sr] = [Math.cos(o.roll), Math.sin(o.roll)];
  [x, y] = [x * cr - y * sr, x * sr + y * cr];
  const [cp, sp] = [Math.cos(o.pitch), Math.sin(o.pitch)];
  [y, z] = [y * cp - z * sp, y * sp + z * cp];
  const [cy, sy] = [Math.cos(o.yaw), Math.sin(o.yaw)];
  [x, z] = [x * cy + z * sy, -x * sy + z * cy];
  return { x, y, z };
}

export interface SynthOptions {
  handedness: Handedness;
  pose: HandPose;
  orientation?: Orientation;
  /** Palm centre in normalised image coordinates (unmirrored camera frame). */
  imageX: number;
  imageY: number;
  /** Distance from the camera, metres. */
  distance: number;
  aspect?: number;
  /** Vertical field of view, radians. A MacBook FaceTime camera is roughly 0.9. */
  fovY?: number;
}

/** Build a RawHand exactly as the MediaPipe tracker would report it. */
export function synthHand(o: SynthOptions): RawHand {
  const aspect = o.aspect ?? 4 / 3;
  const f = 1 / (2 * Math.tan((o.fovY ?? 0.9) / 2));
  const orient = o.orientation ?? { pitch: 0, yaw: 0, roll: 0 };

  let local = localRightHand(o.pose);
  if (o.handedness === "Left") local = local.map((p) => ({ x: -p.x, y: p.y, z: p.z }));

  // Rotate about the palm centre, then centre the world landmarks there (as MediaPipe roughly does).
  const centre = lerp(local[LM.WRIST], local[LM.MIDDLE_MCP], 0.5);
  const world = local.map((p) => rotate(sub(p, centre), orient));

  const anchor: Point = {
    x: ((o.imageX - 0.5) * aspect * o.distance) / f,
    y: ((o.imageY - 0.5) * o.distance) / f,
    z: o.distance,
  };
  const wristZ = anchor.z + world[LM.WRIST].z;
  const landmarks = world.map((w) => {
    const c = add(anchor, w);
    return {
      x: 0.5 + (c.x / c.z) * (f / aspect),
      y: 0.5 + (c.y / c.z) * f,
      z: ((c.z - wristZ) * f) / (o.distance * aspect),
    };
  });

  return { handedness: o.handedness, score: 1, landmarks, worldLandmarks: world };
}
