import { expect, test } from "@playwright/test";
import { openWithSim, simGesture } from "./helpers";

test("simulated hands reach the processor and every gesture is recognised", async ({ page }) => {
  await openWithSim(page, "/lab");
  for (const g of ["fist", "pinch", "point", "open"]) await simGesture(page, g);
  await expect(page.getByTestId("debug-stats")).toContainText("R OPEN");
});

test("the mouse moves the simulated hand like a mirror", async ({ page }) => {
  await openWithSim(page, "/lab");
  const x = () => page.evaluate(() => window.__sleight.store.getState().hands.Right.palm.x);
  await page.mouse.move(300, 400);
  await page.waitForTimeout(400);
  const left = await x();
  await page.mouse.move(1000, 400);
  await page.waitForTimeout(400);
  expect(await x()).toBeGreaterThan(left + 0.5);
});

test("the demo recording plays without a camera", async ({ page }) => {
  await page.goto("/lab");
  await page.getByTestId("start-demo").click();
  await page.waitForFunction(() => Object.keys(window.__sleight.store.getState().hands).length > 0);
  await expect(page.getByText("Recording", { exact: true })).toBeVisible();
});

test("the Blender reference box loads at the exported scale and orientation", async ({ page }) => {
  await openWithSim(page, "/lab");
  const handle = await page.waitForFunction(() => {
    const three = (window.__sleight as unknown as undefined | { three?: { scene: import("three").Scene } })?.three;
    const box = three?.scene.getObjectByName("SmokeBox");
    if (!box) return null;
    box.updateWorldMatrix(true, false);
    const geo = (box as import("three").Mesh).geometry;
    geo.computeBoundingBox();
    const b = geo.boundingBox!.clone().applyMatrix4(box.matrixWorld);
    return { min: b.min.toArray(), max: b.max.toArray() };
  });
  const { min, max } = (await handle.jsonValue())!;
  const size = max.map((v, i) => v - min[i]);
  const centre = max.map((v, i) => (v + min[i]) / 2);
  [0.2, 0.05, 0.1].forEach((v, i) => expect(size[i]).toBeCloseTo(v, 2));
  [0, 0.5, -0.3].forEach((v, i) => expect(centre[i]).toBeCloseTo(v, 2));
});
