import { inUnitSquare } from "./calibration";
import type { Impulse, InteractionFrame, PresenceRegion } from "./types";

interface EngineOptions {
  staleMs: number;
  cooldownMs: number;
  impulseMaxAgeMs: number;
  smoothing: number;
  confidenceThreshold: number;
}
const clamp = (v: number, min = 0, max = 1): number =>
  Math.max(min, Math.min(max, v));
const validNumber = (value: number): boolean => Number.isFinite(value);

/** Shared input state; each scene interprets presence, motion and impulses. */
export class InteractionEngine {
  private readonly options: EngineOptions;
  private latest: InteractionFrame | null = null;
  private pending: Impulse[] = [];
  private recent: Impulse[] = [];
  private seen = new Map<string, number>();
  private filtered = { duplicate: 0, invalid: 0, expired: 0 };
  constructor(options: Partial<EngineOptions> = {}) {
    this.options = {
      staleMs: 500,
      cooldownMs: 350,
      impulseMaxAgeMs: 250,
      smoothing: 0.55,
      confidenceThreshold: 0.2,
      ...options,
    };
  }
  ingest(frame: InteractionFrame): void {
    if (
      !validNumber(frame.timestamp) ||
      (this.latest && frame.timestamp < this.latest.timestamp)
    )
      return;
    const threshold = this.options.confidenceThreshold;
    const pendingCount = this.pending.length;
    this.pending = this.pending.filter(
      (event) =>
        frame.timestamp - event.timestamp <= this.options.impulseMaxAgeMs,
    );
    this.filtered.expired += pendingCount - this.pending.length;
    const previous = new Map(
      this.latest?.presence.map((region) => [region.id, region]) ?? [],
    );
    const continuous =
      !!this.latest &&
      frame.timestamp - this.latest.timestamp < this.options.staleMs;
    const presence: PresenceRegion[] = frame.presence
      .filter(
        (region) =>
          inUnitSquare(region.center) &&
          validNumber(region.radius) &&
          validNumber(region.confidence) &&
          region.confidence >= threshold,
      )
      .map((region) => {
        const prior = continuous ? previous.get(region.id) : undefined;
        const a = this.options.smoothing;
        return {
          ...region,
          center: prior
            ? {
                x: prior.center.x + (region.center.x - prior.center.x) * a,
                y: prior.center.y + (region.center.y - prior.center.y) * a,
              }
            : { ...region.center },
          radius: clamp(region.radius, 0.01, 0.6),
          confidence: clamp(region.confidence),
        };
      });
    const motion = frame.motion
      .filter(
        (sample) =>
          inUnitSquare(sample.position) &&
          validNumber(sample.radius) &&
          validNumber(sample.strength) &&
          validNumber(sample.confidence) &&
          sample.confidence >= threshold,
      )
      .map((sample) => ({
        ...sample,
        position: { ...sample.position },
        strength: clamp(sample.strength),
        radius: clamp(sample.radius, 0.01, 0.6),
        confidence: clamp(sample.confidence),
      }));
    this.recent = this.recent.filter(
      (event) => frame.timestamp - event.timestamp < this.options.cooldownMs,
    );
    for (const [id, timestamp] of this.seen)
      if (frame.timestamp - timestamp > 5000) this.seen.delete(id);
    for (const event of [...frame.impulses].sort(
      (a, b) => b.strength - a.strength,
    )) {
      const age = frame.timestamp - event.timestamp;
      if (
        !inUnitSquare(event.position) ||
        !validNumber(event.strength) ||
        !validNumber(event.timestamp) ||
        !validNumber(event.confidence) ||
        event.confidence < threshold ||
        age > this.options.impulseMaxAgeMs ||
        age < -50 ||
        this.seen.has(event.id)
      ) {
        this.filtered.invalid++;
        continue;
      }
      this.seen.set(event.id, event.timestamp);
      const duplicate = this.recent.some(
        (prior) =>
          Math.hypot(
            prior.position.x - event.position.x,
            prior.position.y - event.position.y,
          ) < 0.12 &&
          Math.abs(event.timestamp - prior.timestamp) < this.options.cooldownMs,
      );
      if (duplicate) {
        this.filtered.duplicate++;
        continue;
      }
      const accepted = {
        ...event,
        position: { ...event.position },
        strength: clamp(event.strength),
        confidence: clamp(event.confidence),
      };
      this.pending.push(accepted);
      this.recent.push(accepted);
    }
    this.latest = {
      timestamp: frame.timestamp,
      presence,
      motion,
      impulses: [],
      source: frame.source,
    };
  }
  sample(now = performance.now()): InteractionFrame {
    const latest = this.latest;
    if (
      !latest ||
      !validNumber(now) ||
      now - latest.timestamp > this.options.staleMs ||
      now < latest.timestamp - 50
    ) {
      this.filtered.expired += this.pending.length;
      this.pending = [];
      return {
        timestamp: now,
        presence: [],
        motion: [],
        impulses: [],
        source: latest?.source ?? "pointer",
      };
    }
    const age = Math.max(0, now - latest.timestamp);
    const fade = clamp(1 - age / this.options.staleMs);
    const impulses = this.pending.filter(
      (event) =>
        now - event.timestamp <= this.options.impulseMaxAgeMs &&
        now - event.timestamp >= -50,
    );
    this.filtered.expired += this.pending.length - impulses.length;
    this.pending = [];
    return {
      ...latest,
      presence: latest.presence.map((region) => ({
        ...region,
        center: { ...region.center },
        confidence: region.confidence * fade,
      })),
      motion: latest.motion.map((sample) => ({
        ...sample,
        position: { ...sample.position },
        strength: sample.strength * fade,
      })),
      impulses,
    };
  }
  reset(): void {
    this.latest = null;
    this.pending = [];
    this.recent = [];
    this.seen.clear();
    this.filtered = { duplicate: 0, invalid: 0, expired: 0 };
  }
  diagnostics(): Record<string, number> {
    return {
      duplicateActions: this.filtered.duplicate,
      invalidActions: this.filtered.invalid,
      expiredActions: this.filtered.expired,
    };
  }
}
