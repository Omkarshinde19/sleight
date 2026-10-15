"use client";

import { useEffect, useRef } from "react";
import { BONES, type Handedness } from "@/lib/hand/types";
import { handStore, useHandStore } from "@/state/handStore";
import { useTracking } from "../tracking/HandTrackingProvider";
import styles from "./hud.module.css";

const HAND_COLOUR: Record<Handedness, string> = { Right: "#7fe3f0", Left: "#ff8a6a" };

/**
 * Landmark skeleton (over the mirrored camera feed when there is one), gesture, fps, latency and grab state.
 * Draws on its own animation frame from the store, so it costs React nothing.
 */
export function DebugOverlay() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const stats = useRef<HTMLDivElement>(null);
  const { video } = useTracking();
  const debug = useHandStore((s) => s.debug);

  useEffect(() => {
    if (!debug) return;
    let raf = 0;
    let frames = 0;
    let renderFps = 0;
    let last = performance.now();

    const draw = () => {
      raf = requestAnimationFrame(draw);
      const now = performance.now();
      frames++;
      if (now - last > 500) {
        renderFps = (frames * 1000) / (now - last);
        frames = 0;
        last = now;
      }
      const c = canvas.current;
      const ctx = c?.getContext("2d");
      if (!c || !ctx) return;
      const s = handStore.getState();
      const W = c.width;
      const H = c.height;
      ctx.clearRect(0, 0, W, H);

      // Mirror so it reads like a mirror, matching how the robot hands move.
      ctx.save();
      ctx.translate(W, 0);
      ctx.scale(-1, 1);
      if (video && video.readyState >= 2) {
        ctx.globalAlpha = 0.55;
        ctx.drawImage(video, 0, 0, W, H);
        ctx.globalAlpha = 1;
      }
      for (const hand of Object.values(s.hands)) {
        if (!hand) continue;
        ctx.strokeStyle = HAND_COLOUR[hand.handedness];
        ctx.fillStyle = HAND_COLOUR[hand.handedness];
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (const [a, b] of BONES) {
          ctx.moveTo(hand.image[a].x * W, hand.image[a].y * H);
          ctx.lineTo(hand.image[b].x * W, hand.image[b].y * H);
        }
        ctx.stroke();
        for (const p of hand.image) {
          ctx.beginPath();
          ctx.arc(p.x * W, p.y * H, 2.6, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.restore();

      if (stats.current) {
        const rows = (["Right", "Left"] as Handedness[]).map((h) => {
          const hand = s.hands[h];
          if (!hand) return `<span class="${styles.dim}">${h[0]} —</span>`;
          const held = s.holding[h];
          return `<span style="color:${HAND_COLOUR[h]}">${h[0]}</span> ${hand.gesture.toUpperCase().padEnd(5, " ")} grip ${hand.features.grip.toFixed(2)} pinch ${hand.features.pinchDistance.toFixed(2)} z ${hand.depth.toFixed(2)}${held ? ` · <b>HOLD ${held}</b>` : ""}`;
        });
        stats.current.innerHTML = [
          `render ${renderFps.toFixed(0)} fps · tracker ${s.trackerFps.toFixed(0)} fps · ${s.source === "camera" ? `${s.latencyMs.toFixed(1)} ms ${s.delegate ?? ""}` : (s.source ?? "no source")}`,
          ...rows,
          s.calibrating ? `<span class="${styles.warn}">calibrating depth — hold still</span>` : "",
        ]
          .filter(Boolean)
          .join("<br/>");
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [debug, video]);

  if (!debug) return null;
  return (
    <div className={`${styles.debug} glass`} data-testid="debug-overlay">
      <canvas ref={canvas} width={240} height={180} className={styles.debugCanvas} aria-label="Hand landmark skeleton" />
      <div ref={stats} className={`${styles.debugStats} mono`} data-testid="debug-stats" />
    </div>
  );
}
