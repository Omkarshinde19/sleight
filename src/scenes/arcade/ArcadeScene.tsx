"use client";

import type { IntersectionEnterPayload } from "@react-three/rapier";
import { CuboidCollider, RigidBody } from "@react-three/rapier";
import { HandPhysics } from "@/components/physics/HandPhysics";
import { Floor } from "@/components/scene/Floor";
import { SceneShell } from "@/components/scene/SceneShell";
import type { Workspace } from "@/lib/hand/mapping";
import { GROUPS } from "@/lib/physics/groups";
import { ArcadeHud } from "./ArcadeHud";
import { useArcade } from "./arcadeStore";
import { balls, Balls } from "./Balls";
import { Hoop } from "./Hoop";

const WORKSPACE: Workspace = {
  center: { x: 0.1, y: 1.15, z: 0 },
  width: 1.7,
  height: 1.15,
  depthGain: 1.4,
  depthRange: 0.6,
  handScale: 1.5,
};

function onSensor({ other }: IntersectionEnterPayload) {
  const i = (other.rigidBody?.userData as { ball?: number } | undefined)?.ball;
  if (i === undefined) return;
  const b = balls[i];
  // Only a ball coming down through the rim counts, and only once per throw.
  if (b.state !== "flying" || (other.rigidBody?.linvel().y ?? 0) > 0) return;
  b.state = "scored";
  b.since = performance.now();
  useArcade.getState().scored();
}

/** Neon arcade back wall: indigo and ember tubes on dark panels. */
function Room() {
  return (
    <>
      <RigidBody type="fixed" colliders={false}>
        <CuboidCollider args={[8, 4, 0.1]} position={[0, 4, -5.2]} collisionGroups={GROUPS.world} restitution={0.4} />
      </RigidBody>
      <mesh position={[0, 4, -5.1]} receiveShadow>
        <planeGeometry args={[16, 8]} />
        <meshStandardMaterial color="#0c0e1a" roughness={0.8} />
      </mesh>
      {[
        { y: 0.6, c: "#6a4bc4" },
        { y: 3.9, c: "#e2553a" },
      ].map(({ y, c }) => (
        <mesh key={y} position={[0, y, -5.05]}>
          <boxGeometry args={[12, 0.035, 0.035]} />
          <meshBasicMaterial color={c} toneMapped={false} />
        </mesh>
      ))}
      {[-3.2, 3.2].map((x) => (
        <mesh key={x} position={[x, 2.25, -5.05]}>
          <boxGeometry args={[0.035, 3.3, 0.035]} />
          <meshBasicMaterial color="#7fe3f0" toneMapped={false} />
        </mesh>
      ))}
      <pointLight position={[0, 3.5, -4.4]} intensity={6} color="#9b7cff" distance={7} />
      <pointLight position={[0, 1.2, -4.4]} intensity={3} color="#ff6a45" distance={5} />
    </>
  );
}

// For automated browser checks: the score store and the balls' runtime state.
if (typeof window !== "undefined") Object.assign(window, { __arcade: useArcade, __arcadeBalls: balls });

export default function ArcadeScene() {
  return (
    <SceneShell
      title="Arcade Room"
      brief="Make a fist on a basketball, swing forward and up, and open your hand to let go. The ball keeps your hand's speed."
      demo="/sessions/demo.json"
      workspace={WORKSPACE}
      camera={{ position: [0.05, 1.55, 1.55], fov: 55, lookAt: [0, 1.45, -2.6] }}
      hud={<ArcadeHud />}
    >
      <HandPhysics scale={WORKSPACE.handScale}>
        <Floor />
        <Room />
        <Hoop onSensor={onSensor} />
        <Balls />
      </HandPhysics>
    </SceneShell>
  );
}
