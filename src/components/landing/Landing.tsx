"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useWeather, type WeatherKind } from "@/state/weatherStore";
import { callouts } from "./callouts";
import { archivo } from "./fonts";
import { updateScroll } from "./scroll";
import styles from "./landing.module.css";

const LandingStage = dynamic(() => import("./LandingStage"), { ssr: false });

const CHAPTERS = [
  {
    n: "01",
    href: "/arcade",
    name: "The Thrower",
    scene: "Arcade Room",
    lede: "Close your fist on a basketball, swing, open your hand. The ball leaves with your hand's own velocity.",
    facts: [
      ["Release velocity", "least-squares slope over the fastest 120 ms before you let go"],
      ["Grab", "a fixed joint to the hand — the ball is never teleported"],
      ["Aim assist", "corrects a share of the miss, at the arc you chose"],
    ],
  },
  {
    n: "02",
    href: "/theatre",
    name: "The Surgeon",
    scene: "Operating Theatre",
    lede: "Hands never touch the patient. The scalpel and forceps do — and they stop at tissue instead of passing through it.",
    facts: [
      ["Tools", "steered by velocity each physics step, so contacts and CCD can stop them"],
      ["Measured", "under 0.05 mm overlap pressed 5 cm into the pad"],
      ["Sterile field", "any finger joint inside the patient raises a breach"],
    ],
  },
] as const;

const PIPELINE = [
  ["Webcam", "640×480, never uploaded"],
  ["HandLandmarker", "MediaPipe WASM, GPU when available"],
  ["One Euro filter", "smooth at rest, quick in motion"],
  ["Gestures", "open · pinch · fist · point, with hysteresis"],
  ["Rapier physics", "kinematic hands, joints, CCD"],
] as const;

const WEATHER: { kind: WeatherKind; label: string }[] = [
  { kind: "clear", label: "Clear" },
  { kind: "rain", label: "Rain" },
  { kind: "snow", label: "Snow" },
];

export function Landing() {
  const calloutRoot = useRef<HTMLDivElement>(null);
  const [showStage, setShowStage] = useState(false);
  const weather = useWeather((s) => s.kind);
  const setWeather = useWeather((s) => s.setKind);

  useEffect(() => {
    callouts.root = calloutRoot.current;
    updateScroll();
    const onScroll = () => updateScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    // Let the text paint first, then bring in the 3D.
    const id = requestAnimationFrame(() => setShowStage(true));
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      cancelAnimationFrame(id);
    };
  }, []);

  return (
    <div className={`${styles.page} ${archivo.variable}`}>
      <div className={styles.backdrop} aria-hidden />
      <div className={styles.stage} aria-hidden>
        {showStage && <LandingStage />}
        <div ref={calloutRoot} className={styles.callouts}>
          {[0, 1, 2].map((i) => (
            <div key={i} className={styles.callout} data-side={i === 2 ? "below" : "above"}>
              <i />
              <span className="mono" />
            </div>
          ))}
        </div>
      </div>

      <header className={styles.nav}>
        <span className={styles.wordmark}>Sleight</span>
        <nav className={`${styles.navLinks} glass`}>
          <Link href="/arcade">Arcade</Link>
          <Link href="/theatre">Theatre</Link>
          <a href="https://github.com/Omkarshinde19/sleight" rel="noreferrer">GitHub</a>
        </nav>
      </header>

      <main className={styles.main}>
        <section className={styles.hero}>
          <p className="mono">A robotics sandbox · runs entirely on your device</p>
          <h1>
            Your hand,
            <br />
            <em>in chrome.</em>
          </h1>
          <p className={styles.heroLede}>
            Your webcam tracks your hand and robot hands move with it, through an arcade and an operating theatre. Real physics, real grips, nothing sent anywhere.
          </p>
          <div className={styles.heroActions}>
            <Link href="/arcade" className={styles.primary}>Start with the Arcade</Link>
            <a href="#how" className={styles.ghost}>How it works</a>
          </div>
          <p className={`${styles.privacy} mono`}>
            <span /> No camera until you choose one. Frames are processed in this tab and never leave it.
          </p>
          <p className={`${styles.scrollHint} mono`}>Scroll — meet the three hands</p>
        </section>

        {CHAPTERS.map((c, i) => (
          <section key={c.n} className={styles.chapter} data-side={i % 2 ? "right" : "left"}>
            <article className={`${styles.card} glass`}>
              <p className={`${styles.chapterNo} mono`}>
                {c.n} · {c.scene}
              </p>
              <h2>{c.name}</h2>
              <p className={styles.lede}>{c.lede}</p>
              <dl className={styles.facts}>
                {c.facts.map(([k, v]) => (
                  <div key={k}>
                    <dt className="mono">{k}</dt>
                    <dd>{v}</dd>
                  </div>
                ))}
              </dl>
              <Link href={c.href} className={styles.enter}>
                Enter the {c.scene} <span aria-hidden>→</span>
              </Link>
            </article>
          </section>
        ))}

        <section id="how" className={styles.how}>
          <p className="mono">How it works</p>
          <h2>
            From a webcam frame to a <em>grip</em>, in one tab.
          </h2>
          <ol className={styles.pipeline}>
            {PIPELINE.map(([k, v], i) => (
              <li key={k} className="glass">
                <span className="mono">{String(i + 1).padStart(2, "0")}</span>
                <b>{k}</b>
                <small>{v}</small>
              </li>
            ))}
          </ol>
          <div className={styles.split}>
            <div className={`${styles.note} glass`}>
              <h3>Private by construction</h3>
              <p>
                The hand model and its WASM runtime are served from this site, not a CDN. The camera feed goes into the tracker
                in your browser and nowhere else — there is no server to send it to.
              </p>
            </div>
            <div className={`${styles.note} glass`}>
              <h3>No camera? Still works</h3>
              <p>
                Every scene runs on a simulated hand (mouse and keys) or a recorded session, so you can try it anywhere and demo
                it without a webcam.
              </p>
            </div>
            <div className={`${styles.note} glass`}>
              <h3>It rains in here</h3>
              <p>Rain beads on the chrome and dries when it stops. Snow settles on the knuckles and melts.</p>
              <div className={styles.weather} role="group" aria-label="Weather">
                {WEATHER.map((w) => (
                  <button key={w.kind} aria-pressed={weather === w.kind} onClick={() => setWeather(w.kind)}>
                    {w.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className={styles.footer}>
        <span className={styles.wordmark}>Sleight</span>
        <p className="mono">
          Built with MediaPipe, three.js and Rapier · <a href="https://github.com/Omkarshinde19/sleight">Source</a>
        </p>
      </footer>
    </div>
  );
}
