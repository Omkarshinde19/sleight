import { expect, test, type Page } from "@playwright/test";
import { openWithSim } from "./helpers";

type P = { x: number; y: number; z: number };
type Tool = "Scalpel" | "Forceps" | "Scissors" | "NeedleDriver" | "Stapler" | "Balfour";
type W = {
  __sleight: { api: { sim: { set(h: string, p: object): void; reach(h: string, p: P, ws: object): void }; workspace: object }; store: { getState(): { holding: Record<string, string | null>; hands: Record<string, { grip: P; palm: P }> } } };
  __tools: {
    tools: Record<Tool, { body: { translation(): P }; seated: boolean }>;
    point(n: Tool): [number, number, number];
    anatomy: { skin: { get(n: string): number }; stitches: P[]; staples: P[]; cuts: { proximal: P; distal: P }; necroticCentre: P };
  };
  __theatre: {
    getState(): {
      step: string;
      layer: string;
      skinCoverage: number;
      fasciaCoverage: number;
      strays: number;
      retracted: boolean;
      rings: { proximal: boolean; distal: boolean };
      specimen: string;
      stitches: number;
      staples: boolean[];
      contact: boolean;
      penetrationMm: number;
      maxPenetrationMm: number;
      goto(step: string): void;
    };
  };
};
const MID_Z = -0.4;
const SKIN_TOP = 1.06;
const LABEL: Record<Tool, string> = { Scalpel: "SCALPEL", Forceps: "FORCEPS", Scissors: "SCISSORS", NeedleDriver: "NEEDLE DRIVER", Stapler: "STAPLER", Balfour: "BALFOUR" };

async function setup(page: Page, step?: string) {
  await openWithSim(page, "/theatre");
  await page.waitForFunction(() => (window as unknown as W).__tools?.tools?.Balfour?.body && (window as unknown as W).__tools.anatomy.skin);
  await page.evaluate(() => (window as unknown as W).__sleight.api.sim.set("Left", { visible: false }));
  if (step) {
    await page.evaluate((s) => (window as unknown as W).__theatre.getState().goto(s), step);
    await page.waitForTimeout(500);
  }
}

const theatre = (page: Page) => page.evaluate(() => { const t = (window as unknown as W).__theatre.getState(); return { ...t, staples: t.staples.filter(Boolean).length }; });
const palm = (page: Page, hand = "Right") => page.evaluate((h) => { const p = (window as unknown as W).__sleight.store.getState().hands[h].palm; return { x: p.x, y: p.y, z: p.z }; }, hand);
const gesture = (page: Page, g: string, hand = "Right") => page.evaluate(([g, h]) => (window as unknown as W).__sleight.api.sim.set(h, { target: g }), [g, hand]);
const body = (page: Page, t: Tool) => page.evaluate((t) => { const p = (window as unknown as W).__tools.tools[t as Tool].body.translation(); return { x: p.x, y: p.y, z: p.z }; }, t);
const point = (page: Page, t: Tool) => page.evaluate((t) => { const [x, y, z] = (window as unknown as W).__tools.point(t as Tool); return { x, y, z }; }, t);

/**
 * Closed-loop reach on the measured palm position. Holding an instrument, slow moves are scaled down
 * (precision mode), so each correction only gets part of the way: it takes a few more rounds.
 */
async function reach(page: Page, p: P, hand = "Right") {
  let c = { ...p };
  for (let i = 0; i < 10; i++) {
    await page.evaluate(([c, h]) => { const s = (window as unknown as W).__sleight; s.api.sim.reach(h as string, c as P, s.api.workspace); }, [c, hand] as const);
    await page.waitForTimeout(250);
    const q = await palm(page, hand);
    const e = { x: p.x - q.x, y: p.y - q.y, z: p.z - q.z };
    if (Math.hypot(e.x, e.y, e.z) < 0.005) return;
    c = { x: c.x + e.x, y: c.y + e.y, z: c.z + e.z };
  }
}

/** Pinch the tool where it lies (its body's origin is where it's held). */
async function pickUp(page: Page, t: Tool, hand = "Right") {
  await reach(page, { x: 0.1, y: 1.35, z: 0.05 }, hand);
  await gesture(page, "pinch", hand);
  await page.waitForTimeout(600);
  const off = await page.evaluate((h) => { const s = (window as unknown as W).__sleight.store.getState().hands[h]; return { x: s.grip.x - s.palm.x, y: s.grip.y - s.palm.y, z: s.grip.z - s.palm.z }; }, hand);
  await gesture(page, "open", hand);
  await page.waitForTimeout(400);
  for (let k = 0; k < 4; k++) {
    const b = await body(page, t);
    await reach(page, { x: b.x - off.x, y: b.y + 0.1 - off.y, z: b.z - off.z }, hand);
    await reach(page, { x: b.x - off.x, y: b.y + 0.01 - off.y, z: b.z - off.z }, hand);
    await gesture(page, "pinch", hand);
    await page.waitForTimeout(400);
    if ((await page.evaluate((h) => (window as unknown as W).__sleight.store.getState().holding[h], hand)) === LABEL[t]) {
      await reach(page, { x: b.x - off.x, y: b.y + 0.12 - off.y, z: b.z - off.z }, hand);
      return;
    }
    await gesture(page, "open", hand);
    await page.waitForTimeout(300);
  }
  throw new Error(`couldn't pick up the ${t}`);
}

/** Offset from the palm to the tool's working point; measured while the tool hangs free in the hand. */
async function pointOffset(page: Page, t: Tool) {
  const w = await point(page, t);
  const p = await palm(page);
  return { x: w.x - p.x, y: w.y - p.y, z: w.z - p.z };
}

/** Move the hand so the working point (at offset `o` from the palm) lands on `target`. */
const place = (page: Page, o: P, target: P) => reach(page, { x: target.x - o.x, y: target.y - o.y, z: target.z - o.z });
const above = (p: P, dy: number) => ({ x: p.x, y: p.y + dy, z: p.z });

/** Close the held tool (squeeze) and open it again, keeping hold. */
async function squeeze(page: Page) {
  await gesture(page, "fist");
  await page.waitForTimeout(450);
  await gesture(page, "pinch");
  await page.waitForTimeout(350);
}

test("a scalpel pushed into the skin stops at its surface", async ({ page }) => {
  await setup(page);
  await pickUp(page, "Scalpel");
  const edge = await pointOffset(page, "Scalpel");
  const spot = { x: 0.04, y: SKIN_TOP, z: MID_Z + 0.03 }; // beside the guide: no slit there
  await place(page, edge, above(spot, 0.06));
  await place(page, edge, above(spot, -0.05));
  await page.waitForTimeout(600);
  const t = await theatre(page);
  expect(t.contact).toBe(true);
  expect(t.penetrationMm).toBeLessThan(1.5);
  expect((await point(page, "Scalpel")).y).toBeGreaterThan(SKIN_TOP - 0.006); // on the skin, not 5 cm into it
});

test("the scalpel opens the skin only along the guide, then the fascia", async ({ page }) => {
  // 44 careful moves, each a few rounds of reach under precision mode's motion scaling
  test.setTimeout(150_000);
  await setup(page);
  await pickUp(page, "Scalpel");
  const edge = await pointOffset(page, "Scalpel");

  // beside the guide: nothing opens, it counts as a stray
  await place(page, edge, { x: 0.0, y: SKIN_TOP + 0.04, z: MID_Z + 0.03 });
  for (let x = -0.02; x <= 0.02; x += 0.01) await place(page, edge, { x, y: SKIN_TOP - 0.004, z: MID_Z + 0.03 });
  let t = await theatre(page);
  expect(t.skinCoverage).toBe(0);
  expect(t.strays).toBeGreaterThan(0);

  // along it: the skin opens, then (deeper) the fascia
  await place(page, edge, { x: -0.085, y: SKIN_TOP + 0.04, z: MID_Z });
  for (const depth of [0.004, 0.02]) {
    for (let x = -0.085; x <= 0.085; x += 0.008) await place(page, edge, { x, y: SKIN_TOP - depth, z: MID_Z });
    await page.waitForTimeout(300);
  }
  t = await theatre(page);
  expect(t.skinCoverage).toBe(1);
  expect(t.fasciaCoverage).toBe(1);
  expect(t.step).toBe("retraction");
  await page.waitForTimeout(800);
  expect(await page.evaluate(() => (window as unknown as W).__tools.anatomy.skin.get("Open_3"))).toBeGreaterThan(0.95);
});

test("the Balfour seats in the wound and holds it open", async ({ page }) => {
  await setup(page, "retraction");
  await pickUp(page, "Balfour");
  const b = await body(page, "Balfour");
  const p = await palm(page);
  const o = { x: b.x - p.x, y: b.y - p.y, z: b.z - p.z };
  await place(page, o, { x: 0, y: 1.2, z: MID_Z });
  await place(page, o, { x: 0, y: 1.1, z: MID_Z });
  await expect.poll(async () => (await theatre(page)).step, { timeout: 5000 }).toBe("resection");
  expect((await theatre(page)).retracted).toBe(true);
  expect(await page.evaluate(() => (window as unknown as W).__sleight.store.getState().holding.Right)).toBeNull();
});

test("scissors cut both ends of the dead segment; forceps carry it to the dish", async ({ page }) => {
  await setup(page, "resection");
  await pickUp(page, "Scissors");
  const tip = await pointOffset(page, "Scissors");
  for (const ring of ["proximal", "distal"] as const) {
    const at = await page.evaluate((r) => { const p = (window as unknown as W).__tools.anatomy.cuts[r]; return { x: p.x, y: p.y, z: p.z }; }, ring);
    await place(page, tip, above(at, 0.05));
    await place(page, tip, above(at, 0.002));
    await squeeze(page);
    await place(page, tip, above(at, 0.05));
  }
  expect((await theatre(page)).rings).toEqual({ proximal: true, distal: true });
  await gesture(page, "open");
  await page.waitForTimeout(900); // the scissors go back to the tray

  await pickUp(page, "Forceps");
  const jaws = await pointOffset(page, "Forceps");
  const seg = await page.evaluate(() => { const p = (window as unknown as W).__tools.anatomy.necroticCentre; return { x: p.x, y: p.y + 0.003, z: p.z }; });
  await place(page, jaws, above(seg, 0.05));
  await place(page, jaws, above(seg, 0.006));
  await gesture(page, "fist");
  await expect.poll(async () => (await theatre(page)).specimen, { timeout: 3000 }).toBe("held");
  await place(page, jaws, above(seg, 0.08));
  await place(page, jaws, { x: 0.27, y: 1.1, z: -0.17 });
  await gesture(page, "pinch");
  await expect.poll(async () => (await theatre(page)).step, { timeout: 3000 }).toBe("anastomosis");
  expect((await theatre(page)).specimen).toBe("dish");
});

test("eight stitches, in order, join the bowel", async ({ page }) => {
  await setup(page, "anastomosis");
  await pickUp(page, "NeedleDriver");
  const needle = await pointOffset(page, "NeedleDriver");
  const stitches = await page.evaluate(() => (window as unknown as W).__tools.anatomy.stitches.map((p) => ({ x: p.x, y: p.y, z: p.z })));
  await place(page, needle, above(stitches[0], 0.05));
  for (const [i, s] of stitches.entries()) {
    await place(page, needle, s);
    await expect.poll(async () => (await theatre(page)).stitches, { timeout: 3000 }).toBeGreaterThanOrEqual(Math.min(i + 1, 8));
  }
  expect((await theatre(page)).step).toBe("closure");
});

test("ten staples close the skin and finish the operation", async ({ page }) => {
  await setup(page, "closure");
  await pickUp(page, "Stapler");
  const outlet = await pointOffset(page, "Stapler");
  const marks = await page.evaluate(() => (window as unknown as W).__tools.anatomy.staples.map((p) => ({ x: p.x, y: p.y, z: p.z })));
  for (const m of marks) {
    await place(page, outlet, above(m, 0.03));
    await place(page, outlet, above(m, 0.004));
    await squeeze(page);
  }
  await expect.poll(async () => (await theatre(page)).step, { timeout: 3000 }).toBe("done");
  await expect(page.getByTestId("result")).toBeVisible();
  expect((await theatre(page)).maxPenetrationMm).toBeLessThan(3);
});

test("one instrument at a time", async ({ page }) => {
  await setup(page);
  await pickUp(page, "Scalpel");
  await page.evaluate(() => (window as unknown as W).__sleight.api.sim.set("Left", { visible: true }));
  const f = await body(page, "Forceps");
  await reach(page, { x: f.x, y: f.y + 0.1, z: f.z + 0.05 }, "Left");
  await reach(page, { x: f.x, y: f.y + 0.01, z: f.z + 0.05 }, "Left");
  await gesture(page, "pinch", "Left");
  await page.waitForTimeout(600);
  expect(await page.evaluate(() => (window as unknown as W).__sleight.store.getState().holding.Left)).toBeFalsy();
});

test("stays inside the performance budget", async ({ page }) => {
  await setup(page);
  await page.waitForTimeout(2000);
  const r = await page.evaluate(async () => {
    const gl = (window as unknown as { __sleight: { three: { gl: { info: { render: { calls: number; triangles: number } } } } } }).__sleight.three.gl;
    const frames: number[] = [];
    let last = performance.now();
    await new Promise<void>((done) => {
      const f = (t: number) => {
        frames.push(t - last);
        last = t;
        if (frames.length < 120) requestAnimationFrame(f);
        else done();
      };
      requestAnimationFrame(f);
    });
    frames.sort((a, b) => a - b);
    return { calls: gl.info.render.calls, triangles: gl.info.render.triangles, median: frames[60] };
  });
  expect(r.calls).toBeLessThan(200); // 149 measured
  expect(r.triangles).toBeLessThan(350_000); // 218k measured
  expect(r.median).toBeLessThan(25); // 16.7 ms (60 fps) measured on an M-series Mac
  const bytes = await page.evaluate(async () => {
    const sizes = await Promise.all(["/models/theatre-room.glb", "/models/patient.glb", "/models/instruments.glb", "/env/theatre-room.hdr"].map(async (u) => (await (await fetch(u)).arrayBuffer()).byteLength));
    return sizes.reduce((a, b) => a + b, 0);
  });
  expect(bytes).toBeLessThan(4 * 1024 * 1024); // 1.7 MB measured
});
