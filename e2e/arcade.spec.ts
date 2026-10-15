import { expect, test } from "@playwright/test";
import { openWithSim } from "./helpers";

type Ball = { state: string; since: number; body: { translation(): { x: number; y: number; z: number }; setTranslation(p: object, w: boolean): void; setLinvel(v: object, w: boolean): void } };
declare global {
  interface Window {
    __arcadeBalls: Ball[];
    __arcade: { getState(): { setAssist(a: string): void; attempts: number } };
  }
}

test("a fist picks up a ball with a joint and a flick throws it at the hoop", async ({ page }) => {
  await openWithSim(page, "/arcade");
  await page.waitForFunction(() => window.__arcadeBalls?.[0]?.body);
  await page.evaluate(() => {
    const { api } = window.__sleight as unknown as { api: { sim: { set(h: string, p: object): void; reach(h: string, p: object, ws: object): void }; workspace: object } };
    api.sim.set("Left", { visible: false });
    api.sim.reach("Right", { x: 0.16, y: 0.95, z: -0.25 }, api.workspace);
  });
  await page.waitForTimeout(500);
  const before = await page.evaluate(() => window.__arcadeBalls[0].body.translation());
  await page.evaluate(() => window.__sleight.api.sim!.set("Right", { target: "fist" }));
  await page.waitForFunction(() => window.__sleight.store.getState().holding.Right === "BALL 1");
  // Held, not teleported: the ball is still where it was the moment it was grabbed.
  const grabbed = await page.evaluate(() => window.__arcadeBalls[0].body.translation());
  expect(Math.hypot(grabbed.x - before.x, grabbed.y - before.y, grabbed.z - before.z)).toBeLessThan(0.1);

  await page.evaluate(() => window.__sleight.api.sim!.throwFlick("Right"));
  await page.waitForFunction(() => window.__arcadeBalls[0].body.translation().z < -2, null, { timeout: 5000 });
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
