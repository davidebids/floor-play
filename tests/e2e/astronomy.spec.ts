import { test, expect, type Page } from "@playwright/test";
test.use({
  launchOptions: {
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
    ],
  },
});
const diag = (page: Page) =>
  page.evaluate(() => (window as any).__PROJECTION__?.diagnostics());
async function cosmos(page: Page) {
  await page.goto("/");
  await page.getByRole("combobox", { name: "Scene", exact: true }).click();
  await page.getByRole("option", { name: /^Starlit cosmos/ }).click();
  await expect
    .poll(async () => {
      const d = await diag(page);
      return d?.activityId === "starlit-cosmos" && d.assetsLoaded;
    })
    .toBe(true);
}
test("cosmos has silent passive motion without creating camera or tap actions, and freezes on pause", async ({
  page,
}) => {
  await cosmos(page);
  await page.getByRole("button", { name: "Enable sound", exact: true }).click();
  const start = (await diag(page)).positions;
  await expect
    .poll(async () => (await diag(page)).ambientLaunches, { timeout: 10000 })
    .toBeGreaterThan(0);
  const moving = await diag(page);
  expect(moving.impulseCount).toBe(0);
  expect(moving.responses).toBe(0);
  expect(moving.audio.voices).toBe(0);
  expect(
    moving.positions.some(
      (p: { x: number; y: number }, i: number) =>
        Math.hypot(p.x - start[i].x, p.y - start[i].y) > 0.001,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() => (window as any).__PROJECTION__.settings().paused),
    )
    .toBe(true);
  const paused = await diag(page);
  await page.waitForTimeout(500);
  const after = await diag(page);
  expect(after.positions).toEqual(paused.positions);
  expect(after.ambientLaunches).toBe(paused.ambientLaunches);
});
test("cosmos keeps independent preferences, renders non-default floor proportions and follows the projector", async ({
  page,
}) => {
  await cosmos(page);
  const stars = page.getByRole("slider", { name: "Stars", exact: true });
  await stars.focus();
  await page.keyboard.press("Home");
  await expect.poll(async () => (await diag(page)).stars).toBe(80);
  await page.getByLabel("Floor depth in feet", { exact: true }).fill("3.7");
  await expect
    .poll(async () => (await diag(page)).renderHeight)
    .toBeGreaterThan(0);
  await expect(
    page.getByRole("button", { name: "Reload scene", exact: true }),
  ).toHaveCount(0);
  await page.reload();
  await expect.poll(async () => (await diag(page)).stars).toBe(80);
  const opening = page.waitForEvent("popup");
  await page
    .getByRole("button", { name: "Open projector", exact: true })
    .click();
  const projector = await opening;
  await expect
    .poll(async () => {
      const d = await diag(projector);
      return d?.activityId === "starlit-cosmos" && d.assetsLoaded;
    })
    .toBe(true);
  await expect.poll(async () => (await diag(page)).active).toBe(false);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await expect
    .poll(() =>
      projector.evaluate(
        () => (window as any).__PROJECTION__?.settings().paused,
      ),
    )
    .toBe(true);
  const positions = JSON.stringify((await diag(projector)).positions);
  await page.waitForTimeout(200);
  expect(JSON.stringify((await diag(projector)).positions)).toBe(positions);
  await projector.close();
  await expect.poll(async () => (await diag(page)).active).toBe(true);
});
test("cosmos chimes unlock on gesture, stop on pause/mute and release their context when switching", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const Native = window.AudioContext;
    (window as any).__cosmosContexts = [];
    window.AudioContext = class extends Native {
      constructor(options?: AudioContextOptions) {
        super(options);
        (window as any).__cosmosContexts.push(this);
      }
    };
  });
  await cosmos(page);
  await page.getByRole("button", { name: "Enable sound", exact: true }).click();
  await expect.poll(async () => (await diag(page)).audio.unlocked).toBe(true);
  const cosmosContextIndex = await page.evaluate(
    () => (window as any).__cosmosContexts.length - 1,
  );
  const canvas = page.getByLabel("Interactive scene: Starlit cosmos", {
    exact: true,
  });
  const b = (await canvas.boundingBox())!;
  await canvas.click({ position: { x: b.width * 0.5, y: b.height * 0.5 } });
  await expect
    .poll(async () => (await diag(page)).audio.voices)
    .toBeGreaterThan(0);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await expect.poll(async () => (await diag(page)).audio.voices).toBe(0);
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() => (window as any).__PROJECTION__.settings().paused),
    )
    .toBe(false);
  const beforeSecondTap = (await diag(page)).impulseCount;
  await canvas.click({ position: { x: b.width * 0.7, y: b.height * 0.6 } });
  await expect
    .poll(async () => (await diag(page)).audio.voices)
    .toBeGreaterThan(0);
  expect((await diag(page)).impulseCount).toBeGreaterThan(beforeSecondTap);
  await page.getByRole("button", { name: "Mute sound", exact: true }).click();
  await expect.poll(async () => (await diag(page)).audio.voices).toBe(0);
  await page.getByRole("combobox", { name: "Scene", exact: true }).click();
  await page.getByRole("option", { name: /^Koi pond/ }).click();
  await expect
    .poll(() =>
      page.evaluate(
        (index) => (window as any).__cosmosContexts[index]?.state,
        cosmosContextIndex,
      ),
    )
    .toBe("closed");
});
for (const asset of [
  "astronomy-moon-surface.jpg",
  "astronomy-earth-clouds.jpg",
  "astronomy-saturn-rings.png",
])
  test(`a missing astronomy image (${asset}) reports a recoverable scene error`, async ({
    page,
  }) => {
    let blocked = true;
    await page.route(`**/${asset}`, (route) =>
      blocked ? route.abort() : route.continue(),
    );
    await page.goto("/");
    await page.getByRole("combobox", { name: "Scene", exact: true }).click();
    await page.getByRole("option", { name: /^Starlit cosmos/ }).click();
    const reload = page.getByRole("button", {
      name: "Reload scene",
      exact: true,
    });
    await expect(reload).toBeVisible();
    blocked = false;
    await reload.click();
    await expect.poll(async () => (await diag(page)).assetsLoaded).toBe(true);
    await expect(reload).toHaveCount(0);
  });
