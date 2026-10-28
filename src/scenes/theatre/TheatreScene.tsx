"use client";

import { HandPhysics } from "@/components/physics/HandPhysics";
import { SceneShell } from "@/components/scene/SceneShell";
import type { Workspace } from "@/lib/hand/mapping";
import { Forceps, Fragments, instruments, Scalpel, TrayAndDish } from "./Instruments";
import { Monitor } from "./Monitor";
import { Patient } from "./Patient";
import { Room } from "./Room";
import { TheatreHud } from "./TheatreHud";
import { useTheatre } from "./theatreStore";

/** Smaller robot hands and a tighter workspace: this scene is about precision. */
const WORKSPACE: Workspace = {
  center: { x: 0.02, y: 1.2, z: -0.08 },
  width: 1.2,
  height: 0.8,
  depthGain: 1.0,
  depthRange: 0.4,
  handScale: 1.2,
};

if (typeof window !== "undefined") Object.assign(window, { __theatre: useTheatre, __instruments: instruments });

export default function TheatreScene() {
  return (
    <SceneShell
      title="Operating Theatre"
      brief="Hands never touch the patient. Pinch the scalpel and run it along the dotted line on the practice pad, then pinch the forceps, squeeze to grip each fragment in the wound and drop it in the kidney dish. The instruments stop at tissue — watch the ghost when you push."
      demo="/sessions/demo.json"
      workspace={WORKSPACE}
      camera={{ position: [0.02, 1.62, 0.62], fov: 50, lookAt: [0, 1.0, -0.42] }}
      hud={<TheatreHud />}
      // Stiffer, more precise contacts than the other scenes: tools pushed into tissue should stop at it.
      physics={{ numSolverIterations: 8, allowedLinearError: 0.0002, contactNaturalFrequency: 60 }}
    >
      <HandPhysics scale={WORKSPACE.handScale}>
        <Room />
        <Patient />
        <TrayAndDish />
        <Scalpel />
        <Forceps />
        <Fragments />
        <Monitor />
      </HandPhysics>
    </SceneShell>
  );
}
