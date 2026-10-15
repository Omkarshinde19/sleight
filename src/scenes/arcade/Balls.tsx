"use client";

import { useFrame } from "@react-three/fiber";
import { BallCollider, CuboidCollider, RigidBody, type RapierRigidBody } from "@react-three/rapier";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useGrabbable } from "@/components/physics/HandPhysics";
import { assistThrow, DEFAULT_ASSIST } from "@/lib/physics/aim";
import { GROUPS } from "@/lib/physics/groups";
import type { Point } from "@/lib/hand/types";
import { ASSIST_STRENGTH, useArcade } from "./arcadeStore";
import { makeBallTexture } from "./ballTexture";
import { hoopOffset, RIM } from "./Hoop";

export const BALL_RADIUS = 0.12;
export const RACK = { x: 0.42, y: 0.8, z: -0.25 };
const SLOTS: Point[] = [-0.26, 0, 0.26].map((dx) => ({ x: RACK.x + dx, y: RACK.y + BALL_RADIUS + 0.03, z: RACK.z }));

type BallState = "rack" | "held" | "flying" | "scored" | "loose";

export interface BallRuntime {
  body: RapierRigidBody | null;
  state: BallState;
  since: number;
  trail: Point[];
}

// Shared so the scene's sensor callback and tests can see ball state.
export const balls: BallRuntime[] = SLOTS.map(() => ({ body: null, state: "rack", since: 0, trail: [] }));

/** Arcade throw: hand speeds are small, so scale them up; z (depth) is the weakest signal, so most gain. */
const THROW = { windowSec: 0.12, lookbackSec: 0.35, gain: { x: 2.2, y: 2.8, z: 3.4 }, maxSpeed: 13 };

function Ball({ index, texture }: { index: number; texture: THREE.Texture }) {
  const rt = balls[index];
  const ref = useRef<RapierRigidBody>(null);
  const threw = useArcade((s) => s.threw);

  useEffect(() => {
    rt.body = ref.current;
  });

  useGrabbable({
    id: `ball-${index}`,
    name: `BALL ${index + 1}`,
    body: () => ref.current,
    gestures: ["fist", "pinch"],
    reach: BALL_RADIUS + 0.13,
    throwable: THROW,
    onGrab: () => {
      rt.state = "held";
      rt.trail = [];
    },
    onRelease: ({ velocity }) => {
      const p = ref.current!.translation();
      const speed = Math.hypot(velocity.x, velocity.y, velocity.z);
      if (speed < 1.2) {
        rt.state = "loose";
        rt.since = performance.now();
        return;
      }
      const strength = ASSIST_STRENGTH[useArcade.getState().assist];
      const target = { x: RIM.x + hoopOffset.x, y: RIM.y + 0.04, z: RIM.z };
      const v = strength ? assistThrow(velocity, p, target, { ...DEFAULT_ASSIST, strength }) : velocity;
      const s = Math.hypot(v.x, v.y, v.z);
      threw({ speed: s, angleDeg: (Math.atan2(v.y, Math.hypot(v.x, v.z)) * 180) / Math.PI, assisted: v !== velocity, raw: velocity, from: { x: p.x, y: p.y, z: p.z } });
      rt.state = "flying";
      rt.since = performance.now();
      rt.trail = [{ ...p }];
      return v;
    },
  });

  return (
    <RigidBody
      ref={ref}
      position={[SLOTS[index].x, SLOTS[index].y, SLOTS[index].z]}
      colliders={false}
      ccd
      linearDamping={0.05}
      angularDamping={0.3}
      userData={{ ball: index }}
      name={`ball-${index}`}
      onCollisionEnter={({ other }) => {
        if (other.rigidBodyObject?.name === "floor" && rt.state === "flying") {
          rt.state = "loose";
          rt.since = performance.now();
          useArcade.getState().missed();
        }
      }}
    >
      <BallCollider args={[BALL_RADIUS]} mass={0.6} restitution={0.78} friction={0.9} collisionGroups={GROUPS.prop} />
      <mesh castShadow>
        <sphereGeometry args={[BALL_RADIUS, 48, 32]} />
        <meshPhysicalMaterial map={texture} roughness={0.55} clearcoat={0.25} clearcoatRoughness={0.4} sheen={0.4} sheenColor="#ffb08a" />
      </mesh>
    </RigidBody>
  );
}

/** Where the ball has been since release, drawn as a dashed blueprint arc. */
function Trails() {
  const lines = useMemo(
    () =>
      balls.map(() => {
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(240 * 3), 3));
        g.setDrawRange(0, 0);
        const l = new THREE.Line(g, new THREE.LineDashedMaterial({ color: "#7fe3f0", dashSize: 0.06, gapSize: 0.04, transparent: true, opacity: 0.85 }));
        l.frustumCulled = false;
        return l;
      }),
    [],
  );

  useFrame(() => {
    balls.forEach((b, i) => {
      const line = lines[i];
      const body = b.body;
      if (body && (b.state === "flying" || b.state === "scored") && b.trail.length < 240) {
        const p = body.translation();
        const last = b.trail[b.trail.length - 1];
        if (!last || Math.hypot(p.x - last.x, p.y - last.y, p.z - last.z) > 0.03) b.trail.push({ x: p.x, y: p.y, z: p.z });
      }
      const pos = line.geometry.getAttribute("position") as THREE.BufferAttribute;
      b.trail.forEach((p, j) => pos.setXYZ(j, p.x, p.y, p.z));
      pos.needsUpdate = true;
      line.geometry.setDrawRange(0, b.trail.length);
      line.computeLineDistances();
      (line.material as THREE.LineDashedMaterial).opacity = b.state === "rack" || b.state === "held" ? 0 : 0.85;
    });
  });

  return (
    <>
      {lines.map((l, i) => (
        <primitive key={i} object={l} />
      ))}
    </>
  );
}

/** Puts balls that have finished their flight back in the rack. Moving an un-held ball is fine. */
function Respawner() {
  useFrame(() => {
    const now = performance.now();
    balls.forEach((b, i) => {
      const body = b.body;
      if (!body || b.state === "held" || b.state === "rack") return;
      const p = body.translation();
      const restingFor = now - b.since;
      const lost = p.y < -2 || Math.abs(p.x) > 8 || p.z > 4 || p.z < -9;
      const done = (b.state === "scored" && restingFor > 2500) || (b.state === "loose" && restingFor > 3500) || (b.state === "flying" && restingFor > 6000);
      if (lost || done) {
        body.setTranslation(SLOTS[i], true);
        body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        body.setAngvel({ x: 0, y: 0, z: 0 }, true);
        b.state = "rack";
        b.trail = [];
      }
    });
  });
  return null;
}

export function Balls() {
  const texture = useMemo(() => makeBallTexture(), []);
  return (
    <>
      {/* the rack: a chrome shelf with lips so balls stay put */}
      <RigidBody type="fixed" colliders={false} position={[RACK.x, RACK.y, RACK.z]}>
        <CuboidCollider args={[0.42, 0.015, 0.16]} collisionGroups={GROUPS.world} />
        <CuboidCollider args={[0.42, 0.04, 0.01]} position={[0, 0.04, 0.15]} collisionGroups={GROUPS.world} />
        <CuboidCollider args={[0.42, 0.04, 0.01]} position={[0, 0.04, -0.15]} collisionGroups={GROUPS.world} />
        {[-0.13, 0.13].map((dx) => (
          <CuboidCollider key={dx} args={[0.01, 0.025, 0.15]} position={[dx, 0.03, 0]} collisionGroups={GROUPS.world} />
        ))}
        <mesh castShadow receiveShadow>
          <boxGeometry args={[0.84, 0.03, 0.32]} />
          <meshStandardMaterial color="#d7dbe6" metalness={1} roughness={0.18} />
        </mesh>
        <mesh position={[0, -RACK.y / 2, 0]} castShadow>
          <cylinderGeometry args={[0.03, 0.05, RACK.y, 16]} />
          <meshStandardMaterial color="#20232f" metalness={0.8} roughness={0.3} />
        </mesh>
      </RigidBody>
      {balls.map((_, i) => (
        <Ball key={i} index={i} texture={texture} />
      ))}
      <Trails />
      <Respawner />
    </>
  );
}
