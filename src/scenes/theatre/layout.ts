/** Scene layout, metres. The patient lies along x; the user stands at +z. */
export const TABLE_TOP = 0.82;
export const TORSO = { x: -0.1, y: TABLE_TOP + 0.13, z: -0.4, half: [0.26, 0.09, 0.16] as const, radius: 0.04 };
export const TORSO_TOP = TORSO.y + TORSO.half[1] + TORSO.radius; // 1.08
export const PAD = { x: -0.2, z: -0.4, half: [0.11, 0.008, 0.07] as const };
export const PAD_TOP = TORSO_TOP + PAD.half[1] * 2; // 1.096
/** The dotted guide on the practice pad: an 18 cm incision along x. */
export const GUIDE = { from: { x: -0.29, z: -0.4 }, to: { x: -0.11, z: -0.4 } };
export const WOUND = { x: 0.07, z: -0.4, radius: 0.055 };
export const INSTRUMENT_TRAY = { x: 0.36, y: 1.0, z: -0.2 };
export const DISH = { x: 0.36, y: 1.0, z: -0.46, radius: 0.06 };
