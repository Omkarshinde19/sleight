import { add, clamp, cross, dist, dot, LM, norm, scale, sub, type Handedness, type Point } from "./types";

/**
 * A rigid skeleton for the robot hand.
 *
 * MediaPipe's world landmarks guess depth per frame, so the distance between two joints changes from
 * frame to frame (about ±13 % on the index finger in the demo recording) and the fingers stretch
 * like rubber. This learns each bone's length (median over the first frames), then rebuilds the hand
 * from the wrist outwards: each bone keeps the tracker's direction but gets its fixed length.
 * Finger joints are also held to what a real hand can do: PIP and DIP are hinges (no sideways bend),
 * and nothing bends far backwards.
 */

/** Parent → child, ordered so every parent is placed before its children. */
export const BONE_TREE: ReadonlyArray<readonly [number, number]> = [
  [LM.WRIST, LM.THUMB_CMC],
  [LM.THUMB_CMC, LM.THUMB_MCP],
  [LM.THUMB_MCP, LM.THUMB_IP],
  [LM.THUMB_IP, LM.THUMB_TIP],
  ...[LM.INDEX_MCP, LM.MIDDLE_MCP, LM.RING_MCP, LM.PINKY_MCP].flatMap(
    (mcp) =>
      [
        [LM.WRIST, mcp],
        [mcp, mcp + 1],
        [mcp + 1, mcp + 2],
        [mcp + 2, mcp + 3],
      ] as const,
  ),
];

/** Flexion limits, radians (negative = bending backwards). */
export const JOINT_LIMITS = {
  mcp: { min: -0.6, max: 1.75, lateral: 0.45 },
  pip: { min: -0.17, max: 1.95 },
  dip: { min: -0.35, max: 1.6 },
} as const;

const SAMPLES_TO_LOCK = 45;
const MIN_SAMPLES = 5;

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

export class Skeleton {
  private samples: number[][] = BONE_TREE.map(() => []);
  private locked: number[] | null = null;
  /**
   * Slow average of the PIP flexion, measured assuming the label is right. If it stays clearly
   * negative the fingers are bending "backwards", which means the hand is labelled the wrong way
   * round: flip the flexion sign rather than freeze the fingers straight.
   */
  private flexEma = 0;
  private flipped = false;

  get isLocked() {
    return this.locked !== null;
  }

  /** Current bone lengths, or null while there aren't enough samples yet. */
  lengths(): number[] | null {
    if (this.locked) return this.locked;
    if (this.samples[0].length < MIN_SAMPLES) return null;
    return this.samples.map(median);
  }

  observe(world: Point[]) {
    if (this.locked) return;
    BONE_TREE.forEach(([a, b], i) => this.samples[i].push(dist(world[a], world[b])));
    if (this.samples[0].length >= SAMPLES_TO_LOCK) {
      this.locked = this.samples.map(median);
      this.samples = BONE_TREE.map(() => []);
    }
  }

  /** Rebuild the hand with fixed bone lengths and joint limits. Same frame and origin as the input. */
  solve(world: Point[], handedness: Handedness): Point[] {
    const lengths = this.lengths();
    const out: Point[] = world.map((p) => ({ ...p }));
    if (!lengths) return out;

    // Hinge axis for finger flexion: across the knuckles, signed so that +angle curls toward the palm.
    const sign = (handedness === "Right" ? 1 : -1) * (this.flipped ? -1 : 1);
    const across = scale(norm(sub(world[LM.INDEX_MCP], world[LM.PINKY_MCP])), sign);

    let pipSum = 0;
    BONE_TREE.forEach(([a, b], i) => {
      let dir = norm(sub(world[b], world[a]));
      const kind = jointKind(a, b);
      if (kind) {
        const grand = kind === "mcp" ? LM.WRIST : a - 1;
        const parent = norm(sub(out[a], out[grand]));
        const { dir: limited, angle } = limitJoint(parent, dir, across, kind);
        dir = limited;
        if (kind === "pip") pipSum += angle;
      }
      out[b] = add(out[a], scale(dir, lengths[i]));
    });

    this.flexEma += 0.05 * (pipSum / 4 - this.flexEma);
    // flexEma is measured with the sign in use, flipped or not: clearly negative means that sign is
    // wrong. (It used to flip back only when the reading was positive, i.e. when the sign was right,
    // so a hand flipped early by a relabel stayed wrong and every fist curled outwards.)
    if (this.flexEma < -0.3) this.flip();
    return out;
  }

  /** The hand's label changed: what was measured under the old label holds with the sign flipped. */
  relabel() {
    this.flip();
  }

  private flip() {
    this.flipped = !this.flipped;
    // the average was measured with the old sign
    this.flexEma = -this.flexEma;
  }
}

/** Which finger joint sits at the start of bone a → b (index…pinky only; the thumb is left free). */
function jointKind(a: number, b: number): keyof typeof JOINT_LIMITS | null {
  if (a === LM.WRIST || b <= LM.THUMB_TIP) return null;
  // child of the bone: 1 = PIP (bent at the MCP), 2 = DIP (at the PIP), 3 = TIP (at the DIP)
  const k = (b - LM.INDEX_MCP) % 4;
  return k === 1 ? "mcp" : k === 2 ? "pip" : k === 3 ? "dip" : null;
}

/**
 * Clamp the bend between a parent bone and a child bone. Returns the limited child direction and the
 * unclamped flexion angle (radians, + toward the palm).
 */
export function limitJoint(parent: Point, child: Point, acrossRaw: Point, kind: keyof typeof JOINT_LIMITS) {
  // hinge axis: across the knuckles, made perpendicular to the parent bone
  const axis = norm(sub(acrossRaw, scale(parent, dot(acrossRaw, parent))));
  const palmar = cross(axis, parent);
  const lateral = dot(child, axis);
  const inPlane = sub(child, scale(axis, lateral));
  const angle = Math.atan2(dot(inPlane, palmar), dot(inPlane, parent));
  const lim = JOINT_LIMITS[kind];
  const a = clamp(angle, lim.min, lim.max);
  const bent = add(scale(parent, Math.cos(a)), scale(palmar, Math.sin(a)));
  if (kind !== "mcp") return { dir: bent, angle };
  // the knuckle can also spread sideways, within limits
  const s = clamp(lateral, -Math.sin(JOINT_LIMITS.mcp.lateral), Math.sin(JOINT_LIMITS.mcp.lateral));
  return { dir: norm(add(scale(bent, Math.sqrt(1 - s * s)), scale(axis, s))), angle };
}
