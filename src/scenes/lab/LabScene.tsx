"use client";

import { RigidBody } from "@react-three/rapier";
import { Suspense } from "react";
import { SmokeModel } from "@/components/assets/SmokeModel";
import { Floor } from "@/components/scene/Floor";
import { SceneShell } from "@/components/scene/SceneShell";

/** M1 test bench: the hands, a floor, a few blocks and the Blender pipeline's reference box. */
export default function LabScene() {
  return (
    <SceneShell debug title="Lab" brief="A bare bench for checking tracking: move, pinch, make a fist, point." demo="/sessions/demo.json">
      <Floor />
      {[-0.4, 0, 0.4].map((x, i) => (
        <RigidBody key={i} position={[x, 0.08, -0.3]} colliders="cuboid">
          <mesh castShadow>
            <boxGeometry args={[0.16, 0.16, 0.16]} />
            <meshStandardMaterial color={["#6a4bc4", "#e2553a", "#7fe3f0"][i]} roughness={0.35} metalness={0.2} />
          </mesh>
        </RigidBody>
      ))}
      <Suspense fallback={null}>
        <SmokeModel />
      </Suspense>
    </SceneShell>
  );
}
