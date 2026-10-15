"use client";

import type { ImpulseJoint, RigidBody as RawBody } from "@dimforge/rapier3d-compat";
import { useFrame } from "@react-three/fiber";
import { BallCollider, CuboidCollider, RigidBody, useRapier, type RapierRigidBody } from "@react-three/rapier";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { driveTargets, useGrabbable } from "@/components/physics/HandPhysics";
import { GROUPS } from "@/lib/physics/groups";
import type { Point } from "@/lib/hand/types";
import { handStore } from "@/state/handStore";
import { DISH, INSTRUMENT_TRAY, TORSO_TOP, WOUND } from "./layout";

/** Live handles for the monitor and tests. */
export const instruments: {
  scalpel: RapierRigidBody | null;
  forceps: RapierRigidBody | null;
  forcepsClosed: boolean;
  fragments: { body: RapierRigidBody | null; held: boolean }[];
} = { scalpel: null, forceps: null, forcepsClosed: false, fragments: [] };

/** Scalpel geometry, local frame: handle along -z, blade edge facing -y. */
export const SCALPEL = {
  handle: [0.006, 0.0045, 0.05] as const,
  blade: { half: [0.0009, 0.008, 0.016] as const, at: [0, -0.003, -0.064] as const },
  /** Point on the cutting edge used to trace the incision. */
  edge: new THREE.Vector3(0, -0.011, -0.07),
};
const FORCEPS_TIP = new THREE.Vector3(0, 0, -0.118);

const steel = () => new THREE.MeshStandardMaterial({ color: "#e4e8f0", metalness: 1, roughness: 0.14 });

/** What the hand wants: a translucent ghost of the tool, shown when the patient is in the way. */
function Ghost({ id, children }: { id: string; children: React.ReactNode }) {
  const group = useRef<THREE.Group>(null);
  useFrame(() => {
    const g = group.current;
    if (!g) return;
    const t = driveTargets.get(id);
    g.visible = !!t;
    if (t) {
      g.position.copy(t.position);
      g.quaternion.copy(t.quaternion);
    }
  });
  return (
    <group ref={group} visible={false}>
      {children}
    </group>
  );
}

const ghostMat = new THREE.MeshBasicMaterial({ color: "#7fe3f0", transparent: true, opacity: 0.22, depthWrite: false });

function ScalpelShape({ material }: { material: THREE.Material }) {
  return (
    <>
      <mesh material={material} castShadow>
        <boxGeometry args={[SCALPEL.handle[0] * 2, SCALPEL.handle[1] * 2, SCALPEL.handle[2] * 2]} />
      </mesh>
      <mesh material={material} position={[...SCALPEL.blade.at]} castShadow>
        <boxGeometry args={[SCALPEL.blade.half[0] * 2, SCALPEL.blade.half[1] * 2, SCALPEL.blade.half[2] * 2]} />
      </mesh>
    </>
  );
}

export function Scalpel() {
  const ref = useRef<RapierRigidBody>(null);
  const mat = useMemo(() => steel(), []);
  useEffect(() => {
    instruments.scalpel = ref.current;
  });
  useGrabbable({
    id: "scalpel",
    name: "SCALPEL",
    body: () => ref.current,
    gestures: ["pinch"],
    // hold like a pen: pinch, squeeze, or in-between all keep it; open the hand to put it down
    holdGestures: ["pinch", "fist", "none", "point"],
    reach: 0.07,
    attach: "drive",
    throwable: false,
    switchGroups: false,
  });
  return (
    <>
      <RigidBody ref={ref} position={[INSTRUMENT_TRAY.x - 0.05, INSTRUMENT_TRAY.y + 0.03, INSTRUMENT_TRAY.z]} colliders={false} ccd softCcdPrediction={0.04} angularDamping={4} linearDamping={2} name="scalpel">
        <CuboidCollider args={[...SCALPEL.handle]} mass={0.04} collisionGroups={GROUPS.tool} friction={0.6} />
        <CuboidCollider args={[...SCALPEL.blade.half]} position={[...SCALPEL.blade.at]} mass={0.005} collisionGroups={GROUPS.tool} friction={0.4} />
        <ScalpelShape material={mat} />
      </RigidBody>
      <Ghost id="scalpel">
        <ScalpelShape material={ghostMat} />
      </Ghost>
    </>
  );
}

function ForcepsShape({ material, closed }: { material: THREE.Material; closed: React.RefObject<number> }) {
  const left = useRef<THREE.Group>(null);
  const right = useRef<THREE.Group>(null);
  useFrame(() => {
    const a = 0.06 * (1 - (closed.current ?? 0));
    if (left.current) left.current.rotation.y = a;
    if (right.current) right.current.rotation.y = -a;
  });
  return (
    <>
      <mesh material={material} position={[0, 0, 0]}>
        <boxGeometry args={[0.014, 0.008, 0.012]} />
      </mesh>
      {[left, right].map((r, i) => (
        <group key={i} ref={r}>
          <mesh material={material} position={[i ? 0.003 : -0.003, 0, -0.06]} castShadow>
            <boxGeometry args={[0.003, 0.006, 0.12]} />
          </mesh>
        </group>
      ))}
    </>
  );
}

export function Forceps() {
  const ref = useRef<RapierRigidBody>(null);
  const mat = useMemo(() => steel(), []);
  const closed = useRef(0);
  const grasp = useRef<{ joint: ImpulseJoint; index: number } | null>(null);
  const holding = useRef(false);
  const { world, rapier } = useRapier();
  useEffect(() => {
    instruments.forceps = ref.current;
  });

  useGrabbable({
    id: "forceps",
    name: "FORCEPS",
    body: () => ref.current,
    gestures: ["pinch"],
    holdGestures: ["pinch", "fist", "none", "point"],
    reach: 0.07,
    attach: "drive",
    throwable: false,
    switchGroups: false,
    onGrab: () => void (holding.current = true),
    onRelease: () => void (holding.current = false),
  });

  useFrame((_, dt) => {
    const b = ref.current;
    if (!b) return;
    // Squeeze (fist) closes the jaws while holding.
    const hands = handStore.getState();
    const hand = Object.entries(hands.holding).find(([, v]) => v === "FORCEPS")?.[0] as "Left" | "Right" | undefined;
    const wantClosed = holding.current && hand ? hands.hands[hand]?.gesture === "fist" : false;
    closed.current += ((wantClosed ? 1 : 0) - closed.current) * Math.min(1, dt * 18);
    instruments.forcepsClosed = closed.current > 0.8;

    const p = b.translation();
    const r = b.rotation();
    const tip = FORCEPS_TIP.clone().applyQuaternion(new THREE.Quaternion(r.x, r.y, r.z, r.w)).add(new THREE.Vector3(p.x, p.y, p.z));

    if (instruments.forcepsClosed && !grasp.current) {
      instruments.fragments.forEach((f, index) => {
        if (grasp.current || f.held || !f.body) return;
        const q = f.body.translation();
        if (Math.hypot(q.x - tip.x, q.y - tip.y, q.z - tip.z) < 0.022) {
          const local = new THREE.Vector3(q.x - p.x, q.y - p.y, q.z - p.z).applyQuaternion(new THREE.Quaternion(r.x, r.y, r.z, r.w).invert());
          const joint = world.createImpulseJoint(
            rapier.JointData.fixed({ x: local.x, y: local.y, z: local.z }, { x: 0, y: 0, z: 0, w: 1 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0, w: 1 }),
            b as unknown as RawBody,
            f.body as unknown as RawBody,
            true,
          );
          for (let i = 0; i < f.body.numColliders(); i++) f.body.collider(i).setCollisionGroups(GROUPS.held);
          f.held = true;
          grasp.current = { joint, index };
        }
      });
    } else if (!instruments.forcepsClosed && grasp.current) {
      const { joint, index } = grasp.current;
      if (world.getImpulseJoint(joint.handle)) world.removeImpulseJoint(joint, true);
      const f = instruments.fragments[index];
      f.held = false;
      const fb = f.body;
      if (fb) setTimeout(() => { for (let i = 0; i < fb.numColliders(); i++) fb.collider(i).setCollisionGroups(GROUPS.prop); }, 120);
      grasp.current = null;
    }
  });

  return (
    <>
      <RigidBody ref={ref} position={[INSTRUMENT_TRAY.x + 0.05, INSTRUMENT_TRAY.y + 0.03, INSTRUMENT_TRAY.z]} colliders={false} ccd softCcdPrediction={0.04} angularDamping={4} linearDamping={2} name="forceps">
        <CuboidCollider args={[0.007, 0.004, 0.06]} position={[0, 0, -0.058]} mass={0.035} collisionGroups={GROUPS.tool} friction={0.8} />
        <ForcepsShape material={mat} closed={closed} />
      </RigidBody>
      <Ghost id="forceps">
        <ForcepsShape material={ghostMat} closed={closed} />
      </Ghost>
    </>
  );
}

const FRAGMENT_SPOTS: Point[] = [
  { x: WOUND.x - 0.02, y: TORSO_TOP + 0.01, z: WOUND.z - 0.012 },
  { x: WOUND.x + 0.018, y: TORSO_TOP + 0.01, z: WOUND.z + 0.016 },
  { x: WOUND.x + 0.006, y: TORSO_TOP + 0.01, z: WOUND.z - 0.026 },
];

/** Small chrome fragments in the wound, to be retrieved with the forceps. */
export function Fragments() {
  const refs = useRef<(RapierRigidBody | null)[]>([]);
  instruments.fragments = FRAGMENT_SPOTS.map((_, i) => instruments.fragments[i] ?? { body: null, held: false });
  useFrame(() => refs.current.forEach((b, i) => (instruments.fragments[i].body = b)));
  return (
    <>
      {FRAGMENT_SPOTS.map((p, i) => (
        <RigidBody key={i} ref={(b) => void (refs.current[i] = b)} position={[p.x, p.y, p.z]} colliders={false} ccd linearDamping={1.5} angularDamping={2} userData={{ fragment: i }}>
          <BallCollider args={[0.007]} mass={0.01} friction={1} collisionGroups={GROUPS.prop} />
          <mesh castShadow>
            <icosahedronGeometry args={[0.008, 1]} />
            <meshStandardMaterial color="#c7ccd8" metalness={1} roughness={0.25} flatShading />
          </mesh>
        </RigidBody>
      ))}
    </>
  );
}

/** Instrument tray and the kidney dish fragments go into. */
export function TrayAndDish() {
  const ring = 16;
  return (
    <>
      <RigidBody type="fixed" colliders={false} position={[INSTRUMENT_TRAY.x, INSTRUMENT_TRAY.y, INSTRUMENT_TRAY.z]}>
        <CuboidCollider args={[0.12, 0.008, 0.09]} collisionGroups={GROUPS.world} />
        <mesh receiveShadow>
          <boxGeometry args={[0.24, 0.016, 0.18]} />
          <meshStandardMaterial color="#c9ced9" metalness={1} roughness={0.3} />
        </mesh>
        <mesh position={[0, -0.5, 0]}>
          <cylinderGeometry args={[0.015, 0.03, 1, 16]} />
          <meshStandardMaterial color="#141722" metalness={0.7} roughness={0.35} />
        </mesh>
      </RigidBody>
      <RigidBody type="fixed" colliders={false} position={[DISH.x, DISH.y, DISH.z]}>
        <CuboidCollider args={[0.075, 0.006, 0.075]} collisionGroups={GROUPS.world} />
        {Array.from({ length: ring }, (_, i) => {
          const a = (i / ring) * Math.PI * 2;
          return <BallCollider key={i} args={[0.01]} position={[Math.cos(a) * DISH.radius, 0.014, Math.sin(a) * DISH.radius]} collisionGroups={GROUPS.world} />;
        })}
        <mesh position={[0, 0.006, 0]} rotation-x={-Math.PI / 2} receiveShadow>
          <circleGeometry args={[DISH.radius, 40]} />
          <meshStandardMaterial color="#aab2c3" metalness={1} roughness={0.22} />
        </mesh>
        <mesh position={[0, 0.014, 0]} rotation-x={Math.PI / 2}>
          <torusGeometry args={[DISH.radius, 0.01, 12, 48]} />
          <meshStandardMaterial color="#dfe3ec" metalness={1} roughness={0.15} />
        </mesh>
        <mesh position={[0, -0.5, 0]}>
          <cylinderGeometry args={[0.015, 0.03, 1, 16]} />
          <meshStandardMaterial color="#141722" metalness={0.7} roughness={0.35} />
        </mesh>
      </RigidBody>
    </>
  );
}
