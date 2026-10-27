/**
 * Page-clock stamps for tracker frames. Render and physics interpolate on performance.now(); stamping a
 * frame when it arrived made the spacing wobble with detection time (a 12 ms detect, then a 20 ms one).
 * Instead keep the source's own spacing (the camera's capture times) shifted by the average delay,
 * re-synced when it drifts far (a looped recording, a stall).
 */
export class FrameClock {
  private offset: number | null = null;
  private last = -Infinity;

  constructor(
    /** How fast the average delay follows changes (0..1 per frame). */
    private follow = 0.05,
    /** Re-sync instead of following when the delay jumps by more than this, ms. */
    private resyncMs = 120,
  ) {}

  /**
   * Stamp for a frame taken at `sourceT` that arrived at `now`; always increasing. It can sit a few ms
   * after `now` for a frame that came back quickly: capping it there would bring the wobble back, and
   * the interpolator draws half a frame in the past anyway.
   */
  stamp(sourceT: number, now: number): number {
    const d = now - sourceT;
    const o = this.offset;
    this.offset = o === null || Math.abs(d - o) > this.resyncMs ? d : o + this.follow * (d - o);
    const t = Math.max(this.last + 1, sourceT + this.offset);
    this.last = t;
    return t;
  }

  reset() {
    this.offset = null;
    this.last = -Infinity;
  }
}
