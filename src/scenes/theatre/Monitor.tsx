"use client";

import { useFrame } from "@react-three/fiber";
import { useRapier } from "@react-three/rapier";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { coverage, meanDeviation, type P2 } from "@/lib/physics/incision";
import { handStore } from "@/state/handStore";
import { instruments, SCALPEL } from "./Instruments";
import { DISH, GUIDE, PAD, PAD_TOP } from "./layout";
import { anatomyColliders } from "./Patient";
import { useTheatre } from "./theatreStore";

const MAX_CUT = 4000;
const q = new THREE.Quaternion();
const edge = new THREE.Vector3();

/**
 * Watches the operation: how deep tools sit in the anatomy (contact manifolds, so it's the
 * solver's own number), whether a hand has entered the patient, the incision and the fragments.
 */
export function Monitor() {
  const { world } = useRapier();
  const cut = useRef<P2[]>([]);
  const lastCutFrame = useRef(-10);
  const frame = useRef(0);
  const lastPublish = useRef(0);
  const breachWas = useRef(false);
  const maxPen = useRef(0);

  const cutLine = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(MAX_CUT * 2 * 3), 3));
    g.setDrawRange(0, 0);
    const l = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: "#c2321f" }));
    l.frustumCulled = false;
    return l;
  }, []);
  const segs = useRef(0);

  useFrame(() => {
    frame.current++;
    const t = useTheatre.getState();

    // 1. tool-into-anatomy depth, from the contact manifolds
    let pen = 0;
    let contact = false;
    for (const tool of [instruments.scalpel, instruments.forceps]) {
      if (!tool) continue;
      for (let i = 0; i < tool.numColliders(); i++) {
        const c = tool.collider(i);
        for (const a of anatomyColliders) {
          world.contactPair(c, a, (m) => {
            for (let k = 0; k < m.numContacts(); k++) {
              const d = m.contactDist(k);
              if (d < 0.0015) contact = true;
              if (d < 0) pen = Math.max(pen, -d);
            }
          });
        }
      }
    }
    maxPen.current = Math.max(maxPen.current, pen);

    // 2. sterile field: any hand joint inside the patient
    const hands = handStore.getState().hands;
    let breach = false;
    for (const h of Object.values(hands)) {
      if (!h || breach) continue;
      for (const j of h.joints) {
        if (anatomyColliders.some((a) => a.containsPoint(j))) {
          breach = true;
          break;
        }
      }
    }
    if (breach && !breachWas.current) useTheatre.setState({ breaches: t.breaches + 1 });
    breachWas.current = breach;

    // 3. incision: the cutting edge resting on the practice pad leaves a cut
    const s = instruments.scalpel;
    const holdingScalpel = Object.values(handStore.getState().holding).includes("SCALPEL");
    if (s && holdingScalpel) {
      const p = s.translation();
      const r = s.rotation();
      edge.copy(SCALPEL.edge).applyQuaternion(q.set(r.x, r.y, r.z, r.w)).add(p as THREE.Vector3);
      const onPad = Math.abs(edge.x - PAD.x) < PAD.half[0] && Math.abs(edge.z - PAD.z) < PAD.half[2] && edge.y < PAD_TOP + 0.0035;
      if (onPad) {
        const last = cut.current[cut.current.length - 1];
        const moved = !last || Math.hypot(edge.x - last.x, edge.z - last.z) > 0.0015;
        if (moved && cut.current.length < MAX_CUT) {
          const continuing = last && frame.current - lastCutFrame.current < 4;
          cut.current.push({ x: edge.x, z: edge.z });
          if (continuing && segs.current < MAX_CUT) {
            const pos = cutLine.geometry.getAttribute("position") as THREE.BufferAttribute;
            pos.setXYZ(segs.current * 2, last.x, PAD_TOP + 0.0007, last.z);
            pos.setXYZ(segs.current * 2 + 1, edge.x, PAD_TOP + 0.0007, edge.z);
            segs.current++;
            pos.needsUpdate = true;
            cutLine.geometry.setDrawRange(0, segs.current * 2);
          }
        }
        lastCutFrame.current = frame.current;
      }
    }

    // 4. fragments resting in the kidney dish
    const retrieved = instruments.fragments.filter((f) => {
      if (!f.body || f.held) return false;
      const p = f.body.translation();
      return Math.hypot(p.x - DISH.x, p.z - DISH.z) < DISH.radius && p.y < DISH.y + 0.05;
    }).length;

    // publish ~10 Hz (contact changes publish at once so the HUD reacts)
    const now = performance.now();
    if (now - lastPublish.current > 100 || contact !== t.contact || breach !== t.breach) {
      lastPublish.current = now;
      const dev = meanDeviation(cut.current, GUIDE.from, GUIDE.to);
      useTheatre.setState({
        penetrationMm: pen * 1000,
        maxPenetrationMm: maxPen.current * 1000,
        contact,
        breach,
        retrieved,
        coverage: coverage(cut.current, GUIDE.from, GUIDE.to),
        accuracyMm: dev === null ? null : dev * 1000,
      });
    }
  });

  return <primitive object={cutLine} />;
}
