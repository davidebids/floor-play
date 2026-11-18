import { KoiAudio } from "./koi-audio";
import { CANVAS_WIDTH, CANVAS_HEIGHT, setCanvasSize } from "../../config";
import { FishRenderer } from "../../fish-renderer";
import { School } from "../../school";
import { SwimState } from "../../koi";
import { seedFishInsideWater, surfaceWaterClearance } from "./pond-boundary";
import { settings as visualSettings } from "../../settings/store";
import { clamp } from "../../math";
import type {
  Activity,
  ActivityContext,
  InteractionFrame,
  ProjectionSettings,
} from "../types";

/** A pond is an activity consumer; no camera, UI, or projector ownership lives here. */
export function createKoiActivity(context: ActivityContext): Activity {
  let config = context.settings;
  const audio = new KoiAudio();
  const logicalWidth = 960;
  const logicalHeight = Math.round(
    (logicalWidth * config.floorHeight) / config.floorWidth,
  );
  setCanvasSize(logicalWidth, Math.min(1280, Math.max(360, logicalHeight)));
  // Clear daylight pond: keep the material/color system distinct from app preferences.
  visualSettings.setWeather("sunny");
  visualSettings.set(["water", "clarity"], 0.82);
  visualSettings.set(["ripples", "types", "touch", "intervalSeconds"], 0.11);
  visualSettings.set(["water", "largeCurrentOpacity"], 0.09);
  visualSettings.set(["water", "secondaryLargeCurrentOpacity"], 0.16);
  visualSettings.set(["water", "detailCurrentOpacity"], 0.2);
  visualSettings.set(["koi", "tinyEvery"], 12);
  visualSettings.set(["lotus", "visibleLeafCount"], 0);
  visualSettings.set(["lotus", "visibleFlowerCount"], 0);
  visualSettings.set(["lotus", "radiusScale"], 1.6);
  visualSettings.set(["duckweed", "visiblePatchCount"], 0);
  visualSettings.set(["butterflies", "visibleCount"], 0);
  visualSettings.set(["tiny-fish", "visibleSchoolCount"], 0);
  const school = new School();
  school.containToWater = true;
  const baseSpeeds = school.fish.map((f) => ({
    cruise: f.cruiseSpeed * 1.8,
    maximum: f.maximumSpeed * 1.8,
  }));
  const startingLocations = [
    [0.31, 0.35],
    [0.52, 0.29],
    [0.69, 0.47],
    [0.46, 0.65],
    [0.3, 0.62],
    [0.65, 0.68],
    [0.52, 0.47],
    [0.73, 0.31],
  ];
  for (const [index, f] of school.fish.entries()) {
    f.bodyLength *= 2.15;
    f.bodyWidth *= 2.15;
    const start = startingLocations[index % startingLocations.length];
    f.position.x = CANVAS_WIDTH * start[0];
    f.position.y = CANVAS_HEIGHT * start[1];
    for (let i = 0; i < f.spine.length; i++) {
      f.spine[i] = {
        x:
          f.position.x -
          (Math.cos(f.heading) * f.bodyLength * i) / (f.spine.length - 1),
        y:
          f.position.y -
          (Math.sin(f.heading) * f.bodyLength * i) / (f.spine.length - 1),
      };
      f.renderSpine[i] = { ...f.spine[i] };
    }
    seedFishInsideWater(f, CANVAS_WIDTH, CANVAS_HEIGHT);
  }
  const renderer = new FishRenderer(context.canvas);
  let disposed = false,
    splashCount = 0,
    dryActions = 0,
    rippleCount = 0;
  const seen = new Map<string, number>();
  const motionTimes = new Map<string, number>();
  const recentBursts: {
    x: number;
    y: number;
    radius: number;
    strength: number;
    until: number;
  }[] = [];
  function configure(next: ProjectionSettings) {
    config = next;
    school.setCount(next.fishCount);
    school.fish.forEach((f, i) => {
      f.cruiseSpeed = baseSpeeds[i].cruise * next.fishSpeed;
      f.maximumSpeed = baseSpeeds[i].maximum * next.fishSpeed;
    });
    const height = Math.min(
      1280,
      Math.max(
        360,
        Math.round((logicalWidth * next.floorHeight) / next.floorWidth),
      ),
    );
    if (height !== CANVAS_HEIGHT) {
      const oldW = CANVAS_WIDTH,
        oldH = CANVAS_HEIGHT;
      setCanvasSize(logicalWidth, height);
      school.resize(logicalWidth / oldW, height / oldH);
      renderer.resize(logicalWidth, height, oldW, oldH);
    }
  }
  configure(config);
  function update(dt: number, time: number, frame: InteractionFrame) {
    if (disposed || config.paused || config.blank) return;
    const accepted: InteractionFrame["impulses"] = [];
    const now = frame.timestamp;
    school.avoidanceRegions = frame.presence
      .filter((p) => p.confidence > 0.15)
      .map((p) => ({
        x: p.center.x * CANVAS_WIDTH,
        y: p.center.y * CANVAS_HEIGHT,
        radius: p.radius * CANVAS_WIDTH,
        strength: p.confidence,
      }));
    for (const burst of recentBursts)
      if (burst.until > time) school.avoidanceRegions.push(burst);
    while (recentBursts.length && recentBursts[0].until <= time)
      recentBursts.shift();
    for (const impulse of frame.impulses) {
      if (seen.has(impulse.id) || impulse.confidence < 0.15) continue;
      seen.set(impulse.id, now);
      if (seen.size > 256) seen.delete(seen.keys().next().value!);
      const x = impulse.position.x * CANVAS_WIDTH,
        y = impulse.position.y * CANVAS_HEIGHT;
      if (
        surfaceWaterClearance({ x, y }, CANVAS_WIDTH, CANVAS_HEIGHT).distance <=
        0
      ) {
        dryActions++;
        continue;
      }
      const power = clamp(impulse.strength, 0.15, 1);
      school.ripples.trigger("touch", { x, y }, 0.7 + power * 0.8);
      renderer.splash(x, y, power);
      recentBursts.push({
        x,
        y,
        radius: 80 + power * 80,
        strength: 0.8 + power,
        until: time + 0.6,
      });
      for (const fish of school.fish.slice(0, school.count))
        if (Math.hypot(fish.position.x - x, fish.position.y - y) < 150) {
          fish.state = SwimState.Burst;
          fish.stateAge = 0;
          fish.stateDuration = 0.5;
        }
      splashCount++;
      accepted.push(impulse);
    }
    for (const motion of frame.motion) {
      if (
        motion.confidence < 0.15 ||
        motion.strength < 0.04 ||
        now - (motionTimes.get(motion.id) ?? -Infinity) < 130
      )
        continue;
      motionTimes.set(motion.id, now);
      if (
        surfaceWaterClearance(
          {
            x: motion.position.x * CANVAS_WIDTH,
            y: motion.position.y * CANVAS_HEIGHT,
          },
          CANVAS_WIDTH,
          CANVAS_HEIGHT,
        ).distance <= 0
      )
        continue;
      school.ripples.trigger(
        "mouth",
        {
          x: motion.position.x * CANVAS_WIDTH,
          y: motion.position.y * CANVAS_HEIGHT,
        },
        clamp(motion.strength, 0.1, 0.55),
      );
      rippleCount++;
    }
    school.update(Math.min(dt, 0.05), time);
    return accepted;
  }
  return {
    audio,
    id: "koi-pond",
    title: "Koi Pond",
    configure,
    update,
    render(time) {
      if (!disposed) renderer.draw(school, time, false);
    },
    diagnostics() {
      return {
        ...renderer.diagnostics(),
        fish: school.count,
        splashCount,
        dryActions,
        rippleCount,
        boundaryCorrections: school.boundaryCorrections,
        positions: school.fish.slice(0, school.count).map((f) => ({
          x: f.position.x / CANVAS_WIDTH,
          y: f.position.y / CANVAS_HEIGHT,
          heading: f.heading,
          speed: f.speed,
          angularVelocity: f.angularVelocity,
          state: SwimState[f.state],
          tailEffort: f.tailEffort,
          phase: f.swimPhase,
          bodyLength: f.bodyLength,
          velocity: { ...f.velocity },
        })),
        logicalWidth: CANVAS_WIDTH,
        logicalHeight: CANVAS_HEIGHT,
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      school.avoidanceRegions = [];
      renderer.dispose();
      audio.dispose();
      seen.clear();
      motionTimes.clear();
      recentBursts.length = 0;
    },
  };
}
