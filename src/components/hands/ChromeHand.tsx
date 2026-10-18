"use client";

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { FINGERS, LM, type Handedness, type Point } from "@/lib/hand/types";
import { makeChromeMaterial } from "@/lib/materials/chrome";
import { handStore } from "@/state/handStore";

/*
 * A bulky mechanical hand built from the 21 tracked joints every frame:
 * muscle-profile phalanges with dorsal armour plates, hinge knuckles, a thick palm with thenar and
 * hypothenar muscle pads, copper "veins" (tendon cables) over the back of the hand, and a muscled
 * forearm with flexor/extensor bundles, hoses and a wrist collar. All sizes are real-hand metres
 * multiplied by the workspace hand scale.
 */

const FINGER_BONES: [number, number][] = FINGERS.flatMap((chain) => chain.slice(1).map((j, i) => [chain[i], j] as [number, number]));
/** Bones that are phalanges (not the wrist → thumb CMC link). */
const PHALANGES = FINGER_BONES.filter(([a]) => a !== LM.WRIST);
const MCPS = [LM.INDEX_MCP, LM.MIDDLE_MCP, LM.RING_MCP, LM.PINKY_MCP];

/** Segment radius by which bone it is: thumb chunkiest, distal phalanges slimmest. */
function boneRadius(a: number): number {
  if (a === LM.THUMB_CMC) return 0.0145;
  if (a === LM.THUMB_MCP) return 0.0128;
  if (a === LM.THUMB_IP) return 0.0112;
  if (MCPS.includes(a as (typeof MCPS)[number])) return a === LM.PINKY_MCP ? 0.0108 : 0.0122;
  const isDistal = [LM.INDEX_DIP, LM.MIDDLE_DIP, LM.RING_DIP, LM.PINKY_DIP].includes(a as never);
  const base = a >= LM.PINKY_MCP ? 0.0098 : 0.011;
  return isDistal ? base * 0.9 : base;
}

const FOREARM = { length: 0.27, radius: 0.024 };
const VEINS = 3;
const VEIN_STEPS = 5;
const PALM_HALF_THICKNESS = 0.017;

// ---------- geometry ----------

/** Unit segment along +y (0 → 1): tapered at both joints, bulging in the middle like a muscle. */
function muscleSegment() {
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= 14; i++) {
    const t = i / 14;
    const r = 0.78 + 0.28 * Math.pow(Math.sin(Math.PI * t), 0.75);
    pts.push(new THREE.Vector2(r, t));
  }
  return new THREE.LatheGeometry(pts, 22);
}

/** Forearm radius along its length (0 = wrist, 1 = elbow): slim wrist, muscle belly two thirds up. */
const forearmProfile = (t: number) => 1 + 0.62 * Math.exp(-Math.pow((t - 0.62) / 0.28, 2)) + 0.18 * t;

function forearmGeometry() {
  const pts: THREE.Vector2[] = [new THREE.Vector2(0.001, 0)];
  for (let i = 0; i <= 20; i++) {
    const t = i / 20;
    pts.push(new THREE.Vector2(forearmProfile(t), t));
  }
  pts.push(new THREE.Vector2(0.001, 1));
  return new THREE.LatheGeometry(pts, 32);
}

/** Half-shell on the +z (dorsal) side, for the armour plates. */
const plateGeometry = () => new THREE.CylinderGeometry(1, 1, 1, 14, 1, true, -Math.PI / 2 + 0.25, Math.PI - 0.5).translate(0, 0.5, 0);
const hingeGeometry = () => new THREE.CylinderGeometry(1, 1, 1, 18, 1, false).rotateZ(Math.PI / 2); // axis along x
const tubeGeometry = () => new THREE.CylinderGeometry(1, 1, 1, 8, 1, true).translate(0, 0.5, 0);

/** Palm: two rings of perimeter points (dorsal and palmar) with a domed centre on each side. */
const PALM_N = 9;
function palmGeometry() {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array((2 * PALM_N + 2) * 3), 3));
  const idx: number[] = [];
  const cT = 2 * PALM_N;
  const cB = cT + 1;
  for (let i = 0; i < PALM_N; i++) {
    const j = (i + 1) % PALM_N;
    idx.push(cT, i, j, cB, PALM_N + j, PALM_N + i, i, PALM_N + i, j, j, PALM_N + i, PALM_N + j);
  }
  g.setIndex(idx);
  return g;
}

// ---------- per-frame placement ----------

const vA = new THREE.Vector3();
const vB = new THREE.Vector3();
const vX = new THREE.Vector3();
const vY = new THREE.Vector3();
const vZ = new THREE.Vector3();
const basis = new THREE.Matrix4();
const toV = (p: Point, out = new THREE.Vector3()) => out.set(p.x, p.y, p.z);

/**
 * Place a unit +y mesh from `a` to `b`, with its local +z turned toward `dorsal`.
 * rx / rz are the cross-section radii (x across the finger, z through it).
 */
function orient(m: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3, dorsal: THREE.Vector3, rx: number, rz: number, lengthScale = 1) {
  vY.subVectors(b, a);
  const len = vY.length() || 1e-6;
  vY.divideScalar(len);
  vZ.copy(dorsal).addScaledVector(vY, -dorsal.dot(vY));
  if (vZ.lengthSq() < 1e-8) vZ.set(0, 0, 1).addScaledVector(vY, -vY.z);
  vZ.normalize();
  vX.crossVectors(vY, vZ);
  basis.makeBasis(vX, vY, vZ);
  m.position.copy(a);
  m.quaternion.setFromRotationMatrix(basis);
  m.scale.set(rx, len * lengthScale, rz);
}

/** Place a unit sphere as an ellipsoid between a and b. */
function ellipsoid(m: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3, dorsal: THREE.Vector3, rx: number, rz: number) {
  orient(m, a, b, dorsal, rx, rz);
  m.position.lerpVectors(a, b, 0.5);
  m.scale.y *= 0.5;
}

interface Parts {
  segments: THREE.Mesh[];
  plates: THREE.Mesh[];
  hinges: THREE.Mesh[];
  tips: THREE.Mesh[];
  tendons: THREE.Mesh[];
  veins: THREE.Mesh[];
  bundles: THREE.Mesh[];
  hoses: THREE.Mesh[];
  palm: THREE.Mesh;
  thenar: THREE.Mesh;
  hypothenar: THREE.Mesh;
  forearm: THREE.Mesh;
  collar: THREE.Mesh;
  wristHinge: THREE.Mesh;
}

export function ChromeHand({
  hand,
  scale = 1.5,
  tint,
  elbowDrop = 0.35,
  forearm = 1,
}: {
  hand: Handedness;
  scale?: number;
  tint?: string;
  /** How much the forearm angles down toward an elbow below the hand (0 = straight back). */
  elbowDrop?: number;
  /** Forearm length multiplier (shorter on the landing page so it stays clear of the headline). */
  forearm?: number;
}) {
  const group = useRef<THREE.Group>(null);

  const { parts, root, palmGeo } = useMemo(() => {
    const chrome = makeChromeMaterial(tint);
    const muscle = makeChromeMaterial("#cdd3e2");
    muscle.roughness = 0.16;
    const gunmetal = makeChromeMaterial("#6f7689");
    gunmetal.roughness = 0.26;
    gunmetal.iridescence = 0.4;
    const copper = makeChromeMaterial("#d0835a");
    copper.roughness = 0.2;
    copper.iridescence = 0.3;
    const palmMat = makeChromeMaterial(tint);
    palmMat.side = THREE.DoubleSide; // winding flips with handedness

    const seg = muscleSegment();
    const plate = plateGeometry();
    const hinge = hingeGeometry();
    const tube = tubeGeometry();
    const sphere = new THREE.SphereGeometry(1, 28, 18);
    const fore = forearmGeometry();
    const ring = new THREE.TorusGeometry(1, 0.22, 12, 36);
    const palmGeo = palmGeometry();

    const root = new THREE.Group();
    const add = (g: THREE.BufferGeometry, m: THREE.Material) => {
      const mesh = new THREE.Mesh(g, m);
      mesh.castShadow = true;
      mesh.frustumCulled = false;
      root.add(mesh);
      return mesh;
    };
    const parts: Parts = {
      segments: PHALANGES.map(() => add(seg, chrome)),
      plates: PHALANGES.map(() => add(plate, gunmetal)),
      hinges: PHALANGES.map(() => add(hinge, gunmetal)),
      tips: FINGERS.map(() => add(sphere, chrome)),
      tendons: [...MCPS.map(() => add(tube, copper)), ...MCPS.map(() => add(tube, copper)), add(tube, copper), add(tube, copper)],
      veins: Array.from({ length: VEINS * VEIN_STEPS }, () => add(tube, copper)),
      bundles: [0, 1, 2, 3].map(() => add(sphere, muscle)),
      hoses: [0, 1].map(() => add(tube, gunmetal)),
      palm: add(palmGeo, palmMat),
      thenar: add(sphere, muscle),
      hypothenar: add(sphere, muscle),
      forearm: add(fore, chrome),
      collar: add(ring, gunmetal),
      wristHinge: add(hinge, gunmetal),
    };
    return { parts, root, palmGeo };
  }, [tint]);

  useFrame(() => {
    const h = handStore.getState().hands[hand];
    if (!group.current) return;
    group.current.visible = !!h;
    if (!h) return;
    const J = h.joints.map((p) => toV(p));
    const s = scale;

    // Palm frame: across the knuckles, toward the fingers, and the back of the hand (dorsal).
    // In the first-person view the back of the hand faces the viewer when the palm faces the webcam.
    const wrist = J[LM.WRIST];
    const across = vA.subVectors(J[LM.INDEX_MCP], J[LM.PINKY_MCP]).clone();
    const up = vB.subVectors(J[LM.MIDDLE_MCP], wrist).clone().normalize();
    const dorsal = new THREE.Vector3().crossVectors(across, up).normalize();
    if (hand === "Right") dorsal.negate();

    // ---- fingers ----
    PHALANGES.forEach(([a, b], i) => {
      const r = boneRadius(a) * s;
      orient(parts.segments[i], J[a], J[b], dorsal, r, r * 0.92);
      orient(parts.plates[i], J[a].clone().lerp(J[b], 0.12), J[a].clone().lerp(J[b], 0.86), dorsal, r * 1.12, r * 1.18);
      // hinge knuckle at the base of each phalanx, axis across the finger
      orient(parts.hinges[i], J[a], J[b], dorsal, 1, 1);
      const hm = parts.hinges[i];
      hm.scale.set(r * 2.05, r * 0.74, r * 0.74);
    });
    FINGERS.forEach((chain, i) => {
      const tip = J[chain[chain.length - 1]];
      const prev = J[chain[chain.length - 2]];
      const r = boneRadius(chain[chain.length - 2]) * s * 0.92;
      ellipsoid(parts.tips[i], prev.clone().lerp(tip, 0.6), tip.clone().addScaledVector(tip.clone().sub(prev).normalize(), r * 0.9), dorsal, r, r * 0.9);
    });

    // ---- palm ----
    const thick = PALM_HALF_THICKNESS * s;
    const perimeter = [
      wrist.clone().addScaledVector(across, -0.42),
      wrist.clone().addScaledVector(across, 0.38),
      J[LM.THUMB_CMC].clone().lerp(J[LM.THUMB_MCP], 0.25),
      J[LM.INDEX_MCP].clone().addScaledVector(across, 0.08),
      J[LM.MIDDLE_MCP],
      J[LM.RING_MCP],
      J[LM.PINKY_MCP].clone().addScaledVector(across, -0.1),
      J[LM.PINKY_MCP].clone().lerp(wrist, 0.45).addScaledVector(across, -0.2),
      wrist.clone().lerp(J[LM.PINKY_MCP], 0.2).addScaledVector(across, -0.32),
    ];
    const pos = palmGeo.getAttribute("position") as THREE.BufferAttribute;
    const centre = new THREE.Vector3();
    perimeter.forEach((p, i) => {
      centre.add(p);
      pos.setXYZ(i, p.x + dorsal.x * thick * 0.8, p.y + dorsal.y * thick * 0.8, p.z + dorsal.z * thick * 0.8);
      pos.setXYZ(i + PALM_N, p.x - dorsal.x * thick, p.y - dorsal.y * thick, p.z - dorsal.z * thick);
    });
    centre.divideScalar(PALM_N);
    pos.setXYZ(2 * PALM_N, centre.x + dorsal.x * thick * 1.55, centre.y + dorsal.y * thick * 1.55, centre.z + dorsal.z * thick * 1.55);
    pos.setXYZ(2 * PALM_N + 1, centre.x - dorsal.x * thick * 1.5, centre.y - dorsal.y * thick * 1.5, centre.z - dorsal.z * thick * 1.5);
    pos.needsUpdate = true;
    palmGeo.computeVertexNormals();

    // muscle pads on the palm side: thumb (thenar) and little-finger (hypothenar)
    const palmar = dorsal.clone().negate();
    ellipsoid(
      parts.thenar,
      wrist.clone().lerp(J[LM.THUMB_CMC], 0.6).addScaledVector(palmar, thick * 0.6),
      J[LM.THUMB_MCP].clone().lerp(J[LM.INDEX_MCP], 0.35).addScaledVector(palmar, thick * 0.6),
      palmar,
      0.021 * s,
      0.014 * s,
    );
    ellipsoid(
      parts.hypothenar,
      wrist.clone().lerp(J[LM.PINKY_MCP], 0.15).addScaledVector(across, -0.22).addScaledVector(palmar, thick * 0.55),
      J[LM.PINKY_MCP].clone().lerp(wrist, 0.25).addScaledVector(across, -0.1).addScaledVector(palmar, thick * 0.55),
      palmar,
      0.016 * s,
      0.012 * s,
    );

    // ---- tendons ("veins") over the back of the hand: wrist → knuckle, then along each finger ----
    const lift = (p: THREE.Vector3, k: number) => p.clone().addScaledVector(dorsal, k);
    const wristBack = lift(wrist, thick * 1.1);
    MCPS.forEach((m, i) => {
      const start = wristBack.clone().addScaledVector(across, (1.5 - i) * 0.11);
      const knuckle = lift(J[m], thick * 1.05);
      orient(parts.tendons[i], start, knuckle, dorsal, 0.0032 * s, 0.0032 * s);
      const pip = lift(J[m + 1], boneRadius(m) * s * 1.05);
      orient(parts.tendons[i + 4], knuckle, pip, dorsal, 0.0026 * s, 0.0026 * s);
    });
    orient(parts.tendons[8], lift(J[LM.THUMB_CMC], thick * 0.6), lift(J[LM.THUMB_MCP], boneRadius(LM.THUMB_CMC) * s), dorsal, 0.0034 * s, 0.0034 * s);
    orient(parts.tendons[9], lift(J[LM.THUMB_MCP], boneRadius(LM.THUMB_CMC) * s), lift(J[LM.THUMB_IP], boneRadius(LM.THUMB_MCP) * s), dorsal, 0.0028 * s, 0.0028 * s);

    // ---- forearm ----
    const armDir = vA.subVectors(wrist, J[LM.MIDDLE_MCP]).normalize().clone();
    // angle the forearm down a little, like an arm resting on an elbow
    armDir.y -= elbowDrop;
    armDir.normalize();
    const elbow = wrist.clone().addScaledVector(armDir, FOREARM.length * s * forearm);
    const fr = FOREARM.radius * s;
    orient(parts.forearm, wrist, elbow, dorsal, fr, fr * 0.86);
    const side = new THREE.Vector3().crossVectors(armDir, dorsal).normalize();

    // flexor / extensor bundles bulging out of the forearm
    const bundleSpecs: [THREE.Vector3, number][] = [
      [dorsal, 0.6],
      [side, 0.55],
      [side.clone().negate(), 0.5],
      [dorsal.clone().negate(), 0.62],
    ];
    bundleSpecs.forEach(([dir, at], i) => {
      const a = wrist.clone().lerp(elbow, at - 0.32).addScaledVector(dir, fr * 0.95);
      const b = wrist.clone().lerp(elbow, at + 0.3).addScaledVector(dir, fr * 1.25);
      ellipsoid(parts.bundles[i], a, b, dir, fr * 0.55, fr * 0.42);
    });

    // veins: copper cables that ride the forearm's muscle contour, slightly raised, wandering a little
    [-0.6, 0.05, 0.62].forEach((k, v) => {
      const at = (t: number) => {
        const a = k + Math.sin(t * 5 + v * 2) * 0.12;
        const dir = dorsal.clone().multiplyScalar(Math.cos(a)).addScaledVector(side, Math.sin(a)).normalize();
        // the lathe is squashed to 0.86 through the dorsal axis
        const rScale = Math.hypot(Math.cos(a) * 0.86, Math.sin(a));
        return { p: wrist.clone().lerp(elbow, t).addScaledVector(dir, fr * (forearmProfile(t) * rScale + 0.1)), dir };
      };
      for (let i = 0; i < VEIN_STEPS; i++) {
        const a = at(0.04 + (i / VEIN_STEPS) * 0.88);
        const b = at(0.04 + ((i + 1) / VEIN_STEPS) * 0.88);
        orient(parts.veins[v * VEIN_STEPS + i], a.p, b.p, a.dir, 0.0033 * s, 0.0033 * s, 1.04);
      }
    });

    // hydraulic hoses on the inner forearm
    [0.35, -0.35].forEach((k, i) => {
      const dir = palmar.clone().multiplyScalar(Math.cos(k)).addScaledVector(side, Math.sin(k)).normalize();
      orient(parts.hoses[i], wrist.clone().addScaledVector(dir, fr * 1.05), elbow.clone().addScaledVector(dir, fr * 1.3), dir, 0.0052 * s, 0.0052 * s);
    });

    // wrist collar and hinge
    const collar = parts.collar;
    collar.position.copy(wrist).addScaledVector(armDir, 0.006 * s);
    collar.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), armDir);
    collar.scale.setScalar(fr * 1.08);
    orient(parts.wristHinge, wrist, J[LM.MIDDLE_MCP], dorsal, 1, 1);
    parts.wristHinge.scale.set(fr * 1.9, fr * 0.7, fr * 0.7);
  });

  return (
    <group ref={group} visible={false} name={`hand-${hand}`}>
      <primitive object={root} />
    </group>
  );
}
