import type { Point } from "../hand/types";

const G = 9.81;

/**
 * Launch velocity that sends a projectile from `from` through `to` at the given speed, taking the
 * higher (lobbed) arc, which is what drops cleanly through a hoop. Null if the speed can't reach.
 */
export function ballisticVelocity(from: Point, to: Point, speed: number, g = G): Point | null {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const d = Math.hypot(dx, dz);
  const h = to.y - from.y;
  if (d < 1e-6) return null;
  const s2 = speed * speed;
  const disc = s2 * s2 - g * (g * d * d + 2 * h * s2);
  if (disc < 0) return null;
  const tan = (s2 + Math.sqrt(disc)) / (g * d);
  const angle = Math.atan(tan);
  const horizontal = speed * Math.cos(angle);
  return { x: (dx / d) * horizontal, y: speed * Math.sin(angle), z: (dz / d) * horizontal };
}

export interface AssistOptions {
  /** 0 = untouched throw, 1 = perfect throw. */
  strength: number;
  /** Only help throws already within this many degrees of the target (horizontally). */
  maxAngleDeg: number;
  /** Throws slower than this are left alone (it's a drop, not a throw). */
  minSpeed: number;
  /** Lift flatter throws to at least this launch angle, degrees. */
  minArcDeg: number;
}

export const DEFAULT_ASSIST: AssistOptions = { strength: 0.5, maxAngleDeg: 35, minSpeed: 2.5, minArcDeg: 58 };

/**
 * Nudges a throw toward the ideal one. Keeps the player's direction mostly theirs and only helps
 * throws that were roughly aimed, so missing is still possible.
 */
export function assistThrow(v: Point, from: Point, target: Point, opts: AssistOptions = DEFAULT_ASSIST): Point {
  const speed = Math.hypot(v.x, v.y, v.z);
  if (speed < opts.minSpeed || opts.strength <= 0) return v;

  const toT = { x: target.x - from.x, z: target.z - from.z };
  const hv = Math.hypot(v.x, v.z);
  const ht = Math.hypot(toT.x, toT.z);
  if (hv < 1e-6 || ht < 1e-6) return v;
  const cos = (v.x * toT.x + v.z * toT.z) / (hv * ht);
  if (Math.acos(Math.max(-1, Math.min(1, cos))) > (opts.maxAngleDeg * Math.PI) / 180) return v;

  // Blend outcomes, not vectors: where would this throw be when it reaches the hoop's distance?
  // Aim `strength` of the way from there to the rim, at a launch angle blended the same way.
  // Flat throws clip the front of the rim even when "on target", so the ideal arc has a floor.
  const k = opts.strength;
  const along = hv * cos; // horizontal speed toward the target
  const rawAt = projectile(from, v, ht / along);
  const aim = { x: rawAt.x + (target.x - rawAt.x) * k, y: rawAt.y + (target.y - rawAt.y) * k, z: rawAt.z + (target.z - rawAt.z) * k };
  const angle = Math.atan2(v.y, hv);
  const floor = Math.max(minAngle(from, target) + 0.17, (opts.minArcDeg * Math.PI) / 180);
  const idealAngle = Math.min(Math.max(angle, floor), 1.25);
  return velocityForAngle(from, aim, angle + (idealAngle - angle) * k) ?? v;
}

/** Launch velocity at a given elevation angle (radians) that passes through the target. */
export function velocityForAngle(from: Point, to: Point, angle: number, g = G): Point | null {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const d = Math.hypot(dx, dz);
  const h = to.y - from.y;
  const c = Math.cos(angle);
  const denom = 2 * c * c * (d * Math.tan(angle) - h);
  if (d < 1e-6 || denom <= 0) return null;
  const speed = Math.sqrt((g * d * d) / denom);
  return { x: (dx / d) * speed * c, y: speed * Math.sin(angle), z: (dz / d) * speed * c };
}

/** Elevation of the straight line to the target: any useful throw must launch above it. */
export const minAngle = (from: Point, to: Point) => Math.atan2(to.y - from.y, Math.hypot(to.x - from.x, to.z - from.z));

/** Smallest launch speed that can reach the target at all. */
export function minimumSpeed(from: Point, to: Point, g = G): number {
  const d = Math.hypot(to.x - from.x, to.z - from.z);
  const h = to.y - from.y;
  return Math.sqrt(g * (h + Math.hypot(d, h)));
}

/** Where a projectile is after t seconds (no drag). */
export const projectile = (p: Point, v: Point, t: number, g = G): Point => ({
  x: p.x + v.x * t,
  y: p.y + v.y * t - 0.5 * g * t * t,
  z: p.z + v.z * t,
});
