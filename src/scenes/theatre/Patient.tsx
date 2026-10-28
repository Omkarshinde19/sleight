"use client";

import { useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { CuboidCollider, RigidBody, type RapierRigidBody } from "@react-three/rapier";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { GROUPS } from "@/lib/physics/groups";
import { CAVITY_FLOOR, FASCIA_DEPTH, INCISION, MID_Z, RETRACTED, SKIN_TOP, TABLE, TABLE_TOP } from "./layout";
import { useTheatre } from "./theatreStore";

const MODEL_URL = "/models/patient.glb";

/** Shape keys of one model part (it may be split into several meshes, one per material), eased to targets. */
export class Morphs {
  private meshes: THREE.Mesh[] = [];
  private target = new Map<string, number>();
  constructor(root: THREE.Object3D) {
    root.traverse((o) => {
      if (o instanceof THREE.Mesh && o.morphTargetDictionary) this.meshes.push(o);
    });
  }
  set(name: string, value: number) {
    this.target.set(name, value);
  }
  get(name: string) {
    const m = this.meshes[0];
    const i = m?.morphTargetDictionary?.[name];
    return i === undefined ? 0 : (m.morphTargetInfluences?.[i] ?? 0);
  }
  /** Ease toward the targets (rate 1 snaps). */
  update(rate: number) {
    for (const m of this.meshes) {
      for (const [name, v] of this.target) {
        const i = m.morphTargetDictionary![name];
        if (i === undefined) continue;
        const now = m.morphTargetInfluences![i];
        m.morphTargetInfluences![i] = now + (v - now) * rate;
      }
    }
  }
}

/** Live handles on the patient for the procedure, the monitor and tests. */
export const anatomy = {
  skin: null as Morphs | null,
  fascia: null as Morphs | null,
  proximal: null as Morphs | null,
  distal: null as Morphs | null,
  /** The dead segment, where it sits in the bowel, and the centre of its geometry there. */
  necrotic: null as THREE.Object3D | null,
  necroticHome: new THREE.Vector3(),
  necroticCentre: new THREE.Vector3(),
  clamps: [] as THREE.Object3D[],
  guides: {} as Partial<Record<"incision" | "staples" | "stitches" | "cutRings", THREE.Object3D>>,
  stitches: [] as THREE.Vector3[],
  staples: [] as THREE.Vector3[],
  cuts: { proximal: new THREE.Vector3(), distal: new THREE.Vector3() },
  /** The patient's body; its colliders (they change as the wound opens) give contact depth and sterile checks. */
  body: null as RapierRigidBody | null,
  /** Eased shape keys snap instead of easing for the next frame (after goto()). */
  snap: false,
};

type Wound = "closed" | "skinOpen" | "fasciaOpen" | "retracted";

/** A slab of the body from its base (y 0.84) up to `top`, over x0…x1 and MID_Z + z0 … MID_Z + z1. */
const slab = (x0: number, x1: number, z0: number, z1: number, top: number) => ({
  half: [(x1 - x0) / 2, (top - 0.84) / 2, (z1 - z0) / 2] as [number, number, number],
  at: [(x0 + x1) / 2, (top + 0.84) / 2, MID_Z + (z0 + z1) / 2] as [number, number, number],
});

/** Half-width of the cut's slit: as wide as the opened skin, so the blade drops in held either way. */
const SLIT = 0.01;

/**
 * The body as boxes. Round the abdomen the skin is stepped (it's domed); along the incision there's a
 * slit, whose floor drops as each layer is cut, so the scalpel can go deeper only there. Retracted, the
 * middle of the wound is open down to the bowel's bed.
 */
function bodyBoxes(wound: Wound) {
  const { from, to } = INCISION;
  const boxes = [
    slab(-0.62, -0.2, -0.18, 0.18, 1.03), // chest
    slab(0.2, 0.9, -0.18, 0.18, 0.95), // pelvis and legs
    slab(-0.2, 0.2, -0.2, -0.12, 0.99),
    slab(-0.2, 0.2, 0.12, 0.2, 0.99),
    // either side of the midline; pulled back and lower once retracted, so instruments reach the bowel
    slab(-0.2, 0.2, -0.12, -0.06, wound === "retracted" ? 1.01 : 1.035),
    slab(-0.2, 0.2, 0.06, 0.12, wound === "retracted" ? 1.01 : 1.035),
  ];
  if (wound === "closed") boxes.push(slab(-0.2, 0.2, -0.06, 0.06, SKIN_TOP));
  else if (wound === "retracted") {
    boxes.push(slab(-0.2, -RETRACTED.x, -0.06, 0.06, SKIN_TOP), slab(RETRACTED.x, 0.2, -0.06, 0.06, SKIN_TOP));
    boxes.push(slab(-RETRACTED.x, RETRACTED.x, -0.06, 0.06, CAVITY_FLOOR));
  } else {
    boxes.push(slab(-0.2, from, -0.06, 0.06, SKIN_TOP), slab(to, 0.2, -0.06, 0.06, SKIN_TOP));
    boxes.push(slab(from, to, -0.06, -SLIT, SKIN_TOP), slab(from, to, SLIT, 0.06, SKIN_TOP));
    boxes.push(slab(from, to, -SLIT, SLIT, wound === "skinOpen" ? SKIN_TOP - FASCIA_DEPTH : CAVITY_FLOOR));
  }
  return boxes;
}

export function Patient() {
  const { scene } = useGLTF(MODEL_URL);
  const body = useRef<RapierRigidBody>(null);
  const step = useTheatre((s) => s.step);
  const layer = useTheatre((s) => s.layer);
  const retracted = useTheatre((s) => s.retracted);
  const rings = useTheatre((s) => s.rings);

  const wound: Wound =
    step === "incision" ? (layer === "skin" ? "closed" : "skinOpen") : step === "retraction" ? (retracted ? "retracted" : "fasciaOpen") : retracted ? "retracted" : "closed";

  useMemo(() => {
    const get = (n: string) => scene.getObjectByName(n)!;
    anatomy.skin = new Morphs(get("Skin"));
    anatomy.fascia = new Morphs(get("Fascia"));
    anatomy.proximal = new Morphs(get("Bowel_Proximal"));
    anatomy.distal = new Morphs(get("Bowel_Distal"));
    const nec = get("Bowel_Necrotic");
    anatomy.necrotic = nec;
    anatomy.necroticHome.copy(nec.position);
    scene.updateMatrixWorld(true);
    new THREE.Box3().setFromObject(nec).getCenter(anatomy.necroticCentre);
    anatomy.clamps = [get("Clamp_Proximal"), get("Clamp_Distal")];
    anatomy.guides = { incision: get("Guide_Incision"), staples: get("Guide_Staples"), stitches: get("Guide_Stitches"), cutRings: get("Guide_CutRings") };
    const world = (n: string) => get(n).getWorldPosition(new THREE.Vector3());
    anatomy.stitches = Array.from({ length: 8 }, (_, k) => world(`STITCH_${String(k + 1).padStart(2, "0")}`));
    anatomy.staples = Array.from({ length: 10 }, (_, k) => world(`STAPLE_${String(k + 1).padStart(2, "0")}`));
    anatomy.cuts = { proximal: world("CUT_Proximal"), distal: world("CUT_Distal") };
    scene.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.castShadow = !o.name.startsWith("Guide");
        o.receiveShadow = true;
      }
    });
  }, [scene]);

  // what's shown at each step
  useEffect(() => {
    const g = anatomy.guides;
    if (g.incision) g.incision.visible = step === "incision";
    if (g.cutRings) g.cutRings.visible = step === "resection" && !(rings.proximal && rings.distal);
    if (g.stitches) g.stitches.visible = step === "anastomosis";
    if (g.staples) g.staples.visible = step === "closure";
    anatomy.clamps.forEach((c) => (c.visible = step === "resection" || step === "anastomosis"));
  }, [step, rings]);

  useEffect(() => {
    anatomy.body = body.current;
  });

  useFrame((_, dt) => {
    const rate = anatomy.snap ? 1 : Math.min(1, dt * 6);
    anatomy.snap = false;
    for (const m of [anatomy.skin, anatomy.fascia, anatomy.proximal, anatomy.distal]) m?.update(rate);
  });

  return (
    <>
      <RigidBody type="fixed" colliders={false} name="table">
        <CuboidCollider args={[TABLE.length / 2, 0.04, TABLE.width / 2]} position={[TABLE.x, TABLE_TOP - 0.04, TABLE.z]} collisionGroups={GROUPS.world} />
      </RigidBody>
      <RigidBody ref={body} type="fixed" colliders={false} name="patient">
        {bodyBoxes(wound).map((b, i) => (
          <CuboidCollider key={`${wound}-${i}`} args={b.half} position={b.at} collisionGroups={GROUPS.anatomy} friction={0.9} />
        ))}
      </RigidBody>
      <primitive object={scene} />
    </>
  );
}

useGLTF.preload(MODEL_URL);
