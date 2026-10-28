import { create } from "zustand";

/** Limits on looking around from where you stand, and on zoom. */
export const VIEW_LIMITS = { yaw: Math.PI / 3, pitch: (40 * Math.PI) / 180, zoom: [0.75, 3] as const };

interface ViewState {
  /** Turn away from the scene's own view, radians: left/right (yaw) and up/down (pitch). */
  yaw: number;
  pitch: number;
  /** 1 = the scene's own field of view; 2 = twice as close. */
  zoom: number;
  look: (dYaw: number, dPitch: number) => void;
  zoomBy: (factor: number) => void;
  reset: () => void;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** The viewer's head: where they've turned and zoomed with the mouse (right-drag, wheel). */
export const useView = create<ViewState>((set) => ({
  yaw: 0,
  pitch: 0,
  zoom: 1,
  look: (dYaw, dPitch) =>
    set((s) => ({ yaw: clamp(s.yaw + dYaw, -VIEW_LIMITS.yaw, VIEW_LIMITS.yaw), pitch: clamp(s.pitch + dPitch, -VIEW_LIMITS.pitch, VIEW_LIMITS.pitch) })),
  zoomBy: (factor) => set((s) => ({ zoom: clamp(s.zoom * factor, VIEW_LIMITS.zoom[0], VIEW_LIMITS.zoom[1]) })),
  reset: () => set({ yaw: 0, pitch: 0, zoom: 1 }),
}));

export const viewMoved = (s: Pick<ViewState, "yaw" | "pitch" | "zoom">) => Math.abs(s.yaw) > 0.01 || Math.abs(s.pitch) > 0.01 || Math.abs(s.zoom - 1) > 0.01;
