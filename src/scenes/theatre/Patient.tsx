"use client";

import type { Collider } from "@dimforge/rapier3d-compat";
import { RoundedBox } from "@react-three/drei";
import { BallCollider, CuboidCollider, RigidBody, RoundCuboidCollider, type RapierRigidBody } from "@react-three/rapier";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { GROUPS } from "@/lib/physics/groups";
import { GUIDE, PAD, PAD_TOP, TABLE_TOP, TORSO, TORSO_TOP, WOUND } from "./layout";

/** The patient's colliders, for contact depth and sterile-field checks. */
export const anatomyColliders: Collider[] = [];

/** Soft ceramic skin for the training mannequin. */
function skinMaterial() {
  return new THREE.MeshPhysicalMaterial({ color: "#e9e4dc", roughness: 0.55, sheen: 0.6, sheenColor: "#ffd9c7", clearcoat: 0.15 });
}

function DottedGuide() {
  const geo = useMemo(() => {
    const pts: number[] = [];
    const n = 24;
    for (let i = 0; i < n; i += 1) {
      const t0 = i / n;
      const t1 = (i + 0.55) / n;
      for (const t of [t0, t1]) pts.push(GUIDE.from.x + (GUIDE.to.x - GUIDE.from.x) * t, PAD_TOP + 0.0006, GUIDE.from.z + (GUIDE.to.z - GUIDE.from.z) * t);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    return g;
  }, []);
  return (
    <lineSegments geometry={geo}>
      <lineBasicMaterial color="#1f6f86" />
    </lineSegments>
  );
}

export function Patient() {
  const body = useRef<RapierRigidBody>(null);
  const skin = useMemo(() => skinMaterial(), []);

  useEffect(() => {
    const b = body.current;
    if (!b) return;
    anatomyColliders.length = 0;
    for (let i = 0; i < b.numColliders(); i++) anatomyColliders.push(b.collider(i));
  });

  const woundRing = 14;
  return (
    <>
      {/* operating table */}
      <RigidBody type="fixed" colliders={false} position={[-0.1, TABLE_TOP - 0.03, TORSO.z]}>
        <CuboidCollider args={[0.65, 0.03, 0.24]} collisionGroups={GROUPS.world} />
        <mesh receiveShadow castShadow>
          <boxGeometry args={[1.3, 0.06, 0.48]} />
          <meshStandardMaterial color="#2a3142" metalness={0.75} roughness={0.3} />
        </mesh>
        <mesh position={[0, -0.42, 0]}>
          <cylinderGeometry args={[0.06, 0.12, 0.8, 24]} />
          <meshStandardMaterial color="#141722" metalness={0.7} roughness={0.35} />
        </mesh>
      </RigidBody>

      {/* the patient: a stylised training mannequin */}
      <RigidBody ref={body} type="fixed" colliders={false} name="patient">
        <RoundCuboidCollider args={[TORSO.half[0], TORSO.half[1], TORSO.half[2], TORSO.radius]} position={[TORSO.x, TORSO.y, TORSO.z]} collisionGroups={GROUPS.anatomy} friction={0.9} />
        <BallCollider args={[0.1]} position={[TORSO.x - 0.42, TORSO.y, TORSO.z]} collisionGroups={GROUPS.anatomy} />
        {/* silicone practice pad */}
        <CuboidCollider args={[PAD.half[0], PAD.half[1], PAD.half[2]]} position={[PAD.x, TORSO_TOP + PAD.half[1], PAD.z]} collisionGroups={GROUPS.anatomy} friction={1.1} />
        {/* wound site: a raised ring the fragments sit inside */}
        {Array.from({ length: woundRing }, (_, i) => {
          const a = (i / woundRing) * Math.PI * 2;
          return (
            <BallCollider
              key={i}
              args={[0.012]}
              position={[WOUND.x + Math.cos(a) * WOUND.radius, TORSO_TOP + 0.006, WOUND.z + Math.sin(a) * WOUND.radius]}
              collisionGroups={GROUPS.anatomy}
            />
          );
        })}

        <RoundedBox args={[TORSO.half[0] * 2 + TORSO.radius * 2, TORSO.half[1] * 2 + TORSO.radius * 2, TORSO.half[2] * 2 + TORSO.radius * 2]} radius={TORSO.radius} smoothness={6} position={[TORSO.x, TORSO.y, TORSO.z]} material={skin} castShadow receiveShadow />
        <mesh position={[TORSO.x - 0.42, TORSO.y, TORSO.z]} material={skin} castShadow>
          <sphereGeometry args={[0.1, 48, 32]} />
        </mesh>
        <mesh position={[PAD.x, TORSO_TOP + PAD.half[1], PAD.z]} receiveShadow castShadow>
          <boxGeometry args={[PAD.half[0] * 2, PAD.half[1] * 2, PAD.half[2] * 2]} />
          <meshPhysicalMaterial color="#e7b8ad" roughness={0.6} sheen={0.8} sheenColor="#ffc9b9" />
        </mesh>
        <DottedGuide />
        <mesh position={[WOUND.x, TORSO_TOP + 0.006, WOUND.z]} rotation-x={Math.PI / 2} castShadow>
          <torusGeometry args={[WOUND.radius, 0.012, 16, 48]} />
          <meshPhysicalMaterial color="#d79a8e" roughness={0.5} sheen={0.6} />
        </mesh>
        <mesh position={[WOUND.x, TORSO_TOP + 0.0008, WOUND.z]} rotation-x={-Math.PI / 2}>
          <circleGeometry args={[WOUND.radius, 48]} />
          <meshStandardMaterial color="#7d2f2a" roughness={0.4} />
        </mesh>
      </RigidBody>
    </>
  );
}
