"use client";

import { useFrame } from "@react-three/fiber";
import { CuboidCollider, RigidBody, useRapier, type RapierRigidBody } from "@react-three/rapier";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { useGrabbable } from "@/components/physics/HandPhysics";
import { GROUPS } from "@/lib/physics/groups";
import { useIndustrial } from "./industrialStore";

/** Socket centre, on the top face of the circuit board. */
export const SOCKET = { x: -0.1, y: 0.935, z: -0.33 };
export const TRAY = { x: -0.5, y: 0.915, z: -0.25 };
const CHIP_W = 0.052;
const CHIP_H = 0.008;

/** How close is close enough to click in. Generous on position, strict-ish on angle: it's a square chip. */
export const SEAT_TOLERANCE = { xz: 0.03, above: 0.05, yawDeg: 14, tiltDeg: 18 };

const q = new THREE.Quaternion();
const e = new THREE.Euler();
const up = new THREE.Vector3();

/** Chip pose relative to the socket: horizontal offset, yaw error (mod 90°) and tilt. */
export function chipAlignment(p: { x: number; y: number; z: number }, r: { x: number; y: number; z: number; w: number }) {
  q.set(r.x, r.y, r.z, r.w);
  e.setFromQuaternion(q, "YXZ");
  let yaw = ((e.y * 180) / Math.PI) % 90;
  if (yaw > 45) yaw -= 90;
  if (yaw < -45) yaw += 90;
  up.set(0, 1, 0).applyQuaternion(q);
  return {
    dx: p.x - SOCKET.x,
    dz: p.z - SOCKET.z,
    dy: p.y - SOCKET.y,
    yawDeg: yaw,
    tiltDeg: (Math.acos(Math.min(1, Math.abs(up.y))) * 180) / Math.PI,
  };
}

export const isSeatable = (a: ReturnType<typeof chipAlignment>) =>
  Math.hypot(a.dx, a.dz) < SEAT_TOLERANCE.xz &&
  a.dy > -0.01 &&
  a.dy < SEAT_TOLERANCE.above &&
  Math.abs(a.yawDeg) < SEAT_TOLERANCE.yawDeg &&
  a.tiltDeg < SEAT_TOLERANCE.tiltDeg;

function traceTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 512;
  const g = c.getContext("2d")!;
  g.fillStyle = "#0b1426";
  g.fillRect(0, 0, 512, 512);
  g.strokeStyle = "rgba(127, 227, 240, 0.55)";
  g.lineWidth = 3;
  // traces fanning out from the socket in the middle
  for (let i = 0; i < 28; i++) {
    const side = i % 4;
    const k = 180 + (i >> 2) * 22;
    g.beginPath();
    const [x0, y0] = [[256, 220], [292, 256], [256, 292], [220, 256]][side];
    g.moveTo(x0 + (side % 2 ? 0 : (i % 7) * 6 - 18), y0 + (side % 2 ? (i % 7) * 6 - 18 : 0));
    const ex = side === 1 ? 512 : side === 3 ? 0 : k * (i % 2 ? 1 : 0.4);
    const ey = side === 0 ? 0 : side === 2 ? 512 : k * (i % 2 ? 0.4 : 1);
    g.lineTo((x0 + ex) / 2, (y0 + ey) / 2);
    g.lineTo(ex, ey);
    g.stroke();
    g.fillStyle = "rgba(255, 200, 120, 0.8)";
    g.beginPath();
    g.arc(ex === 0 ? 8 : ex === 512 ? 504 : ex, ey === 0 ? 8 : ey === 512 ? 504 : ey, 5, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function CircuitBoard() {
  const tex = useMemo(() => traceTexture(), []);
  return (
    <RigidBody type="fixed" colliders={false} position={[SOCKET.x, SOCKET.y - 0.015, SOCKET.z]}>
      <CuboidCollider args={[0.22, 0.015, 0.17]} collisionGroups={GROUPS.world} />
      <mesh receiveShadow castShadow>
        <boxGeometry args={[0.44, 0.03, 0.34]} />
        <meshStandardMaterial attach="material-0" color="#0b1426" />
        <meshStandardMaterial attach="material-1" color="#0b1426" />
        <meshStandardMaterial attach="material-2" map={tex} metalness={0.3} roughness={0.45} />
        <meshStandardMaterial attach="material-3" color="#0b1426" />
        <meshStandardMaterial attach="material-4" color="#0b1426" />
        <meshStandardMaterial attach="material-5" color="#0b1426" />
      </mesh>
      {/* socket frame with gold contacts */}
      <group position={[0, 0.016, 0]}>
        {[0, 1, 2, 3].map((i) => (
          <mesh key={i} rotation-y={(i * Math.PI) / 2} position={[Math.sin((i * Math.PI) / 2) * 0.034, 0.003, Math.cos((i * Math.PI) / 2) * 0.034]}>
            <boxGeometry args={[0.076, 0.006, 0.008]} />
            <meshStandardMaterial color="#1b1f2c" metalness={0.6} roughness={0.4} />
          </mesh>
        ))}
        {Array.from({ length: 24 }, (_, i) => {
          const side = Math.floor(i / 6);
          const t = ((i % 6) - 2.5) * 0.008;
          const [x, z] = [[t, -0.026], [0.026, t], [t, 0.026], [-0.026, t]][side];
          return (
            <mesh key={i} position={[x, 0.001, z]}>
              <boxGeometry args={[0.004, 0.002, 0.004]} />
              <meshStandardMaterial color="#e8b04a" metalness={1} roughness={0.25} />
            </mesh>
          );
        })}
      </group>
    </RigidBody>
  );
}

export function Chip() {
  const ref = useRef<RapierRigidBody>(null);
  const { rapier } = useRapier();
  const held = useRef(false);
  const seating = useRef<{ t: number; from: THREE.Vector3; fromQ: THREE.Quaternion } | null>(null);
  const { seated, seat, setAlignment } = useIndustrial();
  const ghost = useRef<THREE.LineSegments>(null);

  const alignmentNow = () => {
    const b = ref.current;
    if (!b) return null;
    return chipAlignment(b.translation(), b.rotation());
  };

  useGrabbable({
    id: "chip",
    name: "MICROCHIP",
    body: () => ref.current,
    // A precise pinch only: a fist can't pick up something this small.
    gestures: ["pinch"],
    reach: 0.055,
    throwable: false,
    shouldRelease: () => {
      const a = alignmentNow();
      return !!a && isSeatable(a);
    },
    onGrab: () => void (held.current = true),
    onRelease: () => void (held.current = false),
  });

  useFrame((_, dt) => {
    const b = ref.current;
    if (!b) return;
    if (seated && !seating.current) return;

    if (seating.current) {
      // click into place: ease from the release pose to the socket over 180 ms
      const s = seating.current;
      s.t = Math.min(1, s.t + dt / 0.18);
      const k = 1 - Math.pow(1 - s.t, 3);
      const target = new THREE.Vector3(SOCKET.x, SOCKET.y + 0.006, SOCKET.z);
      const yaw = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.round(new THREE.Euler().setFromQuaternion(s.fromQ, "YXZ").y / (Math.PI / 2)) * (Math.PI / 2), 0));
      b.setNextKinematicTranslation(s.from.clone().lerp(target, k));
      b.setNextKinematicRotation(s.fromQ.clone().slerp(yaw, k));
      if (s.t >= 1) seating.current = null;
      return;
    }

    const a = chipAlignment(b.translation(), b.rotation());
    const near = Math.hypot(a.dx, a.dz) < 0.15 && a.dy < 0.2;
    setAlignment(near ? { dx: a.dx, dz: a.dz, yawDeg: a.yawDeg, tiltDeg: a.tiltDeg } : null);
    if (ghost.current) ghost.current.visible = near;

    // Released (or dropped) in the socket, lined up: seat it.
    if (!held.current && isSeatable(a)) {
      const p = b.translation();
      const r = b.rotation();
      b.setBodyType(rapier.RigidBodyType.KinematicPositionBased, true);
      seating.current = { t: 0, from: new THREE.Vector3(p.x, p.y, p.z), fromQ: new THREE.Quaternion(r.x, r.y, r.z, r.w) };
      seat();
    }
  });

  return (
    <>
      {/* tray */}
      <RigidBody type="fixed" colliders={false} position={[TRAY.x, TRAY.y, TRAY.z]}>
        <CuboidCollider args={[0.08, 0.005, 0.08]} collisionGroups={GROUPS.world} />
        {[0, 1, 2, 3].map((i) => (
          <CuboidCollider key={i} args={i % 2 ? [0.005, 0.012, 0.08] : [0.08, 0.012, 0.005]} position={i % 2 ? [i === 1 ? 0.08 : -0.08, 0.012, 0] : [0, 0.012, i === 0 ? 0.08 : -0.08]} collisionGroups={GROUPS.world} />
        ))}
        <mesh receiveShadow>
          <boxGeometry args={[0.17, 0.01, 0.17]} />
          <meshStandardMaterial color="#1e2230" metalness={0.7} roughness={0.35} />
        </mesh>
      </RigidBody>

      {/* alignment guide: a dashed outline of where the chip goes */}
      <lineSegments ref={ghost} position={[SOCKET.x, SOCKET.y + 0.004, SOCKET.z]} rotation-x={-Math.PI / 2} visible={false}>
        <edgesGeometry args={[new THREE.PlaneGeometry(CHIP_W, CHIP_W)]} />
        <lineBasicMaterial color="#7fe3f0" />
      </lineSegments>

      <RigidBody ref={ref} position={[TRAY.x, TRAY.y + 0.02, TRAY.z]} rotation={[0, 0.5, 0]} colliders={false} ccd name="chip" userData={{ chip: true }} angularDamping={2} linearDamping={0.5}>
        <CuboidCollider args={[CHIP_W / 2, CHIP_H / 2, CHIP_W / 2]} mass={0.03} friction={1.2} collisionGroups={GROUPS.prop} />
        <mesh castShadow>
          <boxGeometry args={[CHIP_W, CHIP_H, CHIP_W]} />
          <meshPhysicalMaterial color="#14151b" roughness={0.3} clearcoat={0.6} />
        </mesh>
        {/* pins */}
        {Array.from({ length: 24 }, (_, i) => {
          const side = Math.floor(i / 6);
          const t = ((i % 6) - 2.5) * 0.008;
          const [x, z] = [[t, -CHIP_W / 2 - 0.002], [CHIP_W / 2 + 0.002, t], [t, CHIP_W / 2 + 0.002], [-CHIP_W / 2 - 0.002, t]][side];
          return (
            <mesh key={i} position={[x, -0.002, z]}>
              <boxGeometry args={[0.003, 0.002, 0.005]} />
              <meshStandardMaterial color="#d8dce6" metalness={1} roughness={0.2} />
            </mesh>
          );
        })}
        <mesh position={[-0.016, CHIP_H / 2 + 0.0005, -0.016]}>
          <cylinderGeometry args={[0.004, 0.004, 0.001, 16]} />
          <meshBasicMaterial color="#ff6a45" />
        </mesh>
      </RigidBody>
    </>
  );
}
