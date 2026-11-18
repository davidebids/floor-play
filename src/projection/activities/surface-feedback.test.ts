import { describe, expect, it } from "vitest";
import {
  appendSurfaceMark,
  beachShoreline,
  SURFACE_MARK_CAPACITY,
  type SurfaceMark,
} from "./nature-stage";
import {
  surfaceWaterClearance,
  waterClearance,
  WATER_SURFACE_POLYGON,
} from "./pond-boundary";
describe("surface feedback under camera motion", () => {
  it("retains tap feedback while heavy sweeping fills its own bounded pool", () => {
    const marks: SurfaceMark[] = [];
    appendSurfaceMark(marks, {
      x: 0.5,
      y: 0.5,
      born: 0,
      strength: 0.8,
      kind: "tap",
    });
    for (let i = 0; i < 100; i++)
      appendSurfaceMark(marks, {
        x: 0.1,
        y: 0.1,
        born: i / 100,
        strength: 0.3,
        kind: "motion",
      });
    expect(marks.filter((m) => m.kind === "tap")).toHaveLength(1);
    expect(marks.filter((m) => m.kind === "motion")).toHaveLength(
      SURFACE_MARK_CAPACITY.motion,
    );
    for (let i = 0; i < 100; i++)
      appendSurfaceMark(marks, {
        x: 0.5,
        y: 0.5,
        born: i,
        strength: 0.8,
        kind: "tap",
      });
    expect(marks).toHaveLength(
      SURFACE_MARK_CAPACITY.tap + SURFACE_MARK_CAPACITY.motion,
    );
    expect(marks.filter((m) => m.kind === "tap").at(-1)?.born).toBe(99);
  });
  it("admits visible bottom-left shallows while keeping the whole-fish boundary conservative", () => {
    for (const p of [
      { x: 0.18, y: 0.7 },
      { x: 0.21, y: 0.74 },
      { x: 0.25, y: 0.77 },
    ]) {
      const point = { x: p.x * 960, y: p.y * 640 };
      expect(surfaceWaterClearance(point, 960, 640).distance).toBeGreaterThan(
        0,
      );
      expect(waterClearance(point, 960, 640).distance).toBeLessThan(0);
    }
    for (const p of [
      { x: 0.02, y: 0.5 },
      { x: 0.5, y: 0.02 },
      { x: 0.98, y: 0.5 },
      { x: 0.5, y: 0.98 },
      { x: 0.1, y: 0.9 },
    ])
      expect(
        surfaceWaterClearance({ x: p.x * 960, y: p.y * 640 }, 960, 640)
          .distance,
      ).toBeLessThan(0);
    for (let i = 0; i < WATER_SURFACE_POLYGON.length; i++) {
      const a = WATER_SURFACE_POLYGON[i],
        b = WATER_SURFACE_POLYGON[(i + 1) % WATER_SURFACE_POLYGON.length],
        c = WATER_SURFACE_POLYGON[(i + 2) % WATER_SURFACE_POLYGON.length];
      expect(
        (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x),
      ).toBeGreaterThan(0);
    }
  });
  it("advances and recedes over a visible swash zone rather than merely shimmering in place", () => {
    const samples = Array.from({ length: 601 }, (_, i) =>
      beachShoreline(0.5, i / 60, 0.45),
    );
    expect(Math.max(...samples) - Math.min(...samples)).toBeGreaterThan(0.12);
    const steps = samples.slice(1).map((x, i) => x - samples[i]);
    expect(steps.some((x) => x > 0.0001)).toBe(true);
    expect(steps.some((x) => x < -0.0001)).toBe(true);
    expect(Math.max(...steps.map(Math.abs))).toBeLessThan(0.003);
  });
});
