export interface P2 {
  x: number;
  z: number;
}

/** Distance from a point to a segment, in the xz plane. */
export function distToSegment(p: P2, a: P2, b: P2): number {
  const abx = b.x - a.x;
  const abz = b.z - a.z;
  const len2 = abx * abx + abz * abz;
  const t = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.z - a.z) * abz) / len2)) : 0;
  return Math.hypot(p.x - (a.x + abx * t), p.z - (a.z + abz * t));
}

/**
 * Share of the guide line that the cut covered: the guide is sampled every `step` metres and a
 * sample counts if some cut point lies within `tolerance` of it.
 */
export function coverage(cut: P2[], from: P2, to: P2, tolerance = 0.006, step = 0.005): number {
  const len = Math.hypot(to.x - from.x, to.z - from.z);
  const n = Math.max(1, Math.round(len / step));
  let hit = 0;
  for (let i = 0; i <= n; i++) {
    const s = { x: from.x + ((to.x - from.x) * i) / n, z: from.z + ((to.z - from.z) * i) / n };
    if (cut.some((c) => Math.hypot(c.x - s.x, c.z - s.z) < tolerance)) hit++;
  }
  return hit / (n + 1);
}

/** Mean distance of the cut from the guide, metres (null with no cut). */
export function meanDeviation(cut: P2[], from: P2, to: P2): number | null {
  if (!cut.length) return null;
  return cut.reduce((s, c) => s + distToSegment(c, from, to), 0) / cut.length;
}
