import { FINGERS, type Point } from "./types";

/**
 * Fingers that wrap round a held ball instead of sinking into it. Each finger joint that ends up
 * inside the ball is turned about its parent joint until it rests on the surface (bone lengths kept),
 * and the rest of the finger turns with it. Visual: the ball is held by the grab joint either way.
 */
export function wrapAround(joints: Point[], centre: Point, radius: number, jointRadius: number, passes = 2): Point[] {
  const out = joints.map((p) => ({ ...p }));
  const reach = radius + jointRadius;
  for (let pass = 0; pass < passes; pass++) {
    FINGERS.forEach((chain, f) => {
      // the thumb's chain starts at the wrist; its first bone is in the palm
      for (let k = f === 0 ? 2 : 1; k < chain.length; k++) {
        const parent = out[chain[k - 1]];
        const child = out[chain[k]];
        const d = { x: child.x - centre.x, y: child.y - centre.y, z: child.z - centre.z };
        const dl = Math.hypot(d.x, d.y, d.z);
        if (dl >= reach) continue;
        const len = Math.hypot(child.x - parent.x, child.y - parent.y, child.z - parent.z);
        const s = dl > 1e-9 ? reach / dl : 0;
        const onSurface = dl > 1e-9 ? { x: centre.x + d.x * s, y: centre.y + d.y * s, z: centre.z + d.z * s } : { x: centre.x, y: centre.y + reach, z: centre.z };
        const dir = { x: onSurface.x - parent.x, y: onSurface.y - parent.y, z: onSurface.z - parent.z };
        const l = Math.hypot(dir.x, dir.y, dir.z) || 1;
        const moved = { x: parent.x + (dir.x / l) * len, y: parent.y + (dir.y / l) * len, z: parent.z + (dir.z / l) * len };
        const delta = { x: moved.x - child.x, y: moved.y - child.y, z: moved.z - child.z };
        for (let j = k; j < chain.length; j++) {
          out[chain[j]].x += delta.x;
          out[chain[j]].y += delta.y;
          out[chain[j]].z += delta.z;
        }
      }
    });
  }
  return out;
}
