"use client";

import { HandPhysics } from "@/components/physics/HandPhysics";
import { SceneShell } from "@/components/scene/SceneShell";
import type { Workspace } from "@/lib/hand/mapping";
import { Monitor } from "./Monitor";
import { anatomy, Patient } from "./Patient";
import { Room, TheatreLighting } from "./Room";
import { TheatreHud } from "./TheatreHud";
import { useTheatre } from "./theatreStore";
import { Instruments, toolPoint, tools } from "./Tools";

/** Smaller robot hands and a tighter workspace: this scene is about precision. */
const WORKSPACE: Workspace = {
  center: { x: 0.02, y: 1.2, z: -0.08 },
  width: 1.2,
  height: 0.8,
  depthGain: 1.0,
  depthRange: 0.4,
  handScale: 0.75, // was 1.2: hands 1.6× smaller
  // An upright hand at the webcam leans forward over the patient (~46°). More tipped the held tool
  // farther from the palm, so the wrist's small turns as you squeeze swung its tip by centimetres.
  tilt: 0.8,
  // Holding an instrument, slow moves are halved (and the tracker's shake with them); fast ones aren't.
  precision: { scale: 0.5, fullSpeed: 0.35 },
};

if (typeof window !== "undefined") Object.assign(window, { __theatre: useTheatre, __tools: { tools, point: (n: Parameters<typeof toolPoint>[0]) => toolPoint(n).toArray(), anatomy } });

export default function TheatreScene() {
  return (
    <SceneShell
      title="Operating Theatre"
      brief="A bowel resection in five steps: open the abdomen along the purple line, hold it open with the Balfour retractor, cut out the dead segment of bowel, stitch the healthy ends together and staple the skin. Pinch an instrument to pick it up, squeeze to close it. Hands never touch the patient, and nothing is cut off the guides."
      demo="/sessions/demo.json"
      workspace={WORKSPACE}
      camera={{ position: [0.02, 1.7, 0.8], fov: 62, lookAt: [0.05, 1.33, -1.2] }}
      hud={<TheatreHud />}
      // One instrument at a time, so one hand: the tracker doesn't search every frame for a second.
      hands={1}
      lighting={<TheatreLighting />}
      // Stiffer, more precise contacts than the other scenes: tools pushed into tissue should stop at it.
      physics={{ numSolverIterations: 8, allowedLinearError: 0.0002, contactNaturalFrequency: 60 }}
    >
      <HandPhysics scale={WORKSPACE.handScale}>
        <Room />
        <Patient />
        <Instruments />
        <Monitor />
      </HandPhysics>
    </SceneShell>
  );
}
