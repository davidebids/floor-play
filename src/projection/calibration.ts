import type { CalibrationProfile, Point, Quad } from "./types";

/** Corner correspondences are floor TL, TR, BR, BL, in that order. */
export const DEFAULT_QUAD: Quad = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];
const EPSILON = 1e-10;
const finitePoint = (value: unknown): value is Point => {
  if (!value || typeof value !== "object") return false;
  const point = value as Point;
  return Number.isFinite(point.x) && Number.isFinite(point.y);
};
export const inUnitSquare = (point: Point, tolerance = 1e-7): boolean =>
  finitePoint(point) &&
  point.x >= -tolerance &&
  point.y >= -tolerance &&
  point.x <= 1 + tolerance &&
  point.y <= 1 + tolerance;
const cross = (a: Point, b: Point, c: Point): number =>
  (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);

/** Accept either winding (a mirrored camera reverses it), never crossed/concave or nearly collapsed quads. */
export function validQuad(value: unknown): value is Quad {
  if (
    !Array.isArray(value) ||
    value.length !== 4 ||
    !value.every((point) => finitePoint(point) && inUnitSquare(point, 0))
  )
    return false;
  const turns = value.map((point, i) =>
    cross(point, value[(i + 1) % 4], value[(i + 2) % 4]),
  );
  if (
    !turns.every((turn) => turn > 1e-5) &&
    !turns.every((turn) => turn < -1e-5)
  )
    return false;
  let twiceArea = 0;
  for (let i = 0; i < 4; i++)
    twiceArea +=
      value[i].x * value[(i + 1) % 4].y - value[(i + 1) % 4].x * value[i].y;
  return Math.abs(twiceArea) >= 0.005;
}

/** Solve the full projective transform, not an affine/bounding-box approximation. Row-major 3x3. */
export function homography(source: Quad, target: Quad): number[] {
  if (!validQuad(source) || !validQuad(target))
    throw new RangeError(
      "Calibration corners must form a nondegenerate convex quadrilateral.",
    );
  const rows: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = source[i],
      u = target[i].x,
      v = target[i].y;
    rows.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    rows.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  for (let col = 0; col < 8; col++) {
    let pivot = col;
    for (let row = col + 1; row < 8; row++)
      if (Math.abs(rows[row][col]) > Math.abs(rows[pivot][col])) pivot = row;
    if (Math.abs(rows[pivot][col]) < EPSILON)
      throw new RangeError("Calibration transform is singular.");
    [rows[col], rows[pivot]] = [rows[pivot], rows[col]];
    const divisor = rows[col][col];
    for (let j = col; j <= 8; j++) rows[col][j] /= divisor;
    for (let row = 0; row < 8; row++) {
      if (row === col) continue;
      const factor = rows[row][col];
      for (let j = col; j <= 8; j++) rows[row][j] -= factor * rows[col][j];
    }
  }
  return [...rows.map((row) => row[8]), 1];
}

export function transformPoint(matrix: readonly number[], point: Point): Point {
  if (
    matrix.length !== 9 ||
    !matrix.every(Number.isFinite) ||
    !finitePoint(point)
  )
    throw new RangeError("Invalid transform or point.");
  const w = matrix[6] * point.x + matrix[7] * point.y + matrix[8];
  if (Math.abs(w) < EPSILON)
    throw new RangeError("Point lies outside the finite projection plane.");
  const result = {
    x: (matrix[0] * point.x + matrix[1] * point.y + matrix[2]) / w,
    y: (matrix[3] * point.x + matrix[4] * point.y + matrix[5]) / w,
  };
  if (!finitePoint(result))
    throw new RangeError("Transform produced a nonfinite point.");
  return result;
}

export function invertHomography(m: readonly number[]): number[] {
  if (m.length !== 9 || !m.every(Number.isFinite))
    throw new RangeError("Invalid transform.");
  const [a, b, c, d, e, f, g, h, i] = m;
  const cof = [
    e * i - f * h,
    c * h - b * i,
    b * f - c * e,
    f * g - d * i,
    a * i - c * g,
    c * d - a * f,
    d * h - e * g,
    b * g - a * h,
    a * e - b * d,
  ];
  const determinant = a * cof[0] + b * cof[3] + c * cof[6];
  if (Math.abs(determinant) < EPSILON)
    throw new RangeError("Calibration transform is singular.");
  return cof.map((value) => value / determinant);
}

export function pointInQuad(point: Point, quad: Quad): boolean {
  if (!finitePoint(point) || !validQuad(quad)) return false;
  const turns = quad.map((a, i) => cross(a, quad[(i + 1) % 4], point));
  return (
    turns.every((turn) => turn >= -1e-7) || turns.every((turn) => turn <= 1e-7)
  );
}

function mapInside(
  point: Point,
  source: Quad,
  target: Quad,
  requireUnitOutput: boolean,
): Point | null {
  if (!pointInQuad(point, source)) return null;
  try {
    const result = transformPoint(homography(source, target), point);
    if (requireUnitOutput && !inUnitSquare(result)) return null;
    return {
      x: Math.max(0, Math.min(1, result.x)),
      y: Math.max(0, Math.min(1, result.y)),
    };
  } catch {
    return null;
  }
}

/** Input is already in the same mirrored/unmirrored image space as cameraCorners. */
export function cameraToFloor(
  point: Point,
  profile: CalibrationProfile,
): Point | null {
  return mapInside(point, profile.cameraCorners, DEFAULT_QUAD, true);
}
export function floorToOutput(
  point: Point,
  profile: CalibrationProfile,
): Point | null {
  return mapInside(point, DEFAULT_QUAD, profile.outputCorners, true);
}
export function outputToFloor(
  point: Point,
  profile: CalibrationProfile,
): Point | null {
  return mapInside(point, profile.outputCorners, DEFAULT_QUAD, true);
}

export interface OutputGeometry {
  role: "preview" | "projector";
  stage: { x: number; y: number; width: number; height: number };
  viewport: { width: number; height: number };
  window: { x: number; y: number; width: number; height: number };
  screen: { width: number; height: number; x: number; y: number };
  devicePixelRatio: number;
}

/** A floor mapping belongs to a physical output rectangle, not just camera resolution. */
export function outputGeometrySignature(geometry: OutputGeometry): string {
  const values = [
    geometry.stage.x,
    geometry.stage.y,
    geometry.stage.width,
    geometry.stage.height,
    geometry.viewport.width,
    geometry.viewport.height,
    geometry.window.x,
    geometry.window.y,
    geometry.window.width,
    geometry.window.height,
    geometry.screen.width,
    geometry.screen.height,
    geometry.screen.x,
    geometry.screen.y,
    geometry.devicePixelRatio,
  ];
  if (
    !values.every(Number.isFinite) ||
    geometry.stage.width <= 0 ||
    geometry.stage.height <= 0 ||
    geometry.devicePixelRatio <= 0
  )
    throw new RangeError("Invalid output geometry.");
  // Integer CSS pixels suppress subpixel layout noise; retain display-scale precision.
  return `output-v1:${geometry.role}:${JSON.stringify(values.map((value, index) => (index === values.length - 1 ? Math.round(value * 1000) / 1000 : Math.round(value))))}`;
}
