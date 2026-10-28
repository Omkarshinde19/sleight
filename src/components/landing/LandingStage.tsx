"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Suspense, useMemo, useRef } from "react";
import * as THREE from "three";
import { RobotHand } from "@/components/hands/RobotHand";
import { Studio } from "@/components/scene/Studio";
import { Weather } from "@/components/weather/Weather";
import { handFeatures } from "@/lib/hand/gestures";
import { jointsInScene, type Workspace } from "@/lib/hand/mapping";
import { lerpPose, POSES, synthHand, type HandPose, type Orientation } from "@/lib/hand/synth";
import { LM, type Handedness, type Point } from "@/lib/hand/types";
import { makeChromeMaterial } from "@/lib/materials/chrome";
import type { TrackedHand } from "@/lib/tracking/processor";
import { handStore } from "@/state/handStore";
import { callouts } from "./callouts";
import { scroll } from "./scroll";

const HAND_SCALE = 1.44; // was 2.3: hands 1.6× smaller
const WS: Workspace = { center: { x: 0, y: 0, z: 0 }, width: 1, height: 1, depthGain: 1, depthRange: 1, handScale: HAND_SCALE };

interface Key {
  anchor: Point;
  pose: HandPose;
  orientation: Orientation;
  visible: boolean;
}

/** Hand keyframes for each chapter: hero, thrower, machinist, surgeon, pipeline. */
const KEYS: Record<Handedness, Key[]> = {
  Right: [
    // the reach: index extended toward the other hand, palm down
    { anchor: { x: 0.66, y: 1.24, z: -0.05 }, pose: { curl: [0.25, 0.05, 0.35, 0.5, 0.6], pinch: 0 }, orientation: { roll: 1.45, pitch: -1.15, yaw: 0.25 }, visible: true },
    { anchor: { x: 0.34, y: 1.02, z: 0.05 }, pose: POSES.fist, orientation: { roll: 0.25, pitch: -0.35, yaw: 0.4 }, visible: true },
    { anchor: { x: -0.32, y: 1.1, z: 0.1 }, pose: POSES.pinch, orientation: { roll: 0.35, pitch: -0.35, yaw: 1.15 }, visible: true },
    { anchor: { x: 0.3, y: 1.12, z: 0.1 }, pose: { curl: [0.35, 0.42, 0.55, 0.7, 0.8], pinch: 0.92 }, orientation: { roll: 0.8, pitch: -0.95, yaw: 0.2 }, visible: true },
    { anchor: { x: 1.05, y: 1.42, z: -0.4 }, pose: POSES.open, orientation: { roll: 0.5, pitch: -0.3, yaw: 0.2 }, visible: true },
  ],
  Left: [
    { anchor: { x: -0.02, y: 1.2, z: -0.05 }, pose: { curl: [0.2, 0.15, 0.3, 0.4, 0.5], pinch: 0 }, orientation: { roll: -1.5, pitch: -1.3, yaw: -0.2 }, visible: true },
    { anchor: { x: -0.8, y: 1.1, z: -0.2 }, pose: POSES.open, orientation: { roll: -0.6, pitch: -0.6, yaw: -0.2 }, visible: false },
    { anchor: { x: -0.8, y: 1.1, z: -0.2 }, pose: POSES.open, orientation: { roll: -0.6, pitch: -0.6, yaw: -0.2 }, visible: false },
    { anchor: { x: -0.8, y: 1.1, z: -0.2 }, pose: POSES.open, orientation: { roll: -0.6, pitch: -0.6, yaw: -0.2 }, visible: false },
    { anchor: { x: -1.05, y: 1.42, z: -0.4 }, pose: POSES.open, orientation: { roll: -0.5, pitch: -0.3, yaw: -0.2 }, visible: true },
  ],
};

interface Live {
  anchor: THREE.Vector3;
  pose: HandPose;
  orientation: Orientation;
  presence: number;
}


const v = new THREE.Vector3();
const toV = (p: Point) => new THREE.Vector3(p.x, p.y, p.z);

function flexionDeg(a: Point, b: Point, c: Point) {
  const u = toV(a).sub(toV(b)).normalize();
  const w = toV(c).sub(toV(b)).normalize();
  return 180 - (Math.acos(Math.max(-1, Math.min(1, u.dot(w)))) * 180) / Math.PI;
}

function Driver() {
  const live = useRef<Record<Handedness, Live>>({
    Right: { anchor: toV(KEYS.Right[0].anchor), pose: KEYS.Right[0].pose, orientation: { ...KEYS.Right[0].orientation }, presence: 1 },
    Left: { anchor: toV(KEYS.Left[0].anchor), pose: KEYS.Left[0].pose, orientation: { ...KEYS.Left[0].orientation }, presence: 1 },
  });
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const ball = useRef<THREE.Mesh>(null);
  const chip = useRef<THREE.Mesh>(null);
  const scalpel = useRef<THREE.Group>(null);
  const chrome = useMemo(() => makeChromeMaterial(), []);

  useFrame((state, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    const t = state.clock.elapsedTime;
    const k = 1 - Math.exp(-dt / 0.35);
    const hands: Partial<Record<Handedness, TrackedHand>> = {};
    const chapter = scroll.chapter;
    const portrait = size.width < size.height;
    // pull back on narrow screens so the hands fit
    const camZ = portrait ? 2.9 : 1.55;
    camera.position.z += (camZ - camera.position.z) * Math.min(1, dt * 4);
    camera.lookAt(0, 1.13, 0);

    for (const h of ["Right", "Left"] as Handedness[]) {
      const key = KEYS[h][chapter];
      const L = live.current[h];
      // the thrower loops: wind up with the ball, flick, open
      let pose = key.pose;
      let anchor = toV(key.anchor);
      if (h === "Right" && chapter === 1) {
        const c = (t % 2.6) / 2.6;
        if (c > 0.55) pose = POSES.open;
        anchor = anchor.add(new THREE.Vector3(0, c < 0.45 ? -0.08 * Math.sin((c / 0.45) * Math.PI) : 0.12 * Math.sin(Math.min(1, (c - 0.45) / 0.2) * Math.PI * 0.5), c < 0.45 ? 0 : -0.1));
      }
      // a slow float so the hero never sits still
      anchor.y += Math.sin(t * 0.7 + (h === "Right" ? 0 : 1.7)) * 0.012;
      // portrait phones: the text column is the whole width, so hands go below the hero copy
      // and above the chapter cards, closer to the centre
      if (portrait) {
        anchor.x *= chapter === 0 ? 0.62 : 0.45;
        anchor.y += chapter === 0 ? -0.62 : chapter === 4 ? 0.2 : 0.62;
      }
      L.anchor.lerp(anchor, chapter === 1 && h === "Right" ? 1 - Math.exp(-dt / 0.08) : k);
      L.pose = lerpPose(L.pose, pose, chapter === 1 && h === "Right" ? 1 - Math.exp(-dt / 0.06) : k);
      L.orientation.roll += (key.orientation.roll - L.orientation.roll) * k;
      L.orientation.pitch += (key.orientation.pitch - L.orientation.pitch) * k;
      L.orientation.yaw += (key.orientation.yaw - L.orientation.yaw) * k;
      L.presence += ((key.visible ? 1 : 0) - L.presence) * k;
      if (L.presence < 0.05) continue;

      const raw = synthHand({ handedness: h, pose: L.pose, orientation: L.orientation, imageX: 0.5, imageY: 0.5, distance: 0.5 });
      // off-stage hands slide away as they fade
      const a = L.anchor.clone().add(new THREE.Vector3((h === "Right" ? 1 : -1) * (1 - L.presence) * 0.6, 0, 0));
      const joints = jointsInScene(raw.worldLandmarks, a, WS);
      const features = handFeatures(raw.worldLandmarks);
      const grip = h === "Right" && L.pose.pinch > 0.5 ? toV(joints[LM.THUMB_TIP]).lerp(toV(joints[LM.INDEX_TIP]), 0.5) : toV(joints[LM.MIDDLE_MCP]).lerp(toV(joints[LM.WRIST]), 0.35);
      hands[h] = { handedness: h, joints, features, grip, palm: grip } as unknown as TrackedHand;
    }
    handStore.setState({ hands });

    // props
    const R = hands.Right;
    if (ball.current) {
      const c = (t % 2.6) / 2.6;
      ball.current.visible = chapter === 1 && !!R;
      if (R && chapter === 1) {
        if (c <= 0.55) ball.current.position.copy(toV(R.grip)).add(new THREE.Vector3(-0.02, 0.09, -0.1));
        else {
          const s = (c - 0.55) * 2.6;
          ball.current.position.set(0.34 - 1.1 * s, 1.15 + 3.2 * s - 4.9 * s * s, -1.6 * s);
        }
        ball.current.rotation.x -= dt * 6;
      }
    }
    if (chip.current) {
      chip.current.visible = chapter === 2 && !!R;
      if (R) chip.current.position.copy(toV(R.grip)).add(new THREE.Vector3(0.01, -0.05, 0.02));
    }
    if (scalpel.current) {
      scalpel.current.visible = chapter === 3 && !!R;
      if (R) {
        scalpel.current.position.copy(toV(R.grip));
        const dir = toV(R.joints[LM.INDEX_TIP]).sub(toV(R.joints[LM.INDEX_MCP])).normalize();
        scalpel.current.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), dir);
      }
    }

    // blueprint callouts on the right hand
    const root = callouts.root;
    if (root) root.style.opacity = chapter === 4 || !R ? "0" : "1";
    if (root && R) {
      const items: [Point, string][] = [
        [R.joints[LM.INDEX_PIP], `INDEX PIP ${flexionDeg(R.joints[LM.INDEX_MCP], R.joints[LM.INDEX_PIP], R.joints[LM.INDEX_DIP]).toFixed(0)}°`],
        [R.joints[LM.THUMB_TIP], `PINCH ${R.features.pinchDistance.toFixed(2)}`],
        [R.joints[LM.WRIST], `GRIP ${(R.features.grip * 100).toFixed(0)}%`],
      ];
      items.forEach(([p, text], i) => {
        const el = root.children[i] as HTMLElement | undefined;
        if (!el) return;
        v.set(p.x, p.y, p.z).project(camera);
        const x = (v.x * 0.5 + 0.5) * size.width;
        const y = (-v.y * 0.5 + 0.5) * size.height;
        el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
        const label = el.querySelector("span");
        if (label) label.textContent = text;
      });
    }
  });

  return (
    <>
      <mesh ref={ball} visible={false}>
        <sphereGeometry args={[0.085, 40, 24]} />
        <meshPhysicalMaterial color="#e2553a" roughness={0.55} clearcoat={0.3} />
      </mesh>
      <mesh ref={chip} visible={false} rotation={[1.1, 0.35, 0.15]}>
        <boxGeometry args={[0.09, 0.014, 0.09]} />
        <meshPhysicalMaterial color="#14151b" roughness={0.3} clearcoat={0.8} />
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

export default function LandingStage() {
  return (
    <Canvas dpr={[1, 1.6]} camera={{ position: [0, 1.2, 1.55], fov: 42, near: 0.05, far: 30 }} onCreated={({ camera }) => camera.lookAt(0, 1.13, 0)} gl={{ antialias: true }}>
      <Studio intensity={1.1} />
      <Weather />
      <Suspense fallback={null}>
        <RobotHand hand="Right" scale={HAND_SCALE} />
        <RobotHand hand="Left" scale={HAND_SCALE} />
      </Suspense>
      <Driver />
    </Canvas>
  );
}
