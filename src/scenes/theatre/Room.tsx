"use client";

import { useGLTF } from "@react-three/drei";
import { CuboidCollider, RigidBody } from "@react-three/rapier";
import { useMemo } from "react";
import * as THREE from "three";
import { useObstacle } from "@/state/obstacles";

const MODEL_URL = "/models/theatre-room.glb";
/** Meshes that catch the patient's and the instruments' shadows. */
const SHADOW_CATCHERS = ["Room_Floor", "Room_Inlay", "Room_InlayRing"];

/**
 * The operating room, built by scripts/blender/build_theatre_room.py: walls, doors, monitor, ceiling
 * LEDs and the floor, drawn as exported. Visual only, except the ground collider (floor top at y 0).
 */
export function Room() {
  const { scene } = useGLTF(MODEL_URL);
  const room = useMemo(() => {
    scene.traverse((o) => {
      if (o instanceof THREE.Mesh) o.receiveShadow = SHADOW_CATCHERS.includes(o.name);
    });
    return scene;
  }, [scene]);
  useObstacle("floor", () => ({ kind: "floor", y: 0 }));
  return (
    <>
      <RigidBody type="fixed" colliders={false} name="floor">
        <CuboidCollider args={[3.5, 0.1, 3.5]} position={[-0.1, -0.1, -0.4]} />
      </RigidBody>
      <primitive object={room} />
    </>
  );
}

useGLTF.preload(MODEL_URL);
