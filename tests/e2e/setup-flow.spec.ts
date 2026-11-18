import { expect, test, type Page } from "@playwright/test";
import { exportSettings } from "../../src/projection/storage";
import type { ProjectionSettings } from "../../src/projection/types";

// Setup regression fixtures use Chrome's synthetic video; no physical camera is opened.
test.use({
  launchOptions: {
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
    ],
  },
});
const config = (page: Page): Promise<ProjectionSettings> =>
  page.evaluate(() => (window as any).__PROJECTION__.settings());
async function ready(page: Page) {
  await page.goto("/");
  await expect
    .poll(() =>
      page.evaluate(() =>
        Boolean((window as any).__PROJECTION__?.diagnostics().assetsLoaded),
      ),
    )
    .toBe(true);
  await expect
    .poll(() =>
      page.evaluate(() => (window as any).__PROJECTION__.outputSignature()),
    )
    .not.toBe("");
}
async function connect(page: Page) {
  await page
    .getByRole("button", { name: "Connect camera", exact: true })
    .click();
  await expect
    .poll(
      () => page.evaluate(() => (window as any).__PROJECTION__.tracking().fps),
      { timeout: 45000 },
    )
    .toBeGreaterThan(0);
}
async function align(page: Page) {
  await page
    .getByRole("button", { name: "Align camera", exact: true })
    .last()
    .click();
  await expect(
    page.getByAltText(
      "Click the projected floor corners in this camera preview",
    ),
  ).toBeVisible({ timeout: 45000 });
}
async function markCorners(page: Page) {
  const area = page.locator(".camera-alignment"),
    bounds = (await area.boundingBox())!;
  for (const [x, y] of [
    [0.1, 0.1],
    [0.9, 0.1],
    [0.9, 0.9],
    [0.1, 0.9],
  ])
    await area.click({
      position: { x: bounds.width * x, y: bounds.height * y },
    });
}

test("a live camera signature mismatch cannot bless imported old corners without fresh marks", async ({
  page,
  context,
}) => {
  test.setTimeout(65000);
  await context.grantPermissions(["camera"]);
  await ready(page);
  await connect(page);
  const tracking = await page.evaluate(() =>
    (window as any).__PROJECTION__.tracking(),
  );
  const fixture = await config(page);
  fixture.cameraId = tracking.deviceId;
  fixture.calibration = {
    ...fixture.calibration,
    calibrated: true,
    cameraId: tracking.deviceId,
    cameraWidth: tracking.width + 16,
    cameraHeight: tracking.height,
    outputSignature: await page.evaluate(() =>
      (window as any).__PROJECTION__.outputSignature(),
    ),
  };
  await page.locator('input[type="file"]').setInputFiles({
    name: "old-camera.json",
    mimeType: "application/json",
    buffer: Buffer.from(exportSettings(fixture)),
  });
  await align(page);
  const save = page.getByRole("button", {
    name: "Save alignment",
    exact: true,
  });
  await expect(save).toBeEnabled({ timeout: 45000 });
  await save.click();
  await expect(
    page.getByRole("dialog", { name: "Align camera", exact: true }),
  ).toBeVisible();
  expect((await config(page)).calibration.calibrated).toBe(false);
  await markCorners(page);
  await save.click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect((await config(page)).calibration.cameraWidth).toBe(tracking.width);
});

test("projector geometry changes invalidate corner marks collected earlier in the alignment session", async ({
  page,
  context,
}) => {
  test.setTimeout(80000);
  await context.grantPermissions(["camera"]);
  await ready(page);
  const opened = page.waitForEvent("popup");
  await page
    .getByRole("button", { name: "Open projector", exact: true })
    .click();
  const projector = await opened;
  await expect
    .poll(() =>
      projector.evaluate(() =>
        Boolean((window as any).__PROJECTION__?.diagnostics().assetsLoaded),
      ),
    )
    .toBe(true);
  await connect(page);
  await align(page);
  await markCorners(page);
  const before = await page.evaluate(() =>
    (window as any).__PROJECTION__.outputSignature(),
  );
  await projector.setViewportSize({ width: 1100, height: 720 });
  await expect
    .poll(() =>
      page.evaluate(() => (window as any).__PROJECTION__.outputSignature()),
    )
    .not.toBe(before);
  const save = page.getByRole("button", {
    name: "Save alignment",
    exact: true,
  });
  await expect(save).toBeEnabled({ timeout: 45000 });
  await save.click();
  await expect(
    page.getByRole("dialog", { name: "Align camera", exact: true }),
  ).toBeVisible();
  expect((await config(page)).calibration.calibrated).toBe(false);
  await markCorners(page);
  await save.click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect((await config(page)).calibration.outputSignature).toBe(
    await page.evaluate(() => (window as any).__PROJECTION__.outputSignature()),
  );
  await projector.close();
});

test("alignment keeps both windows stable when global playback shortcuts are pressed", async ({
  page,
  context,
}) => {
  test.setTimeout(80000);
  await context.grantPermissions(["camera"]);
  await ready(page);
  const opened = page.waitForEvent("popup");
  await page
    .getByRole("button", { name: "Open projector", exact: true })
    .click();
  const projector = await opened;
  await expect
    .poll(() =>
      projector.evaluate(() =>
        Boolean((window as any).__PROJECTION__?.diagnostics().assetsLoaded),
      ),
    )
    .toBe(true);
  await connect(page);
  await align(page);
  for (const target of [page, projector])
    for (const key of ["b", "Space", "f"]) {
      await target.evaluate(() =>
        (document.activeElement as HTMLElement)?.blur(),
      );
      await target.keyboard.press(key);
      await expect
        .poll(() => config(page))
        .toMatchObject({ blank: false, paused: true, calibrationGrid: true });
      expect(await config(projector)).toMatchObject({
        blank: false,
        paused: true,
        calibrationGrid: true,
      });
      expect(
        await target.evaluate(() => document.fullscreenElement === null),
      ).toBe(true);
    }
  await page
    .getByRole("button", { name: "Close alignment", exact: true })
    .click();
  await expect
    .poll(() => config(projector))
    .toMatchObject({ paused: false, calibrationGrid: false });
  // Reloading the control window must cancel its draft and release the child's
  // ephemeral alignment lock, rather than leaving the projected floor frozen.
  await align(page);
  await page.reload();
  await expect
    .poll(() =>
      page.evaluate(() =>
        Boolean((window as any).__PROJECTION__?.diagnostics().assetsLoaded),
      ),
    )
    .toBe(true);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect
    .poll(() => config(projector))
    .toMatchObject({ paused: false, calibrationGrid: false });
  await projector.evaluate(() =>
    (document.activeElement as HTMLElement)?.blur(),
  );
  await projector.keyboard.press("Space");
  await expect.poll(() => config(projector)).toMatchObject({ paused: true });
  await projector.keyboard.press("Space");
  await expect.poll(() => config(projector)).toMatchObject({ paused: false });
  await projector.close();
});

test("reloading the projector reacquires its camera and closing it hands capture back once", async ({
  page,
  context,
}) => {
  test.setTimeout(90000);
  await context.grantPermissions(["camera"]);
  await ready(page);
  const opened = page.waitForEvent("popup");
  await page
    .getByRole("button", { name: "Open projector", exact: true })
    .click();
  const projector = await opened;
  await expect
    .poll(() =>
      projector.evaluate(() =>
        Boolean((window as any).__PROJECTION__?.diagnostics().assetsLoaded),
      ),
    )
    .toBe(true);
  await connect(page);
  await expect
    .poll(
      () =>
        projector.evaluate(() => (window as any).__PROJECTION__.tracking().fps),
      { timeout: 45000 },
    )
    .toBeGreaterThan(0);
  await projector.reload();
  await expect
    .poll(
      () =>
        projector.evaluate(
          () => (window as any).__PROJECTION__?.tracking().fps ?? 0,
        ),
      { timeout: 45000 },
    )
    .toBeGreaterThan(0);
  await expect.poll(() => page.locator("video").count()).toBe(0);
  expect(await projector.locator("video").count()).toBe(1);
  expect(
    await page.evaluate(
      () => (window as any).__PROJECTION__.diagnostics().active,
    ),
  ).toBe(false);
  await projector.close();
  // A final remote heartbeat may still be visible before the close timer runs.
  // Wait for local ownership before treating positive tracking fps as handback.
  await expect
    .poll(() =>
      page.evaluate(() => (window as any).__PROJECTION__.diagnostics().active),
    )
    .toBe(true);
  await expect
    .poll(
      () => page.evaluate(() => (window as any).__PROJECTION__.tracking().fps),
      { timeout: 45000 },
    )
    .toBeGreaterThan(0);
  await expect(page.locator("video")).toHaveCount(1);
  expect(
    await page.evaluate(
      () => (window as any).__PROJECTION__.diagnostics().active,
    ),
  ).toBe(true);
  expect(
    (await page.getByRole("alert").allTextContents()).join(" "),
  ).not.toContain("already running");
});

test("floor dimensions can be edited without collapsing the output during an empty draft", async ({
  page,
}) => {
  await ready(page);
  const width = page.getByRole("spinbutton", {
    name: "Floor width in feet",
    exact: true,
  });
  const before = (await config(page)).floorWidth;
  await width.fill("");
  expect((await config(page)).floorWidth).toBe(before);
  await width.fill("8");
  await expect
    .poll(async () => (await config(page)).floorWidth)
    .toBeCloseTo(8 * 0.3048);
  await width.fill("20");
  await width.press("Tab");
  await expect(width).toHaveValue("12");
  expect((await config(page)).floorWidth).toBeCloseTo(12 * 0.3048);
  await width.fill("");
  await width.press("Tab");
  await expect(width).toHaveValue("12");
});

test("camera permission failure offers camera recovery without a stale scene error", async ({
  page,
  context,
}) => {
  test.setTimeout(60000);
  await context.grantPermissions(["camera"]);
  await page.addInitScript(() => {
    const capture = navigator.mediaDevices.getUserMedia.bind(
      navigator.mediaDevices,
    );
    let first = true;
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      if (first) {
        first = false;
        throw new DOMException(
          "Synthetic denied permission",
          "NotAllowedError",
        );
      }
      return capture(constraints);
    };
  });
  await ready(page);
  await page
    .getByRole("button", { name: "Connect camera", exact: true })
    .click();
  await expect(page.locator(".camera-status")).toContainText(
    "permission was denied",
  );
  await expect(
    page.getByRole("button", { name: "Reload scene", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Connect camera", exact: true })
    .click();
  await expect
    .poll(
      () => page.evaluate(() => (window as any).__PROJECTION__.tracking().fps),
      { timeout: 45000 },
    )
    .toBeGreaterThan(0);
  await expect(page.locator(".camera-status")).not.toContainText(
    "permission was denied",
  );
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("mirroring a projector-owned camera rejects queued old previews before accepting fresh corner marks", async ({
  page,
  context,
}) => {
  test.setTimeout(80000);
  await context.grantPermissions(["camera"]);
  await ready(page);
  const opened = page.waitForEvent("popup");
  await page
    .getByRole("button", { name: "Open projector", exact: true })
    .click();
  const projector = await opened;
  try {
    await expect
      .poll(() =>
        projector.evaluate(() =>
          Boolean((window as any).__PROJECTION__?.diagnostics().assetsLoaded),
        ),
      )
      .toBe(true);
    await connect(page);
    await align(page);
    const preview = page.getByAltText(
      "Click the projected floor corners in this camera preview",
    );
    await expect(preview).toBeVisible();
    // Capture and hold real child heartbeats, then deliberately deliver one
    // queued before the mirror change. This removes timer timing from the race.
    await projector.evaluate(() => {
      const original = BroadcastChannel.prototype.postMessage;
      (window as any).__sendHeartbeat = (message: unknown) => {
        const channel = new BroadcastChannel("projection-app-v1");
        original.call(channel, message);
        channel.close();
      };
      BroadcastChannel.prototype.postMessage = function (message) {
        if (message?.type === "heartbeat") {
          if ((window as any).__holdHeartbeats) return;
          (window as any).__oldHeartbeat = message;
        }
        return original.call(this, message);
      };
    });
    await expect
      .poll(() =>
        projector.evaluate(() =>
          Boolean((window as any).__oldHeartbeat?.preview),
        ),
      )
      .toBe(true);
    await projector.evaluate(() => {
      (window as any).__holdHeartbeats = true;
    });
    await page
      .getByRole("checkbox", { name: "Mirror camera preview", exact: true })
      .check();
    await expect(preview).toHaveCount(0);
    await projector.evaluate(() =>
      (window as any).__sendHeartbeat((window as any).__oldHeartbeat),
    );
    await page.waitForTimeout(150);
    await expect(preview).toHaveCount(0);
    const area = page.locator(".camera-alignment"),
      bounds = (await area.boundingBox())!;
    await area.click({
      position: { x: bounds.width * 0.1, y: bounds.height * 0.1 },
    });
    await expect(page.locator(".corner-tabs .lucide-check")).toHaveCount(0);
    await projector.evaluate(() => {
      (window as any).__holdHeartbeats = false;
    });
    await expect(preview).toBeVisible({ timeout: 45000 });
    await markCorners(page);
    await expect(page.locator(".corner-tabs .lucide-check")).toHaveCount(4);
    await page
      .getByRole("button", { name: "Save alignment", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect
      .poll(() => config(projector))
      .toMatchObject({ calibration: { mirrored: true, calibrated: true } });
  } finally {
    await projector.close();
  }
});

test("camera processing continues when hidden-video compositor callbacks are suppressed", async ({
  page,
  context,
}) => {
  test.setTimeout(60000);
  await context.grantPermissions(["camera"]);
  await page.addInitScript(() => {
    // Real Chrome can decode a hidden camera video while never presenting it.
    Object.defineProperty(
      HTMLVideoElement.prototype,
      "requestVideoFrameCallback",
      { configurable: true, value: () => 1 },
    );
    Object.defineProperty(
      HTMLVideoElement.prototype,
      "cancelVideoFrameCallback",
      { configurable: true, value: () => {} },
    );
  });
  await ready(page);
  await connect(page);
  const captured = () =>
    page.evaluate(
      () => (window as any).__PROJECTION__.tracking().submittedFrames ?? 0,
    );
  await expect.poll(captured).toBeGreaterThan(3);
  const before = await captured();
  await expect.poll(captured).toBeGreaterThan(before + 8);
  await expect
    .poll(() =>
      page.evaluate(() => (window as any).__PROJECTION__.tracking().fps),
    )
    .toBeGreaterThan(0);
  await page.getByRole("button", { name: "Mouse", exact: true }).click();
  await expect(page.locator("video")).toHaveCount(0);
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("reloading controls keeps a textured still preview while only the projector captures the camera", async ({
  page,
  context,
}) => {
  test.setTimeout(60000);
  await context.grantPermissions(["camera"]);
  await ready(page);
  await connect(page);
  const opened = page.waitForEvent("popup");
  await page
    .getByRole("button", { name: "Open projector", exact: true })
    .click();
  const projector = await opened;
  await expect
    .poll(
      () =>
        projector.evaluate(
          () => (window as any).__PROJECTION__?.tracking().fps ?? 0,
        ),
      { timeout: 45000 },
    )
    .toBeGreaterThan(0);
  await page.reload();
  await expect
    .poll(() =>
      page.evaluate(() => (window as any).__PROJECTION__?.diagnostics().active),
    )
    .toBe(false);
  const { PNG } = await import("pngjs");
  await expect
    .poll(async () => {
      const image = PNG.sync.read(await page.locator("canvas").screenshot());
      const colors = new Set<string>();
      for (let y = 1; y < 10; y++)
        for (let x = 1; x < 10; x++) {
          const index =
            (Math.floor((image.height * y) / 10) * image.width +
              Math.floor((image.width * x) / 10)) *
            4;
          colors.add(
            `${image.data[index]},${image.data[index + 1]},${image.data[index + 2]}`,
          );
        }
      return colors.size;
    })
    .toBeGreaterThan(20);
  await expect(page.locator("video")).toHaveCount(0);
  await expect(projector.locator("video")).toHaveCount(1);
  await projector.close();
});
