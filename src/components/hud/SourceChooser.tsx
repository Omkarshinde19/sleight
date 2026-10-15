"use client";

import { useHandStore } from "@/state/handStore";
import { useTracking } from "../tracking/HandTrackingProvider";
import styles from "./hud.module.css";

/** Pick how hands come in. Shown before anything asks for the camera. */
export function SourceChooser({ title, brief, demo }: { title: string; brief: string; demo: string }) {
  const tracking = useTracking();
  const status = useHandStore((s) => s.status);
  const error = useHandStore((s) => s.error);

  return (
    <div className={styles.chooserWrap} role="dialog" aria-labelledby="chooser-title">
      <div className={`${styles.chooser} glass`}>
        <p className="mono" style={{ color: "var(--cyan)" }}>Scene</p>
        <h1 id="chooser-title" className={styles.chooserTitle}>{title}</h1>
        <p className={styles.chooserBrief}>{brief}</p>

        {status === "denied" && (
          <p className={styles.notice} role="alert">
            Camera permission was declined. You can allow it from the address bar, or try the simulated hand.
          </p>
        )}
        {status === "error" && error && (
          <p className={styles.notice} role="alert">{error}</p>
        )}

        <div className={styles.choices}>
          <button className={`${styles.choice} ${styles.primary}`} onClick={() => tracking.startCamera()}>
            <b>Use my camera</b>
            <span>Tracked on this device. Nothing is uploaded.</span>
          </button>
          <button className={styles.choice} onClick={() => tracking.startSim()} data-testid="start-sim">
            <b>Simulated hand</b>
            <span>Mouse moves, click grabs, wheel for depth.</span>
          </button>
          <button className={styles.choice} onClick={() => tracking.startPlayback(demo)} data-testid="start-demo">
            <b>Play a recording</b>
            <span>A recorded session, for a hands-free demo.</span>
          </button>
        </div>
      </div>
    </div>
  );
}
