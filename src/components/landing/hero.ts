import type { Workspace } from "@/lib/hand/mapping";

/** Where the hero hand moves: the plane z = 0 through the stage camera's target, the hero's full height. */
export const LANDING_WORKSPACE: Workspace = {
  center: { x: 0, y: 1.13, z: 0 },
  width: 2.1, // see landingWorkspace
  height: 1.19,
  depthGain: 0.6,
  depthRange: 0.35,
  handScale: 1.44,
};

/** Stage camera distance from the hand's plane (LandingStage): further back on portrait screens. */
export const cameraDistance = (width: number, height: number) => (width < height ? 2.6 : 1.55);

/** The landing workspace for a window: the stage camera's whole view of the hand's plane (fov 42°). */
export function landingWorkspace(width: number, height: number): Workspace {
  const h = 2 * cameraDistance(width, height) * Math.tan((21 * Math.PI) / 180);
  return { ...LANDING_WORKSPACE, height: h, width: h * (width / height) };
}

/** Hero state shared between the page and the 3D stage, outside React (read and written every frame). */
export type Room = "arcade" | "theatre";

export const hero = {
  /** The mouse or finger over the hero, in px from the hero's top-left. */
  pointer: { x: 0, y: 0, active: false },
  /** Mouse button or finger down. */
  pressed: false,
  /** The room whose index entry is hovered: the hand acts it out. */
  preview: null as Room | null,
  /** The hand's grip point on screen (px in the hero) and whether it's closed. Written by the stage. */
  hand: { x: 0, y: 0, closed: false, visible: false },
  /** The hero is on screen (the stage stops drawing when it isn't). */
  inView: true,
};
