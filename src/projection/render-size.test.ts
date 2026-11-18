import { describe, expect, it } from "vitest";
import {
  DEFAULT_RENDER_LIMITS,
  resolveRenderSize,
  type RenderSizeInput,
} from "./render-size";
const base: RenderSizeInput = {
  logicalWidth: 960,
  logicalHeight: 640,
  cssWidth: 960,
  cssHeight: 640,
  devicePixelRatio: 1,
};

describe("display-resolution allocation independent of scene coordinates", () => {
  it("keeps at least the authored logical resolution for a small preview", () => {
    expect(
      resolveRenderSize({ ...base, cssWidth: 500, cssHeight: 333 }),
    ).toMatchObject({ width: 960, height: 640, scale: 1, capped: false });
  });
  it("allocates native-density Retina pixels instead of stretching the 960px base", () => {
    expect(resolveRenderSize({ ...base, devicePixelRatio: 2 })).toMatchObject({
      width: 1920,
      height: 1280,
      scale: 2,
    });
  });
  it("renders a 3:2 pond at full native density inside a 4K output", () => {
    const output = resolveRenderSize({
      ...base,
      cssWidth: 1620,
      cssHeight: 1080,
      devicePixelRatio: 2,
    });
    expect(output).toMatchObject({ width: 3240, height: 2160, capped: false });
    expect(output.width / output.height).toBe(1.5);
  });
  it("covers both CSS axes uniformly without changing the logical world aspect", () => {
    const output = resolveRenderSize({
      ...base,
      cssWidth: 1440,
      cssHeight: 1100,
    });
    expect(output.width / output.height).toBe(1.5);
    expect(output.width).toBeGreaterThanOrEqual(1440);
    expect(output.height).toBeGreaterThanOrEqual(1100);
  });
  it("bounds giant/Retina displays by pixel budget, texture edge, and maximum scale", () => {
    const output = resolveRenderSize({
      ...base,
      cssWidth: 7680,
      cssHeight: 5120,
      devicePixelRatio: 2,
    });
    expect(output.capped).toBe(true);
    expect(output.width * output.height).toBeLessThanOrEqual(
      DEFAULT_RENDER_LIMITS.maxPixels,
    );
    expect(Math.max(output.width, output.height)).toBeLessThanOrEqual(
      DEFAULT_RENDER_LIMITS.maxEdge,
    );
    expect(output.scale).toBeLessThanOrEqual(4);
    expect(output.width).toBeGreaterThanOrEqual(960);
    expect(output.height).toBeGreaterThanOrEqual(640);
  });
  it("applies the edge limit to wide worlds independently of the area limit", () => {
    const output = resolveRenderSize({
      logicalWidth: 1200,
      logicalHeight: 400,
      cssWidth: 6000,
      cssHeight: 2000,
      devicePixelRatio: 1,
    });
    expect(output.width).toBe(4096);
    expect(output.height).toBeLessThanOrEqual(1366);
    expect(output.capped).toBe(true);
  });
  it("does not allocate repeatedly for subpixel noise or tiny growth", () => {
    const previous = { width: 1320, height: 880 };
    expect(
      resolveRenderSize({
        ...base,
        cssWidth: 1321,
        cssHeight: 880.667,
        previous,
      }),
    ).toMatchObject({ ...previous, changed: false });
    expect(
      resolveRenderSize({
        ...base,
        cssWidth: 1600,
        cssHeight: 1066.667,
        previous,
      }).changed,
    ).toBe(true);
  });
  it("retains a slightly oversized raster until a meaningful shrink", () => {
    const previous = { width: 1920, height: 1280 };
    expect(
      resolveRenderSize({
        ...base,
        cssWidth: 1840,
        cssHeight: 1226.667,
        previous,
      }),
    ).toMatchObject({ ...previous, changed: false });
    expect(resolveRenderSize({ ...base, previous })).toMatchObject({
      width: 960,
      height: 640,
      changed: true,
    });
  });
  it("preserves buffers when a parent preview is hidden/inactive and resizes upon resume", () => {
    const previous = { width: 1440, height: 960 };
    expect(
      resolveRenderSize({ ...base, cssWidth: 0, cssHeight: 0, previous }),
    ).toMatchObject({ ...previous, changed: false, deferred: true });
    expect(
      resolveRenderSize({
        ...base,
        cssWidth: 1920,
        cssHeight: 1280,
        active: false,
        previous,
      }),
    ).toMatchObject({ ...previous, changed: false, deferred: true });
    expect(
      resolveRenderSize({
        ...base,
        cssWidth: 1920,
        cssHeight: 1280,
        active: true,
        previous,
      }),
    ).toMatchObject({
      width: 1920,
      height: 1280,
      changed: true,
      deferred: false,
    });
  });
  it("uses the logical base for an initially hidden canvas or stale different-aspect buffers", () => {
    expect(
      resolveRenderSize({ ...base, cssWidth: 0, cssHeight: 0 }),
    ).toMatchObject({ width: 960, height: 640, deferred: true });
    expect(
      resolveRenderSize({
        ...base,
        cssWidth: 0,
        cssHeight: 0,
        previous: { width: 1000, height: 1000 },
      }),
    ).toMatchObject({ width: 960, height: 640, changed: true });
  });
  it("reallocates when moving between ordinary and Retina displays", () => {
    expect(
      resolveRenderSize({
        ...base,
        devicePixelRatio: 2,
        previous: { width: 960, height: 640 },
      }),
    ).toMatchObject({ width: 1920, height: 1280, changed: true });
    expect(
      resolveRenderSize({
        ...base,
        devicePixelRatio: 1,
        previous: { width: 1920, height: 1280 },
      }),
    ).toMatchObject({ width: 960, height: 640, changed: true });
  });
  it("treats invalid CSS measurements as hidden and invalid DPR as one", () => {
    expect(resolveRenderSize({ ...base, devicePixelRatio: NaN })).toMatchObject(
      { width: 960, height: 640 },
    );
    expect(resolveRenderSize({ ...base, devicePixelRatio: 0 })).toMatchObject({
      width: 960,
      height: 640,
    });
    expect(resolveRenderSize({ ...base, cssWidth: NaN })).toMatchObject({
      width: 960,
      height: 640,
      deferred: true,
    });
  });
  it("rejects impossible logical bases rather than silently shrinking simulation coordinates", () => {
    expect(() => resolveRenderSize({ ...base, logicalWidth: 0 })).toThrow(
      /Logical/,
    );
    expect(() => resolveRenderSize({ ...base, logicalWidth: 5000 })).toThrow(
      /base/,
    );
    expect(() => resolveRenderSize({ ...base, logicalHeight: 640.5 })).toThrow(
      /integer/,
    );
    expect(() => resolveRenderSize(base, { maxPixels: NaN })).toThrow(/limits/);
  });
});
