"use client";

import { CuboidCollider, RigidBody } from "@react-three/rapier";
import { HandPhysics } from "@/components/physics/HandPhysics";
import { Floor } from "@/components/scene/Floor";
import { SceneShell } from "@/components/scene/SceneShell";
import type { Workspace } from "@/lib/hand/mapping";
import { GROUPS } from "@/lib/physics/groups";
import { Chip, CircuitBoard } from "./ChipAndSocket";
import { IndustrialHud } from "./IndustrialHud";
import { useIndustrial } from "./industrialStore";
import { Levers } from "./Levers";
import { Machine } from "./Machine";

const WORKSPACE: Workspace = {
  center: { x: 0.02, y: 1.08, z: -0.12 },
  width: 1.5,
  height: 0.9,
  depthGain: 1.1,
  depthRange: 0.45,
  handScale: 0.875, // was 1.4: hands 1.6× smaller
};

if (typeof window !== "undefined") Object.assign(window, { __industrial: useIndustrial });

function Workbench() {
  return (
    <RigidBody type="fixed" colliders={false} position={[0, 0.88, -0.3]}>
      <CuboidCollider args={[0.9, 0.02, 0.32]} collisionGroups={GROUPS.world} friction={1} />
      <mesh receiveShadow castShadow>
        <boxGeometry args={[1.8, 0.04, 0.64]} />
        <meshStandardMaterial color="#2a2e3c" metalness={0.85} roughness={0.32} />
      </mesh>
      {/* hazard edge */}
      <mesh position={[0, 0.021, 0.31]}>
        <boxGeometry args={[1.8, 0.002, 0.02]} />
        <meshBasicMaterial color="#ffb000" />
      </mesh>
      {[-0.85, 0.85].map((x) =>
        [-0.28, 0.28].map((z) => (
          <mesh key={`${x}${z}`} position={[x, -0.45, z]}>
            <boxGeometry args={[0.05, 0.86, 0.05]} />
            <meshStandardMaterial color="#141722" metalness={0.6} roughness={0.4} />
          </mesh>
        )),
      )}
    </RigidBody>
  );
}

export default function IndustrialScene() {
  return (
    <SceneShell
      title="Industrial Floor"
      brief="Pinch the tiny microchip and seat it in the socket to power the controller. Then make a fist on a lever knob and pull: the levers are heavy and spring back. Throttle runs the line, Press stamps parts."
      demo="/sessions/demo.json"
      workspace={WORKSPACE}
      camera={{ position: [0.05, 1.72, 1.35], fov: 50, lookAt: [0.05, 0.95, -0.75] }}
      hud={<IndustrialHud />}
    >
      <HandPhysics scale={WORKSPACE.handScale}>
        <Floor />
        <Workbench />
        <CircuitBoard />
        <Chip />
        <Levers />
        <Machine />
        <pointLight position={[0.25, 2.2, -1.2]} intensity={4} color="#ffb36b" distance={4} />
      </HandPhysics>
    </SceneShell>
  );
}
