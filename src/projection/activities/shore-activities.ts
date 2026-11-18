import { NatureStage } from "./nature-stage";
import { createSceneAudio } from "./scene-audio";
import type {
  Activity,
  ActivityContext,
  InteractionFrame,
  ProjectionSettings,
} from "../types";

interface Crab {
  sprite: ReturnType<NatureStage["addSprite"]>;
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  phase: number;
  size: number;
  fleeUntil: number;
}
interface Burst {
  x: number;
  y: number;
  radius: number;
  until: number;
}
const clamp = (value: number, low: number, high: number) =>
  Math.min(high, Math.max(low, value));
const setting = (
  settings: ProjectionSettings,
  id: string,
  key: string,
  fallback: number,
  low: number,
  high: number,
) => {
  const value = settings.activitySettings[id]?.[key];
  return typeof value === "number" && Number.isFinite(value)
    ? clamp(value, low, high)
    : fallback;
};
const angleDelta = (from: number, to: number) =>
  Math.atan2(Math.sin(to - from), Math.cos(to - from));
const usablePoint = (point: { x: number; y: number }) =>
  Number.isFinite(point.x) && Number.isFinite(point.y);

/** Scene-owned wildlife; the shared stage owns water, sand marks, raster size and graphics resources. */
function createShoreActivity(
  context: ActivityContext,
  beach: boolean,
): Activity {
  const id = beach ? "sandy-beach" : "tide-pool";
  const title = beach ? "Sandy beach" : "Tide pool";
  const stage = new NatureStage(context, {
    id,
    title,
    mode: beach ? "beach" : "tide",
    background: `assets/scenes/${beach ? "sandy-beach" : "tide-pool"}.png`,
  });
  const audio = createSceneAudio(id);
  let config = context.settings;
  let disposed = false;
  let scuttleCount = 0;
  let lastTime = 0;
  let randomState = beach ? 786433 : 104729;
  const random = () => {
    randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
    return randomState / 4294967296;
  };
  const crabs: Crab[] = [];
  const bursts: Burst[] = [];
  const seen = new Set<string>();
  const minY = beach ? 0.38 : 0.14;
  const maxY = beach ? 0.88 : 0.86;
  const minX = 0.1;
  const maxX = 0.9;
  let aspect = 2 / 3;

  function configure(settings: ProjectionSettings) {
    if (disposed) return;
    config = settings;
    aspect = clamp(settings.floorHeight / settings.floorWidth, 0.375, 4 / 3);
    stage.configure(settings);
    const count = beach
      ? Math.round(setting(settings, id, "crabCount", 4, 2, 8))
      : Math.round(setting(settings, id, "crabCount", 6, 2, 12));
    while (crabs.length > count) stage.removeSprite(crabs.pop()!.sprite);
    while (crabs.length < count) {
      // Beach wildlife stays peripheral so the main sand-drawing area remains open.
      const x = beach
        ? crabs.length % 2 === 0
          ? 0.14
          : 0.84
        : 0.17 + random() * 0.66;
      const y = beach
        ? 0.45 + ((crabs.length * 0.618034) % 1) * 0.36
        : 0.2 + random() * 0.6;
      const size = 0.065 + random() * 0.016;
      const angle = (random() - 0.5) * 1.8;
      const sprite = stage.addSprite("assets/scenes/shore-crab.png", {
        x,
        y,
        size,
        angle,
        lift: 0.002,
        flutter: 0,
        opacity: 1,
      });
      crabs.push({
        sprite,
        x,
        y,
        size,
        angle,
        vx: 0,
        vy: 0,
        phase: random() * 30,
        fleeUntil: -Infinity,
      });
    }
  }
  configure(config);

  return {
    id,
    title,
    audio,
    configure,
    update(dt: number, time: number, frame: InteractionFrame) {
      if (disposed || config.paused || config.blank || !Number.isFinite(time))
        return;
      const elapsed = Number.isFinite(dt) ? clamp(dt, 0, 0.05) : 0;
      lastTime = time;
      stage.react(frame, time);
      for (let i = bursts.length - 1; i >= 0; i--)
        if (bursts[i].until < time) bursts.splice(i, 1);
      for (const impulse of frame.impulses) {
        if (
          seen.has(impulse.id) ||
          impulse.confidence < 0.15 ||
          !usablePoint(impulse.position)
        )
          continue;
        seen.add(impulse.id);
        if (seen.size > 256) seen.delete(seen.values().next().value!);
        bursts.push({
          x: impulse.position.x,
          y: impulse.position.y,
          radius: 0.19 + clamp(impulse.strength, 0, 1) * 0.13,
          until: time + 0.8,
        });
      }
      for (const crab of crabs) {
        let awayX = 0;
        let awayY = 0;
        let threatened = false;
        const avoid = (
          x: number,
          y: number,
          radius: number,
          confidence: number,
        ) => {
          const dx = crab.x - x;
          const dy = (crab.y - y) * aspect;
          const distance = Math.hypot(dx, dy);
          const reach = Math.max(0.15, radius + crab.size * 0.6);
          if (distance >= reach) return;
          const weight = (1 - distance / reach) * confidence;
          // A hand directly over the body still produces a stable escape direction.
          const direction = crab.phase * 2.39996;
          awayX +=
            (distance > 0.002 ? dx / distance : Math.cos(direction)) * weight;
          awayY +=
            (distance > 0.002 ? dy / distance : Math.sin(direction)) * weight;
          threatened = true;
        };
        for (const region of frame.presence) {
          if (
            region.confidence > 0.15 &&
            Number.isFinite(region.radius) &&
            usablePoint(region.center)
          )
            avoid(
              region.center.x,
              region.center.y,
              clamp(region.radius, 0, 0.5) + 0.07,
              region.confidence,
            );
        }
        for (const burst of bursts) avoid(burst.x, burst.y, burst.radius, 1);
        if (threatened) {
          if (crab.fleeUntil < time) scuttleCount++;
          crab.fleeUntil = time + 0.65;
        }
        const fleeing = crab.fleeUntil > time;
        // Most of a real crab's time is spent still, interspersed with short sideways foraging runs.
        const cycle = (time + crab.phase) % 5.8;
        const foraging = cycle < 1.25;
        const wander =
          crab.phase + time * 0.11 + Math.sin(time * 0.31 + crab.phase) * 0.9;
        let directionX = Math.cos(wander);
        let directionY = Math.sin(wander) * 0.65;
        if (threatened) {
          const length = Math.hypot(awayX, awayY);
          if (length > 1e-5) {
            directionX = awayX / length;
            directionY = awayY / length;
          }
        } else if (fleeing && Math.hypot(crab.vx, crab.vy) > 1e-4) {
          const speed = Math.hypot(crab.vx, crab.vy);
          directionX = crab.vx / speed;
          directionY = crab.vy / speed;
        }
        let crowded = false;
        for (const other of crabs) {
          if (other === crab) continue;
          const dx = crab.x - other.x,
            dy = (crab.y - other.y) * aspect;
          const distance = Math.hypot(dx, dy),
            reach = (crab.size + other.size) * 0.9;
          if (distance >= reach) continue;
          const amount = (1 - distance / reach) * 3,
            angle = crab.phase;
          directionX +=
            (distance > 0.0001 ? dx / distance : Math.cos(angle)) * amount;
          directionY +=
            (distance > 0.0001 ? dy / distance : Math.sin(angle)) * amount;
          crowded = true;
        }
        // Steer back before the body reaches the rock border; never wrap/teleport across the floor.
        const margin = 0.065;
        if (crab.x < minX + margin) directionX = Math.max(directionX, 0.7);
        if (crab.x > maxX - margin) directionX = Math.min(directionX, -0.7);
        if (crab.y < minY + margin) directionY = Math.max(directionY, 0.7);
        if (crab.y > maxY - margin) directionY = Math.min(directionY, -0.7);
        const speed = fleeing ? 0.075 : crowded ? 0.028 : foraging ? 0.018 : 0;
        const directionLength = Math.hypot(directionX, directionY) || 1;
        const smoothing = 1 - Math.exp(-elapsed * (fleeing ? 13 : 7));
        crab.vx +=
          ((directionX / directionLength) * speed - crab.vx) * smoothing;
        crab.vy +=
          ((directionY / directionLength) * speed - crab.vy) * smoothing;
        crab.x = clamp(crab.x + crab.vx * elapsed, minX, maxX);
        crab.y = clamp(crab.y + (crab.vy * elapsed) / aspect, minY, maxY);
        const actualSpeed = Math.hypot(crab.vx, crab.vy);
        if (actualSpeed > 0.003) {
          const heading = Math.atan2(crab.vy, crab.vx);
          // A crab scuttles laterally: use either side without spinning its body on every reversal.
          const alternate = heading + Math.PI;
          const target =
            Math.abs(angleDelta(crab.angle, heading)) <
            Math.abs(angleDelta(crab.angle, alternate))
              ? heading
              : alternate;
          crab.angle += clamp(
            angleDelta(crab.angle, target),
            -elapsed * 2.5,
            elapsed * 2.5,
          );
        }
        const gait = Math.sin(time * (fleeing ? 26 : 14) + crab.phase);
        Object.assign(crab.sprite, {
          x: crab.x,
          y: crab.y,
          angle: crab.angle + gait * Math.min(1, actualSpeed / 0.08) * 0.024,
          gait: Math.min(1, actualSpeed / 0.08),
          gaitPhase: time * (fleeing ? 26 : 14) + crab.phase,
          lift:
            0.0015 + Math.abs(gait) * Math.min(1, actualSpeed / 0.08) * 0.001,
        });
      }
      // Resolve body overlap locally after movement; never wrap or relocate a crab.
      for (let pass = 0; pass < 4; pass++)
        for (let i = 0; i < crabs.length; i++)
          for (let j = i + 1; j < crabs.length; j++) {
            const a = crabs[i],
              b = crabs[j],
              dx = b.x - a.x,
              dy = (b.y - a.y) * aspect;
            const distance = Math.hypot(dx, dy),
              minimum = (a.size + b.size) * 0.72;
            if (distance >= minimum) continue;
            const angle = i * 2.39996 + j,
              nx = distance > 0.0001 ? dx / distance : Math.cos(angle),
              ny = distance > 0.0001 ? dy / distance : Math.sin(angle);
            const correction =
              (minimum - distance) * 0.5 * Math.min(1, elapsed * 30);
            a.x = clamp(a.x - nx * correction, minX, maxX);
            b.x = clamp(b.x + nx * correction, minX, maxX);
            a.y = clamp(a.y - (ny * correction) / aspect, minY, maxY);
            b.y = clamp(b.y + (ny * correction) / aspect, minY, maxY);
          }
      for (const crab of crabs) {
        crab.sprite.x = crab.x;
        crab.sprite.y = crab.y;
      }
    },
    render(time: number) {
      if (!disposed) stage.render(time);
    },
    diagnostics() {
      return {
        ...stage.diagnostics(),
        scene: id,
        crabCount: crabs.length,
        scuttleCount,
        positions: crabs.map((crab) => ({
          x: crab.x,
          y: crab.y,
          speed: Math.hypot(crab.vx, crab.vy),
          fleeing: crab.fleeUntil > lastTime,
        })),
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const crab of crabs) stage.removeSprite(crab.sprite);
      crabs.length = 0;
      bursts.length = 0;
      seen.clear();
      stage.dispose();
      audio.dispose();
    },
  };
}

export const createTidePoolActivity = (context: ActivityContext): Activity =>
  createShoreActivity(context, false);
export const createBeachActivity = (context: ActivityContext): Activity =>
  createShoreActivity(context, true);
