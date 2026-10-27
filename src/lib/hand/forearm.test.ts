import { describe, expect, it } from "vitest";
import { ForearmFollower } from "./forearm";
import type { Point } from "./types";

const deg = (a: Point, b: Point) => (Math.acos(Math.max(-1, Math.min(1, a.x * b.x + a.y * b.y + a.z * b.z))) * 180) / Math.PI;
const up = (wrist: Point, angle: number): Point => ({ x: wrist.x + Math.sin(angle) * 0.14, y: wrist.y + Math.cos(angle) * 0.14, z: wrist.z });

describe("ForearmFollower", () => {
  it("hangs down and toward the viewer for an upright hand", () => {
    const f = new ForearmFollower();
    const wrist = { x: 0, y: 1.1, z: 0 };
    const d = f.update(wrist, up(wrist, 0), 0, 1.5);
    expect(d.y).toBeLessThan(-0.8);
    expect(d.z).toBeGreaterThan(0.2);
  });

  it("turns only a little when the wrist twists in place (no whip)", () => {
    const f = new ForearmFollower();
    const wrist = { x: 0.2, y: 1.1, z: 0 };
    const before = f.update(wrist, up(wrist, 0), 0, 1.5);
    let after = before;
    for (let i = 0; i < 30; i++) after = f.update(wrist, up(wrist, 0.6), 1 / 60, 1.5); // a 34° wrist flick
    expect(deg(before, after)).toBeLessThan(0.35 * 34);
  });

  it("follows the hand across the scene within half a second", () => {
    const f = new ForearmFollower();
    const a = { x: -0.4, y: 1.1, z: 0 };
    const b = { x: 0.4, y: 1.1, z: 0 };
    f.update(a, up(a, 0), 0, 1.5);
    let d = f.update(b, up(b, 0), 0, 1.5);
    for (let i = 0; i < 30; i++) d = f.update(b, up(b, 0), 1 / 60, 1.5);
    const fresh = new ForearmFollower().update(b, up(b, 0), 0, 1.5);
    expect(deg(d, fresh)).toBeLessThan(5);
  });

  it("keeps the wrist from kinking when the hand points sideways", () => {
    const f = new ForearmFollower();
    const wrist = { x: 0, y: 1.1, z: 0 };
    const mcp = up(wrist, Math.PI / 2); // fingers pointing straight along +x
    const d = f.update(wrist, mcp, 0, 1.5);
    const handBack = { x: -1, y: 0, z: 0 };
    // straight arm would be 0°; a forearm ignoring the hand would bend the wrist ~90°
    expect(deg(d, handBack)).toBeLessThan(75);
  });
});
