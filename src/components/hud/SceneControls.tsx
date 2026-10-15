"use client";

import { useState } from "react";
import { useHandStore } from "@/state/handStore";
import { useWeather, type WeatherKind } from "@/state/weatherStore";
import { useTracking } from "../tracking/HandTrackingProvider";
import styles from "./hud.module.css";

const NEXT_WEATHER: Record<WeatherKind, WeatherKind> = { clear: "rain", rain: "snow", snow: "clear" };
const WEATHER_LABEL: Record<WeatherKind, string> = { clear: "☀ Clear", rain: "☂ Rain", snow: "❄ Snow" };

const SOURCE_LABEL = { camera: "Camera", sim: "Simulated", playback: "Recording" } as const;

export function SceneControls({ demo }: { demo: string }) {
  const tracking = useTracking();
  const source = useHandStore((s) => s.source);
  const status = useHandStore((s) => s.status);
  const recording = useHandStore((s) => s.recording);
  const debug = useHandStore((s) => s.debug);
  const [help, setHelp] = useState(false);
  const weather = useWeather((s) => s.kind);
  const setWeather = useWeather((s) => s.setKind);

  return (
    <>
      <nav className={`${styles.pill} ${styles.controls} glass`} aria-label="Scene controls">
        {source && (
          <span className={`${styles.status} mono`} data-status={status}>
            {status === "loading" ? "Loading…" : SOURCE_LABEL[source]}
          </span>
        )}
        {source !== "camera" && <button onClick={() => tracking.startCamera()}>Camera</button>}
        {source !== "sim" && <button onClick={() => tracking.startSim()}>Sim</button>}
        {source !== "playback" && <button onClick={() => tracking.startPlayback(demo)}>Demo</button>}
        {source === "camera" && (
          <>
            <button onClick={() => tracking.recalibrate()} title="Hold your hand at a comfortable distance">Calibrate</button>
            <button onClick={() => tracking.toggleRecording()} aria-pressed={recording} className={recording ? styles.rec : ""}>
              {recording ? "■ Stop" : "● Rec"}
            </button>
          </>
        )}
        {source === "sim" && <button onClick={() => setHelp((h) => !h)} aria-expanded={help}>Keys</button>}
        <button onClick={() => setWeather(NEXT_WEATHER[weather])} title="Rain wets the hands (they dry when it stops); snow settles on them" data-testid="weather">
          {WEATHER_LABEL[weather]}
        </button>
        <button onClick={() => useHandStore.setState({ debug: !debug })} aria-pressed={debug}>Debug</button>
      </nav>
      {help && source === "sim" && (
        <div className={`${styles.help} glass mono`} role="note">
          <div><kbd>Mouse</kbd> move hand · <kbd>Click</kbd>/<kbd>Space</kbd> grab (fist)</div>
          <div><kbd>Shift</kbd>+click pinch · <kbd>Wheel</kbd> or <kbd>R</kbd>/<kbd>F</kbd> depth</div>
          <div><kbd>1–4</kbd> open · pinch · fist · point · <kbd>T</kbd> throw flick</div>
          <div><kbd>Q/E</kbd> roll · <kbd>W/S</kbd> pitch · <kbd>A/D</kbd> yaw · <kbd>0</kbd> reset</div>
          <div><kbd>Tab</kbd> switch hand · <kbd>H</kbd> show/hide other hand · <kbd>`</kbd> debug</div>
        </div>
      )}
    </>
  );
}
