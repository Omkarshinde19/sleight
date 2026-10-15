"use client";

import { Grid } from "@react-three/drei";
import { CuboidCollider, RigidBody } from "@react-three/rapier";

/** Blueprint floor: a dark reflective slab with a cyan drafting grid, and a physics ground. */
export function Floor({ size = 30 }: { size?: number }) {
  return (
    <>
      <RigidBody type="fixed" colliders={false} name="floor">
        <CuboidCollider args={[size / 2, 0.1, size / 2]} position={[0, -0.1, 0]} />
      </RigidBody>
      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <planeGeometry args={[size, size]} />
        <meshStandardMaterial color="#0b0d16" metalness={0.6} roughness={0.55} />
      </mesh>
      <Grid
        position={[0, 0.002, 0]}
        args={[size, size]}
        cellSize={0.1}
        cellThickness={0.5}
        cellColor="#1f3a52"
        sectionSize={1}
        sectionThickness={1}
        sectionColor="#3f8fb0"
        fadeDistance={14}
        fadeStrength={1.5}
        infiniteGrid
      />
    </>
  );
}
