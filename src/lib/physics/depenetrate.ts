import type { Point } from "../hand/types";

/**
 * Keeping the robot hand out of solid things.
 *
 * The hands are kinematic, so they used to go wherever the tracker put them: into the rack, through
 * the balls, under the table. Instead the whole hand (and anything it holds) is shifted, rigidly, by
 * the smallest move that takes every part of it out of the scene's solid shapes. Rigid, so the hand
 * keeps its shape; the real hand's position is still shown as a ghost.
 */
export type Obstacle =
  | { kind: "sphere"; c: Point; r: number }
  /** Axis-aligned box: centre and half extents. */
  | { kind: "box"; c: Point; h: Point }
  /** Horizontal ground at height y. */
  | { kind: "floor"; y: number };

/** A part of the hand: a sphere at p. */
export interface Probe {
  p: Point;
  r: number;
}

const ZERO: Point = { x: 0, y: 0, z: 0 };

/** How far (and which way) a probe at p must move to clear an obstacle; null if it's clear. */
export function penetration(p: Point, r: number, o: Obstacle): { dir: Point; depth: number } | null {
  if (o.kind === "floor") {
    const depth = o.y + r - p.y;
    return depth > 0 ? { dir: { x: 0, y: 1, z: 0 }, depth } : null;
  }
  if (o.kind === "sphere") {
    const d = { x: p.x - o.c.x, y: p.y - o.c.y, z: p.z - o.c.z };
    const l = Math.hypot(d.x, d.y, d.z);
    const depth = o.r + r - l;
    if (depth <= 0) return null;
    return { dir: l > 1e-9 ? { x: d.x / l, y: d.y / l, z: d.z / l } : { x: 0, y: 1, z: 0 }, depth };
  }
  const rel = { x: p.x - o.c.x, y: p.y - o.c.y, z: p.z - o.c.z };
  const q = { x: Math.max(-o.h.x, Math.min(o.h.x, rel.x)), y: Math.max(-o.h.y, Math.min(o.h.y, rel.y)), z: Math.max(-o.h.z, Math.min(o.h.z, rel.z)) };
  const d = { x: rel.x - q.x, y: rel.y - q.y, z: rel.z - q.z };
  const l = Math.hypot(d.x, d.y, d.z);
  if (l > 1e-9) {
    // outside the box: push away from the nearest point on it
    const depth = r - l;
    return depth > 0 ? { dir: { x: d.x / l, y: d.y / l, z: d.z / l }, depth } : null;
  }
  // inside: out through the nearest face
  const faces: [number, Point][] = [
    [o.h.x - rel.x, { x: 1, y: 0, z: 0 }],
    [o.h.x + rel.x, { x: -1, y: 0, z: 0 }],
    [o.h.y - rel.y, { x: 0, y: 1, z: 0 }],
    [o.h.y + rel.y, { x: 0, y: -1, z: 0 }],
    [o.h.z - rel.z, { x: 0, y: 0, z: 1 }],
    [o.h.z + rel.z, { x: 0, y: 0, z: -1 }],
  ];
  const [gap, dir] = faces.reduce((a, b) => (b[0] < a[0] ? b : a));
  return { dir, depth: gap + r };
}

/**
 * The rigid offset that takes all probes out of all obstacles: repeatedly move out of the deepest
 * overlap. A few passes settle corners (a hand pressed into a ball resting on a shelf).
 */
export function pushOut(probes: Probe[], obstacles: Obstacle[], passes = 6): Point {
  const off = { ...ZERO };
  if (!obstacles.length) return off;
  for (let i = 0; i < passes; i++) {
    let best: { dir: Point; depth: number } | null = null;
    for (const pr of probes) {
      const p = { x: pr.p.x + off.x, y: pr.p.y + off.y, z: pr.p.z + off.z };
      for (const o of obstacles) {
        const pen = penetration(p, pr.r, o);
        if (pen && (!best || pen.depth > best.depth)) best = pen;
      }
    }
    if (!best || best.depth < 1e-5) break;
    off.x += best.dir.x * best.depth;
    off.y += best.dir.y * best.depth;
    off.z += best.dir.z * best.depth;
  }
  return off;
}
