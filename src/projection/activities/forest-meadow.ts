import { clamp, wrapAngle } from "../../math";
import type {
  Activity,
  ActivityContext,
  InteractionFrame,
  ProjectionSettings,
} from "../types";
import { NatureStage } from "./nature-stage";
import { createSceneAudio } from "./scene-audio";

type Sprite = ReturnType<NatureStage["addSprite"]>;
interface Actor {
  sprite: Sprite;
  vx: number;
  vy: number;
  vz: number;
  spin: number;
  heading: number;
  speed: number;
  phase: number;
  seed: number;
  escapeUntil: number;
  restAt: number;
  restUntil: number;
  turnRate: number;
  wingFold: number;
  takeoffUntil: number;
}
const random = (index: number) => {
  const n = Math.sin(index * 127.1 + 311.7) * 43758.5453;
  return n - Math.floor(n);
};
const preference = (
  settings: ProjectionSettings,
  id: string,
  key: string,
  fallback: number,
  min: number,
  max: number,
) => {
  const value = settings.activitySettings[id]?.[key];
  return typeof value === "number" && Number.isFinite(value)
    ? clamp(value, min, max)
    : fallback;
};
/** Distances and velocities use world width so interaction remains circular on every floor aspect. */
const offsetFrom = (actor: Actor, x: number, y: number, aspect: number) => ({
  x: actor.sprite.x - x,
  y: (actor.sprite.y - y) * aspect,
});

function makeNatureActivity(
  context: ActivityContext,
  meadow: boolean,
): Activity {
  const id = meadow ? "butterfly-meadow" : "forest-floor";
  const title = meadow ? "Butterfly Meadow" : "Forest Floor";
  const stage = new NatureStage(context, {
    id,
    title,
    mode: meadow ? "meadow" : "forest",
    background: `assets/scenes/${id}.png`,
  });
  const audio = createSceneAudio(id);
  const actors: Actor[] = [];
  const seen = new Map<string, number>();
  const motionHistory = new Map<
    string,
    { x: number; y: number; time: number; vx: number; vy: number }
  >();
  let settings = context.settings;
  let breeze = 0.35;
  let aspect = clamp(
    settings.floorHeight / settings.floorWidth,
    360 / 960,
    1280 / 960,
  );
  let disposed = false;
  let elapsed = 0;
  let responses = 0;
  const addActor = (index: number) => {
    const seed = random(index + (meadow ? 814 : 219));
    const sprite = stage.addSprite(
      `assets/scenes/${meadow ? "meadow-butterfly" : "woodland-leaf"}.png`,
      {
        x: 0.14 + random(index * 7 + 14) * 0.72,
        y: 0.15 + random(index * 11 + 38) * 0.7,
        size: meadow ? 0.053 + seed * 0.022 : 0.044 + seed * 0.035,
        angle: seed * Math.PI * 2,
        lift: meadow ? 0.018 : 0,
        flutter: 0,
        opacity: 0.94 + seed * 0.06,
      },
    );
    actors.push({
      sprite,
      seed,
      vx: 0,
      vy: 0,
      vz: 0,
      spin: 0,
      heading: seed * Math.PI * 2,
      speed: meadow ? 0.03 : 0,
      phase: seed * Math.PI * 2,
      escapeUntil: 0,
      restAt: 8 + seed * 16,
      restUntil: 0,
      turnRate: 0,
      wingFold: 0,
      takeoffUntil: 0,
    });
  };
  function configure(next: ProjectionSettings) {
    if (disposed) return;
    settings = next;
    aspect = clamp(next.floorHeight / next.floorWidth, 360 / 960, 1280 / 960);
    breeze = preference(next, id, "breeze", 0.35, 0, 1);
    const count = Math.round(
      preference(
        next,
        id,
        meadow ? "butterflyCount" : "leafCount",
        meadow ? 9 : 28,
        meadow ? 4 : 12,
        meadow ? 16 : 48,
      ),
    );
    while (actors.length < count) addActor(actors.length);
    while (actors.length > count) stage.removeSprite(actors.pop()!.sprite);
    stage.configure(next);
  }
  configure(settings);

  function reactToImpulses(frame: InteractionFrame, time: number) {
    for (const impulse of frame.impulses) {
      if (impulse.confidence < 0.15 || seen.has(impulse.id)) continue;
      seen.set(impulse.id, frame.timestamp);
      if (seen.size > 256) seen.delete(seen.keys().next().value!);
      const power = clamp(impulse.strength, 0, 1);
      for (const actor of actors) {
        const offset = offsetFrom(
          actor,
          impulse.position.x,
          impulse.position.y,
          aspect,
        );
        const distance = Math.hypot(offset.x, offset.y);
        const radius = meadow ? 0.2 + power * 0.16 : 0.15 + power * 0.11;
        if (distance >= radius) continue;
        responses++;
        const falloff = Math.sqrt(1 - distance / radius);
        const angle =
          distance > 0.001
            ? Math.atan2(offset.y, offset.x)
            : actor.seed * Math.PI * 2;
        if (meadow) {
          actor.escapeUntil = time + 0.9 + power;
          actor.takeoffUntil = time + 0.65;
          actor.speed = Math.max(actor.speed, (0.09 + power * 0.05) * falloff);
          actor.restUntil = 0;
          actor.restAt = time + 7 + actor.seed * 9;
          actor.vx += Math.cos(angle) * (0.1 + power * 0.15) * falloff;
          actor.vy += Math.sin(angle) * (0.1 + power * 0.15) * falloff;
        } else {
          actor.vx += Math.cos(angle) * (0.035 + power * 0.075) * falloff;
          actor.vy += Math.sin(angle) * (0.035 + power * 0.075) * falloff;
          actor.vz = Math.max(actor.vz, (0.1 + power * 0.22) * falloff);
          actor.spin +=
            (actor.seed > 0.5 ? 1 : -1) * (0.8 + power * 2.8) * falloff;
        }
      }
    }
  }

  function updateForest(
    actor: Actor,
    dt: number,
    time: number,
    frame: InteractionFrame,
  ) {
    const sprite = actor.sprite;
    // A gust travels across the floor coherently. Dry leaves have different
    // friction, so most lie still between gusts instead of all drifting forever.
    const mobility = 0.55 + actor.seed * 0.8;
    const gust = Math.pow(
      Math.max(0, Math.sin(time * 0.48 - sprite.x * 3.2 + sprite.y * 1.4)),
      3,
    );
    const windAngle = time * 0.18 + Math.sin(time * 0.17) * 0.3;
    const windForce = gust * breeze * 0.05 * mobility;
    const grounded = sprite.lift < 0.0005 && actor.vz <= 0;
    const moving = Math.hypot(actor.vx, actor.vy) > 0.0025;
    // Soft edge pressure and local separation prevent a swept pile becoming
    // permanently trapped at one corner. Leaves remain free to overlap lightly.
    actor.vx +=
      (Math.max(0, 0.18 - sprite.x) - Math.max(0, sprite.x - 0.82)) * 0.55 * dt;
    actor.vy +=
      (Math.max(0, 0.18 - sprite.y) - Math.max(0, sprite.y - 0.82)) *
      aspect *
      0.55 *
      dt;
    for (const other of actors) {
      if (other === actor) continue;
      const dx = sprite.x - other.sprite.x,
        dy = (sprite.y - other.sprite.y) * aspect;
      const d = Math.hypot(dx, dy),
        reach = (sprite.size + other.sprite.size) * 0.7;
      if (d >= reach) continue;
      const force = (1 - d / reach) * 0.12 * dt,
        angle = actor.seed * 31;
      actor.vx += (d > 0.0001 ? dx / d : Math.cos(angle)) * force;
      actor.vy += (d > 0.0001 ? dy / d : Math.sin(angle)) * force;
    }
    if (!grounded || moving || windForce > 0.012 + (1 - actor.seed) * 0.014) {
      actor.vx += Math.cos(windAngle) * windForce * dt;
      actor.vy += Math.sin(windAngle) * windForce * dt;
      actor.spin +=
        Math.sin(actor.seed * 24 + sprite.x * 4) * windForce * 4 * dt;
    }
    for (const presence of frame.presence) {
      if (presence.confidence < 0.15) continue;
      const offset = offsetFrom(
        actor,
        presence.center.x,
        presence.center.y,
        aspect,
      );
      const distance = Math.hypot(offset.x, offset.y);
      const radius = presence.radius + sprite.size * 0.65;
      if (distance >= radius) continue;
      const force = Math.pow(1 - distance / radius, 2) * presence.confidence;
      const angle =
        distance > 0.001 ? Math.atan2(offset.y, offset.x) : actor.seed * 6.28;
      actor.vx += Math.cos(angle) * force * 0.65 * dt;
      actor.vy += Math.sin(angle) * force * 0.65 * dt;
      actor.spin += Math.sin(actor.seed * 31) * force * 4 * dt;
    }
    for (const motion of frame.motion) {
      if (motion.confidence < 0.15 || motion.strength < 0.05) continue;
      const flow = motionHistory.get(motion.id);
      const offset = offsetFrom(
        actor,
        motion.position.x,
        motion.position.y,
        aspect,
      );
      const distance = Math.hypot(offset.x, offset.y),
        radius = motion.radius + 0.13;
      if (distance < radius) {
        const force = Math.pow(1 - distance / radius, 1.4) * motion.strength;
        const vx = flow?.vx ?? 0,
          vy = flow?.vy ?? 0;
        actor.vx +=
          ((offset.x / Math.max(0.015, distance)) * 0.1 + vx * 0.45) *
          force *
          dt;
        actor.vy +=
          ((offset.y / Math.max(0.015, distance)) * 0.1 + vy * 0.45) *
          force *
          dt;
        actor.spin += (vx * offset.y - vy * offset.x) * force * 22 * dt;
        // A passing hand rolls some leaves gently up into its wake.
        if (grounded && Math.hypot(vx, vy) > 0.22 && force > 0.35)
          actor.vz = Math.max(actor.vz, 0.045 * force * mobility);
      }
    }
    const drag = Math.exp(
      -(grounded ? 2.8 + (1 - actor.seed) * 1.2 : 0.85) * dt,
    );
    actor.vx = clamp(actor.vx * drag, -0.35, 0.35);
    actor.vy = clamp(actor.vy * drag, -0.35, 0.35);
    if (
      grounded &&
      Math.hypot(actor.vx, actor.vy) < 0.0009 &&
      windForce < 0.007
    ) {
      actor.vx = 0;
      actor.vy = 0;
    }
    sprite.x += actor.vx * dt;
    sprite.y += (actor.vy * dt) / aspect;
    actor.heading += actor.spin * dt;
    actor.spin *= Math.exp(-(grounded ? 4.2 : 1.0) * dt);
    if (sprite.lift > 0 || actor.vz > 0) {
      actor.vz -= 0.64 * dt;
      const height = sprite.lift + actor.vz * dt;
      sprite.lift = Math.max(0, height);
      if (height < 0)
        actor.vz = Math.abs(actor.vz) > 0.15 ? Math.abs(actor.vz) * 0.1 : 0;
    }
    actor.phase += dt * (4.5 + Math.hypot(actor.vx, actor.vy) * 20);
    sprite.angle = actor.heading + Math.sin(actor.phase) * sprite.lift * 1.5;
    // A maple leaf never uses the butterfly's bilateral wing hinge.
    sprite.flutter = 0;
    (sprite as Sprite & { bank?: number }).bank =
      Math.sin(actor.phase) * Math.min(0.55, sprite.lift * 12);
    contain(actor);
  }
  function contain(actor: Actor) {
    const sprite = actor.sprite;
    const marginX = sprite.size * 0.55 + 0.025,
      marginY = Math.min(0.3, marginX / aspect);
    if (sprite.x < marginX || sprite.x > 1 - marginX) actor.vx *= -0.35;
    if (sprite.y < marginY || sprite.y > 1 - marginY) actor.vy *= -0.35;
    sprite.x = clamp(sprite.x, marginX, 1 - marginX);
    sprite.y = clamp(sprite.y, marginY, 1 - marginY);
  }
  function updateMeadow(
    actor: Actor,
    dt: number,
    time: number,
    frame: InteractionFrame,
  ) {
    const sprite = actor.sprite;
    let escape = time < actor.escapeUntil;
    const preferred =
      actor.seed * Math.PI * 2 +
      time * (0.055 + actor.seed * 0.035) +
      Math.sin(time * 0.32 + actor.seed * 21) * 0.6;
    let fx = Math.cos(preferred),
      fy = Math.sin(preferred);
    for (const presence of frame.presence) {
      if (presence.confidence < 0.15) continue;
      const offset = offsetFrom(
        actor,
        presence.center.x,
        presence.center.y,
        aspect,
      );
      const distance = Math.hypot(offset.x, offset.y),
        radius = presence.radius + 0.13;
      if (distance >= radius) continue;
      const force = (1 - distance / radius) * presence.confidence;
      fx += (offset.x / Math.max(distance, 0.001)) * force * 7;
      fy += (offset.y / Math.max(distance, 0.001)) * force * 7;
      actor.escapeUntil = Math.max(actor.escapeUntil, time + 0.7);
      escape = true;
    }
    fx += actor.vx * 28;
    fy += actor.vy * 28;
    // Anticipate the edge before reaching it, with a broad return into the meadow.
    const aheadX = sprite.x + Math.cos(actor.heading) * 0.13;
    const aheadY = sprite.y + (Math.sin(actor.heading) * 0.13) / aspect;
    if (aheadX < 0.16) fx += (0.16 - aheadX) * 35;
    if (aheadX > 0.84) fx -= (aheadX - 0.84) * 35;
    if (aheadY < 0.16) fy += (0.16 - aheadY) * 35;
    if (aheadY > 0.84) fy -= (aheadY - 0.84) * 35;
    if (escape) {
      actor.restUntil = 0;
      actor.restAt = time + 6 + actor.seed * 8;
    } else if (time >= actor.restAt && actor.restUntil === 0)
      actor.restUntil = time + 1.6 + actor.seed * 1.8;
    if (actor.restUntil > 0 && time > actor.restUntil) {
      actor.restUntil = 0;
      actor.restAt = time + 9 + actor.seed * 15;
      actor.takeoffUntil = time + 0.65;
    }
    const resting = actor.restUntil > time;
    const target = Math.atan2(fy, fx);
    const maxYaw = escape ? 3.4 : 1.25;
    const yaw = resting
      ? 0
      : clamp(wrapAngle(target - actor.heading) * 2.4, -maxYaw, maxYaw);
    actor.turnRate += (yaw - actor.turnRate) * (1 - Math.exp(-5 * dt));
    actor.heading = wrapAngle(actor.heading + actor.turnRate * dt);
    const gliding =
      !resting &&
      !escape &&
      time > actor.takeoffUntil &&
      Math.sin(time * (1.15 + actor.seed * 0.35) + actor.seed * 19) < -0.55;
    const wingFrequency = resting
      ? 0.55
      : gliding
        ? 1.1
        : 5.1 + actor.seed * 1.8 + (escape ? 1.5 : 0);
    actor.phase += dt * Math.PI * 2 * wingFrequency;
    const beat = 0.5 + Math.sin(actor.phase) * 0.5;
    const targetSpeed = resting
      ? 0
      : (0.027 + actor.seed * 0.016 + breeze * 0.013) *
        (escape ? 2.3 : 1) *
        (gliding ? 1.03 : 0.94 + beat * 0.12);
    actor.speed +=
      (targetSpeed - actor.speed) * (1 - Math.exp(-(resting ? 5 : 3) * dt));
    // A tap adds a brief takeoff translation, distinct from presence steering.
    sprite.x += (Math.cos(actor.heading) * actor.speed + actor.vx) * dt;
    sprite.y +=
      ((Math.sin(actor.heading) * actor.speed + actor.vy) * dt) / aspect;
    actor.vx *= Math.exp(-4.8 * dt);
    actor.vy *= Math.exp(-4.8 * dt);
    const airborne = resting
      ? 0
      : 0.021 +
        actor.seed * 0.012 +
        (escape ? 0.014 : 0) +
        Math.max(0, actor.takeoffUntil - time) * 0.045 +
        Math.sin(time * 2.0 + actor.seed * 12) * 0.0035;
    sprite.lift += (airborne - sprite.lift) * (1 - Math.exp(-3.3 * dt));
    const targetFold = resting
      ? 0.05 + Math.sin(actor.phase) * 0.025
      : gliding
        ? 0.14
        : 0.06 + Math.pow(beat, 1.7) * 0.87;
    // Short blends into a glide/perch prevent a phase jump when behavior changes.
    const foldResponse = resting || gliding ? 9 : 48;
    actor.wingFold +=
      (targetFold - actor.wingFold) * (1 - Math.exp(-foldResponse * dt));
    sprite.flutter = actor.wingFold;
    sprite.angle = actor.heading + Math.PI / 2;
    (sprite as Sprite & { bank?: number }).bank = resting
      ? 0
      : clamp(-actor.turnRate * 0.24, -0.5, 0.5);
    contain(actor);
  }
  return {
    id,
    title,
    audio,
    configure,
    update(dt: number, time: number, frame: InteractionFrame) {
      if (disposed || settings.paused || settings.blank) return;
      elapsed = time;
      const step = clamp(dt, 0, 0.05);
      stage.react(frame, time);
      for (const motion of frame.motion) {
        const previous = motionHistory.get(motion.id);
        if (!previous || frame.timestamp > previous.time) {
          const sampleDt = previous
            ? clamp((frame.timestamp - previous.time) / 1000, 0.016, 0.15)
            : 0.05;
          const dx = previous ? (motion.position.x - previous.x) / sampleDt : 0;
          const dy = previous
            ? ((motion.position.y - previous.y) * aspect) / sampleDt
            : 0;
          motionHistory.set(motion.id, {
            x: motion.position.x,
            y: motion.position.y,
            time: frame.timestamp,
            vx: clamp((previous?.vx ?? 0) * 0.55 + dx * 0.45, -1.4, 1.4),
            vy: clamp((previous?.vy ?? 0) * 0.55 + dy * 0.45, -1.4, 1.4),
          });
        }
      }
      for (const [id, sample] of motionHistory)
        if (frame.timestamp - sample.time > 500) motionHistory.delete(id);
      reactToImpulses(frame, time);
      for (const actor of actors)
        if (meadow) updateMeadow(actor, step, time, frame);
        else updateForest(actor, step, time, frame);
    },
    render(time) {
      if (!disposed) stage.render(time);
    },
    diagnostics() {
      return {
        ...stage.diagnostics(),
        actors: actors.length,
        responses,
        positions: actors.map((a) => ({
          x: a.sprite.x,
          y: a.sprite.y,
          lift: a.sprite.lift,
          angle: a.sprite.angle,
          flutter: a.sprite.flutter,
          speed: meadow ? a.speed : Math.hypot(a.vx, a.vy),
          resting: meadow && a.restUntil > elapsed,
          turnRate: a.turnRate,
          bank: (a.sprite as Sprite & { bank?: number }).bank ?? 0,
        })),
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      seen.clear();
      motionHistory.clear();
      actors.length = 0;
      audio.dispose();
      stage.dispose();
    },
  };
}
export const createForestActivity = (context: ActivityContext): Activity =>
  makeNatureActivity(context, false);
export const createMeadowActivity = (context: ActivityContext): Activity =>
  makeNatureActivity(context, true);
