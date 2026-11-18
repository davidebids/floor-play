import { describe, it, expect } from "vitest";
import {
  focusRegion,
  sourceRegion,
  cameraPoint,
  FULL_FRAME,
} from "./focus-region";
import type { Quad } from "../types";
const corners: Quad = [
  { x: 0.3, y: 0.2 },
  { x: 0.65, y: 0.22 },
  { x: 0.64, y: 0.6 },
  { x: 0.31, y: 0.58 },
];
describe("calibrated hand focus", () => {
  it("keeps context around the floor without shrinking the camera coordinate space", () => {
    const region = focusRegion(corners);
    expect(region.width).toBeCloseTo(0.49);
    expect(region.height).toBeCloseTo(0.56);
    for (const point of corners) {
      expect(point.x).toBeGreaterThan(region.x);
      expect(point.x).toBeLessThan(region.x + region.width);
      expect(point.y).toBeGreaterThan(region.y);
      expect(point.y).toBeLessThan(region.y + region.height);
    }
    const center = cameraPoint({ x: 0.5, y: 0.5 }, region);
    expect(center.x).toBeCloseTo(0.475);
    expect(center.y).toBeCloseTo(0.4);
  });
  it("falls back to the full image before calibration or for malformed corners", () => {
    expect(focusRegion()).toEqual(FULL_FRAME);
    expect(
      focusRegion([corners[0], corners[2], corners[1], corners[3]]),
    ).toEqual(FULL_FRAME);
    expect(
      focusRegion([{ x: -0.1, y: 0 }, ...corners.slice(1)] as Quad),
    ).toEqual(FULL_FRAME);
  });
  it("clips edge padding while preserving exact normalized corner mapping", () => {
    const region = focusRegion([
      { x: 0, y: 0 },
      { x: 0.4, y: 0 },
      { x: 0.4, y: 0.5 },
      { x: 0, y: 0.5 },
    ]);
    expect(region.x).toBe(0);
    expect(region.y).toBe(0);
    expect(cameraPoint({ x: 0, y: 0 }, region)).toEqual({ x: 0, y: 0 });
    expect(cameraPoint({ x: 1, y: 1 }, region)).toEqual({
      x: region.width,
      y: region.height,
    });
  });
  it("selects the reflected source crop exactly once for a mirrored image", () => {
    const region = focusRegion(corners),
      raw = sourceRegion(region, true);
    expect(raw.x).toBeCloseTo(1 - region.x - region.width);
    for (const x of [0, 0.2, 0.7, 1])
      expect(raw.x + (1 - x) * raw.width).toBeCloseTo(
        1 - cameraPoint({ x, y: 0.5 }, region).x,
      );
    expect(sourceRegion(region, false)).toEqual(region);
  });
  it("maps both axes separately for strongly perspective or portrait regions", () => {
    const region = { x: 0.4, y: 0.1, width: 0.15, height: 0.8 };
    const point = cameraPoint({ x: 0.2, y: 0.8 }, region);
    expect(point.x).toBeCloseTo(0.43);
    expect(point.y).toBeCloseTo(0.74);
  });
});
