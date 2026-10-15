import type { Page } from "@playwright/test";

type Sleight = {
  api: { sim: { set: (h: string, p: object) => void; throwFlick: (h?: string) => void } | null };
  store: { getState: () => { status: string; hands: Record<string, { gesture: string; palm: { x: number; y: number; z: number } }>; holding: Record<string, string | null> } };
};
declare global {
  interface Window {
    __sleight: Sleight;
  }
}

export async function openWithSim(page: Page, path: string) {
  await page.goto(`${path}?source=sim`);
  await page.waitForFunction(() => window.__sleight?.store?.getState().status === "running" && !!window.__sleight.api.sim);
  await page.waitForFunction(() => !!window.__sleight.store.getState().hands.Right);
}

/** Pose the simulated right hand and let the classifier's dwell pass. */
export async function simGesture(page: Page, gesture: string, hand = "Right") {
  await page.evaluate(([g, h]) => window.__sleight.api.sim!.set(h, { target: g }), [gesture, hand]);
  await page.waitForFunction(([g, h]) => window.__sleight.store.getState().hands[h]?.gesture === g, [gesture, hand]);
}
