import { describe, expect, it } from "vitest";
import {
  CosmosModel,
  MAX_COMETS,
  MAX_STARS,
  SATURN_RING_RADIUS,
} from "./astronomy-model";
import { emptyFrame, type Impulse, type InteractionFrame } from "../types";

const tap = (
  id: string,
  x: number,
  y: number,
  changes: Partial<Impulse> = {},
): Impulse => ({
  id,
  position: { x, y },
  strength: 0.8,
  confidence: 1,
  timestamp: 1000,
  ...changes,
});
const frame = (impulses: Impulse[] = []): InteractionFrame => ({
  ...emptyFrame(1000),
  source: "camera",
  impulses,
});
const distance = (
  a: { x: number; y: number },
  b: { x: number; y: number },
  aspect = 2 / 3,
) => Math.hypot(a.x - b.x, (a.y - b.y) * aspect);
function run(
  model: CosmosModel,
  seconds: number,
  hz: number,
  aspect = 2 / 3,
  interaction = emptyFrame(),
) {
  for (let i = 1; i <= Math.round(seconds * hz); i++)
    model.update(1 / hz, i / hz, aspect, 0, interaction);
}

describe("astronomy interaction world", () => {
  it("animates a quiet scene without manufacturing taps or responses", () => {
    const model = new CosmosModel();
    const start = model.planets.map((p) => ({ x: p.x, y: p.y }));
    for (let i = 1; i <= 45 * 60; i++) {
      expect(model.update(1 / 60, i / 60, 2 / 3, 0.35, emptyFrame())).toEqual(
        [],
      );
      expect(
        model.comets.filter((c) => c.origin === "ambient").length,
      ).toBeLessThanOrEqual(2);
      if (i === 12 * 60)
        expect(distance(model.planets[0], start[0])).toBeGreaterThan(0.006);
    }
    expect(model.ambientLaunches).toBeGreaterThanOrEqual(3);
    expect(model.impulseCount).toBe(0);
    expect(model.responses).toBe(0);
    expect(model.bursts).toHaveLength(0);
  });
  it("keeps zero-drift idle positions quiet and never catches up a backlog of meteors", () => {
    const quiet = new CosmosModel();
    run(quiet, 25, 60);
    expect(quiet.ambientLaunches).toBe(0);
    for (const planet of quiet.planets) {
      expect(planet.x).toBeCloseTo(planet.homeX, 8);
      expect(planet.y).toBeCloseTo(planet.homeY, 8);
    }
    quiet.update(1 / 60, 10000, 2 / 3, 0.35, emptyFrame());
    expect(quiet.ambientLaunches).toBe(1);
    quiet.update(1 / 60, 10000.02, 2 / 3, 0.35, emptyFrame());
    expect(quiet.ambientLaunches).toBe(1);
  });
  it("gives tap comets priority over ambient life without exceeding effect capacity", () => {
    const model = new CosmosModel();
    model.update(1 / 60, 3.5, 2 / 3, 1, emptyFrame());
    expect(model.comets[0].origin).toBe("ambient");
    model.update(
      1 / 60,
      3.6,
      2 / 3,
      1,
      frame(
        Array.from({ length: MAX_COMETS }, (_, i) =>
          tap(`burst-${i}`, 0.5, 0.5),
        ),
      ),
    );
    expect(model.comets).toHaveLength(MAX_COMETS);
    expect(model.comets.every((c) => c.origin === "tap")).toBe(true);
    expect(model.bursts).toHaveLength(MAX_COMETS);
    expect(model.impulseCount).toBe(MAX_COMETS);
  });
  it("launches corner taps into the visible play area for every supported floor aspect", () => {
    for (const aspect of [0.375, 2 / 3, 4 / 3])
      for (const [x, y] of [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ]) {
        const model = new CosmosModel();
        expect(
          model.update(1 / 60, 0, aspect, 0.5, frame([tap("corner", x, y)])),
        ).toHaveLength(1);
        const comet = model.comets[0];
        expect(Math.sign(comet.dx)).toBe(x === 0 ? 1 : -1);
        expect(Math.sign(comet.dy)).toBe(y === 0 ? 1 : -1);
        const after = {
          x: x + comet.dx * 0.1,
          y: y + (comet.dy * 0.1) / aspect,
        };
        expect(after.x).toBeGreaterThan(0);
        expect(after.x).toBeLessThan(1);
        expect(after.y).toBeGreaterThan(0);
        expect(after.y).toBeLessThan(1);
        expect(model.bursts[0]).toMatchObject({ x, y });
      }
  });
  it("deduplicates a camera action without suppressing a subsequent distinct tap", () => {
    const model = new CosmosModel(),
      first = frame([tap("first", 0.5, 0.5)]);
    expect(model.update(1 / 60, 0, 2 / 3, 0.4, first)).toHaveLength(1);
    const response = model.responses;
    expect(model.update(1 / 60, 0.02, 2 / 3, 0.4, first)).toHaveLength(0);
    expect(model.impulseCount).toBe(1);
    expect(model.responses).toBe(response);
    expect(
      model.update(1 / 60, 0.04, 2 / 3, 0.4, frame([tap("second", 0.5, 0.5)])),
    ).toHaveLength(1);
    expect(model.impulseCount).toBe(2);
  });
  it("rejects malformed and outside-floor taps while preserving a later valid action", () => {
    const model = new CosmosModel();
    const invalid = [
      tap("nan-confidence", 0.5, 0.5, { confidence: NaN }),
      tap("infinite-confidence", 0.5, 0.5, { confidence: Infinity }),
      tap("low", 0.5, 0.5, { confidence: 0.1 }),
      tap("strength", 0.5, 0.5, { strength: NaN }),
      tap("nan", NaN, 0.5),
      tap("left", -0.001, 0.5),
      tap("right", 1.001, 0.5),
      tap("above", 0.5, -0.01),
      tap("below", 0.5, 1.01),
    ];
    expect(model.update(1 / 60, 0, 2 / 3, 0.4, frame(invalid))).toEqual([]);
    expect(model.impulseCount).toBe(0);
    expect(model.comets).toHaveLength(0);
    expect(
      model.update(
        1 / 60,
        0.02,
        2 / 3,
        0.4,
        frame([tap("nan-confidence", 0.5, 0.5)]),
      ),
    ).toHaveLength(1);
  });
  it("ignores malformed presence and motion parameters instead of corrupting the world", () => {
    const model = new CosmosModel();
    const malformed = {
      ...emptyFrame(),
      presence: [
        {
          id: "bad",
          center: { x: 0.27, y: 0.52 },
          radius: 0.2,
          confidence: NaN,
        },
        {
          id: "bad2",
          center: { x: 0.3, y: 0.5 },
          radius: Infinity,
          confidence: 1,
        },
      ],
    };
    model.update(1 / 60, 0, NaN, NaN, malformed);
    for (const body of [...model.stars, ...model.planets])
      expect(Number.isFinite(body.x + body.y + body.vx + body.vy)).toBe(true);
    const before = JSON.stringify(model.planets);
    expect(
      model.update(NaN, 1, 2 / 3, 0.4, frame([tap("bad-dt", 0.5, 0.5)])),
    ).toEqual([]);
    expect(
      model.update(
        1 / 60,
        Infinity,
        2 / 3,
        0.4,
        frame([tap("bad-time", 0.5, 0.5)]),
      ),
    ).toEqual([]);
    expect(JSON.stringify(model.planets)).toBe(before);
  });
  it("lets continuous nearby hands move stars and planets without fabricating taps", () => {
    const baseline = new CosmosModel(),
      active = new CosmosModel();
    const earth = active.planets[0],
      target = { x: earth.x - 0.025, y: earth.y };
    const hand = {
      ...emptyFrame(),
      presence: [{ id: "hand", center: target, radius: 0.08, confidence: 1 }],
    };
    run(baseline, 2, 60);
    run(active, 2, 60, 2 / 3, hand);
    expect(distance(active.planets[0], baseline.planets[0])).toBeGreaterThan(
      0.01,
    );
    expect(distance(active.planets[1], baseline.planets[1])).toBeLessThan(
      0.00001,
    );
    expect(
      active.stars.some((star, i) => distance(star, baseline.stars[i]) > 0.005),
    ).toBe(true);
    expect(active.impulseCount).toBe(0);
    expect(active.comets).toHaveLength(0);
    const swept = active.planets[0].energy;
    active.update(
      1 / 60,
      2.01,
      2 / 3,
      0,
      frame([tap("takeoff", active.planets[0].x, active.planets[0].y)]),
    );
    expect(active.planets[0].energy).toBeGreaterThan(swept + 0.5);
    expect(active.comets).toHaveLength(1);
  });
  it("settles disturbed objects back near their own anchors after the hand leaves", () => {
    const model = new CosmosModel();
    const hand = {
      ...emptyFrame(),
      presence: [
        {
          id: "hand",
          center: { x: 0.25, y: 0.52 },
          radius: 0.3,
          confidence: 1,
        },
      ],
    };
    run(model, 5, 60, 2 / 3, hand);
    expect(
      distance(model.planets[0], {
        x: model.planets[0].homeX,
        y: model.planets[0].homeY,
      }),
    ).toBeGreaterThan(0.02);
    for (let i = 1; i <= 30 * 60; i++)
      model.update(1 / 60, 5 + i / 60, 2 / 3, 0, emptyFrame());
    for (const body of [...model.planets, ...model.stars])
      expect(distance(body, { x: body.homeX, y: body.homeY })).toBeLessThan(
        0.003,
      );
  });
  it("keeps trajectories close across 30, 60 and 120 Hz updates", () => {
    const models = [30, 60, 120].map((hz) => {
      const model = new CosmosModel();
      model.update(0, 0, 2 / 3, 0, frame([tap("tap", 0.25, 0.52)]));
      run(model, 2, hz);
      return model;
    });
    for (const model of models.slice(1)) {
      for (let i = 0; i < model.planets.length; i++)
        expect(distance(model.planets[i], models[0].planets[i])).toBeLessThan(
          0.002,
        );
      for (let i = 0; i < model.stars.length; i++)
        expect(distance(model.stars[i], models[0].stars[i])).toBeLessThan(
          0.004,
        );
    }
  });
  it("bounds star, comet and burst allocations under prolonged repeated interaction", () => {
    const model = new CosmosModel();
    model.setCount(1e9);
    expect(model.stars).toHaveLength(MAX_STARS);
    model.setCount(-9);
    expect(model.stars).toHaveLength(80);
    model.setCount(NaN);
    expect(model.stars).toHaveLength(200);
    for (let i = 0; i < 600; i++) {
      model.update(
        1 / 60,
        i / 60,
        2 / 3,
        1,
        frame([tap(`tap-${i}`, (i * 0.618) % 1, (i * 0.414) % 1)]),
      );
      expect(model.comets.length).toBeLessThanOrEqual(MAX_COMETS);
      expect(model.bursts.length).toBeLessThanOrEqual(MAX_COMETS);
    }
    model.update(1 / 60, 20, 2 / 3, 1, emptyFrame());
    expect(model.comets.filter((c) => c.origin === "tap")).toHaveLength(0);
    expect(model.comets.length).toBeLessThanOrEqual(2);
    expect(model.bursts).toHaveLength(0);
  });
  for (const aspect of [0.375, 4 / 3])
    it(`keeps stars and complete planet extents on-floor under sustained pressure at aspect ${aspect}`, () => {
      const model = new CosmosModel();
      for (let i = 0; i < 3600; i++) {
        const hand = {
          ...emptyFrame(),
          presence: [
            {
              id: "body",
              center: {
                x: 0.5 + Math.sin(i * 0.03) * 0.45,
                y: 0.5 + Math.cos(i * 0.027) * 0.45,
              },
              radius: 0.35,
              confidence: 1,
            },
          ],
          impulses:
            i % 30 === 0
              ? [tap(`tap-${i}`, (i * 0.618) % 1, (i * 0.414) % 1)]
              : [],
        };
        model.update(1 / 60, i / 60, aspect, 1, hand);
        if (i % 60) continue;
        for (const star of model.stars) {
          expect(Number.isFinite(star.x + star.y + star.vx + star.vy)).toBe(
            true,
          );
          expect(star.x).toBeGreaterThanOrEqual(0.008);
          expect(star.x).toBeLessThanOrEqual(0.992);
          expect(star.y).toBeGreaterThanOrEqual(0.008);
          expect(star.y).toBeLessThanOrEqual(0.992);
        }
        for (const p of model.planets) {
          const r =
            p.radius * (p.kind === "saturn" ? SATURN_RING_RADIUS : 1.16);
          expect(Number.isFinite(p.x + p.y + p.vx + p.vy + p.spin)).toBe(true);
          expect(p.x - r).toBeGreaterThanOrEqual(-1e-8);
          expect(p.x + r).toBeLessThanOrEqual(1 + 1e-8);
          expect(p.y - r / aspect).toBeGreaterThanOrEqual(-1e-8);
          expect(p.y + r / aspect).toBeLessThanOrEqual(1 + 1e-8);
        }
      }
    });
});
