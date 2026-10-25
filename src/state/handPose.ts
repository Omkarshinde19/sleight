import { PoseInterpolator, type PoseSnapshot } from "@/lib/hand/interpolate";
import type { Handedness, Point } from "@/lib/hand/types";
import { wrapAround } from "@/lib/hand/wrap";
import { pushOut, type Obstacle, type Probe } from "@/lib/physics/depenetrate";
import type { TrackedHand } from "@/lib/tracking/processor";
import { heldSpheres, obstacles } from "./obstacles";

/**
 * Render-time hand poses, shared by the robot hand mesh and the physics colliders so they never
 * disagree. The tracking provider pushes every processed frame; consumers sample at their own time.
 * Inactive (e.g. on the landing page, which writes poses straight into the hand store) → consumers
 * fall back to the store's joints.
 *
 * A sampled pose is also kept out of the scene's solid shapes (the whole hand shifts, rigidly) and
 * its fingers wrap round a held ball. `real` is where the tracked hand actually is, for the ghost.
 */
export interface HandPoseSample extends PoseSnapshot {
  /** The tracked joints before the push-out. */
  real: Point[];
  /** How far the hand was moved out of solid things. */
  push: Point;
}

/** Real-hand radii (metres) of the parts kept out of things, scaled like the hand. */
const PALM_R = 0.034;
const JOINT_R = 0.009;
/** When the hand no longer needs pushing, it eases back to the tracked position with this time constant (ms). */
const RELAX_TAU = 60;

const interpolators: Record<Handedness, PoseInterpolator> = { Left: new PoseInterpolator(), Right: new PoseInterpolator() };
const cache: Record<Handedness, { t: number; pose: HandPoseSample | null }> = { Left: { t: -1, pose: null }, Right: { t: -1, pose: null } };
const pushed: Record<Handedness, { off: Point; t: number }> = { Left: { off: { x: 0, y: 0, z: 0 }, t: -1 }, Right: { off: { x: 0, y: 0, z: 0 }, t: -1 } };

const len = (p: Point) => Math.hypot(p.x, p.y, p.z);
const shift = (p: Point, o: Point): Point => ({ x: p.x + o.x, y: p.y + o.y, z: p.z + o.z });

function settle(hand: Handedness, raw: PoseSnapshot, tMs: number, scale: number): HandPoseSample {
  const held = heldSpheres[hand]?.() ?? null;
  const solid: Obstacle[] = [];
  for (const get of obstacles.values()) {
    const o = get();
    if (o) solid.push(o);
  }
  const probes: Probe[] = [{ p: raw.palm, r: PALM_R * scale }, ...raw.joints.map((p) => ({ p, r: JOINT_R * scale }))];
  // a held ball moves with the hand (it's already where the pushed hand put it last step)
  const st = pushed[hand];
  if (held) probes.push({ p: { x: held.c.x - st.off.x, y: held.c.y - st.off.y, z: held.c.z - st.off.z }, r: held.r });
  const target = pushOut(probes, solid);

  // Push out at once (never show the hand inside something); ease back once it's clear.
  if (st.t < 0 || len(target) >= len(st.off)) st.off = target;
  else {
    const k = 1 - Math.exp(-Math.max(0, tMs - st.t) / RELAX_TAU);
    st.off = { x: st.off.x + (target.x - st.off.x) * k, y: st.off.y + (target.y - st.off.y) * k, z: st.off.z + (target.z - st.off.z) * k };
  }
  st.t = tMs;

  let joints = raw.joints.map((p) => shift(p, st.off));
  if (held) joints = wrapAround(joints, held.c, held.r, JOINT_R * scale);
  return { joints, palm: shift(raw.palm, st.off), grip: shift(raw.grip, st.off), real: raw.joints, push: { ...st.off } };
}

export const handPose = {
  active: false,
  /** Robot hand size relative to the real hand (the workspace's handScale). */
  handScale: 1.5,

  push(hands: Partial<Record<Handedness, TrackedHand>>, tMs: number) {
    this.active = true;
    for (const h of ["Left", "Right"] as Handedness[]) {
      const hand = hands[h];
      if (hand) interpolators[h].push(hand, tMs);
      else {
        interpolators[h].reset();
        pushed[h] = { off: { x: 0, y: 0, z: 0 }, t: -1 };
      }
      cache[h].t = -1;
    }
  },

  /** Interpolated, settled pose for `hand` at `tMs` (performance.now() time), or null. */
  sample(hand: Handedness, tMs: number = performance.now()): HandPoseSample | null {
    if (!this.active) return null;
    const c = cache[hand];
    if (c.t !== tMs) {
      const raw = interpolators[hand].sample(tMs);
      c.pose = raw ? settle(hand, raw, tMs, this.handScale) : null;
      c.t = tMs;
    }
    return c.pose;
  },

  /** The hands' labels were exchanged: each smoothed pose stays with its hand. */
  swap() {
    [interpolators.Left, interpolators.Right] = [interpolators.Right, interpolators.Left];
    [pushed.Left, pushed.Right] = [pushed.Right, pushed.Left];
    cache.Left.t = cache.Right.t = -1;
  },

  reset() {
    this.active = false;
    interpolators.Left.reset();
    interpolators.Right.reset();
    pushed.Left = { off: { x: 0, y: 0, z: 0 }, t: -1 };
    pushed.Right = { off: { x: 0, y: 0, z: 0 }, t: -1 };
    cache.Left.t = cache.Right.t = -1;
  },
};
