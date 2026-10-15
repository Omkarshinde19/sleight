"use client";

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { useIndustrial } from "./industrialStore";

const BELT = { y: 0.78, z: -1.45, from: -1.4, to: 1.4 };
const PRESS_X = 0.25;
const PLATES = 7;
const PLATE_GAP = (BELT.to - BELT.from) / PLATES;
const PISTON_TOP = 1.55;
const PISTON_TRAVEL = 0.55;
export const STAMP_AT = 0.7;
/** After the throttle is let go, the line coasts down at this rate (per second) so one hand can go to the press. */
const COAST = 0.12;

function gearShape(teeth: number, r: number, depth: number) {
  const s = new THREE.Shape();
  const steps = teeth * 4;
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const rr = i % 4 < 2 ? r : r - depth;
    const p = [Math.cos(a) * rr, Math.sin(a) * rr] as const;
    if (i === 0) s.moveTo(...p);
    else s.lineTo(...p);
  }
  const hole = new THREE.Path();
  hole.absarc(0, 0, r * 0.28, 0, Math.PI * 2, true);
  s.holes.push(hole);
  return s;
}

/**
 * The machine the levers drive. It only runs once the chip is seated (that's its controller).
 * THROTTLE sets gear and belt speed; PRESS lowers the piston, which stamps any blank under it.
 */
export function Machine() {
  const gearA = useRef<THREE.Mesh>(null);
  const gearB = useRef<THREE.Mesh>(null);
  const piston = useRef<THREE.Group>(null);
  const plates = useRef<THREE.InstancedMesh>(null);
  const lamp = useRef<THREE.MeshBasicMaterial>(null);
  const state = useMemo(() => ({ offset: 0, speed: 0, stamped: new Array(PLATES).fill(false), pressDown: false, waiting: -1 }), []);
  const gearGeo = useMemo(() => new THREE.ExtrudeGeometry(gearShape(18, 0.24, 0.035), { depth: 0.06, bevelEnabled: true, bevelSize: 0.008, bevelThickness: 0.008 }), []);
  const smallGearGeo = useMemo(() => new THREE.ExtrudeGeometry(gearShape(10, 0.135, 0.03), { depth: 0.06, bevelEnabled: true, bevelSize: 0.008, bevelThickness: 0.008 }), []);
  const m = useMemo(() => new THREE.Matrix4(), []);
  const plateColors = useMemo(() => [new THREE.Color("#9aa3b8"), new THREE.Color("#ff7a4a")], []);

  useFrame((_, dt) => {
    const { seated, levers, stamped } = useIndustrial.getState();
    const throttle = seated ? levers[0] : 0;
    const press = seated ? levers[1] : 0;
    // line speed follows the throttle up immediately, and coasts down slowly
    state.speed = Math.max(throttle, state.speed - COAST * dt);
    const speed = state.speed;
    if (gearA.current) gearA.current.rotation.z += dt * speed * 3;
    if (gearB.current) gearB.current.rotation.z -= dt * speed * 3 * (18 / 10);
    if (lamp.current) lamp.current.color.set(seated ? (speed > 0.05 ? "#6dffb0" : "#ffd36b") : "#ff3b30");

    const span = BELT.to - BELT.from;
    const xOf = (i: number, offset: number) => BELT.from + ((((i * PLATE_GAP + offset) % span) + span) % span);

    // Transfer press: the belt indexes, stopping each blank under the die until it's stamped.
    const depth = Math.min(1, press / STAMP_AT) * PISTON_TRAVEL;
    if (piston.current) piston.current.position.y = PISTON_TOP - depth;
    const down = press >= STAMP_AT;
    if (down && !state.pressDown && state.waiting >= 0) {
      state.stamped[state.waiting] = true;
      state.waiting = -1;
      stamped();
    }
    if (state.waiting < 0) {
      let step = dt * speed * 0.7;
      for (let i = 0; i < PLATES; i++) {
        const x = xOf(i, state.offset);
        if (!state.stamped[i] && x <= PRESS_X && x + step >= PRESS_X) {
          step = PRESS_X - x;
          state.waiting = i;
        }
      }
      state.offset = (state.offset + step) % span;
    }

    if (plates.current) {
      for (let i = 0; i < PLATES; i++) {
        const x = xOf(i, state.offset);
        // a plate wrapping round to the start is a fresh blank
        if (x < BELT.from + 0.05 && state.stamped[i]) state.stamped[i] = false;
        m.makeScale(1, state.stamped[i] ? 0.6 : 1, 1).setPosition(x, BELT.y + 0.04, BELT.z);
        plates.current.setMatrixAt(i, m);
        plates.current.setColorAt(i, plateColors[state.stamped[i] ? 1 : 0]);
      }
      plates.current.instanceMatrix.needsUpdate = true;
      if (plates.current.instanceColor) plates.current.instanceColor.needsUpdate = true;
    }
    state.pressDown = down;
  });

  return (
    <group>
      {/* conveyor */}
      <mesh position={[0, BELT.y - 0.03, BELT.z]} receiveShadow>
        <boxGeometry args={[BELT.to - BELT.from + 0.2, 0.06, 0.32]} />
        <meshStandardMaterial color="#0f111a" roughness={0.9} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[0, BELT.y, BELT.z + s * 0.18]}>
          <boxGeometry args={[BELT.to - BELT.from + 0.3, 0.05, 0.03]} />
          <meshStandardMaterial color="#d7dbe6" metalness={1} roughness={0.2} />
        </mesh>
      ))}
      <instancedMesh ref={plates} args={[undefined, undefined, PLATES]} castShadow>
        <boxGeometry args={[0.16, 0.04, 0.22]} />
        <meshStandardMaterial metalness={0.9} roughness={0.3} />
      </instancedMesh>

      {/* press frame */}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[PRESS_X + s * 0.28, 1.25, BELT.z]} castShadow>
          <boxGeometry args={[0.08, 1, 0.3]} />
          <meshStandardMaterial color="#1a1d29" metalness={0.7} roughness={0.35} />
        </mesh>
      ))}
      <mesh position={[PRESS_X, 1.8, BELT.z]} castShadow>
        <boxGeometry args={[0.66, 0.14, 0.34]} />
        <meshStandardMaterial color="#1a1d29" metalness={0.7} roughness={0.35} />
      </mesh>
      <group ref={piston} position={[PRESS_X, PISTON_TOP, BELT.z]}>
        <mesh position={[0, 0.12, 0]}>
          <cylinderGeometry args={[0.05, 0.05, 0.4, 24]} />
          <meshStandardMaterial color="#e7ebf3" metalness={1} roughness={0.08} />
        </mesh>
        <mesh position={[0, -0.12, 0]} castShadow>
          <boxGeometry args={[0.3, 0.1, 0.26]} />
          <meshStandardMaterial color="#cfd5e3" metalness={1} roughness={0.15} />
        </mesh>
        <mesh position={[0, -0.172, 0]}>
          <boxGeometry args={[0.3, 0.004, 0.26]} />
          <meshBasicMaterial color="#ff6a45" toneMapped={false} />
        </mesh>
      </group>

      {/* gears */}
      <mesh ref={gearA} geometry={gearGeo} position={[-0.7, 1.3, BELT.z - 0.3]} castShadow>
        <meshStandardMaterial color="#9aa1b4" metalness={1} roughness={0.28} />
      </mesh>
      <mesh ref={gearB} geometry={smallGearGeo} position={[-0.7 + 0.355, 1.3 + 0.08, BELT.z - 0.3]} castShadow>
        <meshStandardMaterial color="#6b7286" metalness={1} roughness={0.3} />
      </mesh>

      {/* status lamp */}
      <mesh position={[PRESS_X, 1.92, BELT.z + 0.1]}>
        <sphereGeometry args={[0.035, 20, 16]} />
        <meshBasicMaterial ref={lamp} color="#ff3b30" toneMapped={false} />
      </mesh>
    </group>
  );
}
