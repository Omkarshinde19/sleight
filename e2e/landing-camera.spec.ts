import { expect, test } from "@playwright/test";

// Chromium's fake webcam (a test pattern, no hand in it), allowed without a prompt.
const gpu = process.platform === "darwin" ? ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] : ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"];
test.use({ permissions: ["camera"], launchOptions: { args: [...gpu, "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] } });

test("the landing camera pill starts and stops the tracker", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Try it with your camera" }).click();
  await expect(page.getByRole("button", { name: "Stop camera" })).toBeVisible();
  await page.waitForFunction(() => window.__sleight.store.getState().status === "running", null, { timeout: 30_000 });
  await expect(page.getByText("Hold a hand up to the camera")).toBeVisible();
  await page.getByRole("button", { name: "Stop camera" }).click();
  await expect(page.getByRole("button", { name: "Try it with your camera" })).toBeVisible();
  expect(await page.evaluate(() => window.__sleight.store.getState().status)).toBe("idle");
});
