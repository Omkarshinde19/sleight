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
