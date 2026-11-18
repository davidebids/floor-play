import type { InteractionFrame, Point, PresenceRegion, Quad } from "../types";
import { pointInQuad, validQuad } from "../calibration";

export interface HandObservation {
  position: Point;
  radius: number;
  confidence: number;
  activity: number;
}
export interface ForegroundObservation {
  presence: PresenceRegion[];
  motion: Array<{
    position: Point;
    radius: number;
    strength: number;
    confidence: number;
  }>;
  hands: HandObservation[];
  illuminationChange?: boolean;
}
interface HandHistory {
  id: string;
  position: Point;
  radius: number;
  timestamp: number;
  activity: number;
  lastImpulse: number;
  armed: boolean;
  lastImpulsePosition: Point;
  posePosition: Point;
  poseRadius: number;
  quietPoseMs: number;
  poseRearmed: boolean;
}
const clamp = (value: number, low = 0, high = 1): number =>
  Math.max(low, Math.min(high, value));
const distance = (a: Point, b: Point): number =>
  Math.hypot(a.x - b.x, a.y - b.y);

/** Normalize image differences to a 100 ms observation interval without amplifying tiny gaps. */
export function imageMotionGain(elapsedMs: number): number {
  return Number.isFinite(elapsedMs) && elapsedMs > 0 && elapsedMs <= 250
    ? Math.min(3, 100 / elapsedMs)
    : 0;
}

/** An image-motion gesture estimator; deliberately makes no floor-height claim. */
export class MotionInterpreter {
  private hands: HandHistory[] = [];
  private nextId = 1;
  private lastFallbackImpulse = -Infinity;
  private fallbackArmed = true;
  private lastFallbackPosition: Point | undefined;
  private lastTimestamp = -Infinity;

  reset(): void {
    this.hands = [];
    this.lastTimestamp = -Infinity;
    this.lastFallbackImpulse = -Infinity;
    this.fallbackArmed = true;
    this.lastFallbackPosition = undefined;
  }

  update(
    observation: ForegroundObservation,
    timestamp: number,
    sensitivity = 0.65,
    playArea?: Quad,
  ): InteractionFrame {
    const frame: InteractionFrame = {
      timestamp,
      presence: [...observation.presence],
      motion: [],
      impulses: [],
      source: "camera",
    };
    if (!Number.isFinite(timestamp) || timestamp <= this.lastTimestamp)
      return { ...frame, presence: [] };
    const hasRecentImage = timestamp - this.lastTimestamp <= 250;
    this.lastTimestamp = timestamp;
    const gain = 0.6 + clamp(sensitivity) * 1.4;
    // Select gestures inside the calibrated floor before choosing a fallback.
    // Otherwise an off-floor forearm can win, then be rejected during mapping.
    const floor = playArea && validQuad(playArea) ? playArea : undefined;
    const activeHands = observation.hands.filter(
      (hand) =>
        hand.confidence >= 0.45 &&
        Number.isFinite(hand.position.x) &&
        Number.isFinite(hand.position.y) &&
        (!floor || pointInQuad(hand.position, floor)),
    );
    const activeMotion = floor
      ? observation.motion.filter((motion) =>
          pointInQuad(motion.position, floor),
        )
      : observation.motion;
    const available = this.hands.filter(
      (hand) => timestamp - hand.timestamp < 450,
    );
    const next: HandHistory[] = [];
    for (const observed of activeHands) {
      let previous: HandHistory | undefined;
      let nearest = 0.24;
      for (const candidate of available) {
        const separation = distance(candidate.position, observed.position);
        if (separation < nearest) {
          previous = candidate;
          nearest = separation;
        }
      }
      if (previous) available.splice(available.indexOf(previous), 1);
      const id = previous?.id ?? `hand-${this.nextId++}`;
      // Hand landmarks are more precise than the coarse body mask, especially
      // for an arm reaching into the floor area from outside the camera view.
      frame.presence.push({
        id: `${id}-presence`,
        center: { ...observed.position },
        radius: Math.max(0.018, observed.radius),
        confidence: observed.confidence,
      });
      const dt = previous
        ? clamp((timestamp - previous.timestamp) / 1000, 0.016, 0.25)
        : 0.1;
      // Filter landmark jitter only for tap decisions; presence stays responsive.
      const alpha = 1 - Math.exp(-dt / 0.045);
      const posePosition = previous
        ? {
            x:
              previous.posePosition.x +
              (observed.position.x - previous.posePosition.x) * alpha,
            y:
              previous.posePosition.y +
              (observed.position.y - previous.posePosition.y) * alpha,
          }
        : observed.position;
      const poseRadius = previous
        ? previous.poseRadius + (observed.radius - previous.poseRadius) * alpha
        : observed.radius;
      const speed = previous
        ? distance(posePosition, previous.posePosition) / dt
        : 0;
      const areaChange = previous
        ? (Math.abs(poseRadius - previous.poseRadius) /
            Math.max(previous.poseRadius, 0.01)) *
          imageMotionGain(dt * 1000)
        : 0;
      const poseMoving = speed > 0.06 || areaChange > 0.055;
      const quietPoseMs = observation.illuminationChange
        ? 0
        : poseMoving
          ? Math.max(0, (previous?.quietPoseMs ?? 0) - dt * 1000)
          : Math.min(250, (previous?.quietPoseMs ?? 0) + dt * 1000);
      const energy = clamp(
        (observed.activity * 1.1 + speed * 0.35 + areaChange * 0.25) * gain,
      );
      const lastImpulse = previous?.lastImpulse ?? -Infinity;
      const genuinelyQuiet = energy < 0.1;
      const poseRearmed =
        !genuinelyQuiet &&
        ((previous?.poseRearmed ?? false) ||
          (previous?.armed === false && quietPoseMs >= 80));
      const current = {
        id,
        position: observed.position,
        radius: observed.radius,
        timestamp,
        activity: observed.activity,
        lastImpulse,
        posePosition,
        poseRadius,
        quietPoseMs,
        poseRearmed,
        armed:
          previous?.armed !== false ||
          genuinelyQuiet ||
          quietPoseMs >= 80 ||
          (previous &&
            distance(observed.position, previous.lastImpulsePosition) >
              Math.max(0.035, observed.radius * 1.2)) ||
          false,
        lastImpulsePosition: previous?.lastImpulsePosition ?? observed.position,
      };
      // A brief contact can end before a second landmark arrives. A newly seen
      // hand still needs strong local image motion against a recent frame.
      const briefContact =
        !previous &&
        hasRecentImage &&
        observed.confidence >= 0.8 &&
        observed.activity >= 0.35;
      const deliberateMotion =
        briefContact ||
        (previous &&
          (poseMoving || (!poseRearmed && observed.activity > 0.22)));
      const settling =
        previous &&
        previous.activity > 0.12 &&
        observed.activity < previous.activity * 0.55;
      if (
        !observation.illuminationChange &&
        deliberateMotion &&
        current.armed &&
        (energy > 0.28 || (settling && energy > 0.15)) &&
        timestamp - lastImpulse > 420
      ) {
        current.lastImpulse = timestamp;
        current.armed = false;
        current.quietPoseMs = 0;
        current.poseRearmed = false;
        current.lastImpulsePosition = observed.position;
        frame.impulses.push({
          id: `${id}-${Math.round(timestamp)}`,
          position: observed.position,
          strength: clamp(0.3 + energy * 0.7),
          confidence: observed.confidence,
          timestamp,
        });
      }
      if (!observation.illuminationChange && energy > 0.055)
        frame.motion.push({
          id,
          position: observed.position,
          radius: Math.max(0.025, observed.radius),
          strength: energy,
          confidence: observed.confidence,
        });
      next.push(current);
    }
    this.hands = next.concat(
      available.filter((hand) => timestamp - hand.timestamp < 250),
    );
    if (!observation.illuminationChange) {
      for (const motion of activeMotion.slice(0, 12)) {
        if (motion.confidence < 0.5 || motion.strength * gain < 0.075) continue;
        frame.motion.push({
          ...motion,
          id: `foreground-${frame.motion.length}`,
          strength: clamp(motion.strength * gain),
        });
      }
      // Observe quiet foreground even while landmarks own the gesture. Otherwise
      // fallback can stay disarmed through a rest and miss the next landmark dropout.
      const strongest = activeMotion.reduce<
        (typeof observation.motion)[number] | undefined
      >(
        (best, candidate) =>
          candidate.confidence > 0.65 &&
          (!best || candidate.strength > best.strength)
            ? candidate
            : best,
        undefined,
      );
      if (
        !strongest ||
        strongest.strength * gain < 0.15 ||
        (this.lastFallbackPosition &&
          distance(strongest.position, this.lastFallbackPosition) >
            Math.max(0.04, strongest.radius * 1.2))
      )
        this.fallbackArmed = true;
      // Fallback is spatially gated by semantic foreground, never raw projected movement.
      if (activeHands.length === 0) {
        if (
          strongest &&
          timestamp - this.lastFallbackImpulse > 650 &&
          this.fallbackArmed &&
          strongest.confidence > 0.65 &&
          strongest.strength * gain > 0.62
        ) {
          frame.impulses.push({
            id: `foreground-${Math.round(timestamp)}`,
            position: strongest.position,
            strength: clamp(strongest.strength * gain),
            confidence: strongest.confidence * 0.7,
            timestamp,
          });
          this.lastFallbackImpulse = timestamp;
          this.lastFallbackPosition = strongest.position;
          this.fallbackArmed = false;
        }
      }
    }
    return frame;
  }
}

export interface ForegroundAnalysis {
  presence: PresenceRegion[];
  motion: ForegroundObservation["motion"];
  illuminationChange: boolean;
}

/** Coarse occupancy represents the complete silhouette rather than one body centroid. */
export function analyzeForeground(
  mask: Float32Array,
  maskWidth: number,
  maskHeight: number,
  gray: Uint8Array,
  previousGray: Uint8Array | undefined,
  imageWidth: number,
  imageHeight: number,
): ForegroundAnalysis {
  const presence: PresenceRegion[] = [];
  const motion: ForegroundObservation["motion"] = [];
  if (
    mask.length !== maskWidth * maskHeight ||
    gray.length !== imageWidth * imageHeight
  )
    return { presence, motion, illuminationChange: false };
  const comparable = previousGray?.length === gray.length;
  let signedDifference = 0;
  let changed = 0;
  if (comparable && previousGray) {
    for (let i = 0; i < gray.length; i += 8) {
      const delta = gray[i] - previousGray[i];
      signedDifference += delta;
      if (Math.abs(delta) > 20) changed++;
    }
  }
  const samples = Math.ceil(gray.length / 8);
  const illuminationChange = Boolean(
    comparable &&
    Math.abs(signedDifference / samples) > 18 &&
    changed / samples > 0.65,
  );
  const columns = 14;
  const rows = 10;
  for (let row = 0; row < rows; row++)
    for (let column = 0; column < columns; column++) {
      let confidence = 0;
      let hits = 0;
      let energy = 0;
      let total = 0;
      for (let sy = 0; sy < 4; sy++)
        for (let sx = 0; sx < 4; sx++) {
          const x = (column + (sx + 0.5) / 4) / columns;
          const y = (row + (sy + 0.5) / 4) / rows;
          const value =
            mask[
              Math.min(maskHeight - 1, Math.floor(y * maskHeight)) * maskWidth +
                Math.min(maskWidth - 1, Math.floor(x * maskWidth))
            ];
          confidence += value;
          total++;
          if (value > 0.62) {
            hits++;
            if (comparable && previousGray) {
              const index =
                Math.min(imageHeight - 1, Math.floor(y * imageHeight)) *
                  imageWidth +
                Math.min(imageWidth - 1, Math.floor(x * imageWidth));
              energy +=
                Math.max(0, Math.abs(gray[index] - previousGray[index]) - 12) /
                75;
            }
          }
        }
      if (hits / total < 0.375) continue;
      const center = { x: (column + 0.5) / columns, y: (row + 0.5) / rows };
      const radius = 0.062;
      const certainty = confidence / total;
      presence.push({
        id: `body-${column}-${row}`,
        center,
        radius,
        confidence: certainty,
      });
      const strength = clamp(energy / Math.max(hits, 1));
      if (strength > 0.055 && !illuminationChange)
        motion.push({
          position: center,
          radius,
          strength,
          confidence: certainty,
        });
    }
  motion.sort((a, b) => b.strength - a.strength);
  return { presence, motion, illuminationChange };
}

export function patchActivity(
  position: Point,
  radius: number,
  gray: Uint8Array,
  previous: Uint8Array | undefined,
  width: number,
  height: number,
): number {
  if (!previous || previous.length !== gray.length) return 0;
  const minX = Math.max(0, Math.floor((position.x - radius) * width));
  const maxX = Math.min(width - 1, Math.ceil((position.x + radius) * width));
  const minY = Math.max(0, Math.floor((position.y - radius) * height));
  const maxY = Math.min(height - 1, Math.ceil((position.y + radius) * height));
  let energy = 0;
  let samples = 0;
  for (let y = minY; y <= maxY; y += 3)
    for (let x = minX; x <= maxX; x += 3) {
      const i = y * width + x;
      energy += Math.max(0, Math.abs(gray[i] - previous[i]) - 12) / 80;
      samples++;
    }
  return clamp(energy / Math.max(samples, 1));
}
