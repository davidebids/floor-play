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
const tracking = (page: Page) =>
  page.evaluate(() => (window as any).__PROJECTION__?.tracking());
test("tapping the pond border produces no water sound, while a water tap splashes and sounds", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const Native = window.AudioContext;
    (window as any).__effectStarts = 0;
    (window as any).__ambienceStarts = 0;
    window.AudioContext = class extends Native {
      createBufferSource() {
        const source = super.createBufferSource();
        const start = source.start.bind(source);
        source.start = ((...args: any[]) => {
          // Ambience is scheduled with an explicit audio-clock start time.
          if (!args.length) (window as any).__effectStarts++;
          else (window as any).__ambienceStarts++;
          return (start as any)(...args);
        }) as any;
        return source;
      }
    };
  });
  await page.goto("/");
  await loaded(page);
  await page.getByRole("button", { name: "Enable sound", exact: true }).click();
  // Ambience starts after loading settles, proving audio is unlocked and decoded.
  await expect
    .poll(() => page.evaluate(() => (window as any).__ambienceStarts))
    .toBeGreaterThan(0);
  const canvas = page.getByLabel("Interactive scene: Koi pond", {
    exact: true,
  });
  const bounds = (await canvas.boundingBox())!;
  await canvas.click({
    position: { x: bounds.width * 0.02, y: bounds.height * 0.5 },
  });
  await expect.poll(async () => (await diag(page)).dryActions).toBe(1);
  expect(await page.evaluate(() => (window as any).__effectStarts)).toBe(0);
  await canvas.click({
    position: { x: bounds.width * 0.5, y: bounds.height * 0.5 },
  });
  await expect.poll(async () => (await diag(page)).splashCount).toBe(1);
  await expect
    .poll(() => page.evaluate(() => (window as any).__effectStarts))
    .toBe(1);
});
async function loaded(page: Page, id = "koi-pond") {
  await expect
    .poll(async () => {
      const d = await diag(page);
      return {
        activityId: d?.activityId,
        assetsLoaded: d?.assetsLoaded,
        error: d?.error,
        assetError: d?.assetError,
      };
    })
    .toMatchObject({ activityId: id, assetsLoaded: true });
}
async function projectorWithCamera(page: Page) {
  await page.goto("/");
  await loaded(page);
  const opening = page.waitForEvent("popup");
  await page
    .getByRole("button", { name: "Open projector", exact: true })
    .click();
  const projector = await opening;
  await loaded(projector);
  await page
    .getByRole("button", { name: "Connect camera", exact: true })
    .click();
  await expect
    .poll(async () => (await tracking(page))?.fps, { timeout: 45000 })
    .toBeGreaterThan(0);
  await projector.evaluate(() => {
    const send = BroadcastChannel.prototype.postMessage;
    BroadcastChannel.prototype.postMessage = function (message) {
      if ((window as any).__silenceHeartbeat && message?.type === "heartbeat")
        return;
      return send.call(this, message);
    };
    (window as any).__silenceHeartbeat = true;
  });
  return projector;
}
for (const asset of ["pond-bed.png", "koi-showa.png", "lily-cluster.png"]) {
  test(`a failed ${asset} load is recoverable rather than silently degrading the pond`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route(`**/assets/${asset}`, (route) => route.abort());
    await page.goto("/");
    await expect(page.getByRole("alert")).toContainText(/Could not load/);
    await page.unroute(`**/assets/${asset}`);
    await page
      .getByRole("button", { name: "Reload scene", exact: true })
      .click();
    await loaded(page);
    await expect(page.getByRole("alert")).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}
test("an inactive controls preview can report and recover its own artwork failure while the projector keeps playing", async ({
  page,
}) => {
  await page.goto("/");
  await loaded(page);
  const opening = page.waitForEvent("popup");
  await page
    .getByRole("button", { name: "Open projector", exact: true })
    .click();
  const projector = await opening;
  await loaded(projector);
  await page.route("**/assets/scenes/forest-floor.png", (route) =>
    route.abort(),
  );
  await page.getByRole("combobox", { name: "Scene", exact: true }).click();
  await page.getByRole("option", { name: /^Forest floor/ }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Could not load scene artwork",
  );
  await loaded(projector, "forest-floor");
  await page.unroute("**/assets/scenes/forest-floor.png");
  await page.getByRole("button", { name: "Reload scene", exact: true }).click();
  await loaded(page, "forest-floor");
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect((await diag(page)).active).toBe(false);
  await projector.close();
});
test("a silent open projector clears stale camera readiness without stealing capture", async ({
  page,
}) => {
  test.setTimeout(65000);
  const projector = await projectorWithCamera(page);
  await expect
    .poll(async () => (await tracking(page))?.fps, { timeout: 8000 })
    .toBe(0);
  expect((await diag(page)).active).toBe(false);
  await expect(page.getByAltText("Local camera tracking preview")).toHaveCount(
    0,
  );
  await projector.evaluate(() => ((window as any).__silenceHeartbeat = false));
  await expect.poll(async () => (await tracking(page))?.fps).toBeGreaterThan(0);
  await projector.close();
});
test("reloaded controls do not take ownership from a silent but open projector, and recover when it closes", async ({
  page,
}) => {
  test.setTimeout(65000);
  const projector = await projectorWithCamera(page);
  await page.reload();
  await loaded(page);
  await expect.poll(async () => (await diag(page))?.active).toBe(false);
  await page.waitForTimeout(5200); // Exceed heartbeat expiry while the projector still owns its lease.
  expect((await diag(page)).active).toBe(false);
  await projector.close();
  await expect
    .poll(async () => (await diag(page))?.active, { timeout: 8000 })
    .toBe(true);
  await expect
    .poll(async () => (await tracking(page))?.fps, { timeout: 45000 })
    .toBeGreaterThan(0);
});
