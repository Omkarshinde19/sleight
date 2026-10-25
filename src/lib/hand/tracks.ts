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
  /** This frame's raw label, signed by confidence (+ = Right). */
  raw: number;
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
  /**
   * Weight of "the right hand is the one on the image's left" (the frame is unmirrored) when both
   * hands are in view: decisive when a second hand appears, a nudge afterwards (hands can cross).
   */
  sideWeight: number;
  sideNudge: number;
}

export const DEFAULT_TRACKER: HandTrackerOptions = {
  forgetMs: 800,
  maxJump: 0.25,
  jumpPerSec: 1.5,
  voteAlpha: 0.12,
  swapMargin: 1.2,
  flipMargin: 0.25,
  sideWeight: 1,
  sideNudge: 0.4,
};

const other = (h: Handedness): Handedness => (h === "Right" ? "Left" : "Right");
/** How much a vote agrees with a label: +1 full agreement, −1 full disagreement. */
const agree = (label: Handedness, vote: number) => (label === "Right" ? vote : -vote);

export class HandTracker {
  private tracks: Track[] = [];

  /** Called when an output label changes (should be rare) or a raw label is overruled. */
  onFlip?: () => void;
  onFix?: () => void;
  /**
   * Called when the hands' labels are exchanged (or a lone hand changes label), before this frame's
   * detections are returned: per-hand state keyed by label should move with the physical hand.
   */
  onSwap?: () => void;

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

    let born = false;
    const assigned: Track[] = hands.map((h, d) => {
      const signed = (h.handedness === "Right" ? 1 : -1) * Math.max(0.3, h.score);
      const t = best[d];
      if (t) {
        t.x = pos[d].x;
        t.y = pos[d].y;
        t.lastT = tMs;
        t.vote += o.voteAlpha * (signed - t.vote);
        t.seen = true;
        t.raw = signed;
        return t;
      }
      // A new hand. Its raw label wins over a track that wasn't seen this frame (that hand has
      // probably left); against a hand that is in view, it takes the other label.
      const inView = (x: Track) => x.seen || best.includes(x);
      let label = h.handedness;
      if (this.tracks.some((x) => x.label === label && inView(x))) label = other(label);
      this.tracks = this.tracks.filter((x) => x.label !== label || inView(x));
      const nt: Track = { label, x: pos[d].x, y: pos[d].y, lastT: tMs, vote: label === "Right" ? 0.5 : -0.5, seen: true, raw: signed };
      this.tracks.push(nt);
      born = true;
      return nt;
    });

    if (born) this.settlePair();
    this.decideLabels();

    return hands.map((h, d) => {
      const label = assigned[d].label;
      if (label !== h.handedness) this.onFix?.();
      return label === h.handedness ? h : { ...h, handedness: label };
    });
  }

  /** +1 if the labels put the right hand on the image's left (as an unmirrored webcam sees it), −1 if not, 0 unless both are in view. */
  private sideAgreement(a: Track, b: Track) {
    if (!a.seen || !b.seen) return 0;
    const right = a.label === "Right" ? a : b;
    const left = a.label === "Right" ? b : a;
    return right.x < left.x ? 1 : -1;
  }

  private swapPair(a: Track, b: Track) {
    [a.label, b.label] = [b.label, a.label];
    this.onFlip?.();
    this.onFlip?.();
    this.onSwap?.();
  }

  /**
   * A second hand just appeared. Label the pair from this frame alone (both raw labels, and which
   * side each hand is on), not from what a lone hand was called: MediaPipe often mislabels a hand
   * that enters the frame by itself, and that label used to stick until both hands jumped across.
   */
  private settlePair() {
    const [a, b] = this.tracks;
    if (!a || !b || !a.seen || !b.seen) return;
    const now = agree(a.label, a.raw) + agree(b.label, b.raw) + this.opts.sideWeight * this.sideAgreement(a, b);
    const swapped = agree(b.label, a.raw) + agree(a.label, b.raw) - this.opts.sideWeight * this.sideAgreement(a, b);
    if (swapped > now) this.swapPair(a, b);
    for (const t of [a, b]) t.vote = t.label === "Right" ? 0.6 : -0.6;
  }

  /** Change labels only when the votes clearly disagree with them. Two tracks always differ. */
  private decideLabels() {
    const o = this.opts;
    const [a, b] = this.tracks;
    if (a && b) {
      if (a.label === b.label) b.label = other(a.label);
      const side = o.sideNudge * this.sideAgreement(a, b);
      const now = agree(a.label, a.vote) + agree(b.label, b.vote) + side;
      const swapped = agree(b.label, a.vote) + agree(a.label, b.vote) - side;
      if (swapped - now > o.swapMargin) this.swapPair(a, b);
    } else if (a && agree(a.label, a.vote) < -o.flipMargin) {
      a.label = other(a.label);
      this.onFlip?.();
      this.onSwap?.();
    }
  }
}
