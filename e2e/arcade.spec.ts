import { expect, test, type Page } from "@playwright/test";
import { openWithSim } from "./helpers";

type Ball = { state: string; since: number; body: { translation(): { x: number; y: number; z: number }; setTranslation(p: object, w: boolean): void; setLinvel(v: object, w: boolean): void } };
declare global {
  interface Window {
    __arcadeBalls: Ball[];
    __arcade: { getState(): { setAssist(a: string): void; attempts: number } };
  }
}

type Sim = { set(h: string, p: object): void; reach(h: string, p: object, ws: object): void; play(h: string, keys: object[]): void };
const ballPos = (page: Page, i: number) => page.evaluate((i) => { const p = window.__arcadeBalls[i].body.translation(); return { x: p.x, y: p.y, z: p.z }; }, i);
const reach = (page: Page, p: object) => page.evaluate((p) => { const a = (window.__sleight as unknown as { api: { sim: Sim; workspace: object } }).api; a.sim.reach("Right", p, a.workspace); }, p);
const pose = (page: Page, g: string) => page.evaluate((g) => (window.__sleight as unknown as { api: { sim: Sim } }).api.sim.set("Right", { target: g }), g);

async function setup(page: Page) {
  await openWithSim(page, "/arcade");
  await page.waitForFunction(() => window.__arcadeBalls?.[2]?.body);
  await page.evaluate(() => (window.__sleight as unknown as { api: { sim: Sim } }).api.sim.set("Left", { visible: false }));
}

test("an open hand sweeping through the rack doesn't knock the balls off", async ({ page }) => {
  await setup(page);
  const before = await Promise.all([0, 1, 2].map((i) => ballPos(page, i)));
  for (const x of [-0.45, -0.27, 0, 0.27, 0.45]) {
    await reach(page, { x, y: 0.95, z: -0.28 });
    await page.waitForTimeout(250);
  }
  const after = await Promise.all([0, 1, 2].map((i) => ballPos(page, i)));
  after.forEach((p, i) => expect(Math.hypot(p.x - before[i].x, p.y - before[i].y, p.z - before[i].z)).toBeLessThan(0.01));
});

test("a half-closed claw holds the ball; opening slowly drops it and it goes back to the rack", async ({ page }) => {
  await setup(page);
  const home = await ballPos(page, 1);
  await reach(page, { x: 0, y: 1.12, z: -0.2 });
  await page.waitForTimeout(400);
  await pose(page, "claw");
  await page.waitForFunction(() => window.__sleight.store.getState().holding.Right === "BALL 2");
  // held, not teleported: still about where it was grabbed
  const grabbed = await ballPos(page, 1);
  expect(Math.hypot(grabbed.x - home.x, grabbed.y - home.y, grabbed.z - home.z)).toBeLessThan(0.1);
  await reach(page, { x: 0, y: 1.3, z: -0.1 });
  await page.waitForTimeout(400);
  expect((await ballPos(page, 1)).y).toBeGreaterThan(1.05); // came up with the hand
  await pose(page, "open");
  await page.waitForFunction(() => !window.__sleight.store.getState().holding.Right);
  expect(await page.evaluate(() => window.__arcade.getState().attempts)).toBe(0); // a drop, not a throw
  // respawns into its cradle
  await page.waitForFunction(() => { const p = window.__arcadeBalls[1].body.translation(); return Math.abs(p.x) < 0.02 && Math.abs(p.z + 0.28) < 0.02 && window.__arcadeBalls[1].state === "rack"; }, null, { timeout: 8000 });
});

test("claw, flick forward and up, open the fingers: the ball is thrown at the hoop", async ({ page }) => {
  await setup(page);
  await reach(page, { x: 0, y: 1.12, z: -0.2 });
  await page.waitForTimeout(400);
  await pose(page, "claw");
  await page.waitForFunction(() => window.__sleight.store.getState().holding.Right === "BALL 2");
  await page.evaluate(() =>
    (window.__sleight as unknown as { api: { sim: Sim } }).api.sim.play("Right", [
      { at: 0, gesture: "claw" },
      { at: 0.25, dy: 0.1, dDistance: 0.1, gesture: "claw" },
      { at: 0.45, dy: -0.26, dDistance: -0.1, gesture: "open" },
      { at: 0.6, dy: -0.44, dDistance: -0.17, gesture: "open" },
      { at: 0.9, dy: -0.46, dDistance: -0.18, gesture: "open" },
    ]),
  );
  await page.waitForFunction(() => window.__arcadeBalls[1].body.translation().z < -2, null, { timeout: 5000 });
  await expect(page.getByTestId("last-throw")).toContainText("m/s");
});

test("a ball coming down through the rim scores, once", async ({ page }) => {
  await openWithSim(page, "/arcade");
  await page.waitForFunction(() => window.__arcadeBalls?.[0]?.body);
  await page.evaluate(() => {
    const b = window.__arcadeBalls[0];
    b.state = "flying";
    b.since = performance.now();
    b.body.setTranslation({ x: 0, y: 2.9, z: -3.1 }, true);
    b.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  });
  await expect(page.getByTestId("score")).toHaveText("1", { timeout: 5000 });
  await page.waitForTimeout(1500);
  await expect(page.getByTestId("score")).toHaveText("1");
});
