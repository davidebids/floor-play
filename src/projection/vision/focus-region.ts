import { validQuad } from "../calibration";
import type { Point, Quad } from "../types";
export interface FocusRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}
export const FULL_FRAME: FocusRegion = { x: 0, y: 0, width: 1, height: 1 };
/** Camera corners are already in the processed (optionally mirrored) image. */
export function focusRegion(corners?: Quad): FocusRegion {
  if (!validQuad(corners)) return FULL_FRAME;
  const xs = corners.map((p) => p.x),
    ys = corners.map((p) => p.y);
  const left = Math.min(...xs),
    right = Math.max(...xs),
    top = Math.min(...ys),
    bottom = Math.max(...ys);
  const px = Math.max(0.025, (right - left) * 0.2),
    py = Math.max(0.025, (bottom - top) * 0.2);
  const x = Math.max(0, left - px),
    y = Math.max(0, top - py);
  return {
    x,
    y,
    width: Math.min(1, right + px) - x,
    height: Math.min(1, bottom + py) - y,
  };
}
export function cameraPoint(point: Point, region: FocusRegion): Point {
  return {
    x: region.x + point.x * region.width,
    y: region.y + point.y * region.height,
  };
}
export function sourceRegion(
  region: FocusRegion,
  mirrored: boolean,
): FocusRegion {
  return { ...region, x: mirrored ? 1 - region.x - region.width : region.x };
}
