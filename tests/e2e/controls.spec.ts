import { test, expect } from "@playwright/test";
const diag = (page: any) =>
  page.evaluate(() => (window as any).__PROJECTION__.diagnostics());
test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect.poll(async () => (await diag(page))?.assetsLoaded).toBe(true);
});
test("pond renders generated assets and pointer input creates local splash", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  const stage = page.getByLabel("Interactive scene: Koi pond");
  const box = (await stage.boundingBox())!;
  const before = await diag(page);
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await expect
    .poll(async () => (await diag(page)).splashCount)
    .toBeGreaterThan(before.splashCount);
  expect((await diag(page)).drawCalls).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});
test("pause freezes fish, resume advances, blank restores", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(page.getByText("Scene paused", { exact: true })).toBeVisible();
  const stopped = (await diag(page)).positions;
  await page.waitForTimeout(220);
  expect((await diag(page)).positions).toEqual(stopped);
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await expect
    .poll(async () => JSON.stringify((await diag(page)).positions))
    .not.toBe(JSON.stringify(stopped));
  await page.getByRole("button", { name: "Blank floor", exact: true }).click();
  await expect(page.locator(".blank-cover")).toBeVisible();
  await page
    .getByRole("button", { name: "Restore picture", exact: true })
    .click();
  await expect(page.locator(".blank-cover")).toHaveCount(0);
});
test("parent settings apply to scene and persist", async ({ page }) => {
  const slider = page.getByRole("slider", { name: "Koi", exact: true });
  await slider.focus();
  await slider.press("Home");
  for (let i = 0; i < 10; i++) await slider.press("ArrowRight");
  await expect.poll(async () => (await diag(page)).fish).toBe(12);
  await page.getByRole("button", { name: "Enable sound" }).click();
  await expect(
    page.getByRole("button", { name: "Mute sound" }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.reload();
  await expect.poll(async () => (await diag(page))?.fish).toBe(12);
  await expect(page.getByRole("button", { name: "Mute sound" })).toBeVisible();
});
test("alignment dialog handles missing camera and output reset", async ({
  page,
}) => {
  await page
    .getByRole("button", { name: "Align camera", exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("dialog", { name: "Align camera" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Save alignment" }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "Connect the camera",
  );
  await page.getByRole("button", { name: "Close alignment" }).click();
  await page.getByRole("button", { name: "Adjust projector corners" }).click();
  await page
    .getByRole("spinbutton", { name: "Top left x", exact: true })
    .fill("6");
  await page
    .getByRole("button", { name: "Reset corners", exact: true })
    .click();
  await expect(
    page.getByRole("spinbutton", { name: "Top left x", exact: true }),
  ).toHaveValue("0");
  await page.getByRole("button", { name: "Save alignment" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
test("projector syncs pause blank count and returns ownership on close", async ({
  page,
}) => {
  const popupPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Open projector" }).click();
  const popup = await popupPromise;
  await popup.waitForLoadState("domcontentloaded");
  await expect.poll(async () => (await diag(popup))?.assetsLoaded).toBe(true);
  await expect(
    page.getByText("Projector connected", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await expect
    .poll(() =>
      popup.evaluate(() => (window as any).__PROJECTION__.settings().paused),
    )
    .toBe(true);
  await page.getByRole("button", { name: "Blank floor", exact: true }).click();
  await expect(popup.locator(".blank-cover")).toBeVisible();
  await page
    .getByRole("button", { name: "Restore picture", exact: true })
    .click();
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await popup.close();
  await expect(page.getByText("Mouse preview", { exact: true })).toBeVisible();
  await expect.poll(async () => (await diag(page)).active).toBe(true);
});
test("keyboard shortcuts work and ignore number inputs", async ({ page }) => {
  await page.locator("h1").click();
  await page.keyboard.press("Space");
  await expect(page.getByText("Scene paused", { exact: true })).toBeVisible();
  await page.keyboard.press("Space");
  await page.keyboard.press("b");
  await expect(page.locator(".blank-cover")).toBeVisible();
  await page.keyboard.press("b");
  const field = page.getByRole("spinbutton", { name: "Floor width in feet" });
  await field.focus();
  await page.keyboard.press("b");
  await expect(page.locator(".blank-cover")).toHaveCount(0);
});
