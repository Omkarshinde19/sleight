"use client";

import { useArcade, type AssistLevel } from "./arcadeStore";

const NEXT: Record<AssistLevel, AssistLevel> = { off: "fair", fair: "strong", strong: "off" };
import styles from "./arcade.module.css";

export function ArcadeHud() {
  const { score, streak, best, attempts, lastThrow, flash, assist, setAssist } = useArcade();

  return (
    <>
      <div className={`${styles.board} glass`} data-testid="arcade-board">
        <div>
          <span className="mono">Score</span>
          <b data-testid="score">{score}</b>
        </div>
        <div>
          <span className="mono">Streak</span>
          <b>{streak}</b>
        </div>
        <div>
          <span className="mono">Best</span>
          <b>{best}</b>
        </div>
        <div className={styles.meta}>
          <span className="mono">{attempts} throws</span>
          {lastThrow && (
            <span className={`mono ${styles.callout}`} data-testid="last-throw">
              v {lastThrow.speed.toFixed(1)} m/s · {lastThrow.angleDeg.toFixed(0)}°{lastThrow.assisted ? " · assisted" : ""}
            </span>
          )}
          <button
            className={`mono ${styles.assist}`}
            aria-pressed={assist !== "off"}
            onClick={() => setAssist(NEXT[assist])}
            title="How much of a near miss the aim assist corrects"
            data-testid="assist"
          >
            Aim assist: {assist}
          </button>
        </div>
      </div>
      {flash && (
        <div key={flash.at} className={styles.flash} data-miss={flash.text === "MISS"} aria-live="polite">
          {flash.text}
        </div>
      )}
      <p className={`${styles.tip} mono`}>Make a fist on a ball · swing forward and up · open your hand to release</p>
    </>
  );
}
