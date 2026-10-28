/**
 * Scene layout, metres. The patient lies along x (head at -x), the user stands at +z. These numbers
 * mirror scripts/blender/build_patient.py and build_instruments.py; src/lib/assets/patient.test.ts checks
 * that the exported models agree.
 */
export const TABLE_TOP = 0.82;
export const TABLE = { x: -0.1, z: -0.4, length: 2.0, width: 0.56 };
/** The body's midline, where the incision runs. */
export const MID_Z = -0.4;
/** The midline incision's guide: along x at MID_Z. Nothing opens outside it. */
export const INCISION = { from: -0.08, to: 0.08 };
export const INCISION_NODES = 7;
/** Depth of the fascia under the skin's surface. */
export const FASCIA_DEPTH = 0.014;
/** The wound once the Balfour holds it open: half sizes along x and z. */
export const RETRACTED = { x: 0.085, z: 0.06 };
/** Where the Balfour retractor sits when seated in the wound (its frame's centre). */
export const BALFOUR_SEAT = { x: 0, y: 1.078, z: -0.4 };
/** Bottom of the open wound: below it, tools meet the bowel's bed. */
export const CAVITY_FLOOR = 0.985;
export const TRAY = { x: 0.42, z: -0.08, top: 1.0, half: [0.24, 0.15] as const };
export const DISH = { x: 0.27, y: 1.002, z: -0.17, half: [0.075, 0.045] as const };

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Height of the body above the table along its length (head -x … feet +x). */
export function bodyThickness(x: number) {
  const head = 0.12, chest = 0.25, belly = 0.24, pelvis = 0.2, legs = 0.13;
  let t = head + (chest - head) * smoothstep(-0.8, -0.62, x);
  t += (belly - chest) * smoothstep(-0.3, -0.18, x);
  t += (pelvis - belly) * smoothstep(0.18, 0.32, x);
  t += (legs - pelvis) * smoothstep(0.35, 0.5, x);
  return t;
}

/** Top of the skin (y). Across the body it's elliptical, 0.2 m half-width. Same as skin_height() in build_patient.py. */
export function skinHeight(x: number, z: number) {
  const dz = (z - MID_Z) / 0.2;
  return TABLE_TOP + bodyThickness(x) * Math.sqrt(Math.max(0, 1 - dz * dz));
}

/** The skin's height on the incision line, at its middle: the cutting strip's top. */
export const SKIN_TOP = skinHeight(0, MID_Z);
