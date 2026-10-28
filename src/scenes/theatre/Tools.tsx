"use client";

import { useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { CuboidCollider, RigidBody, useRapier, type RapierRigidBody } from "@react-three/rapier";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { driveTargets, useGrabbable } from "@/components/physics/HandPhysics";
import { GROUPS } from "@/lib/physics/groups";
import { handStore } from "@/state/handStore";
import { TRAY } from "./layout";

const MODEL_URL = "/models/instruments.glb";

export type ToolName = "Scalpel" | "Forceps" | "Scissors" | "NeedleDriver" | "Stapler" | "Balfour";

interface ToolSpec {
  label: string;
  /** The marker on the tool that does the work (blade edge, jaw tip, needle point, staple outlet). */
  point: string;
  /** Moving parts: [left, right] turned about y by ±open × (1 − closed), or a trigger turned about x. */
  jaws?: { nodes: [string, string]; open: number };
  trigger?: { node: string; pull: number };
  /** Box colliders in the tool's frame (tip along −z, top +y): half sizes and centres, metres. */
  boxes: { half: [number, number, number]; at: [number, number, number] }[];
  mass: number;
}

export const TOOL_SPECS: Record<ToolName, ToolSpec> = {
  Scalpel: {
    label: "SCALPEL",
    point: "Scalpel_EDGE",
    boxes: [
      { half: [0.0055, 0.002, 0.06], at: [0, 0, 0.01] },
      // only the blade's cutting belly collides: it fits the slit whichever way the scalpel points
      { half: [0.0004, 0.004, 0.006], at: [0, -0.005, -0.074] },
    ],
    mass: 0.04,
  },
  Forceps: { label: "FORCEPS", point: "Forceps_TIP", jaws: { nodes: ["Forceps_JAW_L", "Forceps_JAW_R"], open: 0.06 }, boxes: [{ half: [0.005, 0.002, 0.06], at: [0, 0, 0] }], mass: 0.03 },
  Scissors: { label: "SCISSORS", point: "Scissors_TIP", jaws: { nodes: ["Scissors_JAW_L", "Scissors_JAW_R"], open: -0.22 }, boxes: [{ half: [0.012, 0.003, 0.075], at: [0, 0, 0] }], mass: 0.05 },
  NeedleDriver: { label: "NEEDLE DRIVER", point: "NeedleDriver_TIP", jaws: { nodes: ["NeedleDriver_JAW_L", "NeedleDriver_JAW_R"], open: -0.12 }, boxes: [{ half: [0.012, 0.003, 0.07], at: [0, 0, 0.01] }], mass: 0.05 },
  Stapler: {
    label: "STAPLER",
    point: "Stapler_TIP",
    trigger: { node: "Stapler_TRIGGER", pull: -0.35 },
    boxes: [
      { half: [0.013, 0.011, 0.05], at: [0, 0, 0] },
      { half: [0.012, 0.018, 0.013], at: [0, -0.025, 0.035] }, // the grip (shorter than drawn: it's held tilted)
    ],
    mass: 0.12,
  },
  Balfour: {
    label: "BALFOUR",
    point: "Balfour_SEAT",
    boxes: [
      { half: [0.1, 0.003, 0.078], at: [0, 0, 0] },
      { half: [0.025, 0.024, 0.002], at: [0, -0.024, 0.062] },
      { half: [0.025, 0.024, 0.002], at: [0, -0.024, -0.062] },
    ],
    mass: 0.25,
  },
};

export const TOOL_NAMES = Object.keys(TOOL_SPECS) as ToolName[];

/** Live handles on each instrument for the procedure, the monitor and tests. */
export interface ToolHandle {
  body: RapierRigidBody | null;
  /** 0 open … 1 squeezed shut (jaws closed, trigger pulled). */
  closed: number;
  held: boolean;
  /** The working point, in the tool's frame. */
  local: THREE.Vector3;
  /** Where the tool rests on the tray. */
  rest: THREE.Vector3;
  /** Seated in the wound (the Balfour): fixed there until it's sent back. */
  seated: boolean;
  /** Ask for the hand to let go (the Balfour clicking into place). */
  letGo: boolean;
}

export const tools = Object.fromEntries(
  TOOL_NAMES.map((n) => [n, { body: null, closed: 0, held: false, local: new THREE.Vector3(), rest: new THREE.Vector3(), seated: false, letGo: false } satisfies ToolHandle]),
) as Record<ToolName, ToolHandle>;

const q = new THREE.Quaternion();
/** World position of a tool's working point. */
export function toolPoint(name: ToolName, out = new THREE.Vector3()) {
  const t = tools[name];
  const b = t.body;
  if (!b) return out.set(0, -50, 0);
  const p = b.translation();
  const r = b.rotation();
  return out.copy(t.local).applyQuaternion(q.set(r.x, r.y, r.z, r.w)).add(p as THREE.Vector3);
}

/** The instrument in either hand, if any. */
export function heldTool(): ToolName | null {
  const holding = Object.values(handStore.getState().holding);
  return TOOL_NAMES.find((n) => holding.includes(TOOL_SPECS[n].label)) ?? null;
}

/** Back on the tray, still, a moment after it's put down (the scrub nurse takes it). */
export function returnToTray(name: ToolName, delay = 450) {
  setTimeout(() => {
    const t = tools[name];
    const b = t.body;
    if (!b || t.held || t.seated) return;
    b.setTranslation(t.rest, true);
    b.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
    b.setLinvel({ x: 0, y: 0, z: 0 }, true);
    b.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }, delay);
}

const ghostMat = new THREE.MeshBasicMaterial({ color: "#7fe3f0", transparent: true, opacity: 0.22, depthWrite: false });

/** One instrument: the model's node, physics in code, held like a pen, squeezed to close. */
function Tool({ name, model }: { name: ToolName; model: THREE.Object3D }) {
  const spec = TOOL_SPECS[name];
  const ref = useRef<RapierRigidBody>(null);
  const { rapier } = useRapier();
  const { visual, ghost, parts, rest, local } = useMemo(() => {
    const node = model.getObjectByName(name)!;
    const rest = node.position.clone();
    const local = node.getObjectByName(spec.point)!.position.clone();
    const visual = node.clone(true);
    visual.position.set(0, 0, 0);
    visual.traverse((o) => {
      if (o instanceof THREE.Mesh) o.castShadow = true;
    });
    const ghost = node.clone(true);
    ghost.position.set(0, 0, 0);
    ghost.traverse((o) => {
      if (o instanceof THREE.Mesh) o.material = ghostMat;
    });
    const parts = [...(spec.jaws?.nodes ?? []), ...(spec.trigger ? [spec.trigger.node] : [])].map((n) => [visual.getObjectByName(n)!, ghost.getObjectByName(n)!]);
    return { visual, ghost, parts, rest, local };
  }, [model, name, spec]);
  const ghostGroup = useRef<THREE.Group>(null);

  useEffect(() => {
    const t = tools[name];
    t.body = ref.current;
    t.rest.copy(rest);
    t.local.copy(local);
  });

  useGrabbable({
    id: name,
    name: spec.label,
    body: () => ref.current,
    gestures: ["pinch"],
    // held like a pen: pinch, squeeze or in between all keep it; open the hand to put it down
    holdGestures: ["pinch", "fist", "none", "point"],
    reach: 0.08,
    attach: "drive",
    throwable: false,
    switchGroups: false,
    // one instrument at a time, and not the seated retractor
    canGrab: () => heldTool() === null && !tools[name].seated,
    shouldRelease: () => tools[name].letGo,
    onGrab: () => void (tools[name].held = true),
    onRelease: () => {
      const t = tools[name];
      t.held = false;
      t.letGo = false;
      if (t.seated) {
        // clicked into the wound: fixed there, touching nothing
        const b = ref.current;
        b?.setBodyType(rapier.RigidBodyType.Fixed, true);
        for (let i = 0; i < (b?.numColliders() ?? 0); i++) b!.collider(i).setCollisionGroups(GROUPS.heldFree);
      } else returnToTray(name);
    },
  });

  useFrame((_, dt) => {
    const t = tools[name];
    const hands = handStore.getState();
    const hand = (Object.entries(hands.holding).find(([, v]) => v === spec.label)?.[0] ?? null) as "Left" | "Right" | null;
    const squeeze = t.held && hand ? hands.hands[hand]?.gesture === "fist" : false;
    t.closed += ((squeeze ? 1 : 0) - t.closed) * Math.min(1, dt * 18);
    parts.forEach(([v, g], i) => {
      if (spec.jaws) {
        const a = spec.jaws.open * (1 - t.closed) * (i === 0 ? 1 : -1);
        v.rotation.y = g.rotation.y = a;
      } else if (spec.trigger) v.rotation.x = g.rotation.x = spec.trigger.pull * t.closed;
    });
    const gg = ghostGroup.current;
    if (gg) {
      const target = driveTargets.get(name);
      gg.visible = !!target;
      if (target) {
        gg.position.copy(target.position);
        gg.quaternion.copy(target.quaternion);
      }
    }
  });

  return (
    <>
      <RigidBody ref={ref} position={[rest.x, rest.y + 0.005, rest.z]} colliders={false} ccd softCcdPrediction={0.04} angularDamping={4} linearDamping={2} name={name}>
        {spec.boxes.map((b, i) => (
          <CuboidCollider key={i} args={b.half} position={b.at} mass={spec.mass / spec.boxes.length} collisionGroups={GROUPS.tool} friction={0.6} />
        ))}
        <primitive object={visual} />
      </RigidBody>
      <group ref={ghostGroup} visible={false}>
        <primitive object={ghost} />
      </group>
    </>
  );
}

/** The Mayo tray with every instrument on it, and the kidney dish. */
export function Instruments() {
  const { scene } = useGLTF(MODEL_URL);
  const fixtures = useMemo(() => {
    const g = new THREE.Group();
    for (const n of ["MayoTray", "KidneyDish"]) {
      const o = scene.getObjectByName(n)!.clone(true);
      o.traverse((m) => {
        if (m instanceof THREE.Mesh) m.receiveShadow = m.castShadow = true;
      });
      g.add(o);
    }
    return g;
  }, [scene]);
  return (
    <>
      <RigidBody type="fixed" colliders={false} name="tray">
        <CuboidCollider args={[TRAY.half[0], 0.006, TRAY.half[1]]} position={[TRAY.x, TRAY.top - 0.006, TRAY.z]} collisionGroups={GROUPS.world} />
      </RigidBody>
      <primitive object={fixtures} />
      {TOOL_NAMES.map((n) => (
        <Tool key={n} name={n} model={scene} />
      ))}
    </>
  );
}

useGLTF.preload(MODEL_URL);
