"use client";

import { useFrame } from "@react-three/fiber";
import { BallCollider, CuboidCollider, CylinderCollider, RigidBody, useRapier, useRevoluteJoint, type RapierRigidBody } from "@react-three/rapier";
import { useRef } from "react";
import { useGrabbable } from "@/components/physics/HandPhysics";
import { GROUPS } from "@/lib/physics/groups";
import { useIndustrial } from "./industrialStore";

export const LEVER_LENGTH = 0.4;
/** Fully pulled, radians (toward the user). */
export const LEVER_MAX = 1.05;
export const LEVERS = [
  { x: 0.36, label: "THROTTLE" },
  { x: 0.6, label: "PRESS" },
] as const;
const PIVOT = { y: 0.93, z: -0.36 };

/**
 * A heavy lever: a dynamic arm on a revolute joint whose position motor pulls it back upright
 * (spring + damping). The hand grabs the knob through a spring joint, so the lever lags and
 * resists instead of snapping to the hand.
 */
function Lever({ index }: { index: 0 | 1 }) {
  const base = useRef<RapierRigidBody>(null!);
  const arm = useRef<RapierRigidBody>(null!);
  const joint = useRevoluteJoint(base, arm, [[0, 0, 0], [0, 0, 0], [1, 0, 0]]);
  // The hook can recreate the joint (e.g. on re-render), so remember which joint we configured.
  const configured = useRef<unknown>(null);
  const { rapier } = useRapier();
  const x = LEVERS[index].x;

  useGrabbable({
    id: `lever-${index}`,
    name: `LEVER ${LEVERS[index].label}`,
    body: () => arm.current,
    gestures: ["fist"],
    reach: 0.13,
    grabPoint: () => {
      const a = arm.current;
      if (!a) return { x, y: PIVOT.y + LEVER_LENGTH, z: PIVOT.z };
      const r = a.rotation();
      const angle = 2 * Math.atan2(r.x, r.w);
      return { x, y: PIVOT.y + Math.cos(angle) * LEVER_LENGTH, z: PIVOT.z + Math.sin(angle) * LEVER_LENGTH };
    },
    attach: { stiffness: 900, damping: 45 },
    localHandle: { x: 0, y: LEVER_LENGTH, z: 0 },
    throwable: false,
  });

  useFrame(() => {
    const j = joint.current;
    if (j && configured.current !== j) {
      // The hook's limits param doesn't enable limits (checked: limitsEnabled() was false), so set them here.
      j.setLimits(-0.03, LEVER_MAX);
      // Force-based motor toward upright (N·m per rad): this is the lever's "weight". The default
      // acceleration-based model left the arm limp here (checked by kicking it in the browser).
      j.configureMotorModel(rapier.MotorModel.ForceBased);
      j.configureMotorPosition(0, 40, 6);
      configured.current = j;
    }
    const a = arm.current;
    if (!a) return;
    const r = a.rotation();
    const angle = 2 * Math.atan2(r.x, r.w);
    useIndustrial.getState().setLever(index, Math.max(0, Math.min(1, angle / LEVER_MAX)));
  });

  return (
    <>
      <RigidBody ref={base} type="fixed" position={[x, PIVOT.y, PIVOT.z]} colliders={false}>
        <mesh castShadow>
          <cylinderGeometry args={[0.045, 0.045, 0.09, 24]} />
          <meshStandardMaterial color="#20232f" metalness={0.8} roughness={0.3} />
        </mesh>
        <mesh rotation-z={Math.PI / 2}>
          <cylinderGeometry args={[0.018, 0.018, 0.12, 16]} />
          <meshStandardMaterial color="#cfd5e3" metalness={1} roughness={0.15} />
        </mesh>
      </RigidBody>
      <RigidBody ref={arm} position={[x, PIVOT.y, PIVOT.z]} colliders={false} angularDamping={1.5} name={`lever-${index}`} canSleep={false} userData={{ lever: index }}>
        <CylinderCollider args={[(LEVER_LENGTH - 0.05) / 2, 0.014]} position={[0, (LEVER_LENGTH + 0.05) / 2, 0]} mass={2.5} collisionGroups={GROUPS.prop} />
        <BallCollider args={[0.04]} position={[0, LEVER_LENGTH, 0]} mass={1} collisionGroups={GROUPS.prop} />
        <mesh position={[0, LEVER_LENGTH / 2, 0]} castShadow>
          <cylinderGeometry args={[0.014, 0.018, LEVER_LENGTH, 20]} />
          <meshStandardMaterial color="#dfe3ec" metalness={1} roughness={0.12} />
        </mesh>
        <mesh position={[0, LEVER_LENGTH, 0]} castShadow>
          <sphereGeometry args={[0.04, 32, 24]} />
          <meshPhysicalMaterial color={index ? "#ff6a45" : "#6a4bc4"} roughness={0.3} clearcoat={1} />
        </mesh>
      </RigidBody>
    </>
  );
}

export function Levers() {
  return (
    <>
      {/* control panel housing */}
      <RigidBody type="fixed" colliders={false} position={[0.48, 0.87, -0.36]}>
        <CuboidCollider args={[0.22, 0.05, 0.12]} collisionGroups={GROUPS.world} />
        <mesh castShadow receiveShadow>
          <boxGeometry args={[0.44, 0.1, 0.24]} />
          <meshStandardMaterial color="#141722" metalness={0.6} roughness={0.4} />
        </mesh>
        {/* angle scale markings, blueprint style */}
        {LEVERS.map(({ x }) =>
          Array.from({ length: 7 }, (_, i) => (
            <mesh key={`${x}-${i}`} position={[x - 0.48 - 0.06, 0.051, 0.02 + (i / 6) * 0.09]}>
              <boxGeometry args={[i % 3 === 0 ? 0.03 : 0.018, 0.001, 0.003]} />
              <meshBasicMaterial color="#7fe3f0" />
            </mesh>
          )),
        )}
      </RigidBody>
      <Lever index={0} />
      <Lever index={1} />
    </>
  );
}
