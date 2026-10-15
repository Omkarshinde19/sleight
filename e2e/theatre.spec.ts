import { expect, test, type Page } from "@playwright/test";
import { openWithSim } from "./helpers";

type P = { x: number; y: number; z: number };
type Body = { translation(): P; rotation(): { x: number; y: number; z: number; w: number } };
type W = {
  __sleight: { api: { sim: { set(h: string, p: object): void; reach(h: string, p: P, ws: object): void }; workspace: object }; store: { getState(): { holding: Record<string, string | null>; hands: Record<string, { grip: P; palm: P }> } } };
  __instruments: { scalpel: Body; forceps: Body; fragments: { body: Body; held: boolean }[] };
  __theatre: { getState(): { penetrationMm: number; maxPenetrationMm: number; contact: boolean; coverage: number; retrieved: number } };
};
const PAD_TOP = 1.096;

async function setup(page: Page) {
  await openWithSim(page, "/theatre");
  await page.waitForFunction(() => (window as unknown as W).__instruments?.scalpel);
  await page.evaluate(() => (window as unknown as W).__sleight.api.sim.set("Left", { visible: false }));
}

/** Rotate a local vector by a body's rotation, in the page. */
const rotated = (page: Page, which: "scalpel" | "forceps", v: [number, number, number]) =>
  page.evaluate(
    ([which, v]) => {
      const r = (window as unknown as W).__instruments[which as "scalpel"].rotation();
      const { x, y, z, w: qw } = r;
      const ix = qw * v[0] + y * v[2] - z * v[1], iy = qw * v[1] + z * v[0] - x * v[2], iz = qw * v[2] + x * v[1] - y * v[0], iw = -x * v[0] - y * v[1] - z * v[2];
      return { x: ix * qw + iw * -x + iy * -z - iz * -y, y: iy * qw + iw * -y + iz * -x - ix * -z, z: iz * qw + iw * -z + ix * -y - iy * -x };
    },
    [which, v] as const,
  );

const palm = (page: Page) => page.evaluate(() => { const p = (window as unknown as W).__sleight.store.getState().hands.Right.palm; return { x: p.x, y: p.y, z: p.z }; });
const gesture = (page: Page, g: string) => page.evaluate((g) => (window as unknown as W).__sleight.api.sim.set("Right", { target: g }), g);

/** Closed-loop reach on the measured palm position. */
async function reach(page: Page, p: P) {
  let c = { ...p };
  for (let i = 0; i < 4; i++) {
    await page.evaluate((c) => { const s = (window as unknown as W).__sleight; s.api.sim.reach("Right", c, s.api.workspace); }, c);
    await page.waitForTimeout(250);
    const q = await palm(page);
    const e = { x: p.x - q.x, y: p.y - q.y, z: p.z - q.z };
    if (Math.hypot(e.x, e.y, e.z) < 0.006) return;
    c = { x: c.x + e.x, y: c.y + e.y, z: c.z + e.z };
  }
}

async function pickUp(page: Page, which: "scalpel" | "forceps", name: string) {
  await reach(page, { x: 0, y: 1.4, z: 0 });
  await gesture(page, "pinch");
  await page.waitForTimeout(600);
  const off = await page.evaluate(() => { const h = (window as unknown as W).__sleight.store.getState().hands.Right; return { x: h.grip.x - h.palm.x, y: h.grip.y - h.palm.y, z: h.grip.z - h.palm.z }; });
  await gesture(page, "open");
  await page.waitForTimeout(400);
  for (let k = 0; k < 4; k++) {
    const t = await page.evaluate((which) => { const p = (window as unknown as W).__instruments[which as "scalpel"].translation(); return { x: p.x, y: p.y, z: p.z }; }, which);
    const z = which === "forceps" ? t.z - 0.058 : t.z;
    await reach(page, { x: t.x - off.x, y: t.y + 0.1 - off.y, z: z - off.z });
    await reach(page, { x: t.x - off.x, y: t.y + 0.01 - off.y, z: z - off.z });
    await gesture(page, "pinch");
    await page.waitForTimeout(400);
    if ((await page.evaluate(() => (window as unknown as W).__sleight.store.getState().holding.Right)) === name) return;
    await gesture(page, "open");
    await page.waitForTimeout(300);
  }
  throw new Error(`couldn't pick up the ${which}`);
}

/**
 * Offset from the palm to a point on the held tool (local coordinates). Measure it while the tool is
 * free: once it's pressed against something, the tool lags the hand and the offset is no longer rigid.
 */
async function toolPointOffset(page: Page, which: "scalpel" | "forceps", local: [number, number, number]) {
  const t = await page.evaluate((which) => { const p = (window as unknown as W).__instruments[which as "scalpel"].translation(); return { x: p.x, y: p.y, z: p.z }; }, which);
  const p = await palm(page);
  const r = await rotated(page, which, local);
  return { x: t.x + r.x - p.x, y: t.y + r.y - p.y, z: t.z + r.z - p.z };
}

/** Move the hand so the tool point (at offset `o` from the palm) lands on `target`. */
const placeToolPoint = (page: Page, o: P, target: P) => reach(page, { x: target.x - o.x, y: target.y - o.y, z: target.z - o.z });

const theatre = (page: Page) => page.evaluate(() => { const t = (window as unknown as W).__theatre.getState(); return { pen: t.penetrationMm, max: t.maxPenetrationMm, contact: t.contact, coverage: t.coverage, retrieved: t.retrieved }; });

test("a scalpel pushed 5 cm into the practice pad stops at its surface", async ({ page }) => {
  await setup(page);
  await pickUp(page, "scalpel", "SCALPEL");
  const edge = await toolPointOffset(page, "scalpel", [0, -0.011, -0.07]);
  await placeToolPoint(page, edge, { x: -0.2, y: PAD_TOP + 0.06, z: -0.4 });
  await placeToolPoint(page, edge, { x: -0.2, y: PAD_TOP - 0.05, z: -0.4 });
  await page.waitForTimeout(600);
  const t = await theatre(page);
  expect(t.contact).toBe(true);
  expect(t.pen).toBeLessThan(1); // mm, steady state
  const bodyY = await page.evaluate(() => (window as unknown as W).__instruments.scalpel.translation().y);
  expect(bodyY).toBeGreaterThan(PAD_TOP - 0.005); // the scalpel is still above the pad, not 5 cm in it
});

test("the scalpel cuts along the dotted line", async ({ page }) => {
  await setup(page);
  await pickUp(page, "scalpel", "SCALPEL");
  const edge = await toolPointOffset(page, "scalpel", [0, -0.011, -0.07]);
  await placeToolPoint(page, edge, { x: -0.29, y: PAD_TOP + 0.05, z: -0.4 });
  for (let x = -0.29; x <= -0.105; x += 0.01) await placeToolPoint(page, edge, { x, y: PAD_TOP - 0.005, z: -0.4 });
  await page.waitForTimeout(400);
  expect((await theatre(page)).coverage).toBeGreaterThan(0.8);
});

test("forceps lift a fragment out of the wound into the kidney dish", async ({ page }) => {
  await setup(page);
  await pickUp(page, "forceps", "FORCEPS");
  const tip = await toolPointOffset(page, "forceps", [0, 0, -0.118]);
  const fr = await page.evaluate(() => { const p = (window as unknown as W).__instruments.fragments[0].body.translation(); return { x: p.x, y: p.y, z: p.z }; });
  await placeToolPoint(page, tip, { x: fr.x, y: 1.2, z: fr.z });
  await placeToolPoint(page, tip, { x: fr.x, y: fr.y + 0.004, z: fr.z });
  await gesture(page, "fist");
  await page.waitForFunction(() => (window as unknown as W).__instruments.fragments[0].held);
  await placeToolPoint(page, tip, { x: fr.x, y: 1.2, z: fr.z });
  await placeToolPoint(page, tip, { x: 0.36, y: 1.08, z: -0.46 });
  await gesture(page, "pinch");
  await expect(page.getByTestId("retrieved")).toHaveText("1/3", { timeout: 5000 });
  expect((await theatre(page)).max).toBeLessThan(2);
});
