"use client";

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useView } from "@/state/viewStore";

/** Radians of turn per pixel dragged, and zoom per wheel notch (100 px of deltaY). */
const LOOK_SPEED = 0.004;
const ZOOM_STEP = 1.15;
/** How quickly the view eases to where the mouse put it (1/s). */
const EASE = 14;

/**
 * Look around from where you stand: right-drag turns the head (yaw about the world's up, pitch about
 * the head's side), the wheel zooms by narrowing the field of view. The camera never moves, so the
 * hands still go where the scene expects. Input comes from `surface` (the scene's root element).
 */
export function CameraRig({ position, lookAt, fov, surface }: { position: [number, number, number]; lookAt: [number, number, number]; fov: number; surface: React.RefObject<HTMLElement | null> }) {
  const base = useMemo(() => {
    const dir = new THREE.Vector3(...lookAt).sub(new THREE.Vector3(...position)).normalize();
    return { yaw: Math.atan2(-dir.x, -dir.z), pitch: Math.asin(dir.y) };
  }, [position, lookAt]);
  const ease = useRef({ yaw: 0, pitch: 0, zoom: 1 });

  useEffect(() => {
    const el = surface.current;
    if (!el) return;
    let dragging = false;
    let last = { x: 0, y: 0 };
    const down = (e: PointerEvent) => {
      if (e.button !== 2) return;
      dragging = true;
      last = { x: e.clientX, y: e.clientY };
    };
    const move = (e: PointerEvent) => {
      if (!dragging) return;
      useView.getState().look(-(e.clientX - last.x) * LOOK_SPEED, -(e.clientY - last.y) * LOOK_SPEED);
      last = { x: e.clientX, y: e.clientY };
    };
    const up = (e: PointerEvent) => {
      if (e.button === 2) dragging = false;
    };
    const wheel = (e: WheelEvent) => {
      if ((e.target as HTMLElement)?.closest?.("button, a, input, [role=dialog]")) return;
      e.preventDefault();
      useView.getState().zoomBy(Math.pow(ZOOM_STEP, -e.deltaY / 100));
    };
    const menu = (e: MouseEvent) => e.preventDefault();
    el.addEventListener("pointerdown", down);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    el.addEventListener("wheel", wheel, { passive: false });
    el.addEventListener("contextmenu", menu);
    return () => {
      el.removeEventListener("pointerdown", down);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      el.removeEventListener("wheel", wheel);
      el.removeEventListener("contextmenu", menu);
    };
  }, [surface]);

  // a new scene starts looking where it's meant to
  useEffect(() => useView.getState().reset(), []);

  useFrame((state, dt) => {
    const camera = state.camera as THREE.PerspectiveCamera;
    const v = useView.getState();
    const eased = ease.current;
    const k = 1 - Math.exp(-dt * EASE);
    eased.yaw += (v.yaw - eased.yaw) * k;
    eased.pitch += (v.pitch - eased.pitch) * k;
    eased.zoom += (v.zoom - eased.zoom) * k;
    camera.position.set(...position);
    camera.rotation.set(base.pitch + eased.pitch, base.yaw + eased.yaw, 0, "YXZ");
    // zoom narrows the view: tan(fov/2) shrinks by the zoom factor
    const zoomed = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(fov) / 2) / eased.zoom));
    if (Math.abs(camera.fov - zoomed) > 1e-4) {
      camera.fov = zoomed;
      camera.updateProjectionMatrix();
    }
  });
  return null;
}
