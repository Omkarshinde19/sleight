import { LM, type Handedness, type RawHand } from "./types";

/**
 * Keeps each physical hand's identity from frame to frame.
 *
 * MediaPipe labels every detection Left/Right on its own, and the label flickers (most often when the
 * hands are close, side-on or crossing). Everything downstream is keyed by that label, so a flicker
 * used to swap filters, turn the robot hand inside out and drop whatever it held. Here detections are
 * matched to tracks by where the hand is, and each track's label is a vote over recent frames.
 */

interface Track {
  label: Handedness;
  x: number;
  y: number;
  lastT: number;
  /** Running vote: +1 = confidently Right, −1 = confidently Left. */
  vote: number;
  /** Matched in the current frame. */
  seen: boolean;
}

export interface HandTrackerOptions {
  /** Forget a track after this long without a detection. */
  forgetMs: number;
  /** Largest move between frames that still counts as the same hand (frame heights), plus growth per second of gap. */
  maxJump: number;
  jumpPerSec: number;
  /** Weight of each frame in the vote. */
  voteAlpha: number;
  /** How strongly the votes must disagree before labels change (swap gain for two hands, −vote for one). */
  swapMargin: number;
  flipMargin: number;
}

export const DEFAULT_TRACKER: HandTrackerOptions = {
  forgetMs: 800,
  maxJump: 0.25,
  jumpPerSec: 1.5,
  voteAlpha: 0.12,
  swapMargin: 1.2,
  flipMargin: 0.25,
};

const other = (h: Handedness): Handedness => (h === "Right" ? "Left" : "Right");
/** How much a vote agrees with a label: +1 full agreement, −1 full disagreement. */
const agree = (label: Handedness, vote: number) => (label === "Right" ? vote : -vote);

export class HandTracker {
  private tracks: Track[] = [];

  /** Called when an output label changes (should be rare) or a raw label is overruled. */
  onFlip?: () => void;
  onFix?: () => void;

  constructor(private opts: HandTrackerOptions = DEFAULT_TRACKER) {}

  reset() {
    this.tracks = [];
  }

  /** Returns the detections with stable handedness labels (at most one per label). */
  assign(hands: RawHand[], tMs: number, aspect: number): RawHand[] {
    const o = this.opts;
    this.tracks = this.tracks.filter((t) => tMs - t.lastT <= o.forgetMs);
    this.tracks.forEach((t) => (t.seen = false));

    const pos = hands.map((h) => {
      // palm centre, in frame-height units so distances don't depend on the aspect ratio
      const w = h.landmarks[LM.WRIST];
      const m = h.landmarks[LM.MIDDLE_MCP];
      return { x: ((w.x + m.x) / 2) * aspect, y: (w.y + m.y) / 2 };
    });

    // Best assignment of detections to tracks (≤ 2 × 2, so try them all): most matches, then the
    // smallest distance, with a small bonus for agreeing with the raw label as a tie-breaker.
    const cost = (d: number, t: Track) => {
      const dd = Math.hypot(pos[d].x - t.x, pos[d].y - t.y);
      const limit = o.maxJump + o.jumpPerSec * ((tMs - t.lastT) / 1000);
      if (dd > limit) return null;
      return dd + (hands[d].handedness === t.label ? 0 : 0.04 * hands[d].score);
    };
    let best: (Track | null)[] = hands.map(() => null);
    let bestMatches = 0;
    let bestCost = 0;
    const search = (d: number, used: Set<Track>, chosen: (Track | null)[], matches: number, total: number) => {
      if (d === hands.length) {
        if (matches > bestMatches || (matches === bestMatches && total < bestCost)) {
          best = [...chosen];
          bestMatches = matches;
          bestCost = total;
        }
        return;
      }
      chosen[d] = null;
      search(d + 1, used, chosen, matches, total);
      for (const t of this.tracks) {
        if (used.has(t)) continue;
        const c = cost(d, t);
        if (c === null) continue;
        used.add(t);
        chosen[d] = t;
        search(d + 1, used, chosen, matches + 1, total + c);
        used.delete(t);
      }
      chosen[d] = null;
    };
    search(0, new Set(), hands.map(() => null), 0, 0);

    const assigned: Track[] = hands.map((h, d) => {
      const signed = (h.handedness === "Right" ? 1 : -1) * Math.max(0.3, h.score);
      const t = best[d];
      if (t) {
        t.x = pos[d].x;
        t.y = pos[d].y;
        t.lastT = tMs;
        t.vote += o.voteAlpha * (signed - t.vote);
        t.seen = true;
        return t;
      }
      // A new hand. Its raw label wins over a track that wasn't seen this frame (that hand has
      // probably left); against a hand that is in view, it takes the other label.
      const inView = (x: Track) => x.seen || best.includes(x);
      let label = h.handedness;
      if (this.tracks.some((x) => x.label === label && inView(x))) label = other(label);
      this.tracks = this.tracks.filter((x) => x.label !== label || inView(x));
      const nt: Track = { label, x: pos[d].x, y: pos[d].y, lastT: tMs, vote: label === "Right" ? 0.5 : -0.5, seen: true };
      this.tracks.push(nt);
      return nt;
    });

    this.decideLabels();

    return hands.map((h, d) => {
      const label = assigned[d].label;
      if (label !== h.handedness) this.onFix?.();
      return label === h.handedness ? h : { ...h, handedness: label };
    });
  }

  /** Change labels only when the votes clearly disagree with them. Two tracks always differ. */
  private decideLabels() {
    const o = this.opts;
    const [a, b] = this.tracks;
    if (a && b) {
      if (a.label === b.label) b.label = other(a.label);
      const now = agree(a.label, a.vote) + agree(b.label, b.vote);
      const swapped = agree(b.label, a.vote) + agree(a.label, b.vote);
      if (swapped - now > o.swapMargin) {
        [a.label, b.label] = [b.label, a.label];
        this.onFlip?.();
        this.onFlip?.();
      }
    } else if (a && agree(a.label, a.vote) < -o.flipMargin) {
      a.label = other(a.label);
      this.onFlip?.();
    }
  }
}
