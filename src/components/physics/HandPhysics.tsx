"use client";

import type { ImpulseJoint, RigidBody as RapierBody } from "@dimforge/rapier3d-compat";
import { BallCollider, RigidBody, useBeforePhysicsStep, useRapier, type RapierRigidBody } from "@react-three/rapier";
import { createContext, useContext, useEffect, useMemo, useRef, type ReactNode } from "react";
import * as THREE from "three";
import { isGrabGesture } from "@/lib/hand/gestures";
import { LM, type Gesture, type Handedness, type Point } from "@/lib/hand/types";
import { throwVelocity, type MotionHistory, type ThrowOptions } from "@/lib/hand/velocity";
import { GROUPS } from "@/lib/physics/groups";
import { feel } from "@/state/feel";
import { handPose } from "@/state/handPose";
import { handStore } from "@/state/handStore";

export interface ReleaseInfo {
  hand: Handedness;
  /** Hand velocity at release × the grabbable's throw gain (zero if not throwable). */
  velocity: Point;
}

export interface Grabbable {
  id: string;
  /** Shown in the debug overlay. */
  name: string;
  body: () => RapierRigidBody | null;
  /** Gestures that can pick this up. */
  gestures: Gesture[];
  /** How close the grip point must be to the body's centre (or `grabPoint`), metres. */
  reach: number;
  /** Where to measure reach from, if not the body's centre (e.g. a lever's knob). */
  grabPoint?: () => Point;
  /**
   * - "fixed": rigid joint to the hand.
   * - spring: lets the object lag and resist (levers).
   * - "drive": no joint; the object's velocity is steered toward the hand every step, so contacts
   *   (with CCD) stop it at whatever it hits. Used for surgical tools that must never clip.
   */
  attach?: "fixed" | "drive" | { stiffness: number; damping: number };
  /** Gestures that keep holding once picked up (default: `gestures`). */
  holdGestures?: Gesture[];
  /**
   * Grab by how closed the hand is instead of by gesture: a half-closed claw (smoothed grip ≥ `grab`)
   * on or near the object picks it up, and it stays held until the fingers open (grip < `release`).
   * Used for the basketball, which you cradle rather than make a fist around.
   */
  grip?: { grab: number; release: number };
  /** Collision groups to restore after release (default: GROUPS.prop). */
  restGroups?: number;
  /** For spring attachments: the grab point on the body, in its local frame. */
  localHandle?: Point;
  /** Give the object the hand's velocity on release. */
  throwable?: ThrowOptions | false;
  /** Keep the default HELD collision group while attached? (off for levers fixed in place). */
  switchGroups?: boolean;
  /** Checked every step while held; true makes the hand let go (e.g. a chip clicking into its socket). */
  shouldRelease?: () => boolean;
  onGrab?: (hand: Handedness) => void;
  /** May return a new velocity (e.g. aim assist). */
  onRelease?: (info: ReleaseInfo) => Point | void;
}

type Registry = Map<string, Grabbable>;
const GrabContext = createContext<Registry | null>(null);

/** Register a grabbable for as long as the calling component is mounted. */
export function useGrabbable(def: Grabbable) {
  const registry = useContext(GrabContext);
  const ref = useRef(def);
  useEffect(() => {
    ref.current = def;
  });
  useEffect(() => {
    if (!registry) return;
    const proxy: Grabbable = new Proxy({} as Grabbable, { get: (_, k) => ref.current[k as keyof Grabbable] });
    registry.set(def.id, proxy);
    return () => void registry.delete(def.id);
  }, [registry, def.id]);
}

// Real-hand radii (metres) for the colliders; scaled like the visible hand.
const PALM_RADIUS = 0.034;
const TIP_RADIUS = 0.0095;
const TIPS = [LM.THUMB_TIP, LM.INDEX_TIP, LM.MIDDLE_TIP, LM.RING_TIP, LM.PINKY_TIP];
/** A jump bigger than this in one step is a tracking glitch: teleport rather than sweep through things. */
const GLITCH_JUMP = 0.3;
/** A grab gesture can pick something up this long after it forms (forming a fist just before contact). */
const GRAB_GRACE = 0.3;
/** Smoothing for the continuous grip value used by grip-based grabbing. */
const GRIP_TAU = 0.06;
const PARKED = { x: 0, y: -50, z: 0 };

interface HandRuntime {
  palm: RapierRigidBody | null;
  tips: (RapierRigidBody | null)[];
  anchor: RapierRigidBody | null;
  pos: THREE.Vector3[]; // palm, 5 tips, anchor (from the interpolated pose)
  rot: THREE.Quaternion;
  prevGesture: Gesture;
  grabWindowUntil: number;
  /** Grip (0 open … 1 fist), smoothed so a jittery frame can't drop or snatch a ball. */
  grip: number;
  held: { item: Grabbable; joint: ImpulseJoint | null; point: GripPoint; drive?: { offset: THREE.Vector3; rot: THREE.Quaternion } } | null;
  /** The hand's motion history, kept so a hand that vanishes mid-throw can still throw. */
  lastHistory: MotionHistory | null;
  /** Something was held while the tracker had lost the hand (counts a save if it comes back). */
  heldThroughLoss: boolean;
}

/**
 * Where on the hand a held object is attached, chosen once at grab time. (It used to follow the
 * tracker's gesture, so a claw passing through "pinch" for a frame or two yanked the ball ~14 cm to
 * the thumb–index midpoint.)
 */
type GripPoint = "palm" | "pinch";
interface Pose {
  joints: Point[];
  palm: Point;
  grip: Point;
}
const gripPoint = (pose: Pose, point: GripPoint): Point =>
  point === "palm"
    ? pose.palm
    : {
        x: (pose.joints[LM.THUMB_TIP].x + pose.joints[LM.INDEX_TIP].x) / 2,
        y: (pose.joints[LM.THUMB_TIP].y + pose.joints[LM.INDEX_TIP].y) / 2,
        z: (pose.joints[LM.THUMB_TIP].z + pose.joints[LM.INDEX_TIP].z) / 2,
      };

/** Where each driven (tool) item is being steered to: what the hand wants, before contacts. */
export const driveTargets = new Map<string, { position: THREE.Vector3; quaternion: THREE.Quaternion }>();

const newRuntime = (): HandRuntime => ({
  palm: null,
  tips: [],
  anchor: null,
  pos: Array.from({ length: 7 }, () => new THREE.Vector3(PARKED.x, PARKED.y, PARKED.z)),
  rot: new THREE.Quaternion(),
  prevGesture: "none",
  grabWindowUntil: 0,
  grip: 0,
  held: null,
  lastHistory: null,
  heldThroughLoss: false,
});

/** Tool steering: time constant and speed limits. */
const DRIVE_TAU = 0.03;
const DRIVE_MAX_SPEED = 1.6;
const DRIVE_MAX_SPIN = 14;

const basis = new THREE.Matrix4();
const qDrive = new THREE.Quaternion();
const qTmp2 = new THREE.Quaternion();
const qTmp = new THREE.Quaternion();
const vA = new THREE.Vector3();
const vB = new THREE.Vector3();
const vC = new THREE.Vector3();

/** Palm orientation from the joints: y toward the fingers, x across the knuckles. */
function palmQuaternion(J: Point[], out: THREE.Quaternion) {
  const y = vA.set(J[LM.MIDDLE_MCP].x - J[LM.WRIST].x, J[LM.MIDDLE_MCP].y - J[LM.WRIST].y, J[LM.MIDDLE_MCP].z - J[LM.WRIST].z).normalize();
  const x = vB.set(J[LM.INDEX_MCP].x - J[LM.PINKY_MCP].x, J[LM.INDEX_MCP].y - J[LM.PINKY_MCP].y, J[LM.INDEX_MCP].z - J[LM.PINKY_MCP].z);
  x.addScaledVector(y, -x.dot(y)).normalize();
  const z = vC.crossVectors(x, y);
  basis.makeBasis(x, y, z);
  return out.setFromRotationMatrix(basis);
}

/**
 * Kinematic palm + fingertip colliders driven by the tracked joints, and the grab system: a grab
 * gesture near a registered grabbable joins it to the hand's anchor body with a joint (never by
 * teleporting it); releasing removes the joint and hands over the hand's recent velocity.
 */
export function HandPhysics({ scale = 1.5, children }: { scale?: number; children?: ReactNode }) {
  const registry = useMemo<Registry>(() => new Map(), []);
  const hands = useRef<Record<Handedness, HandRuntime>>({ Right: newRuntime(), Left: newRuntime() });
  const { world, rapier } = useRapier();

  const release = (hand: Handedness, rt: HandRuntime, throwIt: boolean, history?: MotionHistory | null) => {
    if (!rt.held) return;
    const { item, joint } = rt.held;
    rt.held = null;
    if (joint && world.getImpulseJoint(joint.handle)) world.removeImpulseJoint(joint, true);
    driveTargets.delete(item.id);
    const body = item.body();
    if (item.attach === "drive") body?.setGravityScale(1, true);
    const motion = history ?? handStore.getState().hands[hand]?.history;
    let velocity: Point = { x: 0, y: 0, z: 0 };
    if (throwIt && item.throwable && motion) velocity = throwVelocity(motion, item.throwable);
    const override = item.onRelease?.({ hand, velocity });
    if (body) {
      if (item.throwable) {
        const v = override ?? velocity;
        body.setLinvel(v, true);
        // a little backspin, like a real release
        body.setAngvel({ x: -6, y: 0, z: 0 }, true);
      }
      // Let the object clear the fingers before hands can touch it again.
      if (item.switchGroups !== false) setTimeout(() => setGroups(body, item.restGroups ?? GROUPS.prop), 150);
    }
    handStore.setState((s) => ({ holding: { ...s.holding, [hand]: null } }));
  };

  const grab = (hand: Handedness, rt: HandRuntime, item: Grabbable, pose: Pose, gesture: Gesture) => {
    const body = item.body();
    const anchor = rt.anchor;
    if (!body || !anchor) return;
    // cradled objects hang off the palm; pinched ones off the fingertips
    const point: GripPoint = !item.grip && gesture === "pinch" ? "pinch" : "palm";
    const at = gripPoint(pose, point);
    rt.pos[6].set(at.x, at.y, at.z);
    anchor.setTranslation(at, false);
    anchor.setRotation(rt.rot, false);
    anchor.setNextKinematicTranslation(at);
    const a = at;
    const inv = qTmp.copy(rt.rot).invert();
    if (item.attach === "drive") {
      // Steered from the palm, which (unlike the grip point) doesn't jump between pinch and fist.
      const o = body.translation();
      const r = body.rotation();
      const offset = new THREE.Vector3(o.x - rt.pos[0].x, o.y - rt.pos[0].y, o.z - rt.pos[0].z).applyQuaternion(inv);
      const rot = inv.clone().multiply(new THREE.Quaternion(r.x, r.y, r.z, r.w));
      body.setGravityScale(0, true);
      rt.held = { item, joint: null, point, drive: { offset, rot } };
      item.onGrab?.(hand);
      handStore.setState((s) => ({ holding: { ...s.holding, [hand]: item.name } }));
      return;
    }
    let params;
    if (item.attach && item.attach !== "fixed") {
      const local = item.localHandle ?? { x: 0, y: 0, z: 0 };
      params = rapier.JointData.spring(0, item.attach.stiffness, item.attach.damping, { x: 0, y: 0, z: 0 }, local);
    } else {
      const o = body.translation();
      const r = body.rotation();
      const offset = new THREE.Vector3(o.x - a.x, o.y - a.y, o.z - a.z).applyQuaternion(inv);
      const frame1 = inv.clone().multiply(new THREE.Quaternion(r.x, r.y, r.z, r.w));
      params = rapier.JointData.fixed(
        { x: offset.x, y: offset.y, z: offset.z },
        { x: frame1.x, y: frame1.y, z: frame1.z, w: frame1.w },
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: 0, w: 1 },
      );
    }
    const joint = world.createImpulseJoint(params, anchor as unknown as RapierBody, body as unknown as RapierBody, true);
    if (item.switchGroups !== false) setGroups(body, GROUPS.held);
    body.wakeUp();
    rt.held = { item, joint, point };
    item.onGrab?.(hand);
    handStore.setState((s) => ({ holding: { ...s.holding, [hand]: item.name } }));
  };

  /** Velocity steering toward the hand's pose: a critically damped follow that contacts can stop. */
  const drive = (rt: HandRuntime, item: Grabbable, d: { offset: THREE.Vector3; rot: THREE.Quaternion }, dt: number) => {
    const body = item.body();
    if (!body) return;
    const target = driveTargets.get(item.id) ?? { position: new THREE.Vector3(), quaternion: new THREE.Quaternion() };
    target.position.copy(d.offset).applyQuaternion(rt.rot).add(rt.pos[0]);
    target.quaternion.copy(rt.rot).multiply(d.rot);
    driveTargets.set(item.id, target);

    const p = body.translation();
    const tau = Math.max(DRIVE_TAU, dt * 2);
    const v = vB.set((target.position.x - p.x) / tau, (target.position.y - p.y) / tau, (target.position.z - p.z) / tau);
    if (v.length() > DRIVE_MAX_SPEED) v.setLength(DRIVE_MAX_SPEED);

    const r = body.rotation();
    const dq = qDrive.copy(target.quaternion).multiply(qTmp2.set(r.x, r.y, r.z, r.w).invert()).normalize();
    if (dq.w < 0) dq.set(-dq.x, -dq.y, -dq.z, -dq.w); // shortest way round
    const angle = 2 * Math.acos(Math.min(1, dq.w));
    // w can round to just above 1 when already aligned; a NaN here panics Rapier's WASM.
    const s = Math.sqrt(Math.max(0, 1 - dq.w * dq.w));
    const w = s < 1e-6 ? vC.set(0, 0, 0) : vC.set(dq.x / s, dq.y / s, dq.z / s).multiplyScalar(angle / tau);
    if (w.length() > DRIVE_MAX_SPIN) w.setLength(DRIVE_MAX_SPIN);
    if (![v.x, v.y, v.z, w.x, w.y, w.z].every(Number.isFinite)) return;
    body.setLinvel(v, true);
    body.setAngvel(w, true);
  };

  useBeforePhysicsStep((w) => {
    const dt = w.timestep;
    const nowMs = performance.now();
    const now = nowMs / 1000;
    const tracked = handStore.getState().hands;

    for (const hand of ["Right", "Left"] as Handedness[]) {
      const rt = hands.current[hand];
      const h = tracked[hand];
      const bodies = [rt.palm, ...rt.tips, rt.anchor];
      if (!h) {
        // Gone for longer than the processor coasts: let go, as a throw if the hand was moving fast
        // (a flick blurs the hand, and that's often when the tracker loses it).
        if (rt.held) {
          feel.lossDrop();
          release(hand, rt, true, rt.lastHistory);
        }
        rt.heldThroughLoss = false;
        rt.lastHistory = null;
        rt.prevGesture = "none";
        rt.grip = 0;
        // Teleport (not a kinematic move): sweeping to the parking spot in one step would
        // smash anything in between, since kinematic bodies with CCD push at any speed.
        if (rt.pos[0].y > -40) bodies.forEach((b) => b?.setTranslation(PARKED, false));
        rt.pos.forEach((p) => p.set(PARKED.x, PARKED.y, PARKED.z));
        continue;
      }

      // Follow the same interpolated pose the robot hand is drawn with. A hand that just appeared (or
      // jumped implausibly far) is teleported in, for the same reason as above.
      const pose = handPose.sample(hand, nowMs) ?? h;
      const targets = [pose.palm, ...TIPS.map((i) => pose.joints[i]), rt.held ? gripPoint(pose, rt.held.point) : pose.grip];
      const teleport = rt.pos[0].y < -40 || rt.pos[0].distanceTo(vA.set(pose.palm.x, pose.palm.y, pose.palm.z)) > GLITCH_JUMP;
      rt.pos.forEach((p, i) => {
        const t = targets[i];
        p.set(t.x, t.y, t.z);
        if (teleport) bodies[i]?.setTranslation(p, false);
      });
      palmQuaternion(pose.joints, rt.rot);
      rt.lastHistory = h.history;
      rt.palm?.setNextKinematicTranslation(rt.pos[0]);
      rt.palm?.setNextKinematicRotation(rt.rot);
      rt.tips.forEach((b, i) => b?.setNextKinematicTranslation(rt.pos[i + 1]));
      rt.anchor?.setNextKinematicTranslation(rt.pos[6]);
      rt.anchor?.setNextKinematicRotation(rt.rot);

      // While the tracker has lost the hand (coasting), keep whatever it holds and grab nothing new:
      // its gesture and grip are just the last ones seen.
      if (h.lost) {
        if (rt.held) rt.heldThroughLoss = true;
        if (rt.held?.item.shouldRelease?.()) release(hand, rt, false);
        else if (rt.held?.drive) drive(rt, rt.held.item, rt.held.drive, dt);
        continue;
      }
      if (rt.heldThroughLoss) {
        if (rt.held) feel.coastSave();
        rt.heldThroughLoss = false;
      }

      // Grab / release
      const g = h.gesture;
      if (isGrabGesture(g) && !isGrabGesture(rt.prevGesture)) rt.grabWindowUntil = now + GRAB_GRACE;
      rt.prevGesture = g;
      rt.grip += (h.features.grip - rt.grip) * (1 - Math.exp(-dt / GRIP_TAU));

      const held = rt.held?.item;
      const stillHolding = (item: Grabbable) => (item.grip ? rt.grip >= item.grip.release : (item.holdGestures ?? item.gestures).includes(g));
      if (held && held.shouldRelease?.()) release(hand, rt, false);
      else if (held && !stillHolding(held)) release(hand, rt, true);
      if (rt.held?.drive) drive(rt, rt.held.item, rt.held.drive, dt);
      else if (!rt.held) {
        const other = hands.current[hand === "Right" ? "Left" : "Right"];
        const gestureWindow = isGrabGesture(g) && now <= rt.grabWindowUntil;
        let best: Grabbable | null = null;
        let bestD = Infinity;
        for (const item of registry.values()) {
          if (other.held?.item.id === item.id) continue;
          // grip-based items: a closing claw anywhere near the object takes it
          const wants = item.grip ? rt.grip >= item.grip.grab : gestureWindow && item.gestures.includes(g);
          if (!wants) continue;
          const b = item.body();
          if (!b) continue;
          const p = item.grabPoint?.() ?? b.translation();
          // for a cradled object the palm counts as much as the grip point
          const from = item.grip ? pose.palm : pose.grip;
          const d = Math.hypot(p.x - from.x, p.y - from.y, p.z - from.z);
          if (d < item.reach && d < bestD) {
            best = item;
            bestD = d;
          }
        }
        if (best) grab(hand, rt, best, pose, g);
      }
    }
  });

  return (
    <GrabContext.Provider value={registry}>
      {(["Right", "Left"] as Handedness[]).map((hand) => (
        <HandBodies key={hand} rt={hands.current[hand]} scale={scale} />
      ))}
      {children}
    </GrabContext.Provider>
  );
}

function setGroups(body: RapierRigidBody, groups: number) {
  for (let i = 0; i < body.numColliders(); i++) body.collider(i).setCollisionGroups(groups);
}

function HandBodies({ rt, scale }: { rt: HandRuntime; scale: number }) {
  const parked: [number, number, number] = [PARKED.x, PARKED.y, PARKED.z];
  return (
    <>
      <RigidBody ref={(b) => void (rt.palm = b)} type="kinematicPosition" colliders={false} position={parked} ccd>
        <BallCollider args={[PALM_RADIUS * scale]} collisionGroups={GROUPS.hand} friction={1.2} />
      </RigidBody>
      {TIPS.map((_, i) => (
        <RigidBody key={i} ref={(b) => void (rt.tips[i] = b)} type="kinematicPosition" colliders={false} position={parked} ccd>
          <BallCollider args={[TIP_RADIUS * scale]} collisionGroups={GROUPS.hand} friction={1.5} />
        </RigidBody>
      ))}
      {/* Grip anchor: no collider, just something to attach joints to. */}
      <RigidBody ref={(b) => void (rt.anchor = b)} type="kinematicPosition" colliders={false} position={parked} />
    </>
  );
}
