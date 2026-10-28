"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Suspense, useMemo, useRef } from "react";
import * as THREE from "three";
import { RobotHand } from "@/components/hands/RobotHand";
import { Studio } from "@/components/scene/Studio";
import { Weather } from "@/components/weather/Weather";
import { handFeatures } from "@/lib/hand/gestures";
import { jointsInScene, type Workspace } from "@/lib/hand/mapping";
import { CLAW, lerpPose, POSES, synthHand, type HandPose, type Orientation } from "@/lib/hand/synth";
import { LM } from "@/lib/hand/types";
import { makeChromeMaterial } from "@/lib/materials/chrome";
import type { TrackedHand } from "@/lib/tracking/processor";
import { handStore } from "@/state/handStore";
import { Halftone } from "./Halftone";
import { cameraDistance, hero, LANDING_WORKSPACE } from "./hero";

const HAND_SCALE = LANDING_WORKSPACE.handScale;
const WS: Workspace = { center: { x: 0, y: 0, z: 0 }, width: 1, height: 1, depthGain: 1, depthRange: 1, handScale: HAND_SCALE };
/** The camera looks at this point; the hand moves on the plane z = 0 through it. */
const LOOK = new THREE.Vector3(0, 1.13, 0);
/** Palm toward the viewer, fingers up, turned a little toward the headline. */
const FACING: Orientation = { roll: 0.25, pitch: -0.2, yaw: 0.35 };
/** Hovering a room in the index: the hand acts it out (see the thrower loop and the scalpel below). */
const THROWER: Orientation = { roll: 0.25, pitch: -0.35, yaw: 0.4 };
const SURGEON: Orientation = { roll: 0.8, pitch: -0.95, yaw: 0.2 };
const SCALPEL_GRIP: HandPose = { curl: [0.35, 0.42, 0.55, 0.7, 0.8], pinch: 0.92 };
/** One throw, s: wind up, flick, the ball flies, the hand opens. */
const THROW_LOOP = 2.6;

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
  const ball = useRef<THREE.Mesh>(null);
  const scalpel = useRef<THREE.Group>(null);
  const chrome = useMemo(() => makeChromeMaterial(), []);
  const released = useRef(new THREE.Vector3());

  useFrame((state, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    const t = state.clock.elapsedTime;
    const portrait = size.width < size.height;
    camera.position.set(0, 1.2, cameraDistance(size.width, size.height));
    camera.lookAt(LOOK);

    // your own hand, through the camera (or a recorded session): the tracker drives the robot hand
    const st = handStore.getState();
    if (st.source && st.status === "running") {
      const h = st.hands.Right ?? st.hands.Left;
      hero.hand.visible = !!h;
      if (ball.current) ball.current.visible = false;
      if (scalpel.current) scalpel.current.visible = false;
      if (!h) return;
      projected.copy(toV(h.grip)).project(camera);
      hero.hand.x = (projected.x * 0.5 + 0.5) * size.width;
      hero.hand.y = (-projected.y * 0.5 + 0.5) * size.height;
      hero.hand.closed = h.gesture === "fist" || h.gesture === "pinch";
      return;
    }

    const L = live.current;
    const P = hero.pointer;
    const room = hero.preview;
    const cycle = (t % THROW_LOOP) / THROW_LOOP;
    let pose: HandPose;
    let facing = FACING;
    if (room) {
      // a staged hand in the middle of the hero, acting out the room
      heroToWorld(size.width * 0.5, size.height * 0.52, size, camera, target.current);
      if (room === "arcade") {
        facing = THROWER;
        pose = cycle > 0.55 ? POSES.open : CLAW;
        // wind up (dip), then flick up and away
        target.current.y += cycle < 0.45 ? -0.08 * Math.sin((cycle / 0.45) * Math.PI) : 0.12 * Math.sin(Math.min(1, (cycle - 0.45) / 0.2) * Math.PI * 0.5);
        if (cycle >= 0.45) target.current.z -= 0.1;
      } else {
        facing = SURGEON;
        pose = SCALPEL_GRIP;
        // slow strokes along an incision
        target.current.x += Math.sin(t * 1.4) * 0.14;
        target.current.y -= 0.05 + Math.abs(Math.cos(t * 1.4)) * 0.03;
      }
    } else if (P.active) {
      // the mouse (or a finger) carries the hand; pressing closes it
      heroToWorld(P.x, P.y, size, camera, target.current);
      pose = hero.pressed ? POSES.fist : { curl: [0.1, 0.08, 0.1, 0.12, 0.15], pinch: 0 };
    } else {
      // idle: a slow float between the two lines of the headline
      heroToWorld(size.width * (portrait ? 0.5 : 0.56) + Math.sin(t * 0.5) * size.width * 0.03, size.height * 0.5 + Math.sin(t * 0.8) * size.height * 0.02, size, camera, target.current);
      pose = { curl: POSES.open.curl.map((c, i) => c + 0.12 + 0.06 * Math.sin(t * 1.3 + i * 0.6)) as HandPose["curl"], pinch: 0 };
    }

    const before = L.anchor.x;
    const throwing = room === "arcade" && cycle >= 0.45 && cycle < 0.65;
    L.anchor.lerp(target.current, 1 - Math.exp(-dt / (throwing ? 0.04 : P.active && !room ? 0.05 : 0.12)));
    L.pose = lerpPose(L.pose, pose, 1 - Math.exp(-dt / 0.06));
    // lean into sideways moves
    const vx = (L.anchor.x - before) / Math.max(dt, 1e-3);
    const k = 1 - Math.exp(-dt / 0.15);
    const roll = facing.roll + Math.sin(t * 0.6) * 0.08 - THREE.MathUtils.clamp(vx * 0.35, -0.6, 0.6);
    L.orientation.roll += (roll - L.orientation.roll) * k;
    L.orientation.pitch += (facing.pitch - L.orientation.pitch) * k;
    L.orientation.yaw += (facing.yaw - L.orientation.yaw) * k;

    const raw = synthHand({ handedness: "Right", pose: L.pose, orientation: L.orientation, imageX: 0.5, imageY: 0.5, distance: 0.5 });
    const joints = jointsInScene(raw.worldLandmarks, L.anchor, WS);
    const grip = toV(joints[LM.MIDDLE_MCP]).lerp(toV(joints[LM.WRIST]), 0.35);
    const hand = { handedness: "Right", joints, features: handFeatures(raw.worldLandmarks), grip, palm: grip } as unknown as TrackedHand;
    handStore.setState({ hands: { Right: hand } });

    projected.copy(grip).project(camera);
    hero.hand.x = (projected.x * 0.5 + 0.5) * size.width;
    hero.hand.y = (-projected.y * 0.5 + 0.5) * size.height;
    hero.hand.closed = !room && P.active && hero.pressed;
    hero.hand.visible = true;

    // props: the basketball sits in the claw, then flies off on the flick
    if (ball.current) {
      ball.current.visible = room === "arcade";
      if (room === "arcade") {
        if (cycle <= 0.55) {
          ball.current.position.copy(grip).add(new THREE.Vector3(-0.02, 0.09, -0.1));
          released.current.copy(ball.current.position);
        } else {
          const s = (cycle - 0.55) * THROW_LOOP;
          ball.current.position.copy(released.current).add(new THREE.Vector3(-0.5 * s, 2.6 * s - 4.9 * s * s, -1.6 * s));
        }
        ball.current.rotation.x -= dt * 6;
      }
    }
    if (scalpel.current) {
      scalpel.current.visible = room === "theatre";
      if (room === "theatre") {
        scalpel.current.position.copy(toV(joints[LM.THUMB_TIP])).lerp(toV(joints[LM.INDEX_TIP]), 0.5);
        const dir = toV(joints[LM.INDEX_TIP]).sub(toV(joints[LM.INDEX_MCP])).normalize();
        scalpel.current.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), dir);
      }
    }
  });

  return (
    <>
      <mesh ref={ball} visible={false}>
        <sphereGeometry args={[0.085, 40, 24]} />
        <meshPhysicalMaterial color="#e2553a" roughness={0.55} clearcoat={0.3} />
      </mesh>
      <group ref={scalpel} visible={false}>
        <mesh material={chrome} position={[0, 0, 0.09]}>
          <boxGeometry args={[0.02, 0.014, 0.24]} />
        </mesh>
        <mesh material={chrome} position={[0, -0.008, -0.07]}>
          <boxGeometry args={[0.004, 0.03, 0.09]} />
        </mesh>
      </group>
    </>
  );
}

export default function LandingStage({ active }: { active: boolean }) {
  return (
    <Canvas dpr={[1, 1.6]} frameloop={active ? "always" : "never"} camera={{ position: [0, 1.2, 1.55], fov: 42, near: 0.05, far: 30 }} gl={{ antialias: true, alpha: true }}>
      <Studio intensity={1.1} />
      <Weather />
      <Suspense fallback={null}>
        <RobotHand hand="Right" scale={HAND_SCALE} />
        <RobotHand hand="Left" scale={HAND_SCALE} />
      </Suspense>
      <Driver />
      <Halftone />
    </Canvas>
  );
}
