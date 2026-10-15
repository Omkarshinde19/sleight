"use client";

import { LEVERS, LEVER_MAX } from "./Levers";
import { SEAT_TOLERANCE } from "./ChipAndSocket";
import { useIndustrial } from "./industrialStore";
import styles from "./industrial.module.css";

const ok = (v: number, limit: number) => (Math.abs(v) < limit ? styles.ok : styles.off);

export function IndustrialHud() {
  const { seated, alignment, levers, parts } = useIndustrial();
  return (
    <>
      <div className={`${styles.panel} glass`} data-testid="industrial-panel">
        <div className={styles.row}>
          <span className="mono">Controller</span>
          <b data-testid="chip-state" className={seated ? styles.ok : styles.off}>
            {seated ? "Seated" : "No chip"}
          </b>
        </div>
        {!seated && alignment && (
          <div className={`${styles.align} mono`} data-testid="alignment">
            <span className={ok(Math.hypot(alignment.dx, alignment.dz), SEAT_TOLERANCE.xz)}>
              Δxy {(Math.hypot(alignment.dx, alignment.dz) * 1000).toFixed(0)} mm
            </span>
            <span className={ok(alignment.yawDeg, SEAT_TOLERANCE.yawDeg)}>Δθ {alignment.yawDeg.toFixed(0)}°</span>
            <span className={ok(alignment.tiltDeg, SEAT_TOLERANCE.tiltDeg)}>tilt {alignment.tiltDeg.toFixed(0)}°</span>
          </div>
        )}
        {LEVERS.map((l, i) => (
          <div key={l.label} className={styles.gauge}>
            <span className="mono">{l.label}</span>
            <div className={styles.bar}>
              <div style={{ width: `${levers[i] * 100}%` }} data-testid={`lever-${i}`} data-value={levers[i].toFixed(3)} />
            </div>
            <span className="mono">{((levers[i] * LEVER_MAX * 180) / Math.PI).toFixed(0)}°</span>
          </div>
        ))}
        <div className={styles.row}>
          <span className="mono">Parts stamped</span>
          <b data-testid="parts">{parts}</b>
        </div>
      </div>
      <p className={`${styles.tip} mono`}>
        {seated ? "Fist on a knob · pull toward you · it pulls back" : "Pinch the chip · line it up over the socket · let go"}
      </p>
    </>
  );
}
