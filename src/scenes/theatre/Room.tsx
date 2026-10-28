"use client";

import { Environment, useGLTF } from "@react-three/drei";
import { CuboidCollider, RigidBody } from "@react-three/rapier";
import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useObstacle } from "@/state/obstacles";

const MODEL_URL = "/models/theatre-room.glb";
const ENV_URL = "/env/theatre-room.hdr";

/**
 * The operating room, built by scripts/blender/build_theatre_room.py and lit by bake_theatre_room.py.
 * Room_Baked carries its lighting in its texture and is drawn unlit; the glowing parts and the painting
 * are drawn as exported. Visual only, except the ground collider (floor top at y 0).
 */
export function Room() {
  const { scene } = useGLTF(MODEL_URL);
  const room = useMemo(() => {
    scene.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      if (o.name === "Room_Baked") {
        const baked = o.material as THREE.MeshStandardMaterial;
        o.material = new THREE.MeshBasicMaterial({ map: baked.map, toneMapped: false });
      }
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
      {/* the baked floor can't take live shadows: a shadow-only sheet just above it does */}
      <mesh rotation-x={-Math.PI / 2} position={[-0.1, 0.002, -0.4]} receiveShadow>
        <planeGeometry args={[7, 7]} />
        <shadowMaterial opacity={0.28} />
      </mesh>
      <SurgicalLight scene={scene} name="A" />
      <SurgicalLight scene={scene} name="B" />
    </>
  );
}

/** A live spotlight where the baked surgical light hangs (the LIGHT_Surgical_* markers), aimed alike. */
function SurgicalLight({ scene, name }: { scene: THREE.Object3D; name: string }) {
  const light = useRef<THREE.SpotLight>(null);
  const at = scene.getObjectByName(`LIGHT_Surgical_${name}`)!.position;
  const aim = scene.getObjectByName(`LIGHT_Surgical_${name}_TARGET`)!.position;
  useLayoutEffect(() => {
    const l = light.current;
    if (!l) return;
    l.target.position.copy(aim);
    l.target.updateMatrixWorld();
  }, [aim]);
  return (
    <spotLight
      ref={light}
      position={at}
      angle={0.42}
      penumbra={0.7}
      intensity={1.6}
      distance={4}
      decay={1.5}
      color="#fff4e6"
      castShadow
      shadow-mapSize={[1024, 1024]}
      shadow-bias={-0.0002}
      shadow-normalBias={0.01}
    />
  );
}

/**
 * Image-based light and reflections from the baked room, for what moves: patient, tools, hands. The HDR
 * is the room at Cycles' own brightness; the bake was exposed ×0.1 (bake_theatre_room.py), so is this.
 */
const ENV_EXPOSURE = 0.1;

export function TheatreLighting() {
  return (
    <>
      <Environment files={ENV_URL} environmentIntensity={ENV_EXPOSURE} />
      <ambientLight intensity={0.05} />
    </>
  );
}

useGLTF.preload(MODEL_URL);
