import { expect, test, type Page } from "@playwright/test";

const letter = (page: Page, i: number) => page.locator("[data-letter]").nth(i);
const centre = async (page: Page, i: number) => {
  const b = (await letter(page, i).boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  // the stage is up once its hand reports where it is
  await page.waitForFunction(() => !!document.querySelector("canvas"));
  await page.waitForTimeout(1500);
});

test("the poster lists the two rooms and nothing else", async ({ page }) => {
  await expect(page.getByRole("heading", { level: 1, name: "Sleight of hand" })).toHaveCount(1);
  await expect(page.locator("[data-letter]")).toHaveCount(13);
  await expect(letter(page, 0)).toBeVisible();
  await expect(page.getByRole("link", { name: "Enter the Arcade Room" })).toHaveAttribute("href", "/arcade");
  await expect(page.getByRole("link", { name: "Enter the Operating Theatre" })).toHaveAttribute("href", "/theatre");
  await expect(page.locator("body")).not.toContainText(/industrial/i);
  await expect(page.locator('a[href="/industrial"]')).toHaveCount(0);
});

test("pressing on a letter picks it up, and it springs back when let go", async ({ page }) => {
  const g = await centre(page, 4);
  await page.mouse.move(g.x - 120, g.y + 120);
  await page.mouse.move(g.x, g.y, { steps: 10 });
  await page.waitForTimeout(300);
  await page.mouse.down();
  await page.mouse.move(g.x - 200, g.y + 220, { steps: 20 });
  await page.waitForTimeout(200);
  const moved = await centre(page, 4);
  expect(Math.hypot(moved.x - g.x, moved.y - g.y)).toBeGreaterThan(150);
  // its neighbour stayed put
  await expect(letter(page, 3)).not.toHaveAttribute("style", /translate/);

  await page.mouse.up();
  await expect.poll(async () => { const c = await centre(page, 4); return Math.hypot(c.x - g.x, c.y - g.y); }, { timeout: 3000 }).toBeLessThan(2);
});

test("hovering a room makes the hand act it out", async ({ page }) => {
  await page.getByRole("link", { name: /01 Arcade Room/ }).hover();
  await expect(page.getByText("Flick", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: /02 Operating Theatre/ }).hover();
  await expect(page.getByText("Stitch", { exact: true })).toBeVisible();
  await page.mouse.move(20, 300);
  await expect(page.getByText("by yours", { exact: true })).toBeVisible();
});

test("a recorded hand drives the hero, like the camera would", async ({ page }) => {
  await page.evaluate(() => (window as unknown as { __sleight: { api: { startPlayback: (u: string) => Promise<void> } } }).__sleight.api.startPlayback("/sessions/demo.json"));
  await page.waitForFunction(() => window.__sleight.store.getState().status === "running" && Object.keys(window.__sleight.store.getState().hands).length > 0);
});
