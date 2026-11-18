import type { Koi } from "../../koi";
import type { Vec2 } from "../../math";

/** Sample actual travelled path by distance, avoiding time-based lag when speed changes. */
export function sampleTrail(
  fish: Pick<Koi, "trail" | "heading" | "position">,
  distance: number,
): Vec2 {
  const trail = fish.trail;
  if (distance <= 0 || trail.length < 2)
    return {
      x: fish.position.x - Math.cos(fish.heading) * distance,
      y: fish.position.y - Math.sin(fish.heading) * distance,
    };
  let remaining = distance;
  for (let i = 1; i < trail.length; i++) {
    const a = trail[i - 1],
      b = trail[i],
      span = Math.hypot(b.x - a.x, b.y - a.y);
    if (span < 1e-5) continue;
    if (remaining <= span) {
      const k = remaining / span;
      return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
    }
    remaining -= span;
  }
  // A resize may compress the stored path. Never invent an untravelled tail
  // extension through the bank while fresh distance history builds up.
  return { ...trail[trail.length - 1] };
}

export function advanceTrail(fish: Koi): void {
  if (fish.trail.length < 2) fish.resetTrail();
  const fixed = fish.trail[1];
  if (Math.hypot(fish.position.x - fixed.x, fish.position.y - fixed.y) >= 2.0)
    fish.trail.unshift({ ...fish.position });
  else fish.trail[0] = { ...fish.position };
  fish.trail.length = Math.min(
    fish.trail.length,
    Math.ceil(Math.max(fish.bodyLength * 1.8, 100) / 2) + 4,
  );
  const spacing = fish.bodyLength / (fish.spine.length - 1);
  for (let i = 0; i < fish.spine.length; i++)
    fish.spine[i] = sampleTrail(fish, i * spacing);
}

/** Photo-mesh centerline: real path first, with an aft-growing travelling tail stroke. */
export function swimmingCenter(fish: Koi, t: number): Vec2 {
  const distance = (t - 0.045) * fish.bodyLength * 1.2;
  const center = sampleTrail(fish, distance);
  const before = sampleTrail(fish, distance - 0.6),
    after = sampleTrail(fish, distance + 0.6);
  const dx = after.x - before.x,
    dy = after.y - before.y,
    span = Math.hypot(dx, dy) || 1;
  const envelope = Math.pow(Math.max(0, (t - 0.25) / 0.75), 1.8);
  const amplitude =
    fish.bodyLength *
    (0.023 + 0.052 * Math.min(1.1, Math.max(0, fish.tailEffort)));
  const wave =
    Math.sin(fish.swimPhase - t * 5.8 + fish.phaseOffset) *
    envelope *
    amplitude;
  return { x: center.x - (dy / span) * wave, y: center.y + (dx / span) * wave };
}

export interface SwimmingSection {
  center: Vec2;
  normal: Vec2;
  width: number;
  finFlutter: number;
}

/** Shared cross-section for one mesh row; all columns use the same path samples. */
export function swimmingSection(
  fish: Koi,
  t: number,
  index = 0,
): SwimmingSection {
  const center = swimmingCenter(fish, t),
    before = swimmingCenter(fish, t - 0.01),
    after = swimmingCenter(fish, t + 0.01);
  const dx = after.x - before.x,
    dy = after.y - before.y,
    span = Math.hypot(dx, dy) || 1;
  return {
    center,
    normal: { x: -dy / span, y: dx / span },
    width: fish.bodyLength * 0.6,
    finFlutter:
      t > 0.15 && t < 0.48
        ? Math.sin(fish.swimPhase * 0.65 + index) * 0.012 * fish.bodyLength
        : 0,
  };
}

export function sectionVertex(section: SwimmingSection, across: number): Vec2 {
  const offset = across * section.width + section.finFlutter * across;
  return {
    x: section.center.x + section.normal.x * offset,
    y: section.center.y + section.normal.y * offset,
  };
}

/** Actual photo mesh vertex, shared with containment tests. across ranges -.5..+.5. */
export function swimmingVertex(
  fish: Koi,
  t: number,
  across: number,
  index = 0,
): Vec2 {
  return sectionVertex(swimmingSection(fish, t, index), across);
}
