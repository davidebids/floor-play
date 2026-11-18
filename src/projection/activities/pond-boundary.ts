import type { Vec2 } from "../../math";
import type { Koi } from "../../koi";

/** Traced conservatively inside the generated bed's emergent stone shoreline.
 * Coordinates use floor space: x right, y down. Used by both optics and motion. */
export const WATER_POLYGON: readonly Vec2[] = [
  { x: 0.5, y: 0.18 },
  { x: 0.68, y: 0.2 },
  { x: 0.79, y: 0.28 },
  { x: 0.84, y: 0.42 },
  { x: 0.83, y: 0.6 },
  { x: 0.76, y: 0.74 },
  { x: 0.62, y: 0.81 },
  { x: 0.42, y: 0.82 },
  { x: 0.27, y: 0.76 },
  { x: 0.18, y: 0.64 },
  { x: 0.15, y: 0.48 },
  { x: 0.17, y: 0.32 },
  { x: 0.29, y: 0.22 },
];
/** Wet shallows extend beyond the conservative whole-fish navigation boundary. */
export const WATER_SURFACE_POLYGON: readonly Vec2[] = [
  { x: 0.5, y: 0.15 },
  { x: 0.7, y: 0.16 },
  { x: 0.84, y: 0.23 },
  { x: 0.9, y: 0.38 },
  { x: 0.91, y: 0.6 },
  { x: 0.84, y: 0.75 },
  { x: 0.65, y: 0.83 },
  { x: 0.42, y: 0.86 },
  { x: 0.27, y: 0.82 },
  { x: 0.16, y: 0.74 },
  { x: 0.105, y: 0.6 },
  { x: 0.105, y: 0.42 },
  { x: 0.14, y: 0.28 },
  { x: 0.28, y: 0.16 },
];
interface Plane {
  a: Vec2;
  nx: number;
  ny: number;
}
const planeCache = new Map<string, Plane[]>();
const insetCache = new Map<string, Vec2[]>();
function planes(
  width: number,
  height: number,
  polygon = WATER_POLYGON,
): Plane[] {
  const key = `${polygon === WATER_POLYGON ? "fish" : "surface"}/${width}/${height}`;
  const cached = planeCache.get(key);
  if (cached) return cached;
  const points = polygon.map((p) => ({
    x: p.x * width,
    y: p.y * height,
  }));
  const result = points.map((a, i) => {
    const b = points[(i + 1) % points.length],
      dx = b.x - a.x,
      dy = b.y - a.y,
      d = Math.hypot(dx, dy);
    return { a, nx: -dy / d, ny: dx / d };
  });
  planeCache.set(key, result);
  if (planeCache.size > 16) planeCache.delete(planeCache.keys().next().value!);
  return result;
}
export function waterClearance(
  point: Vec2,
  width: number,
  height: number,
  polygon = WATER_POLYGON,
): { distance: number; normal: Vec2 } {
  let distance = Infinity,
    normal = { x: 0, y: 0 };
  for (const plane of planes(width, height, polygon)) {
    const d =
      (point.x - plane.a.x) * plane.nx + (point.y - plane.a.y) * plane.ny;
    if (d < distance) {
      distance = d;
      normal = { x: plane.nx, y: plane.ny };
    }
  }
  return { distance, normal };
}
export function surfaceWaterClearance(
  point: Vec2,
  width: number,
  height: number,
) {
  return waterClearance(point, width, height, WATER_SURFACE_POLYGON);
}
function insetPolygon(margin: number, width: number, height: number): Vec2[] {
  const key = `${width}/${height}/${margin.toFixed(5)}`;
  const cached = insetCache.get(key);
  if (cached) return cached;
  let polygon = WATER_POLYGON.map((p) => ({ x: p.x * width, y: p.y * height }));
  for (const plane of planes(width, height)) {
    const clipped: Vec2[] = [];
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i],
        b = polygon[(i + 1) % polygon.length];
      const da =
        (a.x - plane.a.x) * plane.nx + (a.y - plane.a.y) * plane.ny - margin;
      const db =
        (b.x - plane.a.x) * plane.nx + (b.y - plane.a.y) * plane.ny - margin;
      if (da >= -1e-8) clipped.push(a);
      if (da >= 0 !== db >= 0) {
        const t = da / (da - db);
        clipped.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      }
    }
    polygon = clipped;
  }
  if (!polygon.length)
    throw new RangeError("Fish is too large for the calibrated water area.");
  insetCache.set(key, polygon);
  if (insetCache.size > 256) insetCache.delete(insetCache.keys().next().value!);
  return polygon;
}
export function projectIntoWater(
  point: Vec2,
  margin: number,
  width: number,
  height: number,
): Vec2 {
  if (waterClearance(point, width, height).distance >= margin)
    return { ...point };
  const polygon = insetPolygon(margin + 0.001, width, height);
  let nearest = polygon[0],
    best = Infinity;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i],
      b = polygon[(i + 1) % polygon.length],
      dx = b.x - a.x,
      dy = b.y - a.y;
    const t = Math.max(
      0,
      Math.min(
        1,
        ((point.x - a.x) * dx + (point.y - a.y) * dy) /
          (dx * dx + dy * dy || 1),
      ),
    );
    const p = { x: a.x + dx * t, y: a.y + dy * t },
      d = (p.x - point.x) ** 2 + (p.y - point.y) ** 2;
    if (d < best) {
      best = d;
      nearest = p;
    }
  }
  return { ...nearest };
}
/** Covers the full rectangular photo mesh, tail stroke and small optical distortion. */
export function fishWaterMargin(fish: Pick<Koi, "bodyLength">): number {
  return fish.bodyLength * 0.41 + 5;
}
export function seedFishInsideWater(
  fish: Koi,
  width: number,
  height: number,
): void {
  const margin = fishWaterMargin(fish);
  fish.position = projectIntoWater(fish.position, margin + 2, width, height);
  const initial = fish.heading;
  for (let step = 0; step < 48; step++) {
    const offset =
      ((step === 0 ? 0 : Math.ceil(step / 2) * (step % 2 ? 1 : -1)) * Math.PI) /
      24;
    const angle = initial + offset;
    let safe = true;
    for (let sample = 0; sample <= 12; sample++) {
      const d = (fish.bodyLength * 1.3 * sample) / 12;
      if (
        waterClearance(
          {
            x: fish.position.x - Math.cos(angle) * d,
            y: fish.position.y - Math.sin(angle) * d,
          },
          width,
          height,
        ).distance <
        margin + 1
      ) {
        safe = false;
        break;
      }
    }
    if (safe) {
      fish.heading = angle;
      break;
    }
  }
  fish.resetTrail();
  fish.trail = fish.trail.map((point) =>
    projectIntoWater(point, margin, width, height),
  );
}
export function containFishAfterResize(
  fish: Koi,
  width: number,
  height: number,
): void {
  const margin = fishWaterMargin(fish);
  fish.position = projectIntoWater(fish.position, margin, width, height);
  fish.trail = fish.trail.map((point) =>
    projectIntoWater(point, margin, width, height),
  );
}

/** Exact same convex half-plane boundary in pixel space for bed, water, fish and shadows. */
const boundaryGLSL = (
  polygon: readonly Vec2[],
) => `float pondWaterDistance(vec2 uv,vec2 dimensions){vec2 p=uv*dimensions;float distanceToWater=1.0e6;vec2 a;vec2 b;vec2 edge;
${polygon
  .map((a, i) => {
    const b = polygon[(i + 1) % polygon.length];
    return `a=vec2(${a.x.toFixed(6)},${a.y.toFixed(6)})*dimensions;b=vec2(${b.x.toFixed(6)},${b.y.toFixed(6)})*dimensions;edge=b-a;distanceToWater=min(distanceToWater,dot(p-a,vec2(-edge.y,edge.x))/length(edge));`;
  })
  .join("\n")}
return distanceToWater;}`;
export const POND_BOUNDARY_GLSL = boundaryGLSL(WATER_POLYGON);
export const POND_SURFACE_BOUNDARY_GLSL = boundaryGLSL(WATER_SURFACE_POLYGON);
