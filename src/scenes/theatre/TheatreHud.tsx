"use client";

import { score, STAPLE_COUNT, STEP_TITLES, STEPS, STITCH_COUNT, type Step } from "./procedure";
import { useTheatre } from "./theatreStore";
import styles from "./theatre.module.css";

type View = ReturnType<typeof useTheatre.getState>;

/** What to do now, per step: the instrument and the move. */
const HINTS: Record<Step, (s: View) => string> = {
  incision: (s) => (s.layer === "skin" ? "Scalpel: run the blade along the purple line to open the skin." : "Again along the line, deeper: open the fascia."),
  retraction: () => "Pick up the Balfour retractor, carry it over the wound and let go.",
  resection: (s) => (s.rings.proximal && s.rings.distal ? "Forceps: squeeze on the dark segment, lift it into the kidney dish, open." : "Scissors: squeeze shut on each purple ring round the dark segment."),
  anastomosis: () => "Needle driver: touch the needle to each glowing dot, in order.",
  closure: () => "Stapler: squeeze on each purple mark along the incision.",
  done: () => "Operation complete.",
};

function progress(step: Step, s: View): string {
  switch (step) {
    case "incision":
      return `${Math.round(s.skinCoverage * 100)}% · ${Math.round(s.fasciaCoverage * 100)}%`;
    case "retraction":
      return s.retracted || STEPS.indexOf(s.step) > 1 ? "done" : "—";
    case "resection":
      return `${Number(s.rings.proximal) + Number(s.rings.distal)}/2 · ${s.specimen === "dish" ? "out" : "in"}`;
    case "anastomosis":
      return `${s.stitches}/${STITCH_COUNT}`;
    case "closure":
      return `${s.staples.filter(Boolean).length}/${STAPLE_COUNT}`;
    default:
      return "";
  }
}

export function TheatreHud() {
  const t = useTheatre();
  const current = STEPS.indexOf(t.step);
  const seconds = t.finishedAt === null ? 0 : (t.finishedAt - t.startedAt) / 1000;
  const result = t.step === "done" ? score({ accuracyMm: t.accuracyMm, strays: t.strays, breaches: t.breaches, maxPenetrationMm: t.maxPenetrationMm, seconds }) : null;
  return (
    <>
      <div className={`${styles.panel} glass`} data-testid="theatre-panel">
        <p className="mono" style={{ color: "var(--cyan)" }}>Bowel resection</p>
        <ol className={styles.steps}>
          {STEPS.slice(0, 5).map((step, i) => (
            <li key={step} className={i < current ? styles.doneStep : i === current ? styles.nowStep : ""} data-testid={`step-${step}`}>
              <span className="mono">
                {i + 1} · {STEP_TITLES[step]}
              </span>
              <b className="mono">{progress(step, t)}</b>
            </li>
          ))}
        </ol>
        <p className={styles.hint} data-testid="hint">{HINTS[t.step](t)}</p>
        <div className={styles.metrics}>
          <div>
            <span className="mono">Accuracy</span>
            <b data-testid="accuracy">{t.accuracyMm === null ? "—" : `±${t.accuracyMm.toFixed(1)} mm`}</b>
          </div>
          <div title="Attempts off the guides: cutting beside the line, closing scissors or firing staples away from a mark.">
            <span className="mono">Strays</span>
            <b data-testid="strays">{t.strays}</b>
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
      {t.notice && (
        <div className={`${styles.notice} glass mono`} role="status" data-testid="notice">
          {t.notice}
        </div>
      )}
      {t.breach && (
        <div className={styles.breach} role="alert">
          Hands off the patient — use the instruments
        </div>
      )}
      {result && (
        <div className={`${styles.result} glass`} data-testid="result">
          <p className="mono">Operation complete</p>
          <b>{result.grade}</b>
          <span className="mono">
            {result.score} / 100 · {Math.floor(seconds / 60)}:{String(Math.round(seconds % 60)).padStart(2, "0")}
          </span>
          <button className="mono" onClick={() => t.goto("incision")}>
            Operate again
          </button>
        </div>
      )}
      <p className={`${styles.tip} mono`}>Pinch an instrument to pick it up · squeeze to close it · open your hand to put it down (one at a time)</p>
    </>
  );
}
