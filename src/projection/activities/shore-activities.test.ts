import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../storage";
import {
  emptyFrame,
  type Activity,
  type InteractionFrame,
  type ProjectionSettings,
} from "../types";

const mocks = vi.hoisted(() => ({ stages: [] as any[], audios: [] as any[] }));
vi.mock("./nature-stage", () => ({
  NatureStage: class {
    sprites: any[] = [];
    configure = vi.fn();
    react = vi.fn();
    render = vi.fn();
    dispose = vi.fn();
    diagnostics = () => ({ activeMarks: 3 });
    addSprite = vi.fn((_asset: string, values: any) => {
      const sprite = { ...values };
      this.sprites.push(sprite);
      return sprite;
    });
    removeSprite = vi.fn((sprite: any) => {
      this.sprites.splice(this.sprites.indexOf(sprite), 1);
    });
    constructor(
      public context: any,
      public options: any,
    ) {
      mocks.stages.push(this);
    }
  },
}));
vi.mock("./scene-audio", () => ({
  createSceneAudio: (id: string) => {
    const audio = {
      id,
      unlock: vi.fn(),
      configure: vi.fn(),
      impulse: vi.fn(),
      dispose: vi.fn(),
    };
    mocks.audios.push(audio);
    return audio;
  },
}));
import {
  createBeachActivity,
  createTidePoolActivity,
} from "./shore-activities";
const settings = (): ProjectionSettings => structuredClone(DEFAULT_SETTINGS);
const context = (config = settings()) => ({
  canvas: {} as HTMLCanvasElement,
  settings: config,
});
const positions = (activity: Activity) =>
  activity.diagnostics().positions as {
    x: number;
    y: number;
    speed: number;
    fleeing: boolean;
  }[];
const tick = (
  activity: Activity,
  seconds: number,
  frame: InteractionFrame = emptyFrame(),
) => {
  for (let i = 1; i <= seconds * 60; i++)
    activity.update(1 / 60, i / 60, frame);
};
beforeEach(() => {
  mocks.stages.length = 0;
  mocks.audios.length = 0;
});

describe("shore activities", () => {
  it("keeps escape scuttling gentle while retaining a clear local hand response", () => {
    const tide = createTidePoolActivity(context()),
      start = positions(tide)[0];
    const frame = {
      ...emptyFrame(),
      presence: [
        {
          id: "hand",
          center: { x: start.x - 0.025, y: start.y },
          radius: 0.08,
          confidence: 1,
        },
      ],
    };
    tick(tide, 0.5, frame);
    const current = positions(tide)[0];
    expect(current.x - start.x).toBeGreaterThan(0.025);
    for (const crab of positions(tide))
      expect(crab.speed).toBeLessThanOrEqual(0.0751);
    tide.dispose();
  });
  it("separates crabs after a sustained hand drives them toward the same edges", () => {
    const tide = createTidePoolActivity(context());
    let pressured: ReturnType<typeof positions> = [];
    for (let i = 0; i < 5400; i++) {
      const frame =
        i < 1800
          ? {
              ...emptyFrame(i * 17),
              presence: [
                {
                  id: "body",
                  center: { x: 0.5, y: 0.5 },
                  radius: 0.4,
                  confidence: 1,
                },
              ],
            }
          : emptyFrame(i * 17);
      tide.update(1 / 60, i / 60, frame);
      if (i === 1799) pressured = positions(tide);
    }
    for (const crabs of [pressured, positions(tide)])
      for (let i = 0; i < crabs.length; i++)
        for (let j = i + 1; j < crabs.length; j++)
          expect(
            Math.hypot(
              crabs[i].x - crabs[j].x,
              ((crabs[i].y - crabs[j].y) * 2) / 3,
            ),
          ).toBeGreaterThan(0.085);
    tide.dispose();
  });
  it("gives each activity a distinct stage, art, audio, and independently configured preferences", () => {
    const config = settings();
    config.activitySettings["sandy-beach"] = {
      trailDuration: 9,
      waveMotion: 0.7,
    };
    const tide = createTidePoolActivity(context(config));
    const beach = createBeachActivity(context(config));
    expect(mocks.stages.map((stage) => stage.options)).toEqual([
      {
        id: "tide-pool",
        title: "Tide pool",
        mode: "tide",
        background: "assets/scenes/tide-pool.png",
      },
      {
        id: "sandy-beach",
        title: "Sandy beach",
        mode: "beach",
        background: "assets/scenes/sandy-beach.png",
      },
    ]);
    expect(mocks.audios.map((audio) => audio.id)).toEqual([
      "tide-pool",
      "sandy-beach",
    ]);
    expect(tide.diagnostics().crabCount).toBe(6);
    expect(beach.diagnostics().crabCount).toBe(4);
    expect(mocks.stages[1].configure).toHaveBeenLastCalledWith(config);
    expect(
      positions(beach).every(
        (position) => position.x < 0.2 || position.x > 0.8,
      ),
    ).toBe(true);
  });
  it("bounds crab count and removes surplus sprites when tide preferences change", () => {
    const config = settings();
    config.activitySettings["tide-pool"] = { crabCount: 500 };
    const tide = createTidePoolActivity(context(config));
    expect(positions(tide)).toHaveLength(12);
    config.activitySettings["tide-pool"].crabCount = -10;
    tide.configure(config);
    expect(positions(tide)).toHaveLength(2);
    expect(mocks.stages[0].removeSprite).toHaveBeenCalledTimes(10);
    expect(mocks.stages[0].sprites).toHaveLength(2);
  });
  it("scuttles away from a nearby hand, rather than only animating an idle background", () => {
    const tide = createTidePoolActivity(context());
    const initial = positions(tide)[0];
    const hand = { x: initial.x - 0.025, y: initial.y };
    const frame = {
      ...emptyFrame(),
      presence: [{ id: "hand", center: hand, radius: 0.08, confidence: 1 }],
    };
    tick(tide, 0.5, frame);
    const moved = positions(tide)[0];
    expect(moved.x).toBeGreaterThan(initial.x + 0.025);
    expect(moved.fleeing).toBe(true);
    expect(tide.diagnostics().scuttleCount).toBeGreaterThan(0);
    expect(mocks.stages[0].react).toHaveBeenCalledWith(frame, 0.5);
  });
  it("reacts to a slap once and lets the escape expire if the same input frame is replayed", () => {
    const tide = createTidePoolActivity(context());
    const initial = positions(tide)[0];
    const frame = {
      ...emptyFrame(),
      impulses: [
        {
          id: "slap",
          position: initial,
          strength: 1,
          confidence: 1,
          timestamp: 0,
        },
      ],
    };
    tide.update(1 / 60, 0, frame);
    expect(positions(tide).some((position) => position.fleeing)).toBe(true);
    tick(tide, 3, frame);
    expect(positions(tide).some((position) => position.fleeing)).toBe(false);
  });
  it("keeps long-running wildlife finite and within the playable bounds for a tall floor", () => {
    const config = settings();
    config.floorHeight = 2;
    config.floorWidth = 1;
    const tide = createTidePoolActivity(context(config));
    const frame = {
      ...emptyFrame(),
      presence: [
        { id: "body", center: { x: 0.5, y: 0.5 }, radius: 0.4, confidence: 1 },
      ],
    };
    tick(tide, 120, frame);
    for (const position of positions(tide)) {
      expect(Number.isFinite(position.speed)).toBe(true);
      expect(position.x).toBeGreaterThanOrEqual(0.1);
      expect(position.x).toBeLessThanOrEqual(0.9);
      expect(position.y).toBeGreaterThanOrEqual(0.14);
      expect(position.y).toBeLessThanOrEqual(0.86);
    }
  });
  it("routes sand drawing input to persistent shared-stage marks and suspends it while paused or blank", () => {
    const config = settings();
    const beach = createBeachActivity(context(config));
    const frame = {
      ...emptyFrame(),
      motion: [
        {
          id: "finger",
          position: { x: 0.4, y: 0.5 },
          radius: 0.02,
          strength: 0.7,
          confidence: 1,
        },
      ],
    };
    beach.update(1 / 60, 1, frame);
    expect(mocks.stages[0].react).toHaveBeenCalledTimes(1);
    expect(beach.diagnostics().activeMarks).toBe(3);
    const before = positions(beach);
    config.paused = true;
    beach.configure(config);
    beach.update(1, 2, frame);
    expect(positions(beach)).toEqual(before);
    config.paused = false;
    config.blank = true;
    beach.configure(config);
    beach.update(1, 3, frame);
    expect(mocks.stages[0].react).toHaveBeenCalledTimes(1);
  });
  it("disposes owned stage/audio exactly once and ignores subsequent lifecycle calls", () => {
    const tide = createTidePoolActivity(context());
    const stage = mocks.stages[0];
    tide.dispose();
    tide.dispose();
    tide.update(0.1, 1, emptyFrame());
    tide.render(1);
    tide.configure(settings());
    expect(stage.dispose).toHaveBeenCalledTimes(1);
    expect(mocks.audios[0].dispose).toHaveBeenCalledTimes(1);
    expect(stage.sprites).toHaveLength(0);
    expect(stage.render).not.toHaveBeenCalled();
    expect(stage.react).not.toHaveBeenCalled();
    expect(stage.configure).toHaveBeenCalledTimes(1);
  });
});
