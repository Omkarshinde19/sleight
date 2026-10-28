import { expect, test, type Page } from "@playwright/test";
import { openWithSim } from "./helpers";

type P = { x: number; y: number; z: number };
const ev = <T, A>(page: Page, fn: (a: A) => T, arg?: A) => page.evaluate(fn as never, arg) as Promise<T>;
type Api = { api: { sim: { set(h: string, p: object): void; reach(h: string, p: P, ws: object): void; hands: { Right: { orientation: { yaw: number } } } }; workspace: object }; store: { getState(): { holding: Record<string, string | null>; hands: Record<string, { grip: P; palm: P }> } }; rapier: { world: { forEachRigidBody(f: (b: { userData?: { chip?: boolean }; translation(): P }) => void): void } } };
type Ind = { seated: boolean; parts: number; levers: number[]; alignment: { yawDeg: number } | null; seat(): void };
// Helpers defined inside the page, since functions passed to evaluate() can't close over test code.
declare function api(): Api;
declare function ind(): Ind;

async function setup(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    w.api = () => w.__sleight;
    w.ind = () => (w.__industrial as { getState(): unknown }).getState();
  });
  await openWithSim(page, "/industrial");
  await page.waitForFunction(() => (window as unknown as { __industrial?: unknown }).__industrial);
  await ev(page, () => window.__sleight.api.sim!.set("Left", { visible: false }));
}

const reachOnce = (page: Page, p: P) => ev(page, (p) => api().api.sim.reach("Right", p, api().api.workspace), p);
/**
 * Closed-loop reach: the inverse mapping is only approximate off-centre (perspective changes the
 * apparent palm size, so depth drifts), so correct with the measured palm position, like a user would.
 */
async function reach(page: Page, p: P) {
  let cmd = { ...p };
  for (let i = 0; i < 3; i++) {
    await reachOnce(page, cmd);
    await page.waitForTimeout(250);
    const palm = await ev(page, () => {
      const h = api().store.getState().hands.Right;
      return { x: h.palm.x, y: h.palm.y, z: h.palm.z };
    });
    const err = { x: p.x - palm.x, y: p.y - palm.y, z: p.z - palm.z };
    if (Math.hypot(err.x, err.y, err.z) < 0.008) return;
    cmd = { x: cmd.x + err.x, y: cmd.y + err.y, z: cmd.z + err.z };
  }
}
const gesture = (page: Page, g: string) => ev(page, (g) => api().api.sim.set("Right", { target: g }), g);
const chip = (page: Page) =>
  ev(page, () => {
    let p: P | undefined;
    api().rapier.world.forEachRigidBody((b) => {
      if (b.userData?.chip) {
        const t = b.translation();
        p = { x: t.x, y: t.y, z: t.z };
      }
    });
    return p!;
  });

/** Come down on the chip from above (so the fingers don't knock it) and pinch, retrying if it moved. */
async function pinchChip(page: Page, off: P) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const c = await chip(page);
    await reach(page, { x: c.x - off.x, y: c.y + 0.12 - off.y, z: c.z - off.z });
    await page.waitForTimeout(400);
    const c2 = await chip(page);
    await reach(page, { x: c2.x - off.x, y: c2.y + 0.01 - off.y, z: c2.z - off.z });
    await page.waitForTimeout(400);
    await gesture(page, "pinch");
    await page.waitForTimeout(400);
    if ((await ev(page, () => api().store.getState().holding.Right)) === "MICROCHIP") return;
    await gesture(page, "open");
    await page.waitForTimeout(400);
  }
  throw new Error("couldn't pinch the chip");
}

/** Where the pinch point sits relative to the palm, measured away from everything. */
async function pinchOffset(page: Page) {
  await reach(page, { x: 0, y: 1.45, z: 0 });
  await gesture(page, "pinch");
  await page.waitForTimeout(600);
  const o = await ev(page, () => {
    const h = api().store.getState().hands.Right;
    return { x: h.grip.x - h.palm.x, y: h.grip.y - h.palm.y, z: h.grip.z - h.palm.z };
  });
  await gesture(page, "open");
  await page.waitForTimeout(400);
  return o;
}

test("a fist can't pick up the microchip, a pinch can", async ({ page }) => {
  await setup(page);
  const off = await pinchOffset(page);
  const c = await chip(page);
  // 3 cm above: inside the chip's grab reach (5.5 cm), clear of the curling fingertips, which would flick it off the bench
  await reach(page, { x: c.x - off.x, y: c.y + 0.03 - off.y, z: c.z - off.z });
  await page.waitForTimeout(500);
  await gesture(page, "fist");
  await page.waitForTimeout(500);
  expect(await ev(page, () => api().store.getState().holding.Right ?? null)).toBeNull();
  await gesture(page, "open");
  await page.waitForTimeout(500);
  await pinchChip(page, off);
});

test("the chip seats only once it's lined up over the socket", async ({ page }) => {
  await setup(page);
  const off = await pinchOffset(page);
  await pinchChip(page, off);

  const SOCKET = { x: -0.1, y: 0.935, z: -0.33 };
  let target = { x: SOCKET.x - off.x, y: SOCKET.y + 0.15 - off.y, z: SOCKET.z - off.z };
  const steer = async (dy: number) => {
    const now = await chip(page);
    target = { x: target.x + SOCKET.x - now.x, y: target.y + SOCKET.y + dy - now.y, z: target.z + SOCKET.z - now.z };
    await reach(page, target);
    await page.waitForTimeout(500);
  };
  for (let i = 0; i < 3; i++) await steer(0.12);
  // It starts 29° off: hovering low over the socket must not seat it yet.
  await steer(0.03);
  expect(await ev(page, () => ind().seated)).toBe(false);
  await steer(0.12);
  for (let i = 0; i < 4; i++) {
    const yaw = await ev(page, () => ind().alignment?.yawDeg ?? 0);
    await ev(page, (d) => void (api().api.sim.hands.Right.orientation.yaw += d), (yaw * Math.PI) / 180);
    await page.waitForTimeout(400);
  }
  await steer(0.06);
  await steer(0.03);
  await page.waitForFunction(() => ind().seated);
  await expect(page.getByTestId("chip-state")).toHaveText("Seated");
});

test("levers resist, spring back, and drive the press", async ({ page }) => {
  await setup(page);
  await ev(page, () => ind().seat());
  const pull = async (x: number) => {
    await reach(page, { x, y: 1.5, z: -0.2 });
    await page.waitForTimeout(400);
    await reach(page, { x, y: 1.33, z: -0.36 });
    await page.waitForTimeout(500);
    await gesture(page, "fist");
    await page.waitForFunction(() => api().store.getState().holding.Right?.startsWith("LEVER"));
    for (const k of [0.33, 0.66, 1, 1.15]) {
      await reach(page, { x, y: 0.93 + Math.cos(k) * 0.4, z: -0.36 + Math.sin(k) * 0.4 });
      await page.waitForTimeout(250);
    }
    const levers = await ev(page, () => ind().levers);
    await gesture(page, "open");
    await page.waitForTimeout(200);
    await reach(page, { x: 0.05, y: 1.5, z: 0.05 });
    return levers;
  };
  const t = await pull(0.36);
  expect(t[0]).toBeGreaterThan(0.6);
  await page.waitForTimeout(800);
  expect(await ev(page, () => ind().levers[0])).toBeLessThan(0.1); // sprang back
  await pull(0.6);
  await expect(page.getByTestId("parts")).toHaveText("1");
});
