"use client";

import { useFrame } from "@react-three/fiber";
import { BallCollider, CuboidCollider, CylinderCollider, RigidBody, type IntersectionEnterPayload, type RapierRigidBody } from "@react-three/rapier";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { GROUPS } from "@/lib/physics/groups";
import { useArcade } from "./arcadeStore";

/** Rim centre in the scene (when the hoop is at rest). */
export const RIM = { x: 0, y: 2.3, z: -3.1 };
export const RIM_RADIUS = 0.23;
const BOARD_Z = RIM.z - 0.32;
const RIM_SEGMENTS = 22;

export const hoopOffset = { x: 0 };

export function Hoop({ onSensor }: { onSensor: (p: IntersectionEnterPayload) => void }) {
  const body = useRef<RapierRigidBody>(null);
  const streak = useArcade((s) => s.streak);
  const t = useRef(0);

  // From a streak of 3 the hoop starts to drift side to side, faster as the streak grows.
  useFrame((_, dt) => {
    if (!body.current) return;
    const level = Math.max(0, streak - 2);
    const target = level ? Math.sin((t.current += dt * (0.5 + level * 0.12))) * Math.min(0.9, 0.35 + level * 0.1) : 0;
    hoopOffset.x += (target - hoopOffset.x) * Math.min(1, dt * 2);
    body.current.setNextKinematicTranslation({ x: hoopOffset.x, y: 0, z: 0 });
  });

  const net = useMemo(() => {
    const pts: number[] = [];
    const n = 16;
    const bottom = 0.13;
    const depth = 0.42;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const a2 = ((i + 1.5) / n) * Math.PI * 2;
      // diagonal strands make the diamond pattern
      pts.push(Math.cos(a) * RIM_RADIUS, 0, Math.sin(a) * RIM_RADIUS, Math.cos(a2) * bottom, -depth, Math.sin(a2) * bottom);
      pts.push(Math.cos(a2) * RIM_RADIUS, 0, Math.sin(a2) * RIM_RADIUS, Math.cos(a) * bottom, -depth, Math.sin(a) * bottom);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    return g;
  }, []);

  return (
    <RigidBody ref={body} type="kinematicPosition" colliders={false} name="hoop">
      {/* backboard */}
      <CuboidCollider args={[0.9, 0.53, 0.02]} position={[RIM.x, RIM.y + 0.3, BOARD_Z]} collisionGroups={GROUPS.world} restitution={0.6} />
      <mesh position={[RIM.x, RIM.y + 0.3, BOARD_Z]}>
        <boxGeometry args={[1.8, 1.06, 0.03]} />
        <meshPhysicalMaterial color="#9fb8ff" transparent opacity={0.16} roughness={0.05} metalness={0} clearcoat={1} />
      </mesh>
      <lineSegments position={[RIM.x, RIM.y + 0.3, BOARD_Z + 0.017]}>
        <edgesGeometry args={[new THREE.PlaneGeometry(1.8, 1.06)]} />
        <lineBasicMaterial color="#7fe3f0" />
      </lineSegments>
      <lineSegments position={[RIM.x, RIM.y + 0.16, BOARD_Z + 0.017]}>
        <edgesGeometry args={[new THREE.PlaneGeometry(0.6, 0.45)]} />
        <lineBasicMaterial color="#ff7a4a" />
      </lineSegments>

      {/* rim: a ring of small sphere colliders is robust against tunnelling */}
      {Array.from({ length: RIM_SEGMENTS }, (_, i) => {
        const a = (i / RIM_SEGMENTS) * Math.PI * 2;
        return (
          <BallCollider
            key={i}
            args={[0.014]}
            position={[RIM.x + Math.cos(a) * RIM_RADIUS, RIM.y, RIM.z + Math.sin(a) * RIM_RADIUS]}
            collisionGroups={GROUPS.world}
            restitution={0.5}
          />
        );
      })}
      <mesh position={[RIM.x, RIM.y, RIM.z]} rotation-x={Math.PI / 2} castShadow>
        <torusGeometry args={[RIM_RADIUS, 0.012, 12, 48]} />
        <meshPhysicalMaterial color="#ff6a45" metalness={0.9} roughness={0.25} clearcoat={1} />
      </mesh>
      {/* rim bracket */}
      <mesh position={[RIM.x, RIM.y - 0.02, (RIM.z - RIM_RADIUS + BOARD_Z) / 2]}>
        <boxGeometry args={[0.12, 0.03, BOARD_Z - (RIM.z - RIM_RADIUS) + 0.02]} />
        <meshStandardMaterial color="#cfd5e3" metalness={1} roughness={0.2} />
      </mesh>
      <lineSegments geometry={net} position={[RIM.x, RIM.y, RIM.z]}>
        <lineBasicMaterial color="#eceae4" transparent opacity={0.75} />
      </lineSegments>

      {/* score sensor just under the rim: a ball must pass down through it */}
      <CylinderCollider args={[0.03, RIM_RADIUS * 0.72]} position={[RIM.x, RIM.y - 0.13, RIM.z]} sensor onIntersectionEnter={onSensor} />

      {/* pole */}
      <mesh position={[RIM.x, (RIM.y + 0.3) / 2, BOARD_Z - 0.35]}>
        <cylinderGeometry args={[0.05, 0.06, RIM.y + 0.3, 20]} />
        <meshStandardMaterial color="#1a1d2a" metalness={0.8} roughness={0.35} />
      </mesh>
      <CuboidCollider args={[0.06, (RIM.y + 0.3) / 2, 0.06]} position={[RIM.x, (RIM.y + 0.3) / 2, BOARD_Z - 0.35]} collisionGroups={GROUPS.world} />
    </RigidBody>
  );
}
