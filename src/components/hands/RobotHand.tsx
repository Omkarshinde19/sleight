"use client";

import { useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { clone } from "three/examples/jsm/utils/SkeletonUtils.js";
import { ForearmFollower, SCENE_ELBOW, type ElbowPlacement } from "@/lib/hand/forearm";
import { HandRig } from "@/lib/hand/rig";
import { BONES, LM, type Handedness } from "@/lib/hand/types";
import { weatherproof } from "@/lib/materials/chrome";
import { handPose, type HandPoseSample } from "@/state/handPose";
import { handStore } from "@/state/handStore";

/*
 * The chrome robot hand, modelled and rigged in Blender (scripts/blender/build_hand.py), driven every
 * frame from the tracked joints by HandRig. One skinned mesh per material, so about four draw calls a
 * hand. The forearm hangs toward an elbow that follows the hand (ForearmFollower).
 */

const MODEL_URL = "/models/robot-hand.glb";
/** Real-hand forearm length (m) before the hand scale and the `forearm` multiplier. */
const FOREARM_LENGTH = 0.27;
/** When the forearm reaches off-screen, it grows at most to this multiple of its length. */
const MAX_REACH = 2.5;

const vNdc = new THREE.Vector3();
const vWrist = new THREE.Vector3();
const vDir = new THREE.Vector3();

/** Shortest length (≥ base) at which the forearm's far end is out of the camera's view; capped. */
function offscreenLength(wrist: THREE.Vector3, dir: THREE.Vector3, camera: THREE.Camera, base: number) {
  const step = base * 0.1;
  for (let len = base; len < base * MAX_REACH; len += step) {
    vNdc.copy(wrist).addScaledVector(dir, len).project(camera);
    // a little past the edge, so the forearm's widest part is gone too
    if (Math.abs(vNdc.x) > 1.15 || Math.abs(vNdc.y) > 1.15 || vNdc.z > 1) return len;
  }
  return base * MAX_REACH;
}

/** The Blender materials, once: rain and snow on the chrome, and the reflections the scenes are lit for. */
const prepared = new WeakSet<THREE.Material>();
function prepareMaterial(m: THREE.Material) {
  if (prepared.has(m) || !(m instanceof THREE.MeshStandardMaterial)) return;
  prepared.add(m);
  m.envMapIntensity = 1.6;
  if (m instanceof THREE.MeshPhysicalMaterial) m.iridescenceThicknessRange = [180, 620];
  weatherproof(m);
  m.needsUpdate = true;
}

/** Show the real hand as cyan lines, fading in once the robot hand is held back more than 1 cm. */
function updateGhost(ghost: THREE.LineSegments, pose: HandPoseSample | null) {
  const pushed = pose ? Math.hypot(pose.push.x, pose.push.y, pose.push.z) : 0;
  const mat = ghost.material as THREE.LineBasicMaterial;
  mat.opacity = Math.min(0.7, Math.max(0, (pushed - 0.01) * 14));
  ghost.visible = mat.opacity > 0.01;
  if (!pose || !ghost.visible) return;
  const gp = ghost.geometry.getAttribute("position") as THREE.BufferAttribute;
  BONES.forEach(([a, b], i) => {
    gp.setXYZ(i * 2, pose.real[a].x, pose.real[a].y, pose.real[a].z);
    gp.setXYZ(i * 2 + 1, pose.real[b].x, pose.real[b].y, pose.real[b].z);
  });
  gp.needsUpdate = true;
}

export function RobotHand({
  hand,
  scale = 1.5,
  forearm = 1,
  elbowAt = SCENE_ELBOW,
  reachOffscreen = true,
}: {
  hand: Handedness;
  scale?: number;
  /** Forearm length multiplier (shorter on the landing page so it stays clear of the headline). */
  forearm?: number;
  /** Where the elbow sits (the forearm hangs toward it). */
  elbowAt?: ElbowPlacement;
  /** Grow the forearm until its end is off-screen, so it never shows as a stump. */
  reachOffscreen?: boolean;
}) {
  const group = useRef<THREE.Group>(null);
  const { scene } = useGLTF(MODEL_URL);
  const follower = useMemo(() => new ForearmFollower(elbowAt), [elbowAt]);

  const { rig, ghost } = useMemo(() => {
    const rig = new HandRig(clone(scene));
    for (const m of rig.meshes) {
      m.castShadow = true;
      (Array.isArray(m.material) ? m.material : [m.material]).forEach(prepareMaterial);
    }
    // Ghost: where the real hand is while the robot hand is held back by something solid.
    const ghostGeo = new THREE.BufferGeometry();
    ghostGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(BONES.length * 6), 3));
    const ghost = new THREE.LineSegments(ghostGeo, new THREE.LineBasicMaterial({ color: "#7fe3f0", transparent: true, opacity: 0, depthTest: false }));
    ghost.frustumCulled = false;
    ghost.renderOrder = 10;
    return { rig, ghost };
  }, [scene]);

  useEffect(
    () => () => {
      ghost.geometry.dispose();
      (ghost.material as THREE.Material).dispose();
    },
    [ghost],
  );

  useFrame(({ camera }, delta) => {
    const h = handStore.getState().hands[hand];
    if (!group.current) return;
    group.current.visible = !!h;
    if (!h) {
      follower.reset();
      return;
    }
    // the interpolated pose (smooth at any frame rate, and exactly where the physics colliders are)
    const pose = handPose.sample(hand);
    const joints = (pose ?? h).joints;
    updateGhost(ghost, pose);

    const w = joints[LM.WRIST];
    const wrist = vWrist.set(w.x, w.y, w.z);
    const dir = vDir.copy(follower.update(w, joints[LM.MIDDLE_MCP], delta, scale));
    const base = FOREARM_LENGTH * scale * forearm;
    const length = reachOffscreen ? offscreenLength(wrist, dir, camera, base) : base;
    rig.update(joints, hand, dir, length, scale);
  });

  return (
    <group ref={group} visible={false} name={`hand-${hand}`}>
      <primitive object={rig.root} />
      <primitive object={ghost} />
    </group>
  );
}

useGLTF.preload(MODEL_URL);
