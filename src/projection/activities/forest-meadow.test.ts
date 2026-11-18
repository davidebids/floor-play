import { describe, expect, it, vi } from "vitest";
import type { Activity, InteractionFrame } from "../types";
import { emptyFrame } from "../types";
import { DEFAULT_SETTINGS } from "../storage";

const resources = vi.hoisted(() => ({
  stages: [] as { dispose: ReturnType<typeof vi.fn> }[],
  audio: [] as { dispose: ReturnType<typeof vi.fn> }[],
}));
vi.mock("./nature-stage", () => ({
  NatureStage: class {
    sprites: Record<string, number>[] = [];
    dispose = vi.fn(() => {
      this.sprites.length = 0;
    });
    constructor() {
      resources.stages.push(this);
    }
    addSprite(_asset: string, options: Record<string, number>) {
      const sprite = { ...options };
      this.sprites.push(sprite);
      return sprite;
    }
    removeSprite(sprite: Record<string, number>) {
      this.sprites.splice(this.sprites.indexOf(sprite), 1);
    }
    configure() {}
    react() {}
    render() {}
    diagnostics() {
      return { assetsLoaded: true };
    }
  },
}));
vi.mock("./scene-audio", () => ({
  createSceneAudio: () => {
    const audio = {
      unlock: vi.fn(),
      configure: vi.fn(),
      impulse: vi.fn(),
      dispose: vi.fn(),
    };
    resources.audio.push(audio);
    return audio;
  },
}));
import { createForestActivity, createMeadowActivity } from "./forest-meadow";
const settings = () => structuredClone(DEFAULT_SETTINGS);
const build = (meadow = false) =>
  (meadow ? createMeadowActivity : createForestActivity)({
    canvas: {} as HTMLCanvasElement,
    settings: settings(),
  });
interface Position {
  x: number;
  y: number;
  lift: number;
  speed: number;
  flutter: number;
  angle: number;
}
const positions = (activity: Activity) =>
  activity.diagnostics().positions as Position[];
function strike(
  id: string,
  x: number,
  y: number,
  strength = 1,
): InteractionFrame {
  return {
    ...emptyFrame(1000),
    impulses: [
      { id, position: { x, y }, strength, confidence: 1, timestamp: 1000 },
    ],
  };
}

describe("forest and meadow interaction behaviors", () => {
  it("distinguishes a butterfly tap from the hand's already-active sweeping escape", () => {
    const swept = build(true),
      tapped = build(true),
      start = positions(tapped)[0];
    for (let i = 0; i < 12; i++) {
      const presence = [
        {
          id: "hand",
          center: { x: start.x - 0.03, y: start.y },
          radius: 0.08,
          confidence: 1,
        },
      ];
      const ordinary = { ...emptyFrame(i * 17 + 1000), presence };
      swept.update(1 / 60, i / 60, ordinary);
      tapped.update(
        1 / 60,
        i / 60,
        i === 0
          ? { ...strike("tap", start.x - 0.03, start.y, 0.8), presence }
          : ordinary,
      );
    }
    const a = positions(swept)[0],
      b = positions(tapped)[0];
    expect(Math.hypot(a.x - b.x, ((a.y - b.y) * 2) / 3)).toBeGreaterThan(0.025);
    swept.dispose();
    tapped.dispose();
  });
  it("lets a broad sweep disperse leaves without permanently trapping the whole scene at the border", () => {
    const forest = build();
    for (let i = 0; i < 4200; i++) {
      const frame =
        i < 600
          ? {
              ...emptyFrame(i * 17),
              presence: [
                {
                  id: "body",
                  center: { x: 0.5, y: 0.5 },
                  radius: 0.7,
                  confidence: 1,
                },
              ],
            }
          : emptyFrame(i * 17);
      forest.update(1 / 60, i / 60, frame);
    }
    const inside = positions(forest).filter(
      (p) => p.x > 0.14 && p.x < 0.86 && p.y > 0.14 && p.y < 0.86,
    );
    expect(inside.length).toBeGreaterThanOrEqual(10);
    forest.dispose();
  });
  it("gives a moderate leaf tap a distinct airborne tumble", () => {
    const forest = build(),
      leaf = positions(forest)[0];
    const frame = strike("tap", leaf.x + 0.08, leaf.y, 0.5);
    let peak = 0;
    for (let i = 0; i < 30; i++) {
      forest.update(1 / 60, i / 60, i === 0 ? frame : emptyFrame(i * 17));
      peak = Math.max(peak, positions(forest)[0].lift);
    }
    expect(peak).toBeGreaterThan(0.012);
    const landed = positions(forest)[0];
    expect(
      Math.hypot(landed.x - leaf.x, ((landed.y - leaf.y) * 2) / 3),
    ).toBeLessThan(0.045);
    forest.dispose();
  });
  it("reads independent scene preferences and bounds actor counts", () => {
    const config = settings();
    config.activitySettings = {
      "forest-floor": { leafCount: 100, breeze: 1 },
      "butterfly-meadow": { butterflyCount: 4, breeze: 0 },
    };
    const forest = createForestActivity({
      canvas: {} as HTMLCanvasElement,
      settings: config,
    });
    const meadow = createMeadowActivity({
      canvas: {} as HTMLCanvasElement,
      settings: config,
    });
    expect(forest.diagnostics().actors).toBe(48);
    expect(meadow.diagnostics().actors).toBe(4);
    const next = structuredClone(config);
    next.activitySettings["forest-floor"].leafCount = 12;
    forest.configure(next);
    expect(forest.diagnostics().actors).toBe(12);
    expect(meadow.diagnostics().actors).toBe(4);
    forest.dispose();
    meadow.dispose();
  });
  it("lifts nearby leaves once per strike and lets them settle", () => {
    const forest = build();
    const leaf = positions(forest)[0];
    const frame = strike("tap", leaf.x, leaf.y);
    forest.update(1 / 60, 0, frame);
    expect(positions(forest)[0].lift).toBeGreaterThan(0);
    const responses = forest.diagnostics().responses;
    forest.update(0, 0.01, frame);
    expect(forest.diagnostics().responses).toBe(responses);
    for (let i = 1; i < 180; i++)
      forest.update(1 / 60, i / 60, emptyFrame(i * 17 + 1000));
    expect(positions(forest)[0].lift).toBe(0);
    expect(positions(forest)[0].speed).toBeLessThan(0.01);
    forest.dispose();
  });
  it("makes a nearby butterfly escape without globally accelerating the meadow", () => {
    const baseline = build(true),
      reactive = build(true);
    const target = positions(reactive)[0];
    const frame = strike("burst", target.x, target.y);
    baseline.update(1 / 60, 0, emptyFrame(1000));
    reactive.update(1 / 60, 0, frame);
    for (let i = 1; i < 30; i++) {
      baseline.update(1 / 60, i / 60, emptyFrame(1000 + i * 17));
      reactive.update(1 / 60, i / 60, emptyFrame(1000 + i * 17));
    }
    expect(positions(reactive)[0].speed).toBeGreaterThan(
      positions(baseline)[0].speed * 1.5,
    );
    const distant = positions(baseline).findIndex(
      (p) => Math.hypot(p.x - target.x, ((p.y - target.y) * 2) / 3) > 0.35,
    );
    expect(distant).toBeGreaterThanOrEqual(0);
    expect(positions(reactive)[distant].speed).toBeCloseTo(
      positions(baseline)[distant].speed,
      8,
    );
    baseline.dispose();
    reactive.dispose();
  });
  for (const meadow of [false, true])
    for (const floorHeight of [0.5, 1.2192, 2.6])
      it(`${meadow ? "butterflies" : "leaves"} remain finite and inside changing floor aspects`, () => {
        const config = settings();
        config.floorHeight = floorHeight;
        config.activitySettings[meadow ? "butterfly-meadow" : "forest-floor"] =
          meadow
            ? { butterflyCount: 16, breeze: 1 }
            : { leafCount: 48, breeze: 1 };
        const activity = (meadow ? createMeadowActivity : createForestActivity)(
          { canvas: {} as HTMLCanvasElement, settings: config },
        );
        for (let i = 0; i < 3600; i++) {
          const frame =
            i % 90 === 0
              ? strike(
                  `tap-${i}`,
                  0.1 + ((i * 0.618) % 1) * 0.8,
                  0.15 + ((i * 0.414) % 1) * 0.7,
                )
              : emptyFrame(i * 17);
          activity.update(i % 180 === 179 ? 0.2 : 1 / 60, i / 60, frame);
          if (i % 120 === 0)
            for (const p of positions(activity)) {
              expect(
                Number.isFinite(p.x + p.y + p.angle + p.lift + p.flutter),
              ).toBe(true);
              expect(p.x).toBeGreaterThan(0);
              expect(p.x).toBeLessThan(1);
              expect(p.y).toBeGreaterThan(0);
              expect(p.y).toBeLessThan(1);
              expect(p.lift).toBeGreaterThanOrEqual(0);
              expect(p.flutter).toBeGreaterThanOrEqual(0);
              expect(p.flutter).toBeLessThanOrEqual(1);
            }
        }
        activity.dispose();
      });
  it("pushes leaves locally with continuous presence rather than needing a strike", () => {
    const baseline = build(),
      reactive = build();
    const target = positions(reactive)[0];
    const center = { x: target.x + 0.035, y: target.y };
    for (let i = 0; i < 120; i++) {
      const frame = {
        ...emptyFrame(i * 17),
        presence: [{ id: "hand", center, radius: 0.09, confidence: 1 }],
      };
      baseline.update(1 / 60, i / 60, emptyFrame(i * 17));
      reactive.update(1 / 60, i / 60, frame);
    }
    expect(positions(reactive)[0].x).toBeLessThan(
      positions(baseline)[0].x - 0.02,
    );
    const distant = positions(baseline).findIndex(
      (p) => Math.hypot(p.x - center.x, ((p.y - center.y) * 2) / 3) > 0.3,
    );
    expect(distant).toBeGreaterThanOrEqual(0);
    expect(positions(reactive)[distant].x).toBeCloseTo(
      positions(baseline)[distant].x,
      8,
    );
    expect(reactive.diagnostics().responses).toBe(0);
    baseline.dispose();
    reactive.dispose();
  });
  it("moves leaves with a directional hand wake while preserving their silhouettes", () => {
    const baseline = build(),
      flowing = build();
    const leaf = positions(flowing)[0];
    for (let i = 0; i < 80; i++) {
      const frame = {
        ...emptyFrame(1000 + i * 17),
        motion: [
          {
            id: "sweep",
            position: { x: leaf.x - 0.11 + i * 0.0025, y: leaf.y },
            radius: 0.055,
            strength: 1,
            confidence: 1,
          },
        ],
      };
      baseline.update(1 / 60, i / 60, emptyFrame(1000 + i * 17));
      flowing.update(1 / 60, i / 60, frame);
    }
    expect(positions(flowing)[0].x).toBeGreaterThan(
      positions(baseline)[0].x + 0.008,
    );
    for (const p of positions(flowing)) expect(p.flutter).toBe(0);
    baseline.dispose();
    flowing.dispose();
  });
  it("uses varied leaf friction so breeze does not move every leaf in unison", () => {
    const forest = build();
    const initial = positions(forest);
    for (let i = 0; i < 900; i++)
      forest.update(1 / 60, i / 60, emptyFrame(i * 17));
    const travel = positions(forest).map((p, i) =>
      Math.hypot(p.x - initial[i].x, ((p.y - initial[i].y) * 2) / 3),
    );
    expect(Math.max(...travel)).toBeGreaterThan(0.012);
    expect(Math.min(...travel)).toBeLessThan(0.005);
    forest.dispose();
  });
  it("keeps butterfly turns smooth and lets landed butterflies hold their heading", () => {
    const meadow = build(true);
    let previous = positions(meadow);
    const restTime = new Array(previous.length).fill(0);
    let checkedRest = 0;
    for (let i = 0; i < 1800; i++) {
      meadow.update(1 / 60, i / 60, emptyFrame(i * 17));
      const current = positions(meadow);
      for (let j = 0; j < current.length; j++) {
        const delta = Math.atan2(
          Math.sin(current[j].angle - previous[j].angle),
          Math.cos(current[j].angle - previous[j].angle),
        );
        if (i > 0)
          expect(Math.abs(delta)).toBeLessThanOrEqual(1.25 / 60 + 0.001);
        const resting = (current[j] as Position & { resting: boolean }).resting;
        restTime[j] = resting ? restTime[j] + 1 / 60 : 0;
        if (restTime[j] > 0.8) {
          expect(Math.abs(delta)).toBeLessThan(0.003);
          expect(current[j].lift).toBeLessThan(0.004);
          checkedRest++;
        }
      }
      previous = current;
    }
    expect(checkedRest).toBeGreaterThan(30);
    meadow.dispose();
  });
  it("pauses motion and disposes its renderer and audio exactly once", () => {
    const forest = build();
    const config = settings();
    config.paused = true;
    forest.configure(config);
    const before = positions(forest);
    forest.update(1, 1, strike("paused", before[0].x, before[0].y));
    expect(positions(forest)).toEqual(before);
    const audio = resources.audio.at(-1)!,
      stage = resources.stages.at(-1)!;
    forest.dispose();
    forest.dispose();
    expect(audio.dispose).toHaveBeenCalledTimes(1);
    expect(stage.dispose).toHaveBeenCalledTimes(1);
  });
});
