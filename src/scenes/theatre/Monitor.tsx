"use client";

import { RigidBodyType } from "@dimforge/rapier3d-compat";
import { useFrame } from "@react-three/fiber";
import { useRapier } from "@react-three/rapier";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { GROUPS } from "@/lib/physics/groups";
import { handStore } from "@/state/handStore";
import { BALFOUR_SEAT, DISH, FASCIA_DEPTH, INCISION_NODES, MID_Z, skinHeight } from "./layout";
import { anatomy } from "./Patient";
import { bladeContact, closureWeights, coverageOf, CUT_DONE, markCut, nodeWeights, STITCH_COUNT } from "./procedure";
import { useTheatre } from "./theatreStore";
import { heldTool, returnToTray, toolPoint, tools, type ToolName } from "./Tools";

const tip = new THREE.Vector3();
const v = new THREE.Vector3();
/** How close a working point must come to its target, metres. */
const REACH = { ring: 0.016, specimen: 0.03, stitch: 0.008, staple: 0.012 };
/** The joined bowel: the clamps bring the ends this close before the first stitch. */
const APPROXIMATED = 0.9;

const setOpen = (layer: "skin" | "fascia", weights: number[]) => weights.forEach((w, k) => anatomy[layer]?.set(`Open_${k}`, w));

/** Where the dead segment is drawn: it sits in the bowel, rides the forceps, or lies in the dish. */
function placeSpecimen(centre: THREE.Vector3) {
  const n = anatomy.necrotic;
  if (n) n.position.copy(anatomy.necroticHome).add(v.copy(centre).sub(anatomy.necroticCentre));
}

/** Put the model in the state the store describes (after goto(): tests, practice, restart). */
function applyState(s: ReturnType<typeof useTheatre.getState>) {
  setOpen("skin", s.step === "done" ? Array(INCISION_NODES).fill(0) : s.step === "closure" ? closureWeights(stapleXs(s.staples), false) : nodeWeights(s.skinCut));
  setOpen("fascia", s.step === "closure" || s.step === "done" ? Array(INCISION_NODES).fill(0) : nodeWeights(s.fasciaCut));
  anatomy.skin?.set("Retracted", s.retracted ? 1 : 0);
  anatomy.fascia?.set("Retracted", s.retracted ? 1 : 0);
  const joined = s.step === "anastomosis" ? APPROXIMATED + ((1 - APPROXIMATED) * s.stitches) / STITCH_COUNT : s.stitches >= STITCH_COUNT ? 1 : 0;
  anatomy.proximal?.set("Approximate", joined);
  anatomy.distal?.set("Approximate", joined);
  placeSpecimen(s.specimen === "dish" ? new THREE.Vector3(DISH.x, DISH.y + 0.018, DISH.z) : anatomy.necroticCentre);
  const b = tools.Balfour;
  b.seated = s.retracted;
  b.letGo = false;
  if (b.body) {
    if (s.retracted) seatBalfour();
    else unseatBalfour(0);
  }
  anatomy.snap = true;
}

const stapleXs = (staples: boolean[]) => staples.flatMap((on, i) => (on ? [anatomy.staples[i]?.x ?? 0] : []));

function seatBalfour() {
  const b = tools.Balfour.body;
  if (!b) return;
  b.setBodyType(RigidBodyType.Fixed, true);
  b.setTranslation(BALFOUR_SEAT, true);
  b.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
  for (let i = 0; i < b.numColliders(); i++) b.collider(i).setCollisionGroups(0);
}

function unseatBalfour(delay = 300) {
  const t = tools.Balfour;
  t.seated = false;
  const b = t.body;
  if (!b) return;
  b.setBodyType(RigidBodyType.Dynamic, true);
  for (let i = 0; i < b.numColliders(); i++) b.collider(i).setCollisionGroups(GROUPS.tool);
  returnToTray("Balfour", delay);
}

/**
 * Runs the operation: reads the instrument in hand and its working point every frame, applies the
 * step's rules (cut only on the guide, seat the retractor, cut the rings, lift the specimen, stitch in
 * order, staple the marks), moves the model to match and publishes progress to the HUD.
 */
export function Monitor() {
  const { world } = useRapier();
  const last = useRef({ contact: "none" as string, closed: {} as Partial<Record<ToolName, number>>, publish: 0, breach: false, maxPen: 0, devSum: 0, devN: 0, grab: new THREE.Vector3(), noticeAt: 0 });
  const epoch = useTheatre((s) => s.epoch);
  const stitches = useTheatre((s) => s.stitches);
  const staples = useTheatre((s) => s.staples);

  useEffect(() => {
    applyState(useTheatre.getState());
    last.current.maxPen = 0;
    last.current.devSum = last.current.devN = 0;
  }, [epoch]);

  const marker = useRef<THREE.Mesh>(null);
  const thread = useMemo(() => {
    const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    const l = new THREE.Line(g, new THREE.LineBasicMaterial({ color: "#7b5cd6" }));
    l.frustumCulled = false;
    l.visible = false;
    return l;
  }, []);

  const notice = (text: string) => {
    last.current.noticeAt = performance.now();
    useTheatre.setState({ notice: text });
  };
  const stray = (text: string) => {
    useTheatre.setState((s) => ({ strays: s.strays + 1 }));
    notice(text);
  };

  useFrame(({ clock }) => {
    const s = useTheatre.getState();
    const L = last.current;
    const held = heldTool();
    const closedNow = (n: ToolName) => tools[n].closed > 0.8;
    const squeezed = (n: ToolName) => {
      // one squeeze: the moment the jaws (or trigger) close
      const was = (L.closed[n] ?? 0) > 0.8;
      return closedNow(n) && !was;
    };

    // The patient's colliders change as the wound opens: ask its body for the current ones every frame
    // (holding on to a removed collider and touching it panics Rapier).
    const pb = anatomy.body;
    const body = pb ? Array.from({ length: pb.numColliders() }, (_, i) => pb.collider(i)) : [];

    // 1. tool-into-anatomy depth, from the contact manifolds
    let pen = 0;
    let contact = false;
    let scalpelTouching = false;
    for (const name of Object.keys(tools) as ToolName[]) {
      const b = tools[name].body;
      if (!b || tools[name].seated) continue;
      for (let i = 0; i < b.numColliders(); i++) {
        const c = b.collider(i);
        for (const a of body) {
          world.contactPair(c, a, (m) => {
            for (let k = 0; k < m.numContacts(); k++) {
              const d = m.contactDist(k);
              if (d < 0.0015) {
                contact = true;
                if (name === "Scalpel") scalpelTouching = true;
              }
              if (d < 0) pen = Math.max(pen, -d);
            }
          });
        }
      }
    }
    L.maxPen = Math.max(L.maxPen, pen);

    // 2. sterile field: any hand joint inside the patient
    let breach = false;
    for (const h of Object.values(handStore.getState().hands)) {
      if (!h || breach) continue;
      breach = h.joints.some((j) => body.some((a) => a.containsPoint(j)));
    }
    if (breach && !L.breach) useTheatre.setState({ breaches: s.breaches + 1 });
    L.breach = breach;

    // 3. the step
    if (s.step === "incision" && held === "Scalpel") {
      toolPoint("Scalpel", tip);
      // the fascia lies under the skin: the edge must be in the slit, well below the surface
      const where = bladeContact(tip, scalpelTouching, s.layer === "fascia" ? FASCIA_DEPTH / 3 : undefined);
      if (where === "cut") {
        const cut = s.layer === "skin" ? s.skinCut : s.fasciaCut;
        L.devSum += Math.abs(tip.z - MID_Z);
        L.devN++;
        if (markCut(cut, tip.x)) {
          const coverage = coverageOf(cut);
          setOpen(s.layer, nodeWeights(cut));
          const accuracyMm = (L.devSum / L.devN) * 1000;
          if (coverage >= CUT_DONE) {
            cut.fill(true);
            setOpen(s.layer, nodeWeights(cut));
            if (s.layer === "skin") {
              useTheatre.setState({ layer: "fascia", skinCoverage: 1, accuracyMm });
              notice("Skin open. Now the fascia: run the blade along the line again.");
            } else {
              useTheatre.setState({ step: "retraction", fasciaCoverage: 1, accuracyMm });
              notice("Fascia open. Carry the Balfour retractor to the wound and let go.");
            }
          } else useTheatre.setState(s.layer === "skin" ? { skinCoverage: coverage, accuracyMm } : { fasciaCoverage: coverage, accuracyMm });
        }
      } else if (where === "off" && L.contact !== "off") stray("Stay on the purple line: nothing is cut off the guide.");
      L.contact = where;
    }

    if (s.step === "retraction") {
      const b = tools.Balfour;
      if (held === "Balfour" && b.body && !b.seated) {
        const p = b.body.translation();
        if (Math.hypot(p.x - BALFOUR_SEAT.x, p.z - BALFOUR_SEAT.z) < 0.045 && p.y < BALFOUR_SEAT.y + 0.07) {
          b.seated = true;
          b.letGo = true;
        }
      }
      if (b.seated && !b.held) {
        seatBalfour();
        anatomy.skin?.set("Retracted", 1);
        anatomy.fascia?.set("Retracted", 1);
        useTheatre.setState({ step: "resection", retracted: true });
        notice("Wound held open. Scissors: cut both ends of the dark segment, at the purple rings.");
      }
    }

    if (s.step === "resection") {
      if (held === "Scissors" && squeezed("Scissors")) {
        toolPoint("Scissors", tip);
        const ring = (["proximal", "distal"] as const).find((r) => !s.rings[r] && tip.distanceTo(anatomy.cuts[r]) < REACH.ring);
        if (ring) {
          const rings = { ...s.rings, [ring]: true };
          useTheatre.setState({ rings });
          if (rings.proximal && rings.distal) {
            placeSpecimen(v.copy(anatomy.necroticCentre).add(new THREE.Vector3(0, 0.003, 0)));
            notice("Both ends cut. Forceps: lift the dead segment into the kidney dish.");
          } else notice("One end cut. Now the other ring.");
        } else if (Math.abs(tip.x) < 0.1 && Math.abs(tip.z - MID_Z) < 0.07 && tip.y < 1.09) stray("Close the scissors on a purple ring.");
      }
      if (held === "Forceps") {
        toolPoint("Forceps", tip);
        if (s.specimen === "inside" && squeezed("Forceps")) {
          const centre = anatomy.necrotic ? v.copy(anatomy.necrotic.position).sub(anatomy.necroticHome).add(anatomy.necroticCentre) : v;
          if (tip.distanceTo(centre) < REACH.specimen) {
            if (s.rings.proximal && s.rings.distal) {
              L.grab.copy(centre).sub(tip);
              useTheatre.setState({ specimen: "held" });
            } else notice("Cut both ends first.");
          }
        }
        if (s.specimen === "held") {
          if (tools.Forceps.closed > 0.4) placeSpecimen(v.copy(tip).add(L.grab));
          else {
            const overDish = Math.abs(tip.x - DISH.x) < DISH.half[0] + 0.02 && Math.abs(tip.z - DISH.z) < DISH.half[1] + 0.02 && tip.y < DISH.y + 0.15;
            if (overDish) {
              placeSpecimen(new THREE.Vector3(DISH.x, DISH.y + 0.018, DISH.z));
              anatomy.proximal?.set("Approximate", APPROXIMATED);
              anatomy.distal?.set("Approximate", APPROXIMATED);
              useTheatre.setState({ specimen: "dish", step: "anastomosis" });
              notice("Specimen out. Needle driver: join the ends, stitch by stitch along the dots.");
            } else {
              placeSpecimen(v.copy(anatomy.necroticCentre).add(new THREE.Vector3(0, 0.003, 0)));
              useTheatre.setState({ specimen: "inside" });
              notice("Let go over the kidney dish.");
            }
          }
        }
      } else if (s.specimen === "held") {
        placeSpecimen(v.copy(anatomy.necroticCentre).add(new THREE.Vector3(0, 0.003, 0)));
        useTheatre.setState({ specimen: "inside" });
      }
    }

    if (s.step === "anastomosis" && held === "NeedleDriver") {
      toolPoint("NeedleDriver", tip);
      const next = anatomy.stitches[s.stitches];
      if (next && tip.distanceTo(next) < REACH.stitch) {
        const n = s.stitches + 1;
        const joined = APPROXIMATED + ((1 - APPROXIMATED) * n) / STITCH_COUNT;
        anatomy.proximal?.set("Approximate", joined);
        anatomy.distal?.set("Approximate", joined);
        if (n === STITCH_COUNT) {
          useTheatre.setState({ stitches: n, step: "closure", retracted: false });
          unseatBalfour();
          anatomy.skin?.set("Retracted", 0);
          anatomy.fascia?.set("Retracted", 0);
          setOpen("fascia", Array(INCISION_NODES).fill(0));
          notice("Bowel joined, fascia closed. Stapler: a staple on each purple mark.");
        } else useTheatre.setState({ stitches: n });
      }
    }

    if (s.step === "closure" && held === "Stapler" && squeezed("Stapler")) {
      toolPoint("Stapler", tip);
      const i = anatomy.staples.findIndex((m, k) => !s.staples[k] && Math.hypot(m.x - tip.x, m.z - tip.z) < REACH.staple && tip.y < m.y + 0.02);
      if (i >= 0) {
        const placed = s.staples.map((on, k) => on || k === i);
        const all = placed.every(Boolean);
        setOpen("skin", closureWeights(stapleXs(placed), all));
        useTheatre.setState(all ? { staples: placed, step: "done", finishedAt: performance.now() } : { staples: placed });
        if (all) notice("Operation complete.");
      } else if (Math.abs(tip.x) < 0.2 && Math.abs(tip.z - MID_Z) < 0.16 && tip.y < skinHeight(tip.x, tip.z) + 0.03) stray("Fire the stapler on a purple mark.");
    }

    for (const n of Object.keys(tools) as ToolName[]) L.closed[n] = tools[n].closed;

    // thread from the needle to the last stitch, and the next target's marker
    const s2 = useTheatre.getState();
    thread.visible = s2.step === "anastomosis" && held === "NeedleDriver" && s2.stitches > 0;
    if (thread.visible) {
      const pos = thread.geometry.getAttribute("position") as THREE.BufferAttribute;
      toolPoint("NeedleDriver", tip);
      const a = anatomy.stitches[s2.stitches - 1];
      pos.setXYZ(0, tip.x, tip.y, tip.z);
      pos.setXYZ(1, a.x, a.y, a.z);
      pos.needsUpdate = true;
    }
    const m = marker.current;
    if (m) {
      const target =
        s2.step === "resection" && !(s2.rings.proximal && s2.rings.distal) ? (s2.rings.proximal ? anatomy.cuts.distal : anatomy.cuts.proximal) : s2.step === "anastomosis" ? anatomy.stitches[s2.stitches] : null;
      m.visible = !!target;
      if (target) {
        m.position.copy(target);
        m.scale.setScalar(1 + 0.25 * Math.sin(clock.elapsedTime * 6));
      }
    }

    if (s2.notice && performance.now() - L.noticeAt > 4000) useTheatre.setState({ notice: null });

    // publish ~10 Hz (contact changes publish at once so the HUD reacts)
    const now = performance.now();
    if (now - L.publish > 100 || contact !== s2.contact || breach !== s2.breach) {
      L.publish = now;
      useTheatre.setState({ penetrationMm: pen * 1000, maxPenetrationMm: L.maxPen * 1000, contact, breach });
    }
  });

  return (
    <>
      <primitive object={thread} />
      <mesh ref={marker} visible={false} renderOrder={2}>
        <torusGeometry args={[0.006, 0.0009, 8, 24]} />
        <meshBasicMaterial color="#38e0d0" depthTest={false} transparent opacity={0.9} />
      </mesh>
      {anatomy.stitches.slice(0, stitches).map((p, i) => (
        <mesh key={i} position={p} rotation-y={Math.PI / 2}>
          <torusGeometry args={[0.0022, 0.0006, 6, 12]} />
          <meshStandardMaterial color="#6b4fbf" roughness={0.6} />
        </mesh>
      ))}
      {anatomy.staples.map((p, i) => (staples[i] ? <Staple key={i} at={p} /> : null))}
    </>
  );
}

/** A skin staple across the incision: a flat bridge with two legs into the skin. */
function Staple({ at }: { at: THREE.Vector3 }) {
  return (
    <group position={at}>
      <mesh position={[0, 0.0012, 0]} rotation-x={Math.PI / 2}>
        <cylinderGeometry args={[0.0005, 0.0005, 0.009, 6]} />
        <meshStandardMaterial color="#d7dde6" metalness={1} roughness={0.25} />
      </mesh>
      {[-0.0045, 0.0045].map((z) => (
        <mesh key={z} position={[0, 0, z]}>
          <cylinderGeometry args={[0.0005, 0.0005, 0.0025, 6]} />
          <meshStandardMaterial color="#d7dde6" metalness={1} roughness={0.25} />
        </mesh>
      ))}
    </group>
  );
}
