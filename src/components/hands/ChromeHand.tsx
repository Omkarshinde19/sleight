"use client";

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { FINGERS, LM, type Handedness, type Point } from "@/lib/hand/types";
import { handStore } from "@/state/handStore";

// Radii in real-hand metres; multiplied by the workspace hand scale.
const JOINT_RADIUS: number[] = (() => {
  const r = new Array(21).fill(0.0088);
  r[LM.WRIST] = 0.02;
  [LM.INDEX_MCP, LM.MIDDLE_MCP, LM.RING_MCP, LM.PINKY_MCP, LM.THUMB_CMC].forEach((i) => (r[i] = 0.0115));
  [LM.THUMB_MCP, LM.INDEX_PIP, LM.MIDDLE_PIP, LM.RING_PIP, LM.PINKY_PIP].forEach((i) => (r[i] = 0.0102));
  [LM.THUMB_TIP, LM.INDEX_TIP, LM.MIDDLE_TIP, LM.RING_TIP, LM.PINKY_TIP].forEach((i) => (r[i] = 0.0082));
  return r;
})();
const BONE_RADIUS = 0.0094;
const PALM_HALF_THICKNESS = 0.011;
const FOREARM_LENGTH = 0.2;

const FINGER_BONES: [number, number][] = FINGERS.flatMap((chain) =>
  chain.slice(1).map((j, i) => [chain[i], j] as [number, number]),
);

export function makeChromeMaterial(tint = "#eef1f7") {
  return new THREE.MeshPhysicalMaterial({
    color: tint,
    metalness: 1,
    roughness: 0.09,
    iridescence: 0.9,
    iridescenceIOR: 1.7,
    iridescenceThicknessRange: [180, 620],
    clearcoat: 0.5,
    clearcoatRoughness: 0.06,
    envMapIntensity: 1.6,
  });
}

const v = new THREE.Vector3();
const v2 = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const toV = (p: Point, out = new THREE.Vector3()) => out.set(p.x, p.y, p.z);

/** Palm plate with fixed topology: we only move its vertices each frame. */
function makePalmGeometry() {
  const N = 7;
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array((2 * N + 2) * 3), 3));
  const idx: number[] = [];
  const cT = 2 * N;
  const cB = 2 * N + 1;
  for (let i = 0; i < N; i++) {
    const j = (i + 1) % N;
    idx.push(cT, i, j); // top fan
    idx.push(cB, N + j, N + i); // bottom fan
    idx.push(i, N + i, j, j, N + i, N + j); // side
  }
  g.setIndex(idx);
  return g;
}

export function ChromeHand({ hand, scale = 1.5, tint }: { hand: Handedness; scale?: number; tint?: string }) {
  const group = useRef<THREE.Group>(null);
  const joints = useRef<(THREE.Mesh | null)[]>([]);
  const bones = useRef<(THREE.Mesh | null)[]>([]);
  const palm = useRef<THREE.Mesh>(null);
  const forearm = useRef<THREE.Mesh>(null);

  const material = useMemo(() => makeChromeMaterial(tint), [tint]);
  const darkMaterial = useMemo(() => {
    const m = makeChromeMaterial("#8c93a6");
    m.roughness = 0.22;
    return m;
  }, []);
  const sphere = useMemo(() => new THREE.SphereGeometry(1, 24, 16), []);
  const cylinder = useMemo(() => new THREE.CylinderGeometry(0.82, 1, 1, 20, 1, true).translate(0, 0.5, 0), []);
  const forearmGeo = useMemo(() => new THREE.CylinderGeometry(0.75, 1.25, 1, 28, 1, false).translate(0, 0.5, 0), []);
  const palmGeo = useMemo(() => makePalmGeometry(), []);
  const palmMaterial = useMemo(() => {
    const m = makeChromeMaterial(tint);
    m.side = THREE.DoubleSide; // winding flips with handedness
    return m;
  }, [tint]);

  useFrame(() => {
    const h = handStore.getState().hands[hand];
    if (!group.current) return;
    group.current.visible = !!h;
    if (!h) return;
    const J = h.joints;

    J.forEach((p, i) => {
      const m = joints.current[i];
      if (!m) return;
      toV(p, m.position);
      m.scale.setScalar(JOINT_RADIUS[i] * scale);
    });

    FINGER_BONES.forEach(([a, b], i) => {
      const m = bones.current[i];
      if (!m) return;
      toV(J[a], m.position);
      toV(J[b], v).sub(m.position);
      const length = v.length();
      m.quaternion.setFromUnitVectors(UP, v.normalize());
      const r = BONE_RADIUS * scale * (a === LM.WRIST ? 1.2 : 1);
      m.scale.set(r, length, r);
    });

    // Palm plate
    const wrist = toV(J[LM.WRIST]);
    const idx = toV(J[LM.INDEX_MCP]);
    const pinky = toV(J[LM.PINKY_MCP]);
    const across = idx.clone().sub(pinky);
    const normal = v2.copy(idx).sub(wrist).cross(pinky.clone().sub(wrist)).normalize();
    const perimeter = [
      wrist.clone().addScaledVector(across, -0.32),
      wrist.clone().addScaledVector(across, 0.3),
      toV(J[LM.THUMB_CMC]),
      idx,
      toV(J[LM.MIDDLE_MCP]),
      toV(J[LM.RING_MCP]),
      pinky,
    ];
    const pos = palmGeo.getAttribute("position") as THREE.BufferAttribute;
    const t = PALM_HALF_THICKNESS * scale;
    const centre = new THREE.Vector3();
    perimeter.forEach((p, i) => {
      centre.add(p);
      pos.setXYZ(i, p.x + normal.x * t, p.y + normal.y * t, p.z + normal.z * t);
      pos.setXYZ(i + 7, p.x - normal.x * t, p.y - normal.y * t, p.z - normal.z * t);
    });
    centre.divideScalar(perimeter.length);
    pos.setXYZ(14, centre.x + normal.x * t * 1.4, centre.y + normal.y * t * 1.4, centre.z + normal.z * t * 1.4);
    pos.setXYZ(15, centre.x - normal.x * t * 1.4, centre.y - normal.y * t * 1.4, centre.z - normal.z * t * 1.4);
    pos.needsUpdate = true;
    palmGeo.computeVertexNormals();
    palmGeo.computeBoundingSphere();

    // Forearm: continues from the wrist, away from the fingers.
    if (forearm.current) {
      const dir = v.copy(wrist).sub(toV(J[LM.MIDDLE_MCP], v2)).normalize();
      forearm.current.position.copy(wrist);
      forearm.current.quaternion.setFromUnitVectors(UP, dir);
      const r = 0.017 * scale;
      forearm.current.scale.set(r, FOREARM_LENGTH * scale, r);
    }
  });

  return (
    <group ref={group} visible={false} name={`hand-${hand}`}>
      {Array.from({ length: 21 }, (_, i) => (
        <mesh key={`j${i}`} ref={(m) => void (joints.current[i] = m)} geometry={sphere} material={i === LM.WRIST ? darkMaterial : material} castShadow />
      ))}
      {FINGER_BONES.map((_, i) => (
        <mesh key={`b${i}`} ref={(m) => void (bones.current[i] = m)} geometry={cylinder} material={material} castShadow />
      ))}
      <mesh ref={palm} geometry={palmGeo} material={palmMaterial} castShadow frustumCulled={false} />
      <mesh ref={forearm} geometry={forearmGeo} material={darkMaterial} castShadow />
    </group>
  );
}
