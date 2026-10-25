import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

type P = { x: number; y: number; z: number };
type Body = { translation(): P; numColliders(): number; isKinematic(): boolean };
type W = {
  __arcadeBalls: { body: Body }[];
  __st: { grabs: number; fingersInBall: number; worstDrift: number };
  __sleight: {
    api: { startPlayback(r: unknown): void };
    store: { getState(): { holding: Record<string, string | null> } };
    pose: { sample(h: string): { joints: P[]; palm: P } | null };
    rapier: { world: { forEachRigidBody(f: (b: Body) => void): void } };
  };
};

/**
 * A real arcade session (webcam landmarks only) played back in the scene: the bugs it showed were
 * robot fingers inside the balls, held balls wobbling or slipping in the hand, and the hands swapping.
 */
test("replaying a real session: hands stay out of the balls and held balls stay put", async ({ page }) => {
  test.setTimeout(90_000);
  const rec = JSON.parse(readFileSync("src/lib/hand/__fixtures__/arcade-session.json", "utf8"));
  const t0 = rec.frames[0].t;
  rec.frames = rec.frames.filter((f: { t: number }) => f.t - t0 < 16_000);
  await page.goto("/arcade");
  await page.waitForFunction(() => (window as unknown as Partial<W>).__arcadeBalls?.[2]?.body && (window as unknown as Partial<W>).__sleight?.api);
  await page.evaluate((r) => {
    const w = window as unknown as W;
    const st = { grabs: 0, fingersInBall: 0, worstDrift: 0 };
    w.__st = st;
    const prev: Record<string, string | null> = {};
    const held: Record<string, number | null> = {};
    const tick = () => {
      const s = w.__sleight.store.getState();
      const balls = w.__arcadeBalls.map((b) => b.body.translation());
      const anchors: P[] = [];
      w.__sleight.rapier.world.forEachRigidBody((b) => void (b.numColliders() === 0 && b.isKinematic() && anchors.push(b.translation())));
      for (const h of ["Right", "Left"]) {
        const hold = s.holding[h] ?? null;
        if (hold && !prev[h]) {
          st.grabs++;
          held[h] = null;
        }
        prev[h] = hold;
        const p = w.__sleight.pose.sample(h);
        if (!p) continue;
        const i = hold ? Number(hold.split(" ")[1]) - 1 : -1;
        p.joints.forEach((j) =>
          balls.forEach((b, k) => {
            if (k !== i && Math.hypot(j.x - b.x, j.y - b.y, j.z - b.z) < 0.12 - 0.005) st.fingersInBall++;
          }),
        );
        if (hold) {
          // distance from the ball to the grab anchor it hangs off, once it has settled into the palm
          const b = balls[i];
          const a = anchors.reduce((m, x) => (Math.hypot(x.x - p.palm.x, x.y - p.palm.y, x.z - p.palm.z) < Math.hypot(m.x - p.palm.x, m.y - p.palm.y, m.z - p.palm.z) ? x : m));
          const d = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
          if (held[h] === null) held[h] = -performance.now();
          else if (held[h]! < 0 && performance.now() + held[h]! > 250) held[h] = d;
          else if (held[h]! > 0) st.worstDrift = Math.max(st.worstDrift, Math.abs(d - held[h]!));
        }
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    w.__sleight.api.startPlayback(r);
  }, rec);
  await page.waitForTimeout(16_500);
  const st = await page.evaluate(() => (window as unknown as W).__st);
  expect(st.grabs).toBeGreaterThanOrEqual(2);
  expect(st.fingersInBall).toBe(0);
  expect(st.worstDrift).toBeLessThan(0.01);
});
