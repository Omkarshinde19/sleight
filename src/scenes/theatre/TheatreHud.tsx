"use client";

import { useTheatre } from "./theatreStore";
import styles from "./theatre.module.css";

export function TheatreHud() {
  const t = useTheatre();
  return (
    <>
      <div className={`${styles.panel} glass`} data-testid="theatre-panel">
        <p className="mono" style={{ color: "var(--cyan)" }}>Procedure</p>
        <div className={styles.task}>
          <span className="mono">1 · Scalpel</span>
          <b data-testid="coverage">{Math.round(t.coverage * 100)}%</b>
          <small className="mono">of the dotted line{t.accuracyMm !== null ? ` · ±${t.accuracyMm.toFixed(1)} mm` : ""}</small>
        </div>
        <div className={styles.task}>
          <span className="mono">2 · Forceps</span>
          <b data-testid="retrieved">{t.retrieved}/3</b>
          <small className="mono">fragments in the dish</small>
        </div>
        <div className={styles.metrics}>
          <div>
            <span className="mono">Tool contact</span>
            <b className={t.contact ? styles.live : ""} data-testid="contact">{t.contact ? "TOUCHING" : "—"}</b>
          </div>
          <div title="How far the tool sits inside the anatomy right now, and the worst so far. The solver allows ~1 mm of slop.">
            <span className="mono">Penetration</span>
            <b data-testid="penetration">
              {t.penetrationMm.toFixed(1)} <small>/ max {t.maxPenetrationMm.toFixed(1)} mm</small>
            </b>
          </div>
          <div>
            <span className="mono">Sterile field</span>
            <b className={t.breach ? styles.alarm : styles.ok} data-testid="sterile">{t.breach ? "BREACH" : t.breaches ? `${t.breaches} breach${t.breaches > 1 ? "es" : ""}` : "Clean"}</b>
          </div>
        </div>
      </div>
      {t.breach && (
        <div className={styles.breach} role="alert">
          Hands off the patient — use the instruments
        </div>
      )}
      <p className={`${styles.tip} mono`}>Pinch an instrument to pick it up · squeeze to close the forceps · open your hand to put it down</p>
    </>
  );
}
