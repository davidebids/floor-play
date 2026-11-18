import { expect, test, type Page } from "@playwright/test";
import {
  DEFAULT_QUAD,
  homography,
  transformPoint,
} from "../../src/projection/calibration";
import { DEFAULT_SETTINGS } from "../../src/projection/storage";
import { mapCameraFrame } from "../../src/projection/vision/controller";
import { MotionInterpreter } from "../../src/projection/vision/motion";
import { surfaceWaterClearance } from "../../src/projection/activities/pond-boundary";
import type { InteractionFrame, Point, Quad } from "../../src/projection/types";
test.use({
  launchOptions: {
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
    ],
  },
});
const scenes = [
  ["koi-pond", "Koi pond"],
  ["forest-floor", "Forest floor"],
  ["tide-pool", "Tide pool"],
  ["butterfly-meadow", "Butterfly meadow"],
  ["sandy-beach", "Sandy beach"],
] as const;
const diag = (page: Page) =>
  page.evaluate(() => (window as any).__PROJECTION__.diagnostics());
async function choose(page: Page, id: string, title: string) {
  await page.getByRole("combobox", { name: "Scene", exact: true }).click();
  await page.getByRole("option", { name: new RegExp(`^${title}`) }).click();
  await expect
    .poll(async () => {
      const d = await diag(page);
      return d.activityId === id && d.assetsLoaded;
    })
    .toBe(true);
}
const targets: Point[] = [
  { x: 0.5, y: 0.5 },
  { x: 0.015, y: 0.5 },
  { x: 0.985, y: 0.5 },
  { x: 0.5, y: 0.015 },
  { x: 0.5, y: 0.985 },
  { x: 0.015, y: 0.015 },
  { x: 0.985, y: 0.015 },
  { x: 0.985, y: 0.985 },
  { x: 0.015, y: 0.985 },
  { x: 0.18, y: 0.7 },
  { x: 0.21, y: 0.74 },
  { x: 0.25, y: 0.77 },
];
for (const [id, title] of scenes)
  test(`mapped camera observations reach ${id} at center, sides and corners with scene-specific filtering`, async ({
    page,
  }) => {
    await page.goto("/");
    await choose(page, id, title);
    let expected = 0,
      dry = 0;
    for (const [index, point] of targets.entries()) {
      if (
        index > 0 &&
        Math.hypot(
          point.x - targets[index - 1].x,
          point.y - targets[index - 1].y,
        ) < 0.12
      )
        await page.waitForTimeout(400); // Separate nearby physical taps beyond shared debounce.
      const mirrored = index % 2 === 1;
      const corners = [
        { x: 0.26, y: 0.14 },
        { x: 0.78, y: 0.26 },
        { x: 0.66, y: 0.85 },
        { x: 0.12, y: 0.68 },
      ].map((p) => ({ x: mirrored ? 1 - p.x : p.x, y: p.y })) as Quad;
      const cameraPoint = transformPoint(
          homography(DEFAULT_QUAD, corners),
          point,
        ),
        timestamp = 1000 + index * 1000;
      const profile = {
        ...structuredClone(DEFAULT_SETTINGS.calibration),
        calibrated: true,
        mirrored,
        cameraCorners: corners,
      };
      const interpreter = new MotionInterpreter();
      const hand = {
        position: cameraPoint,
        radius: 0.025,
        confidence: 0.95,
        activity: 0.8,
      };
      interpreter.update(
        { presence: [], motion: [], hands: [{ ...hand, activity: 0 }] },
        timestamp - 100,
        0.65,
        corners,
      );
      const observed = interpreter.update(
        { presence: [], motion: [], hands: [hand] },
        timestamp,
        0.65,
        corners,
      );
      const mapped = mapCameraFrame(observed, profile);
      expect(mapped.impulses).toHaveLength(1);
      await page.evaluate(
        (frame) => (window as any).__PROJECTION__.replay(frame),
        mapped,
      );
      const wet =
        id !== "koi-pond" ||
        surfaceWaterClearance({ x: point.x * 960, y: point.y * 640 }, 960, 640)
          .distance > 0;
      if (wet) expected++;
      else dry++;
      await expect
        .poll(async () => {
          const d = await diag(page);
          return d.splashCount ?? d.impulseCount;
        })
        .toBe(expected);
      if (id === "koi-pond")
        await expect.poll(async () => (await diag(page)).dryActions).toBe(dry);
    }
    const before = await diag(page);
    await page.evaluate(
      (frame: InteractionFrame) => (window as any).__PROJECTION__.replay(frame),
      {
        timestamp: 50000,
        source: "camera",
        presence: [],
        motion: [],
        impulses: [
          {
            id: "outside",
            timestamp: 50000,
            position: { x: -0.02, y: 0.5 },
            strength: 1,
            confidence: 0.95,
          },
        ],
      },
    );
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    const after = await diag(page);
    expect(after.splashCount ?? after.impulseCount).toBe(
      before.splashCount ?? before.impulseCount,
    );
  });
test("continuous camera motion cannot replace the visible tap feedback", async ({
  page,
}) => {
  await page.goto("/");
  await choose(page, "tide-pool", "Tide pool");
  await page.evaluate(() =>
    (window as any).__PROJECTION__.replay({
      timestamp: 1000,
      source: "camera",
      presence: [],
      motion: [],
      impulses: [
        {
          id: "tap",
          timestamp: 1000,
          position: { x: 0.5, y: 0.5 },
          strength: 0.8,
          confidence: 1,
        },
      ],
    }),
  );
  await expect.poll(async () => (await diag(page)).activeTapMarks).toBe(1);
  await page.evaluate(async () => {
    for (let step = 0; step < 8; step++) {
      (window as any).__PROJECTION__.replay({
        timestamp: 2000 + step * 150,
        source: "camera",
        presence: [],
        impulses: [],
        motion: Array.from({ length: 6 }, (_, i) => ({
          id: `move-${i}`,
          position: { x: 0.1 + i * 0.12 + step * 0.012, y: 0.2 },
          radius: 0.04,
          strength: 0.7,
          confidence: 1,
        })),
      });
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  });
  expect((await diag(page)).activeTapMarks).toBe(1);
});
test("beach surf advances and recedes and starts with four independently spaced crabs", async ({
  page,
}) => {
  test.setTimeout(25000);
  await page.goto("/");
  await choose(page, "sandy-beach", "Sandy beach");
  expect((await diag(page)).crabCount).toBe(4);
  const values: number[] = [];
  for (let i = 0; i < 20; i++) {
    values.push((await diag(page)).shoreline);
    await page.waitForTimeout(450);
  }
  expect(Math.max(...values) - Math.min(...values)).toBeGreaterThan(0.12);
  await expect(
    page.getByRole("slider", { name: "Shore crabs", exact: true }),
  ).toHaveValue("4");
});
