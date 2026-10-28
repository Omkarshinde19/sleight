import { useEffect, type RefObject } from "react";
import { hero } from "./hero";

/*
 * The headline's letters are things the hero hand can pick up. Closing the hand on a letter grabs it;
 * it follows the hand, tilting with the motion, and when the hand opens it flies on with its speed,
 * then springs back to its place with a little overshoot.
 */

/** Spring back (1/s²) and damping (1/s): bouncy, settles in about a second. */
const SPRING = 90;
const DAMP = 9;
/** How close (fraction of the letter's height) the hand must be to a letter's centre to take it. */
const REACH = 0.55;

interface Letter {
  el: HTMLElement;
  /** Centre at rest, px in the hero. */
  home: { x: number; y: number };
  size: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export function useLetterGrab(heroRef: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const root = heroRef.current;
    if (!root) return;
    let letters: Letter[] = [];
    let held: { letter: Letter; dx: number; dy: number } | null = null;
    let wasClosed = false;

    const measure = () => {
      const base = root.getBoundingClientRect();
      letters = [...root.querySelectorAll<HTMLElement>("[data-letter]")].map((el) => {
        el.style.transform = "";
        const r = el.getBoundingClientRect();
        return { el, home: { x: r.left - base.left + r.width / 2, y: r.top - base.top + r.height / 2 }, size: r.height, x: 0, y: 0, vx: 0, vy: 0 };
      });
      held = null;
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(root);
    // the display face arrives after first paint and changes every letter's box
    document.fonts?.ready.then(measure);

    let last = performance.now();
    let raf = requestAnimationFrame(function step(now) {
      raf = requestAnimationFrame(step);
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      if (!hero.inView) return;
      const hand = hero.hand;
      const closed = hand.visible && hand.closed;

      if (closed && !wasClosed) {
        // the hand just closed: take the nearest letter within reach
        let best: Letter | null = null;
        let bestD = Infinity;
        for (const l of letters) {
          const d = Math.hypot(l.home.x + l.x - hand.x, l.home.y + l.y - hand.y);
          if (d < l.size * REACH && d < bestD) {
            best = l;
            bestD = d;
          }
        }
        if (best) held = { letter: best, dx: best.home.x + best.x - hand.x, dy: best.home.y + best.y - hand.y };
      }
      if (!closed) held = null;
      wasClosed = closed;

      for (const l of letters) {
        if (held?.letter === l) {
          // carried: ease toward the hand (the held point drifts into the fist), and keep the speed
          held.dx *= 1 - Math.min(1, dt * 4);
          held.dy *= 1 - Math.min(1, dt * 4);
          const nx = hand.x + held.dx - l.home.x;
          const ny = hand.y + held.dy - l.home.y;
          l.vx = (nx - l.x) / Math.max(dt, 1e-3);
          l.vy = (ny - l.y) / Math.max(dt, 1e-3);
          l.x = nx;
          l.y = ny;
        } else {
          l.vx += (-l.x * SPRING - l.vx * DAMP) * dt;
          l.vy += (-l.y * SPRING - l.vy * DAMP) * dt;
          l.x += l.vx * dt;
          l.y += l.vy * dt;
        }
        const moving = Math.abs(l.x) + Math.abs(l.y) > 0.3 || Math.abs(l.vx) + Math.abs(l.vy) > 1;
        if (!moving) {
          if (l.el.style.transform) l.el.style.transform = "";
          continue;
        }
        const tilt = Math.max(-28, Math.min(28, l.vx * 0.02));
        const lift = held?.letter === l ? 1.08 : 1;
        l.el.style.transform = `translate(${l.x.toFixed(1)}px, ${l.y.toFixed(1)}px) rotate(${tilt.toFixed(1)}deg) scale(${lift})`;
      }
    });

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [heroRef]);
}
