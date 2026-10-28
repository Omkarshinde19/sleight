"use client";

import { useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { clone } from "three/examples/jsm/utils/SkeletonUtils.js";
import { HandRig } from "@/lib/hand/rig";
import { BONES, LM, type Handedness } from "@/lib/hand/types";
import { weatherproof } from "@/lib/materials/chrome";
import { handPose, type HandPoseSample } from "@/state/handPose";
import { handStore } from "@/state/handStore";

/*
 * The chrome robot hand, modelled and rigged in Blender (scripts/blender/build_hand.py), driven every
 * frame from the tracked joints by HandRig. One skinned mesh per material, so about four draw calls a
 * hand. The hands end at the wrist: a short cuff carries on in line with the hand (no forearm).
 */

const MODEL_URL = "/models/robot-hand.glb";
/** Real-hand length (m) of the wrist cuff, the FOREARM bone (scripts/blender/build_hand.py). */
const CUFF_LENGTH = 0.05;

const vDir = new THREE.Vector3();

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

export function RobotHand({ hand, scale = 0.94 }: { hand: Handedness; scale?: number }) {
  const group = useRef<THREE.Group>(null);
  const { scene } = useGLTF(MODEL_URL);

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

  useFrame(() => {
    const h = handStore.getState().hands[hand];
    if (!group.current) return;
    group.current.visible = !!h;
    if (!h) return;
    // the interpolated pose (smooth at any frame rate, and exactly where the physics colliders are)
    const pose = handPose.sample(hand);
    const joints = (pose ?? h).joints;
    updateGhost(ghost, pose);
    // the cuff carries on straight back from the knuckles through the wrist
    const w = joints[LM.WRIST];
    const m = joints[LM.MIDDLE_MCP];
    const dir = vDir.set(w.x - m.x, w.y - m.y, w.z - m.z).normalize();
    rig.update(joints, hand, dir, CUFF_LENGTH * scale, scale);
  });

  return (
    <group ref={group} visible={false} name={`hand-${hand}`}>
      <primitive object={rig.root} />
      <primitive object={ghost} />
    </group>
  );
}

useGLTF.preload(MODEL_URL);
