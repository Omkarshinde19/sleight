"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Suspense, useRef } from "react";
import * as THREE from "three";
import { RobotHand } from "@/components/hands/RobotHand";
import { Studio } from "@/components/scene/Studio";
import { Weather } from "@/components/weather/Weather";
import { handFeatures } from "@/lib/hand/gestures";
import { jointsInScene, type Workspace } from "@/lib/hand/mapping";
import { lerpPose, POSES, synthHand, type HandPose, type Orientation } from "@/lib/hand/synth";
import { LM } from "@/lib/hand/types";
import type { TrackedHand } from "@/lib/tracking/processor";
import { handStore } from "@/state/handStore";
import { hero } from "./hero";

const HAND_SCALE = 1.44;
const WS: Workspace = { center: { x: 0, y: 0, z: 0 }, width: 1, height: 1, depthGain: 1, depthRange: 1, handScale: HAND_SCALE };
/** The camera looks at this point; the hand moves on the plane z = 0 through it. */
const LOOK = new THREE.Vector3(0, 1.13, 0);
/** Palm toward the viewer, fingers up, turned a little toward the headline. */
const FACING: Orientation = { roll: 0.25, pitch: -0.2, yaw: 0.35 };

const toV = (p: { x: number; y: number; z: number }) => new THREE.Vector3(p.x, p.y, p.z);
const ray = new THREE.Raycaster();
const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
const ndc = new THREE.Vector2();
const projected = new THREE.Vector3();

/** A point in the hero (px) → the plane the hand moves on. */
function heroToWorld(x: number, y: number, size: { width: number; height: number }, camera: THREE.Camera, out: THREE.Vector3) {
  ndc.set((x / size.width) * 2 - 1, -(y / size.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  return ray.ray.intersectPlane(plane, out) ?? out.copy(LOOK);
}

function Driver() {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const live = useRef({ anchor: LOOK.clone(), pose: POSES.open as HandPose, orientation: { ...FACING } });
  const target = useRef(new THREE.Vector3());

  useFrame((state, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    const t = state.clock.elapsedTime;
    const portrait = size.width < size.height;
    camera.position.set(0, 1.2, portrait ? 2.6 : 1.55);
    camera.lookAt(LOOK);

    // idle: a slow float between the two lines of the headline
    const L = live.current;
    heroToWorld(size.width * (portrait ? 0.5 : 0.56) + Math.sin(t * 0.5) * size.width * 0.03, size.height * 0.5 + Math.sin(t * 0.8) * size.height * 0.02, size, camera, target.current);
    const pose: HandPose = { curl: POSES.open.curl.map((c, i) => c + 0.12 + 0.06 * Math.sin(t * 1.3 + i * 0.6)) as HandPose["curl"], pinch: 0 };

    L.anchor.lerp(target.current, 1 - Math.exp(-dt / 0.12));
    L.pose = lerpPose(L.pose, pose, 1 - Math.exp(-dt / 0.1));
    L.orientation.roll += (FACING.roll + Math.sin(t * 0.6) * 0.08 - L.orientation.roll) * 0.1;

    const raw = synthHand({ handedness: "Right", pose: L.pose, orientation: L.orientation, imageX: 0.5, imageY: 0.5, distance: 0.5 });
    const joints = jointsInScene(raw.worldLandmarks, L.anchor, WS);
    const grip = toV(joints[LM.MIDDLE_MCP]).lerp(toV(joints[LM.WRIST]), 0.35);
    const hand = { handedness: "Right", joints, features: handFeatures(raw.worldLandmarks), grip, palm: grip } as unknown as TrackedHand;
    handStore.setState({ hands: { Right: hand } });

    projected.copy(grip).project(camera);
    hero.hand.x = (projected.x * 0.5 + 0.5) * size.width;
    hero.hand.y = (-projected.y * 0.5 + 0.5) * size.height;
    hero.hand.visible = true;
  });

  return null;
}

export default function LandingStage() {
  return (
    <Canvas dpr={[1, 1.6]} camera={{ position: [0, 1.2, 1.55], fov: 42, near: 0.05, far: 30 }} gl={{ antialias: true, alpha: true }}>
      <Studio intensity={1.1} />
      <Weather />
      <Suspense fallback={null}>
        <RobotHand hand="Right" scale={HAND_SCALE} />
      </Suspense>
      <Driver />
    </Canvas>
  );
}
