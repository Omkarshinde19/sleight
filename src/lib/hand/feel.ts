import { BONES, dist, type Handedness, type Point } from "./types";

/**
 * "Feel" metrics: numbers for what makes the hands feel wrong, so fixes can be measured.
 * Fed by the HandProcessor (tracking side) and the grab system (what happened to held objects).
 */
export interface FeelStats {
  /** Joint jitter while the hand is still, mm RMS in scene space (null until a still window is seen). */
  jitterMm: number | null;
  /** Bone-length variation (coefficient of variation, %), on the tracker's raw landmarks and on the output. */
  boneCvRawPct: number;
  boneCvPct: number;
  /** Times an output hand changed its Left/Right label, per minute (should be 0). */
  labelFlipsPerMin: number;
  /** Detections whose raw tracker label was overruled, per minute. */
  labelFixesPerMin: number;
  /** Gaps in a hand's detections, per minute, and the longest one. */
  dropoutsPerMin: number;
  longestGapMs: number;
  /** Gaps short enough to be bridged by coasting. */
  bridgedPerMin: number;
  /** Held objects that survived a tracking gap, and ones dropped because the hand was lost. */
  coastSaves: number;
  lossDrops: number;
  minutes: number;
}

const JITTER_WINDOW = 10;
/** A window counts as "still" if the palm moved less than this between its first and last frame (m). */
const STILL_DRIFT = 0.01;
const BONE_ALPHA = 0.05;

interface BoneStats {
  mean: number[];
  sq: number[];
  n: number;
}

const newBoneStats = (): BoneStats => ({ mean: BONES.map(() => 0), sq: BONES.map(() => 0), n: 0 });

function observeBones(s: BoneStats, joints: Point[]) {
  const a = s.n === 0 ? 1 : BONE_ALPHA;
  BONES.forEach(([i, j], b) => {
    const l = dist(joints[i], joints[j]);
    s.mean[b] += a * (l - s.mean[b]);
    s.sq[b] += a * (l * l - s.sq[b]);
  });
  s.n++;
}

/** Mean coefficient of variation over the bones, %. */
function boneCv(s: BoneStats): number {
  if (s.n < 2) return 0;
  let sum = 0;
  BONES.forEach((_, b) => {
    const m = s.mean[b];
    const v = Math.max(0, s.sq[b] - m * m);
    sum += m > 1e-6 ? Math.sqrt(v) / m : 0;
  });
  return (100 * sum) / BONES.length;
}

interface HandMeter {
  window: Point[][];
  rawBones: BoneStats;
  outBones: BoneStats;
  lastSeen: number | null;
  /** Frames that arrived without this hand since it was last seen. */
  missed: number;
}

const newHandMeter = (): HandMeter => ({ window: [], rawBones: newBoneStats(), outBones: newBoneStats(), lastSeen: null, missed: 0 });

export class FeelMeter {
  private hands: Record<Handedness, HandMeter> = { Left: newHandMeter(), Right: newHandMeter() };
  private firstT: number | null = null;
  private lastT = 0;
  private jitter: number | null = null;
  private labelFlips = 0;
  private labelFixes = 0;
  private dropouts = 0;
  private bridged = 0;
  private longestGap = 0;
  private saves = 0;
  private drops = 0;

  constructor(
    /** Gaps up to this long count as bridged (the processor's coasting time). */
    private bridgeMs = 250,
  ) {}

  reset() {
    Object.assign(this, new FeelMeter(this.bridgeMs));
  }

  frame(tMs: number) {
    this.firstT ??= tMs;
    this.lastT = tMs;
  }

  /** A hand was detected this frame. `raw` = tracker world landmarks, `out` = the joints we render. */
  detected(hand: Handedness, tMs: number, raw: Point[], out: Point[], palm: Point) {
    const m = this.hands[hand];
    // A dropout is frames arriving without the hand, not the tracker running slowly.
    if (m.lastSeen !== null && m.missed > 0) {
      const gap = tMs - m.lastSeen;
      this.dropouts++;
      if (gap <= this.bridgeMs) this.bridged++;
      this.longestGap = Math.max(this.longestGap, gap);
    }
    m.lastSeen = tMs;
    m.missed = 0;
    observeBones(m.rawBones, raw);
    observeBones(m.outBones, out);

    m.window.push([palm, ...out]);
    if (m.window.length > JITTER_WINDOW) m.window.shift();
    if (m.window.length === JITTER_WINDOW && dist(m.window[0][0], m.window[JITTER_WINDOW - 1][0]) < STILL_DRIFT) {
      const n = m.window[0].length;
      let sum = 0;
      for (let j = 1; j < n; j++) {
        const mean = { x: 0, y: 0, z: 0 };
        for (const f of m.window) {
          mean.x += f[j].x / JITTER_WINDOW;
          mean.y += f[j].y / JITTER_WINDOW;
          mean.z += f[j].z / JITTER_WINDOW;
        }
        for (const f of m.window) sum += (f[j].x - mean.x) ** 2 + (f[j].y - mean.y) ** 2 + (f[j].z - mean.z) ** 2;
      }
      const rmsMm = 1000 * Math.sqrt(sum / ((n - 1) * JITTER_WINDOW));
      this.jitter = this.jitter === null ? rmsMm : this.jitter * 0.9 + rmsMm * 0.1;
    }
  }

  /** A frame arrived without this hand (while it was being tracked). */
  missed(hand: Handedness) {
    if (this.hands[hand].lastSeen !== null) this.hands[hand].missed++;
  }

  /** The hands' labels were exchanged: keep each hand's history with it. */
  swap() {
    [this.hands.Left, this.hands.Right] = [this.hands.Right, this.hands.Left];
  }

  /** The hand left (or was reset); a later detection is a new appearance, not a gap. */
  forget(hand: Handedness) {
    this.hands[hand].lastSeen = null;
    this.hands[hand].missed = 0;
    this.hands[hand].window = [];
  }

  labelFlip() {
    this.labelFlips++;
  }
  labelFix() {
    this.labelFixes++;
  }
  coastSave() {
    this.saves++;
  }
  lossDrop() {
    this.drops++;
  }

  stats(): FeelStats {
    const minutes = this.firstT === null ? 0 : (this.lastT - this.firstT) / 60000;
    const perMin = (n: number) => (minutes > 0.05 ? n / minutes : 0);
    const cv = (k: "rawBones" | "outBones") => {
      const ms = Object.values(this.hands).filter((h) => h[k].n > 1);
      return ms.length ? ms.reduce((s, h) => s + boneCv(h[k]), 0) / ms.length : 0;
    };
    return {
      jitterMm: this.jitter,
      boneCvRawPct: cv("rawBones"),
      boneCvPct: cv("outBones"),
      labelFlipsPerMin: perMin(this.labelFlips),
      labelFixesPerMin: perMin(this.labelFixes),
      dropoutsPerMin: perMin(this.dropouts),
      bridgedPerMin: perMin(this.bridged),
      longestGapMs: this.longestGap,
      coastSaves: this.saves,
      lossDrops: this.drops,
      minutes,
    };
  }
}
