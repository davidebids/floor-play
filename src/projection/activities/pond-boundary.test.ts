import { describe, expect, it } from "vitest";
import { setCanvasSize } from "../../config";
import { School } from "../../school";
import { SwimState } from "../../koi";
import {
  waterClearance,
  projectIntoWater,
  fishWaterMargin,
  seedFishInsideWater,
} from "./pond-boundary";
import { swimmingVertex } from "./swim-motion";

describe("whole koi stays inside the visible shoreline", () => {
  it("projects into the exact inset convex water area", () => {
    for (const point of [
      { x: 0, y: 0 },
      { x: 960, y: 0 },
      { x: 960, y: 640 },
      { x: 0, y: 640 },
      { x: 480, y: 320 },
    ]) {
      const safe = projectIntoWater(point, 42, 960, 640);
      expect(waterClearance(safe, 960, 640).distance).toBeGreaterThanOrEqual(
        42 - 1e-5,
      );
    }
  });
  it("keeps the complete mesh safe immediately after aspect changes", () => {
    setCanvasSize(960, 640);
    const school = new School();
    school.containToWater = true;
    school.setCount(24);
    school.fish.forEach((fish, i) => {
      fish.bodyLength = 85;
      fish.position = {
        x: 200 + (i % 6) * 110,
        y: 160 + Math.floor(i / 6) * 90,
      };
      seedFishInsideWater(fish, 960, 640);
    });
    let previousHeight = 640;
    for (const height of [360, 1280, 640]) {
      setCanvasSize(960, height);
      school.resize(1, height / previousHeight);
      previousHeight = height;
      for (let index = 0; index < 24; index++) {
        const fish = school.fish[index];
        expect(
          waterClearance(fish.position, 960, height).distance,
        ).toBeGreaterThanOrEqual(fishWaterMargin(fish) - 1e-4);
        for (let row = 0; row <= 32; row++)
          for (let col = 0; col <= 6; col++) {
            const point = swimmingVertex(fish, row / 32, col / 6 - 0.5, index);
            expect(
              waterClearance(point, 960, height).distance,
            ).toBeGreaterThanOrEqual(-1e-4);
          }
      }
    }
  });
  const cases = [
    [1, 0.2, 960, 640],
    [8, 2, 960, 640],
    [24, 2, 960, 640],
    [8, 2, 960, 360],
    [24, 0.2, 960, 1280],
    [24, 2, 960, 1280],
  ];
  for (const [count, pace, width, height] of cases)
    it(`${count} fish at pace ${pace}, ${width}x${height}, including frame spikes and edge disturbances`, () => {
      setCanvasSize(width, height);
      const school = new School();
      school.setCount(count);
      school.containToWater = true;
      school.fish.forEach((fish, i) => {
        fish.bodyLength = 60 + (i % 6) * 5;
        fish.bodyWidth = fish.bodyLength * 0.17;
        fish.position = {
          x: width * (0.14 + ((i * 0.618034) % 1) * 0.72),
          y: height * (0.15 + ((i * 0.414214) % 1) * 0.7),
        };
        fish.heading = i * 0.85;
        fish.cruiseSpeed = 32 * pace;
        fish.maximumSpeed = fish.cruiseSpeed * 1.8;
        fish.speed = fish.cruiseSpeed;
        fish.state = SwimState.Glide;
        fish.stateDuration = 14;
        fish.stateAge = 0;
        seedFishInsideWater(fish, width, height);
      });
      for (let step = 0; step < 3600; step++) {
        school.avoidanceRegions =
          step > 180 && step < 380
            ? [
                {
                  x: width * 0.72,
                  y: height * 0.28,
                  radius: width * 0.13,
                  strength: 1,
                },
              ]
            : [];
        school.update(step % 180 === 179 ? 0.12 : 1 / 60, step / 60);
        for (let index = 0; index < count; index++) {
          const fish = school.fish[index],
            margin = fishWaterMargin(fish);
          expect(
            waterClearance(fish.position, width, height).distance,
          ).toBeGreaterThanOrEqual(margin - 1e-4);
          if (step === 0 || step === 1800 || step === 3599) {
            for (let row = 0; row <= 32; row++)
              for (let col = 0; col <= 6; col++) {
                const point = swimmingVertex(
                  fish,
                  row / 32,
                  col / 6 - 0.5,
                  index,
                );
                expect(
                  waterClearance(point, width, height).distance,
                ).toBeGreaterThanOrEqual(-1e-4);
              }
          }
        }
      }
    });
});
