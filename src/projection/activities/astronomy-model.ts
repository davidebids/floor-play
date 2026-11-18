import type { Impulse, InteractionFrame, Point } from "../types";

export const COSMOS_ID = "starlit-cosmos";
export const MAX_STARS = 360;
export const MAX_COMETS = 8;
export const SATURN_RING_RADIUS = 2.27;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const valid = (p: Point) =>
  Number.isFinite(p.x) &&
  Number.isFinite(p.y) &&
  p.x >= 0 &&
  p.x <= 1 &&
  p.y >= 0 &&
  p.y <= 1;
export interface Star {
  x: number;
  y: number;
  homeX: number;
  homeY: number;
  vx: number;
  vy: number;
  phase: number;
  size: number;
  warmth: number;
  glow: number;
}
export interface Planet {
  kind: "earth" | "saturn" | "moon";
  x: number;
  y: number;
  homeX: number;
  homeY: number;
  radius: number;
  vx: number;
  vy: number;
  spin: number;
  energy: number;
}
export interface Comet {
  origin: "tap" | "ambient";
  x: number;
  y: number;
  dx: number;
  dy: number;
  born: number;
  life: number;
}
export interface Starburst {
  x: number;
  y: number;
  born: number;
  strength: number;
}

/** Bounded world-space motion, independent of projection raster size. */
export class CosmosModel {
  readonly stars: Star[] = [];
  readonly planets: Planet[] = [
    {
      kind: "earth",
      x: 0.27,
      y: 0.52,
      homeX: 0.27,
      homeY: 0.52,
      radius: 0.087,
      vx: 0,
      vy: 0,
      spin: 0,
      energy: 0,
    },
    {
      kind: "saturn",
      x: 0.73,
      y: 0.6,
      homeX: 0.73,
      homeY: 0.6,
      radius: 0.073,
      vx: 0,
      vy: 0,
      spin: 0,
      energy: 0,
    },
    {
      kind: "moon",
      x: 0.52,
      y: 0.25,
      homeX: 0.52,
      homeY: 0.25,
      radius: 0.034,
      vx: 0,
      vy: 0,
      spin: 0,
      energy: 0,
    },
  ];
  readonly comets: Comet[] = [];
  readonly bursts: Starburst[] = [];
  impulseCount = 0;
  ambientLaunches = 0;
  responses = 0;
  time = 0;
  private seen = new Set<string>();
  private seed = 81473;
  private ambientSeed = 97213;
  private nextAmbientAt = 3.5;
  private ambientRandom() {
    this.ambientSeed =
      (Math.imul(this.ambientSeed, 1664525) + 1013904223) >>> 0;
    return this.ambientSeed / 4294967296;
  }
  private random() {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }
  constructor() {
    this.setCount(200);
  }
  setCount(count: number) {
    const n = Number.isFinite(count)
      ? clamp(Math.round(count), 80, MAX_STARS)
      : 200;
    this.stars.length = Math.min(this.stars.length, n);
    while (this.stars.length < n) {
      const x = 0.015 + this.random() * 0.97,
        y = 0.015 + this.random() * 0.97;
      this.stars.push({
        x,
        y,
        homeX: x,
        homeY: y,
        vx: 0,
        vy: 0,
        phase: this.random() * Math.PI * 2,
        size: 1.2 + this.random() ** 3 * 4.2,
        warmth: this.random(),
        glow: 0,
      });
    }
  }
  update(
    dt: number,
    time: number,
    aspect: number,
    drift: number,
    frame: InteractionFrame,
  ): readonly Impulse[] {
    if (!Number.isFinite(dt) || !Number.isFinite(time)) return [];
    const step = clamp(dt, 0, 0.05);
    const ratio = Number.isFinite(aspect) ? clamp(aspect, 0.375, 4 / 3) : 2 / 3;
    const motion = Number.isFinite(drift) ? clamp(drift, 0, 1) : 0;
    this.time = time;
    const accepted: Impulse[] = [];
    for (const tap of frame.impulses) {
      if (
        this.seen.has(tap.id) ||
        !Number.isFinite(tap.confidence) ||
        tap.confidence < 0.15 ||
        !Number.isFinite(tap.strength) ||
        !valid(tap.position)
      )
        continue;
      this.seen.add(tap.id);
      if (this.seen.size > 256)
        this.seen.delete(this.seen.values().next().value!);
      const strength = clamp(tap.strength, 0.35, 1);
      accepted.push(tap);
      this.impulseCount++;
      this.bursts.push({
        x: tap.position.x,
        y: tap.position.y,
        born: time,
        strength,
      });
      if (this.bursts.length > MAX_COMETS) this.bursts.shift();
      // Aim into open space, so a corner tap remains visible rather than shooting off-floor.
      const targetX = tap.position.x < 0.5 ? 0.84 : 0.16;
      const targetY = tap.position.y < 0.5 ? 0.78 : 0.22;
      const angle =
        Math.atan2(
          (targetY - tap.position.y) * ratio,
          targetX - tap.position.x,
        ) +
        (this.random() - 0.5) * 0.3;
      this.comets.push({
        origin: "tap",
        x: tap.position.x,
        y: tap.position.y,
        dx: Math.cos(angle),
        dy: Math.sin(angle),
        born: time,
        life: 1.7,
      });
      if (this.comets.length > MAX_COMETS) {
        const ambient = this.comets.findIndex(
          (comet) => comet.origin === "ambient",
        );
        this.comets.splice(ambient >= 0 ? ambient : 0, 1);
      }
      for (const star of this.stars) {
        const dx = star.x - tap.position.x,
          dy = (star.y - tap.position.y) * ratio,
          d = Math.hypot(dx, dy);
        if (d > 0.23) continue;
        const power = (1 - d / 0.23) * strength,
          a = d > 0.001 ? Math.atan2(dy, dx) : star.phase;
        star.vx += Math.cos(a) * power * 0.18;
        star.vy += Math.sin(a) * power * 0.18;
        star.glow = Math.max(star.glow, power);
        this.responses++;
      }
      for (const planet of this.planets) {
        const dx = planet.x - tap.position.x,
          dy = (planet.y - tap.position.y) * ratio,
          d = Math.hypot(dx, dy);
        if (d > planet.radius + 0.2) continue;
        const force = (1 - d / (planet.radius + 0.2)) * strength;
        planet.energy = Math.max(planet.energy, force);
        const a = d > 0.001 ? Math.atan2(dy, dx) : 0.8;
        planet.vx += Math.cos(a) * 0.06 * force;
        planet.vy += Math.sin(a) * 0.06 * force;
        this.responses++;
      }
    }
    for (let i = this.bursts.length - 1; i >= 0; i--)
      if (time - this.bursts[i].born > 2.1) this.bursts.splice(i, 1);
    for (let i = this.comets.length - 1; i >= 0; i--)
      if (time - this.comets[i].born > this.comets[i].life)
        this.comets.splice(i, 1);
    if (motion === 0) this.nextAmbientAt = time + 3.5;
    else if (time >= this.nextAmbientAt) {
      // Ambient life never manufactures an input action, sound, or starburst.
      // Skip a busy interval instead of evicting tap feedback or catching up later.
      if (
        this.comets.length < MAX_COMETS - 2 &&
        this.comets.filter((comet) => comet.origin === "ambient").length < 2
      ) {
        const fromLeft = this.ambientRandom() < 0.5;
        const x = fromLeft
          ? 0.1 + this.ambientRandom() * 0.12
          : 0.78 + this.ambientRandom() * 0.12;
        const y = 0.1 + this.ambientRandom() * 0.2;
        const angle = Math.atan2(
          (0.62 - y) * ratio,
          (fromLeft ? 0.83 : 0.17) - x,
        );
        this.comets.push({
          origin: "ambient",
          x,
          y,
          dx: Math.cos(angle),
          dy: Math.sin(angle),
          born: time,
          life: 2.8,
        });
        this.ambientLaunches++;
      }
      this.nextAmbientAt =
        time + (7 + this.ambientRandom() * 6) / (0.7 + motion * 0.7);
    }
    const push = (
      body: { x: number; y: number; vx: number; vy: number },
      radius: number,
      force: number,
    ) => {
      for (const hand of frame.presence.slice(0, 8)) {
        if (
          !valid(hand.center) ||
          !Number.isFinite(hand.radius) ||
          !Number.isFinite(hand.confidence) ||
          hand.confidence < 0.15
        )
          continue;
        const dx = body.x - hand.center.x,
          dy = (body.y - hand.center.y) * ratio,
          d = Math.hypot(dx, dy);
        const reach = clamp(hand.radius, 0.01, 0.35) + radius;
        if (d >= reach) continue;
        const power =
          (1 - d / reach) * clamp(hand.confidence, 0, 1) * force * step;
        const a = d > 0.001 ? Math.atan2(dy, dx) : 0.7;
        body.vx += Math.cos(a) * power;
        body.vy += Math.sin(a) * power;
      }
    };
    for (const star of this.stars) {
      push(star, 0.075, 0.35);
      const tx =
        star.homeX +
        Math.sin(time * 0.09 + star.phase) *
          0.025 *
          motion *
          (0.55 + star.size * 0.18);
      const ty =
        star.homeY +
        Math.cos(time * 0.07 + star.phase) *
          0.025 *
          motion *
          (0.55 + star.size * 0.18);
      star.vx += (tx - star.x) * 0.65 * step;
      star.vy += (ty - star.y) * ratio * 0.65 * step;
      star.vx *= Math.exp(-2.2 * step);
      star.vy *= Math.exp(-2.2 * step);
      star.x = clamp(star.x + star.vx * step, 0.008, 0.992);
      star.y = clamp(star.y + (star.vy * step) / ratio, 0.008, 0.992);
      star.glow *= Math.exp(-1.7 * step);
    }
    for (const [index, planet] of this.planets.entries()) {
      push(planet, planet.radius + 0.055, 0.12);
      const phase = index * 2.1;
      const orbitX =
        planet.homeX + Math.sin(time * 0.13 + phase) * 0.045 * motion;
      const orbitY =
        planet.homeY + Math.sin(time * 0.1 + phase * 0.7) * 0.03 * motion;
      planet.vx += (orbitX - planet.x) * 1.1 * step;
      planet.vy += (orbitY - planet.y) * ratio * 1.1 * step;
      planet.vx *= Math.exp(-2.8 * step);
      planet.vy *= Math.exp(-2.8 * step);
      const r =
        planet.kind === "saturn"
          ? planet.radius * SATURN_RING_RADIUS
          : planet.radius * 1.16;
      planet.x = clamp(planet.x + planet.vx * step, r, 1 - r);
      planet.y = clamp(
        planet.y + (planet.vy * step) / ratio,
        Math.min(0.45, r / ratio),
        Math.max(0.55, 1 - r / ratio),
      );
      planet.spin += step * (0.035 + motion * 0.035 + planet.energy * 0.25);
      planet.energy *= Math.exp(-1.5 * step);
    }
    return accepted;
  }
}
