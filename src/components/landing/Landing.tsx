"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useWeather, type WeatherKind } from "@/state/weatherStore";
import { archivo } from "./fonts";
import { hero } from "./hero";
import styles from "./landing.module.css";

const LandingStage = dynamic(() => import("./LandingStage"), { ssr: false });

const ROOMS = [
  {
    n: "01",
    id: "arcade",
    href: "/arcade",
    verb: "THROW",
    name: "Arcade Room",
    lede: "Cup a basketball with a half-closed hand, flick and open. It leaves with your hand's own velocity.",
    facts: [
      ["Release", "a least-squares fit over the fastest 120 ms before you let go"],
      ["Grab", "a fixed joint to your palm, never a teleport"],
      ["Aim assist", "off, fair or strong, at the arc you chose"],
    ],
    image: "/landing/arcade.jpg",
  },
  {
    n: "02",
    id: "theatre",
    href: "/theatre",
    verb: "CUT",
    name: "Operating Theatre",
    lede: "A bowel resection in five steps: scalpel, retractor, scissors, needle driver, stapler. One instrument at a time.",
    facts: [
      ["Guides", "nothing is cut off the purple line"],
      ["Motion scaling", "slow moves halved, like a surgical robot"],
      ["Sterile field", "a hand inside the patient is a breach"],
    ],
    image: "/landing/theatre.jpg",
  },
] as const;

const SET_LIST = [
  ["Webcam", "640 px, never uploaded"],
  ["Hand landmarker", "MediaPipe WASM, in a worker"],
  ["One Euro filter", "steady at rest, quick in motion"],
  ["Gestures", "open · pinch · fist, with hysteresis"],
  ["Rapier physics", "joints, contacts, CCD"],
] as const;

const VENUE = [
  ["Venue", "Your browser tab"],
  ["Admission", "Free. No sign-up, no keys"],
  ["Camera", "Optional. Frames never leave the tab"],
  ["No webcam?", "A simulated hand on the mouse, or a recorded session"],
] as const;

const WEATHER: { kind: WeatherKind; label: string }[] = [
  { kind: "clear", label: "Clear" },
  { kind: "rain", label: "Rain" },
  { kind: "snow", label: "Snow" },
];

const TICKER = ["Real hands", "Real physics", "Nothing uploaded", "Runs in your tab", "Two rooms", "One hand"];

export function Landing() {
  const heroRef = useRef<HTMLElement>(null);
  const [showStage, setShowStage] = useState(false);
  const weather = useWeather((s) => s.kind);
  const setWeather = useWeather((s) => s.setKind);

  useEffect(() => {
    // Let the type paint first, then bring in the 3D.
    const id = requestAnimationFrame(() => setShowStage(true));
    const el = heroRef.current;
    const io = new IntersectionObserver(([e]) => (hero.inView = e.isIntersecting));
    if (el) io.observe(el);
    return () => {
      cancelAnimationFrame(id);
      io.disconnect();
    };
  }, []);

  return (
    <div className={`${styles.page} ${archivo.variable}`}>
      <header className={styles.nav}>
        <Link href="/" className={styles.wordmark}>
          <span className={styles.burger} aria-hidden>
            <i />
            <i />
            <i />
          </span>
          Sleight
        </Link>
        <nav className={styles.navLinks}>
          <Link href="/arcade">Arcade</Link>
          <Link href="/theatre">Theatre</Link>
          <a href="#venue">How it works</a>
          <a href="https://github.com/Omkarshinde19/sleight" rel="noreferrer">GitHub</a>
        </nav>
        <Link href="/arcade" className={styles.pill}>
          Enter
        </Link>
      </header>

      <section ref={heroRef} className={styles.hero}>
        <h1 className={styles.headline}>
          <span className={styles.lineTop}>Sleight</span>
          <span className={styles.lineBottom}>of hand</span>
        </h1>
        <div className={styles.stage} aria-hidden>
          {showStage && <LandingStage />}
        </div>

        <p className={styles.stack}>
          Robot
          <br />
          hands
          <br />
          driven
          <br />
          by yours
        </p>

        <div className={styles.side}>
          <ol className={styles.index}>
            {ROOMS.map((r) => (
              <li key={r.id}>
                <Link href={r.href}>
                  <span>{r.n}</span> {r.name}
                </Link>
              </li>
            ))}
          </ol>
          <p className={styles.lede}>
            A browser robotics sandbox. Your webcam tracks your hand, chrome robot hands move with it. Nothing leaves this tab.
          </p>
        </div>

        <div className={styles.heroFoot}>
          <a href="#lineup" className={styles.explore}>
            <span className={styles.round} aria-hidden>
              →
            </span>
            Explore now
          </a>
        </div>

        <p className={styles.tag}>
          Real hands
          <br />
          real physics
        </p>
      </section>

      <div className={styles.ticker} aria-hidden>
        <div>
          {[...TICKER, ...TICKER, ...TICKER, ...TICKER].map((t, i) => (
            <span key={i}>{t}</span>
          ))}
        </div>
      </div>

      <main>
        <section id="lineup" className={styles.lineup}>
          <header className={styles.sectionHead}>
            <p className={styles.label}>The lineup</p>
            <h2>
              Two rooms.
              <br />
              <em>One hand.</em>
            </h2>
          </header>

          {ROOMS.map((r) => (
            <article key={r.id} className={styles.room} data-room={r.id}>
              <div className={styles.photo}>
                {/* eslint-disable-next-line @next/next/no-img-element -- a static screenshot, styled as halftone in CSS */}
                <img src={r.image} alt={`The ${r.name}`} loading="lazy" />
                <span className={styles.verb} aria-hidden>
                  {r.verb}
                </span>
              </div>
              <div className={styles.roomText}>
                <p className={styles.label}>
                  {r.n} · {r.name}
                </p>
                <h3>{r.name}</h3>
                <p>{r.lede}</p>
                <dl>
                  {r.facts.map(([k, v]) => (
                    <div key={k}>
                      <dt>{k}</dt>
                      <dd>{v}</dd>
                    </div>
                  ))}
                </dl>
                <Link href={r.href} className={styles.pill}>
                  Enter the {r.name} <span aria-hidden>→</span>
                </Link>
              </div>
            </article>
          ))}
        </section>

        <section id="venue" className={styles.venue}>
          <header className={styles.sectionHead}>
            <p className={styles.label}>How it works</p>
            <h2>
              The venue is
              <br />
              <em>your browser.</em>
            </h2>
          </header>
          <div className={styles.venueGrid}>
            <dl className={styles.details}>
              {VENUE.map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
              <div>
                <dt>Forecast</dt>
                <dd>
                  Rain beads on the chrome, snow settles on the knuckles.
                  <span className={styles.weather} role="group" aria-label="Weather">
                    {WEATHER.map((w) => (
                      <button key={w.kind} aria-pressed={weather === w.kind} onClick={() => setWeather(w.kind)}>
                        {w.label}
                      </button>
                    ))}
                  </span>
                </dd>
              </div>
            </dl>
            <div>
              <p className={styles.label}>Set list</p>
              <ol className={styles.setList}>
                {SET_LIST.map(([k, v], i) => (
                  <li key={k}>
                    <span>{String(i + 1).padStart(2, "0")}</span>
                    <b>{k}</b>
                    <small>{v}</small>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </section>
      </main>

      <footer className={styles.footer}>
        <p className={styles.footMark} aria-hidden>
          Sleight
        </p>
        <p className={styles.label}>
          Built with MediaPipe, three.js and Rapier · <a href="https://github.com/Omkarshinde19/sleight">Source</a>
        </p>
      </footer>
    </div>
  );
}
