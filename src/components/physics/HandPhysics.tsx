"use client";

import type { ImpulseJoint, RigidBody as RapierBody } from "@dimforge/rapier3d-compat";
import { BallCollider, RigidBody, useBeforePhysicsStep, useRapier, type RapierRigidBody } from "@react-three/rapier";
import { createContext, useContext, useEffect, useMemo, useRef, type ReactNode } from "react";
import * as THREE from "three";
import { isGrabGesture } from "@/lib/hand/gestures";
import { LM, type Gesture, type Handedness, type Point } from "@/lib/hand/types";
import { throwVelocity, type ThrowOptions } from "@/lib/hand/velocity";
import { GROUPS } from "@/lib/physics/groups";
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
  /** Fixed (rigid) attachment, or a spring that lets the object lag and resist (levers). */
  attach?: "fixed" | { stiffness: number; damping: number };
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
/** Physics follows the (30 Hz) tracker with this time constant, so kinematic bodies move smoothly at 90 Hz. */
const FOLLOW_TAU = 0.03;
/** A grab gesture can pick something up this long after it forms (forming a fist just before contact). */
const GRAB_GRACE = 0.3;
const PARKED = { x: 0, y: -50, z: 0 };

interface HandRuntime {
  palm: RapierRigidBody | null;
  tips: (RapierRigidBody | null)[];
  anchor: RapierRigidBody | null;
  pos: THREE.Vector3[]; // smoothed: palm, 5 tips, anchor
  rot: THREE.Quaternion;
  prevGesture: Gesture;
  grabWindowUntil: number;
  held: { item: Grabbable; joint: ImpulseJoint } | null;
}

const newRuntime = (): HandRuntime => ({
  palm: null,
  tips: [],
  anchor: null,
  pos: Array.from({ length: 7 }, () => new THREE.Vector3(PARKED.x, PARKED.y, PARKED.z)),
  rot: new THREE.Quaternion(),
  prevGesture: "none",
  grabWindowUntil: 0,
  held: null,
});

const basis = new THREE.Matrix4();
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

  const release = (hand: Handedness, rt: HandRuntime, throwIt: boolean) => {
    if (!rt.held) return;
    const { item, joint } = rt.held;
    rt.held = null;
    if (world.getImpulseJoint(joint.handle)) world.removeImpulseJoint(joint, true);
    const body = item.body();
    const tracked = handStore.getState().hands[hand];
    let velocity: Point = { x: 0, y: 0, z: 0 };
    if (throwIt && item.throwable && tracked) velocity = throwVelocity(tracked.history, item.throwable);
    const override = item.onRelease?.({ hand, velocity });
    if (body) {
      if (item.throwable) {
        const v = override ?? velocity;
        body.setLinvel(v, true);
        // a little backspin, like a real release
        body.setAngvel({ x: -6, y: 0, z: 0 }, true);
      }
      // Let the object clear the fingers before hands can touch it again.
      if (item.switchGroups !== false) setTimeout(() => setGroups(body, GROUPS.prop), 150);
    }
    handStore.setState((s) => ({ holding: { ...s.holding, [hand]: null } }));
  };

  const grab = (hand: Handedness, rt: HandRuntime, item: Grabbable) => {
    const body = item.body();
    const anchor = rt.anchor;
    if (!body || !anchor) return;
    const a = anchor.translation();
    const inv = qTmp.copy(rt.rot).invert();
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
    rt.held = { item, joint };
    item.onGrab?.(hand);
    handStore.setState((s) => ({ holding: { ...s.holding, [hand]: item.name } }));
  };

  useBeforePhysicsStep((w) => {
    const dt = w.timestep;
    const k = 1 - Math.exp(-dt / FOLLOW_TAU);
    const now = performance.now() / 1000;
    const tracked = handStore.getState().hands;

    for (const hand of ["Right", "Left"] as Handedness[]) {
      const rt = hands.current[hand];
      const h = tracked[hand];
      const bodies = [rt.palm, ...rt.tips, rt.anchor];
      if (!h) {
        if (rt.held) release(hand, rt, false);
        rt.prevGesture = "none";
        // Teleport (not a kinematic move): sweeping to the parking spot in one step would
        // smash anything in between, since kinematic bodies with CCD push at any speed.
        if (rt.pos[0].y > -40) bodies.forEach((b) => b?.setTranslation(PARKED, false));
        rt.pos.forEach((p) => p.set(PARKED.x, PARKED.y, PARKED.z));
        continue;
      }

      // Smoothly follow the tracked joints. A hand that just appeared is teleported in, for the same reason.
      const targets = [h.palm, ...TIPS.map((i) => h.joints[i]), h.grip];
      const appeared = rt.pos[0].y < -40;
      rt.pos.forEach((p, i) => {
        const t = targets[i];
        if (appeared) {
          p.set(t.x, t.y, t.z);
          bodies[i]?.setTranslation(p, false);
        } else p.lerp(vA.set(t.x, t.y, t.z), k);
      });
      rt.rot.slerp(palmQuaternion(h.joints, qTmp), k);
      rt.palm?.setNextKinematicTranslation(rt.pos[0]);
      rt.palm?.setNextKinematicRotation(rt.rot);
      rt.tips.forEach((b, i) => b?.setNextKinematicTranslation(rt.pos[i + 1]));
      rt.anchor?.setNextKinematicTranslation(rt.pos[6]);
      rt.anchor?.setNextKinematicRotation(rt.rot);

      // Grab / release
      const g = h.gesture;
      if (isGrabGesture(g) && !isGrabGesture(rt.prevGesture)) rt.grabWindowUntil = now + GRAB_GRACE;
      rt.prevGesture = g;

      if (rt.held && rt.held.item.shouldRelease?.()) release(hand, rt, false);
      else if (rt.held && !rt.held.item.gestures.includes(g)) release(hand, rt, true);
      else if (!rt.held && isGrabGesture(g) && now <= rt.grabWindowUntil) {
        const other = hands.current[hand === "Right" ? "Left" : "Right"];
        let best: Grabbable | null = null;
        let bestD = Infinity;
        for (const item of registry.values()) {
          if (!item.gestures.includes(g) || other.held?.item.id === item.id) continue;
          const b = item.body();
          if (!b) continue;
          const p = item.grabPoint?.() ?? b.translation();
          const d = Math.hypot(p.x - h.grip.x, p.y - h.grip.y, p.z - h.grip.z);
          if (d < item.reach && d < bestD) {
            best = item;
            bestD = d;
          }
        }
        if (best) grab(hand, rt, best);
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
