import type { Activity, ActivityContext } from "./types";

export interface SceneControl {
  key: string;
  label: string;
  min: number;
  max: number;
  step?: number;
  defaultValue: number;
  format?: (value: number) => string;
}
export type ActivityFactory = (context: ActivityContext) => Activity;
export interface SceneDefinition {
  id: string;
  title: string;
  description: string;
  thumbnail?: string;
  pointerHint: string;
  supportsAudio: boolean;
  controls: readonly SceneControl[];
  load: () => Promise<ActivityFactory>;
}

/** Each installed scene supplies its own presentation, controls, assets and sound. */
export const activities: readonly SceneDefinition[] = [
  {
    id: "koi-pond",
    title: "Koi pond",
    description: "Clear water. Curious koi.",
    thumbnail: "assets/pond-bed.png",
    pointerHint: "Move to stir. Click to splash.",
    supportsAudio: true,
    controls: [
      { key: "fishCount", label: "Koi", min: 2, max: 20, defaultValue: 8 },
      {
        key: "fishSpeed",
        label: "Swimming pace",
        min: 0.3,
        max: 1.5,
        step: 0.05,
        defaultValue: 0.8,
        format: (value) =>
          value < 0.7 ? "Gentle" : value > 1.1 ? "Lively" : "Natural",
      },
    ],
    async load() {
      const { createKoiActivity } = await import("./activities/koi");
      return createKoiActivity;
    },
  },
  {
    id: "forest-floor",
    title: "Forest floor",
    description: "Rustling leaves. Sunlit moss.",
    thumbnail: "assets/scenes/forest-floor.png",
    pointerHint: "Move to rustle leaves. Tap to send them tumbling.",
    supportsAudio: true,
    controls: [
      { key: "leafCount", label: "Leaves", min: 12, max: 48, defaultValue: 28 },
      {
        key: "breeze",
        label: "Forest breeze",
        min: 0,
        max: 1,
        step: 0.05,
        defaultValue: 0.35,
      },
    ],
    async load() {
      return (await import("./activities/forest-meadow")).createForestActivity;
    },
  },
  {
    id: "tide-pool",
    title: "Tide pool",
    description: "Clear shallows. Curious shore crabs.",
    thumbnail: "assets/scenes/tide-pool.png",
    pointerHint: "Move to chase crabs. Tap to ripple the shallows.",
    supportsAudio: true,
    controls: [
      {
        key: "crabCount",
        label: "Shore crabs",
        min: 2,
        max: 12,
        defaultValue: 6,
      },
      {
        key: "waterMotion",
        label: "Water movement",
        min: 0,
        max: 1,
        step: 0.05,
        defaultValue: 0.45,
      },
    ],
    async load() {
      return (await import("./activities/shore-activities"))
        .createTidePoolActivity;
    },
  },
  {
    id: "butterfly-meadow",
    title: "Butterfly meadow",
    description: "Soft grass. Fluttering wings.",
    thumbnail: "assets/scenes/butterfly-meadow.png",
    pointerHint: "Move to lift butterflies. Tap to send them fluttering.",
    supportsAudio: true,
    controls: [
      {
        key: "butterflyCount",
        label: "Butterflies",
        min: 4,
        max: 16,
        defaultValue: 9,
      },
      {
        key: "breeze",
        label: "Meadow breeze",
        min: 0,
        max: 1,
        step: 0.05,
        defaultValue: 0.35,
      },
    ],
    async load() {
      return (await import("./activities/forest-meadow")).createMeadowActivity;
    },
  },
  {
    id: "sandy-beach",
    title: "Sandy beach",
    description: "Warm sand. A gentle incoming tide.",
    thumbnail: "assets/scenes/sandy-beach.png",
    pointerHint: "Move to draw in the sand. Tap to leave a deeper mark.",
    supportsAudio: true,
    controls: [
      {
        key: "crabCount",
        label: "Shore crabs",
        min: 2,
        max: 8,
        defaultValue: 4,
      },
      {
        key: "trailDuration",
        label: "Sand trail duration",
        min: 2,
        max: 12,
        defaultValue: 7,
        format: (value) => `${value}s`,
      },
      {
        key: "waveMotion",
        label: "Wave movement",
        min: 0,
        max: 1,
        step: 0.05,
        defaultValue: 0.45,
      },
    ],
    async load() {
      return (await import("./activities/shore-activities"))
        .createBeachActivity;
    },
  },
  {
    id: "starlit-cosmos",
    title: "Starlit cosmos",
    description: "Luminous nebulae. Worlds within reach.",
    thumbnail: "assets/scenes/astronomy-nebula.png",
    pointerHint: "Move to part the stars. Tap to send a shooting star.",
    supportsAudio: true,
    controls: [
      {
        key: "starCount",
        label: "Stars",
        min: 80,
        max: 360,
        step: 20,
        defaultValue: 200,
      },
      {
        key: "drift",
        label: "Celestial drift",
        min: 0,
        max: 1,
        step: 0.05,
        defaultValue: 0.35,
        format: (value) =>
          value < 0.3 ? "Still" : value > 0.7 ? "Drifting" : "Gentle",
      },
      {
        key: "starlight",
        label: "Starlight",
        min: 0.3,
        max: 1,
        step: 0.05,
        defaultValue: 0.8,
        format: (value) => `${Math.round(value * 100)}%`,
      },
    ],
    async load() {
      return (await import("./activities/astronomy")).createAstronomyActivity;
    },
  },
];
export async function loadActivity(
  id: string,
  context: ActivityContext,
): Promise<Activity> {
  const scene = activities.find((scene) => scene.id === id);
  if (!scene) throw new Error(`Unknown activity: ${id}`);
  if (context.isCurrent && !context.isCurrent())
    throw new Error("Scene load was superseded.");
  const factory = await scene.load();
  if (context.isCurrent && !context.isCurrent())
    throw new Error("Scene load was superseded.");
  return factory(context);
}
