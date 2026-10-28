import { expect, test, type Page } from "@playwright/test";
import { openWithSim } from "./helpers";

type W = { __sleight: { three: { camera: { fov: number; rotation: { x: number; y: number } } }; store: { getState(): { hands: Record<string, { palm: { x: number; y: number } }> } } } };
const view = (page: Page) => page.evaluate(() => { const c = (window as unknown as W).__sleight.three.camera; return { pitch: c.rotation.x, yaw: c.rotation.y, fov: c.fov }; });
const palm = (page: Page) => page.evaluate(() => { const p = (window as unknown as W).__sleight.store.getState().hands.Right.palm; return { x: p.x, y: p.y }; });

for (const scene of ["/theatre", "/arcade", "/industrial"]) {
  test(`${scene}: right-drag looks around, the wheel zooms, reset puts it back`, async ({ page }) => {
    await openWithSim(page, scene);
    await page.waitForFunction(() => !!(window as unknown as W).__sleight?.three?.camera);
    await page.waitForTimeout(600);
    const start = await view(page);
    await page.mouse.move(640, 400);
    await page.waitForTimeout(300);
    const hand = await palm(page);

    // drag left and up with the right button: the view turns left and tilts up
    await page.mouse.down({ button: "right" });
    for (let i = 1; i <= 10; i++) await page.mouse.move(640 - i * 15, 400 - i * 8);
    await page.mouse.up({ button: "right" });
    await page.waitForTimeout(600);
    const turned = await view(page);
    expect(turned.yaw - start.yaw).toBeGreaterThan(0.4); // 150 px × 0.004 rad/px ≈ 0.6 rad
    expect(turned.pitch - start.pitch).toBeGreaterThan(0.2);
    const after = await palm(page);
    expect(Math.hypot(after.x - hand.x, after.y - hand.y)).toBeLessThan(0.01); // the hand didn't follow the drag

    await page.mouse.wheel(0, -500); // zoom in
    await page.waitForTimeout(600);
    expect((await view(page)).fov).toBeLessThan(start.fov * 0.6);

    await page.getByTestId("reset-view").click();
    await page.waitForTimeout(800);
    const back = await view(page);
    expect(back.yaw).toBeCloseTo(start.yaw, 2);
    expect(back.pitch).toBeCloseTo(start.pitch, 2);
    expect(back.fov).toBeCloseTo(start.fov, 1);
  });
}
