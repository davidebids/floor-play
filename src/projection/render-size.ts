/** Raster allocation policy. Logical scene coordinates never change with display resolution. */
export interface RenderSize {
  width: number;
  height: number;
}
export interface RenderSizeInput {
  logicalWidth: number;
  logicalHeight: number;
  /** Read canvas.clientWidth/clientHeight, not its perspective-warped bounding rectangle. */
  cssWidth: number;
  cssHeight: number;
  devicePixelRatio?: number;
  previous?: RenderSize;
  /** Inactive previews keep their allocation until they resume. */
  active?: boolean;
}
export interface RenderSizeLimits {
  maxPixels: number;
  maxEdge: number;
  maxScale: number;
}
export interface ResolvedRenderSize extends RenderSize {
  scale: number;
  changed: boolean;
  capped: boolean;
  deferred: boolean;
}
export const DEFAULT_RENDER_LIMITS: Readonly<RenderSizeLimits> = {
  maxPixels: 8_388_608,
  maxEdge: 4096,
  maxScale: 4,
};

/**
 * Cover both CSS axes at the display's pixel density, preserving the logical aspect.
 * Small sizing noise reuses the existing raster; major resize/DPR changes reallocate.
 */
export function resolveRenderSize(
  input: RenderSizeInput,
  overrides: Partial<RenderSizeLimits> = {},
): ResolvedRenderSize {
  const { logicalWidth: width, logicalHeight: height, previous } = input;
  const limits = { ...DEFAULT_RENDER_LIMITS, ...overrides };
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width <= 0 ||
    height <= 0
  )
    throw new RangeError(
      "Logical render dimensions must be positive integer coordinates.",
    );
  if (
    !Object.values(limits).every(
      (value) => Number.isFinite(value) && value >= 1,
    )
  )
    throw new RangeError(
      "Render allocation limits must be finite and positive.",
    );
  if (
    width > limits.maxEdge ||
    height > limits.maxEdge ||
    width * height > limits.maxPixels
  )
    throw new RangeError(
      "The logical render base exceeds the allocation limits.",
    );

  const maxScale = Math.min(
    limits.maxScale,
    limits.maxEdge / width,
    limits.maxEdge / height,
    Math.sqrt(limits.maxPixels / (width * height)),
  );
  const validPrevious =
    previous &&
    Number.isInteger(previous.width) &&
    Number.isInteger(previous.height) &&
    previous.width >= width &&
    previous.height >= height &&
    previous.width <= limits.maxEdge &&
    previous.height <= limits.maxEdge &&
    previous.width * previous.height <= limits.maxPixels &&
    previous.width <= width * maxScale + 1e-7 &&
    previous.height <= height * maxScale + 1e-7 &&
    Math.abs(previous.width * height - previous.height * width) <=
      Math.max(width, height);

  const result = (
    size: RenderSize,
    capped: boolean,
    deferred: boolean,
  ): ResolvedRenderSize => ({
    ...size,
    scale: Math.min(size.width / width, size.height / height),
    changed:
      !previous ||
      previous.width !== size.width ||
      previous.height !== size.height,
    capped,
    deferred,
  });
  const measurable =
    Number.isFinite(input.cssWidth) &&
    Number.isFinite(input.cssHeight) &&
    input.cssWidth > 0 &&
    input.cssHeight > 0;
  if (input.active === false || !measurable)
    return result(validPrevious ? previous! : { width, height }, false, true);

  const dpr =
    Number.isFinite(input.devicePixelRatio) && input.devicePixelRatio! > 0
      ? input.devicePixelRatio!
      : 1;
  const requested = Math.max(
    1,
    (input.cssWidth * dpr) / width,
    (input.cssHeight * dpr) / height,
  );
  const capped = requested > maxScale + 1e-7;
  const desired = Math.min(maxScale, requested);

  if (validPrevious) {
    const previousScale = Math.min(
      previous!.width / width,
      previous!.height / height,
    );
    // A 1.5% growth tolerance and 15% shrink tolerance avoid GPU buffer churn at
    // bucket boundaries, fractional CSS sizes, or a changing browser toolbar.
    if (desired <= previousScale * 1.015 && desired >= previousScale * 0.85)
      return result(previous!, capped, false);
  }

  const quantizedScale = Math.min(maxScale, Math.ceil(desired * 8 - 1e-9) / 8);
  // Floor both dimensions so rounding can never exceed the declared pixel/edge budget.
  return result(
    {
      width: Math.max(width, Math.floor(width * quantizedScale + 1e-7)),
      height: Math.max(height, Math.floor(height * quantizedScale + 1e-7)),
    },
    capped,
    false,
  );
}
