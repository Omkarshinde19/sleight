import { clamp, LM, type Point } from "./types";

/** Where in a scene the hands can reach. Scene units are metres. */
export interface Workspace {
  center: Point;
  /** Full width / height covered when the hand crosses the whole camera frame. */
  width: number;
  height: number;
  /** Scene z travel per unit of relative depth (see DepthEstimator). */
  depthGain: number;
  /** Clamp on z offset from the centre. */
  depthRange: number;
  /** Size multiplier for the robot hand relative to the real hand. */
  handScale: number;
  /**
   * Fraction of the camera frame at each edge that lies outside the workspace (default EDGE): the
   * middle of the frame covers the whole workspace, so reaching its edges (the hoop) doesn't take the
   * hand out of the camera's view, where tracking drops out.
   */
  edge?: number;
  /**
   * Pitch the hand forward by this much (radians) about its palm: an upright hand facing the webcam
   * becomes a hand reaching down onto a table, palm down.
   */
  tilt?: number;
  /**
   * Motion scaling while holding something, like a surgical robot's: slow moves are scaled by `scale`
   * (fine control, and the tracker's jitter shrinks with them); moves at `fullSpeed` m/s or faster are not.
   */
  precision?: { scale: number; fullSpeed: number };
}

export const EDGE = 0.08;

export const DEFAULT_WORKSPACE: Workspace = {
  center: { x: 0, y: 1.1, z: 0 },
  width: 1.8,
  height: 1.2,
  depthGain: 1.6,
  depthRange: 0.7,
  handScale: 0.94,
};

/** Palm centre in image space: between the wrist and the middle-finger knuckle. */
export function palmCenter(points: Point[]): Point {
  const w = points[LM.WRIST];
  const m = points[LM.MIDDLE_MCP];
  return { x: (w.x + m.x) / 2, y: (w.y + m.y) / 2, z: (w.z + m.z) / 2 };
}

/**
 * Camera axes → scene axes for a first-person view. The webcam faces the user, so its x points to the
 * user's left and its z points toward the user. Scene: x right, y up, -z into the scene.
 * (x, y, z) → (-x, -y, z) is a rotation (det +1), so a right hand stays a right hand.
 */
export const cameraToScene = (p: Point): Point => ({ x: -p.x, y: -p.y, z: p.z });

/** Anchor of the hand in the scene, from the image palm centre and relative depth. */
export function anchorInScene(imagePalm: Point, relDepth: number, ws: Workspace): Point {
  const stretch = 1 / (1 - 2 * (ws.edge ?? EDGE));
  return {
    x: ws.center.x + (0.5 - imagePalm.x) * ws.width * stretch,
    y: ws.center.y + (0.5 - imagePalm.y) * ws.height * stretch,
    z: ws.center.z + clamp(relDepth * ws.depthGain, -ws.depthRange, ws.depthRange),
  };
}

/**
 * All 21 joints in scene space: the hand's shape comes from the metric world landmarks
 * (scaled up), placed so its palm centre sits on the anchor.
 */
export function jointsInScene(world: Point[], anchor: Point, ws: Workspace): Point[] {
  const c = palmCenter(world);
  // about scene x, fingers (+y) toward -z: into the scene, then down
  const cos = Math.cos(ws.tilt ?? 0);
  const sin = Math.sin(ws.tilt ?? 0);
  return world.map((p) => {
    const s = cameraToScene({ x: p.x - c.x, y: p.y - c.y, z: p.z - c.z });
    const y = s.y * cos + s.z * sin;
    const z = s.z * cos - s.y * sin;
    return {
      x: anchor.x + s.x * ws.handScale,
      y: anchor.y + y * ws.handScale,
      z: anchor.z + z * ws.handScale,
    };
  });
}
