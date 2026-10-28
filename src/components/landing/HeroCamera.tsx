"use client";

import { useTracking } from "@/components/tracking/HandTrackingProvider";
import { useHandStore } from "@/state/handStore";
import styles from "./landing.module.css";

/** The hero's camera switch: your own hand drives the hero hand, tracked in this tab like in the rooms. */
export function HeroCamera() {
  const tracking = useTracking();
  const status = useHandStore((s) => (s.source === "camera" ? s.status : s.status === "denied" || s.status === "error" ? s.status : "idle"));
  const error = useHandStore((s) => s.error);
  const seen = useHandStore((s) => s.source === "camera" && Object.keys(s.hands).length > 0);

  const on = status === "loading" || status === "running";
  const note =
    status === "loading"
      ? "Starting the tracker…"
      : status === "running"
        ? seen
          ? "Make a fist to squeeze the paint · close on a letter to grab it"
          : "Hold a hand up to the camera"
        : status === "denied"
          ? "Camera blocked. Allow it in the address bar, or use the mouse"
          : status === "error"
            ? (error ?? "The camera didn't start")
            : "Frames stay in this tab";

  return (
    <div className={styles.camera}>
      <button type="button" className={styles.pill} data-on={on || undefined} onClick={() => (on ? tracking.stop() : tracking.startCamera())}>
        <span className={styles.rec} aria-hidden />
        {on ? "Stop camera" : "Try it with your camera"}
      </button>
      <p className={styles.cameraNote} aria-live="polite">
        {note}
      </p>
    </div>
  );
}
