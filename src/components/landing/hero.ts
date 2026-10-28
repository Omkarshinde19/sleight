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
