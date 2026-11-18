import { expect, test, type Page } from "@playwright/test";
import {
  DEFAULT_SETTINGS,
  exportSettings,
  SETTINGS_KEY,
} from "../../src/projection/storage";
import type { ProjectionSettings } from "../../src/projection/types";

// This spec uses only Chromium's synthetic stream, never the user's camera.
test.use({
  launchOptions: {
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
    ],
  },
});

const configuration = (page: Page): Promise<ProjectionSettings> =>
  page.evaluate(() =>
    (
      window as unknown as {
        __PROJECTION__: { settings: () => ProjectionSettings };
      }
    ).__PROJECTION__.settings(),
  );
const waitForPond = async (page: Page) => {
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as unknown as {
              __PROJECTION__?: { diagnostics: () => Record<string, unknown> };
            }
          ).__PROJECTION__?.diagnostics().assetsLoaded,
      ),
    )
    .toBe(true);
};

async function loadCalibratedFixture(page: Page) {
  await page.goto("/");
  await waitForPond(page);
  await expect
    .poll(() =>
      page.evaluate(() => (window as any).__PROJECTION__.outputSignature()),
    )
    .not.toBe("");
  const outputSignature = await page.evaluate(() =>
    (window as any).__PROJECTION__.outputSignature(),
  );
  const fixture = {
    ...structuredClone(DEFAULT_SETTINGS),
    cameraId: "fixture-camera",
    calibration: {
      ...structuredClone(DEFAULT_SETTINGS.calibration),
      cameraId: "fixture-camera",
      cameraWidth: 1280,
      cameraHeight: 720,
      calibrated: true,
      outputSignature,
    },
  };
  await page.locator('input[type="file"]').setInputFiles({
    name: "fixture.json",
    mimeType: "application/json",
    buffer: Buffer.from(exportSettings(fixture)),
  });
  await expect
    .poll(async () => (await configuration(page)).calibration.calibrated)
    .toBe(true);
}

test("output adjustment invalidates camera alignment; closing restores the profile and previous pause state", async ({
  page,
}) => {
  await loadCalibratedFixture(page);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await page
    .getByRole("button", { name: "Adjust projector corners", exact: true })
    .click();
  await page
    .getByRole("spinbutton", { name: "Top left x", exact: true })
    .fill("6");
  await expect
    .poll(async () => (await configuration(page)).calibration.calibrated)
    .toBe(false);
  await expect
    .poll(
      async () => (await configuration(page)).calibration.outputCorners[0].x,
    )
    .toBe(0.06);
  await page
    .getByRole("button", { name: "Close alignment", exact: true })
    .click();
  await expect
    .poll(async () => (await configuration(page)).calibration.calibrated)
    .toBe(true);
  expect((await configuration(page)).calibration.outputCorners[0].x).toBe(0);
  expect((await configuration(page)).paused).toBe(true);
  await page
    .getByRole("button", { name: "Adjust projector corners", exact: true })
    .click();
  await page
    .getByRole("spinbutton", { name: "Top left x", exact: true })
    .fill("6");
  await page
    .getByRole("button", { name: "Save alignment", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect((await configuration(page)).calibration.calibrated).toBe(false);
  expect((await configuration(page)).calibration.outputCorners[0].x).toBe(0.06);
  expect((await configuration(page)).paused).toBe(true);
});

test("projector contains square and tall floor dimensions and receives settings updates", async ({
  page,
}) => {
  await page.goto("/");
  await waitForPond(page);
  await page
    .getByRole("spinbutton", { name: "Floor width in feet", exact: true })
    .fill("4");
  await page
    .getByRole("spinbutton", { name: "Floor depth in feet", exact: true })
    .fill("6");
  const opened = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Open projector" }).click();
  const projector = await opened;
  await waitForPond(projector);
  async function containedAspect(expected: number) {
    await expect
      .poll(() =>
        projector.locator(".scene-stage").evaluate((stage) => {
          const r = stage.getBoundingClientRect();
          return r.width / r.height;
        }),
      )
      .toBeCloseTo(expected, 2);
    const bounds = await projector.locator(".scene-stage").boundingBox();
    const viewport = await projector.evaluate(() => ({
      width: innerWidth,
      height: innerHeight,
    }));
    expect(bounds!.x).toBeGreaterThanOrEqual(-1);
    expect(bounds!.y).toBeGreaterThanOrEqual(-1);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width + 1);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height + 1);
  }
  await containedAspect(2 / 3);
  await page
    .getByRole("spinbutton", { name: "Floor width in feet", exact: true })
    .fill("6");
  await containedAspect(1);
  expect((await configuration(projector)).floorWidth).toBeCloseTo(1.8288);
  await projector.close();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as unknown as {
              __PROJECTION__: { diagnostics: () => Record<string, unknown> };
            }
          ).__PROJECTION__.diagnostics().active,
      ),
    )
    .toBe(true);
});

test.describe("synthetic camera calibration", () => {
  test("aligning Default camera resolves its actual device ID and persists a valid profile", async ({
    page,
    context,
  }) => {
    test.setTimeout(60000);
    await context.grantPermissions(["camera"]);
    await page.goto("/");
    await waitForPond(page);
    expect((await configuration(page)).cameraId).toBe("");
    await page
      .getByRole("button", { name: "Connect camera", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Align camera", exact: true })
      .last()
      .click();
    const preview = page.getByAltText(
      "Click the projected floor corners in this camera preview",
    );
    await expect(preview).toBeVisible({ timeout: 45000 });
    const area = page.locator(".camera-alignment");
    const box = (await area.boundingBox())!;
    for (const [x, y] of [
      [0.1, 0.1],
      [0.9, 0.12],
      [0.88, 0.9],
      [0.12, 0.88],
    ])
      await area.click({ position: { x: box.width * x, y: box.height * y } });
    await page
      .getByRole("button", { name: "Save alignment", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect
      .poll(async () => (await configuration(page)).calibration.calibrated)
      .toBe(true);
    const settings = await configuration(page);
    expect(settings.cameraId.length).toBeGreaterThan(0);
    expect(settings.cameraId).toBe(settings.calibration.cameraId);
    expect(settings.calibration.cameraWidth).toBeGreaterThan(0);
    expect(settings.calibration.cameraHeight).toBeGreaterThan(0);
    await page.getByRole("button", { name: "Mouse", exact: true }).click();
    await page.reload();
    await waitForPond(page);
    expect((await configuration(page)).calibration.calibrated).toBe(true);
  });
});

test("alignment temporarily reveals a blanked floor and restores blank, pause and grid on cancel", async ({
  page,
}) => {
  await page.goto("/");
  await waitForPond(page);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await page
    .getByRole("checkbox", { name: "Show alignment grid", exact: true })
    .check();
  await page.getByRole("button", { name: "Blank floor", exact: true }).click();
  await page
    .getByRole("button", { name: "Adjust projector corners", exact: true })
    .click();
  expect((await configuration(page)).blank).toBe(false);
  await expect(page.locator(".alignment-grid")).toBeVisible();
  await page
    .getByRole("button", { name: "Close alignment", exact: true })
    .click();
  expect(await configuration(page)).toMatchObject({
    blank: true,
    paused: true,
    calibrationGrid: true,
  });
});

test("an unavailable persisted activity falls back to koi while retaining other scene preferences", async ({
  page,
}) => {
  await page.addInitScript(
    ({ key, value }) => localStorage.setItem(key, value),
    {
      key: SETTINGS_KEY,
      value: JSON.stringify({
        version: 1,
        settings: {
          ...DEFAULT_SETTINGS,
          activityId: "not-installed",
          activitySettings: { "future-garden": { bloomSize: 0.8 } },
        },
      }),
    },
  );
  await page.goto("/");
  await waitForPond(page);
  const settings = await configuration(page);
  expect(settings.activityId).toBe("koi-pond");
  expect(settings.activitySettings["future-garden"]).toEqual({
    bloomSize: 0.8,
  });
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test.describe("physical geometry and camera recovery with synthetic video", () => {
  test("projector calibration survives parent resize/reload, invalidates on output resize, and camera hands back on close", async ({
    page,
    context,
  }) => {
    test.setTimeout(90000);
    await context.grantPermissions(["camera"]);
    await page.goto("/");
    await waitForPond(page);
    await page
      .getByRole("button", { name: "Connect camera", exact: true })
      .click();
    await expect
      .poll(() =>
        page.evaluate(() => document.querySelector("video")?.videoWidth ?? 0),
      )
      .toBeGreaterThan(0);
    const opened = page.waitForEvent("popup");
    await page
      .getByRole("button", { name: "Open projector", exact: true })
      .click();
    let projector = await opened;
    await waitForPond(projector);
    await expect
      .poll(
        () =>
          page.evaluate(() => (window as any).__PROJECTION__.tracking().state),
        { timeout: 45000 },
      )
      .toBe("limited");
    await page
      .getByRole("button", { name: "Align camera", exact: true })
      .last()
      .click();
    const preview = page.getByAltText(
      "Click the projected floor corners in this camera preview",
    );
    await expect(preview).toBeVisible();
    const area = page.locator(".camera-alignment"),
      box = (await area.boundingBox())!;
    for (const [x, y] of [
      [0.1, 0.1],
      [0.9, 0.1],
      [0.9, 0.9],
      [0.1, 0.9],
    ])
      await area.click({ position: { x: box.width * x, y: box.height * y } });
    await page
      .getByRole("button", { name: "Save alignment", exact: true })
      .click();
    await expect
      .poll(async () => (await configuration(projector)).calibration.calibrated)
      .toBe(true);
    expect((await configuration(page)).calibration.outputSignature).toContain(
      "projector",
    );
    await page.setViewportSize({ width: 1200, height: 900 });
    await page.waitForTimeout(1300);
    expect((await configuration(projector)).calibration.calibrated).toBe(true);
    await page.reload();
    await waitForPond(page);
    await expect(
      page.getByText("Projector connected", { exact: true }),
    ).toBeVisible();
    await page.waitForTimeout(1000);
    expect((await configuration(page)).calibration.calibrated).toBe(true);
    expect(await page.locator("video").count()).toBe(0);
    const savedSignature = (await configuration(page)).calibration
      .outputSignature;
    await projector.close();
    await expect
      .poll(() =>
        page.evaluate(
          () => (window as any).__PROJECTION__.diagnostics().active,
        ),
      )
      .toBe(true);
    expect((await configuration(page)).calibration.calibrated).toBe(true);
    expect((await configuration(page)).calibration.outputSignature).toBe(
      savedSignature,
    );
    const reopened = page.waitForEvent("popup");
    await page
      .getByRole("button", { name: "Open projector", exact: true })
      .click();
    projector = await reopened;
    await waitForPond(projector);
    await expect
      .poll(() =>
        projector.evaluate(() =>
          (window as any).__PROJECTION__.outputSignature(),
        ),
      )
      .toBe(savedSignature);
    await expect
      .poll(async () => (await configuration(projector)).calibration.calibrated)
      .toBe(true);
    await projector.setViewportSize({ width: 1100, height: 760 });
    await expect
      .poll(async () => (await configuration(page)).calibration.calibrated)
      .toBe(false);
    await projector.close();
    await expect
      .poll(
        () =>
          page.evaluate(() => document.querySelector("video")?.videoWidth ?? 0),
        { timeout: 30000 },
      )
      .toBeGreaterThan(0);
    await expect
      .poll(
        () =>
          page.evaluate(() => (window as any).__PROJECTION__.tracking().state),
        { timeout: 45000 },
      )
      .toBe("limited");
    expect(
      await page.locator('[role="alert"]').allTextContents(),
    ).not.toContain(
      "The camera is already running in another Projection App window.",
    );
    await page.getByRole("button", { name: "Mouse", exact: true }).click();
  });
  test("a disconnected camera clears its old preview and cannot save stale alignment", async ({
    page,
    context,
  }) => {
    test.setTimeout(60000);
    await context.grantPermissions(["camera"]);
    await page.goto("/");
    await waitForPond(page);
    await page
      .getByRole("button", { name: "Connect camera", exact: true })
      .click();
    await expect
      .poll(
        () =>
          page.evaluate(() => (window as any).__PROJECTION__.tracking().state),
        { timeout: 45000 },
      )
      .toBe("limited");
    await page
      .getByRole("button", { name: "Align camera", exact: true })
      .last()
      .click();
    await expect(
      page.getByAltText(
        "Click the projected floor corners in this camera preview",
      ),
    ).toBeVisible();
    await page.evaluate(() => {
      const video = document.querySelector("video")!;
      const stream = video.srcObject as MediaStream;
      stream.getVideoTracks()[0].dispatchEvent(new Event("ended"));
    });
    await expect
      .poll(() =>
        page.evaluate(() => (window as any).__PROJECTION__.tracking().state),
      )
      .toBe("error");
    await expect(
      page.getByAltText(
        "Click the projected floor corners in this camera preview",
      ),
    ).toHaveCount(0);
    await page
      .getByRole("button", { name: "Save alignment", exact: true })
      .click();
    await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
      "Connect the camera",
    );
    expect((await configuration(page)).calibration.calibrated).toBe(false);
  });
});
