import { describe, expect, it } from "vitest";
import {
  cameraToFloor,
  DEFAULT_QUAD,
  floorToOutput,
  homography,
  invertHomography,
  outputToFloor,
  outputGeometrySignature,
  pointInQuad,
  transformPoint,
  validQuad,
} from "./calibration";
import { DEFAULT_SETTINGS } from "./storage";
import type { Quad } from "./types";
const camera: Quad = [
  { x: 0.14, y: 0.08 },
  { x: 0.88, y: 0.2 },
  { x: 0.73, y: 0.93 },
  { x: 0.05, y: 0.77 },
];
const expectPoint = (
  actual: { x: number; y: number } | null,
  expected: { x: number; y: number },
) => {
  expect(actual).not.toBeNull();
  expect(actual!.x).toBeCloseTo(expected.x, 7);
  expect(actual!.y).toBeCloseTo(expected.y, 7);
};
describe("projective calibration", () => {
  it("maps all four perspective correspondences, not only the bounding box", () => {
    const m = homography(camera, DEFAULT_QUAD);
    camera.forEach((p, i) =>
      expectPoint(transformPoint(m, p), DEFAULT_QUAD[i]),
    );
    expectPoint(
      cameraToFloor(camera[2], {
        ...DEFAULT_SETTINGS.calibration,
        cameraCorners: camera,
      }),
      { x: 1, y: 1 },
    );
  });
  it("round-trips interior coordinates through a genuinely projective transform and inverse", () => {
    const m = homography(DEFAULT_QUAD, camera),
      inverse = invertHomography(m);
    expect(Math.abs(m[6]) + Math.abs(m[7])).toBeGreaterThan(0.01);
    for (let y = 0; y <= 10; y++)
      for (let x = 0; x <= 10; x++) {
        const p = { x: x / 10, y: y / 10 };
        expectPoint(transformPoint(inverse, transformPoint(m, p)), p);
      }
  });
  it("maps output warp in both directions without stretching/cropping away the border", () => {
    const profile = { ...DEFAULT_SETTINGS.calibration, outputCorners: camera };
    const p = { x: 0.35, y: 0.72 },
      output = floorToOutput(p, profile)!;
    expectPoint(outputToFloor(output, profile), p);
    expect(outputToFloor({ x: 0, y: 0 }, profile)).toBeNull();
  });
  it("allows reflected camera correspondences without applying a second mirror", () => {
    const reflected = DEFAULT_QUAD.map((p) => ({ x: 1 - p.x, y: p.y })) as Quad;
    expect(validQuad(reflected)).toBe(true);
    expectPoint(
      cameraToFloor(
        { x: 0.75, y: 0.3 },
        {
          ...DEFAULT_SETTINGS.calibration,
          cameraCorners: reflected,
          mirrored: true,
        },
      ),
      { x: 0.25, y: 0.3 },
    );
  });
  it("rejects crossed, concave, tiny, nonfinite and out-of-range regions", () => {
    const cases = [
      [DEFAULT_QUAD[0], DEFAULT_QUAD[2], DEFAULT_QUAD[1], DEFAULT_QUAD[3]],
      [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 0.2, y: 0.2 },
        { x: 0, y: 1 },
      ],
      [
        { x: 0, y: 0 },
        { x: 0.01, y: 0 },
        { x: 0.01, y: 0.01 },
        { x: 0, y: 0.01 },
      ],
      [{ x: NaN, y: 0 }, ...DEFAULT_QUAD.slice(1)],
      [{ x: -0.01, y: 0 }, ...DEFAULT_QUAD.slice(1)],
    ];
    cases.forEach((quad) => expect(validQuad(quad)).toBe(false));
    expect(() => homography(cases[0] as Quad, DEFAULT_QUAD)).toThrow(
      /quadrilateral/,
    );
  });
  it("rejects outside camera points and invalid mappings without a false edge interaction", () => {
    const profile = { ...DEFAULT_SETTINGS.calibration, cameraCorners: camera };
    expect(pointInQuad({ x: 0, y: 0 }, camera)).toBe(false);
    expect(cameraToFloor({ x: 0, y: 0 }, profile)).toBeNull();
    expect(cameraToFloor({ x: Infinity, y: 0.5 }, profile)).toBeNull();
    expect(() =>
      transformPoint([1, 0, 0, 0, 1, 0, 0, 0, 0], { x: 0.5, y: 0.5 }),
    ).toThrow();
    expect(() => invertHomography([1, 0, 0, 0, 0, 0, 0, 0, 1])).toThrow();
  });
});

describe("physical output signature", () => {
  const geometry = {
    role: "projector" as const,
    stage: { x: 0, y: 40, width: 1200, height: 800 },
    viewport: { width: 1200, height: 880 },
    window: { x: 100, y: 200, width: 1220, height: 920 },
    screen: { width: 1920, height: 1080, x: 0, y: 0 },
    devicePixelRatio: 1,
  };
  it("changes for projector resizing, movement, display scale or owner role", () => {
    const original = outputGeometrySignature(geometry);
    expect(
      outputGeometrySignature({
        ...geometry,
        stage: { ...geometry.stage, width: 1100 },
      }),
    ).not.toBe(original);
    expect(
      outputGeometrySignature({
        ...geometry,
        window: { ...geometry.window, x: 200 },
      }),
    ).not.toBe(original);
    expect(
      outputGeometrySignature({ ...geometry, devicePixelRatio: 2 }),
    ).not.toBe(original);
    expect(outputGeometrySignature({ ...geometry, role: "preview" })).not.toBe(
      original,
    );
  });
  it("ignores insignificant subpixel layout noise and rejects invalid rectangles", () => {
    expect(
      outputGeometrySignature({
        ...geometry,
        stage: { ...geometry.stage, x: 0.1 },
      }),
    ).toBe(outputGeometrySignature(geometry));
    expect(() =>
      outputGeometrySignature({
        ...geometry,
        stage: { ...geometry.stage, width: 0 },
      }),
    ).toThrow(/geometry/);
  });
});
