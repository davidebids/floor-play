import { test, expect } from "@playwright/test";

test("a lost graphics context reports the problem and restores the pond", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.goto("/");
  const diag = () =>
    page.evaluate(() => (window as any).__PROJECTION__.diagnostics());
  await expect.poll(async () => (await diag()).assetsLoaded).toBe(true);
  await page.evaluate(() => {
    const canvas = document.querySelector("canvas")!;
    const gl = canvas.getContext("webgl2")!;
    const extension = gl.getExtension("WEBGL_lose_context");
    if (!extension)
      throw new Error("WebGL context-loss test extension unavailable");
    (window as any).__restoreTestContext = () => extension.restoreContext();
    extension.loseContext();
  });
  await expect(page.getByRole("alert")).toContainText(
    "Graphics are unavailable",
  );
  await expect(
    page.getByRole("button", { name: "Reload scene" }),
  ).toBeVisible();
  await page.evaluate(() => (window as any).__restoreTestContext());
  await expect.poll(async () => (await diag()).assetsLoaded).toBe(true);
  await expect(page.getByRole("alert")).toHaveCount(0);
  const first = JSON.stringify((await diag()).positions);
  await expect
    .poll(async () => JSON.stringify((await diag()).positions))
    .not.toBe(first);
  expect(errors).toEqual([]);
});

test("projector graphics problems reach the controls and clear after recovery", async ({
  page,
}) => {
  await page.goto("/");
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as any).__PROJECTION__.diagnostics().assetsLoaded,
      ),
    )
    .toBe(true);
  const popupPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Open projector" }).click();
  const popup = await popupPromise;
  await expect
    .poll(() =>
      popup.evaluate(
        () => (window as any).__PROJECTION__?.diagnostics().assetsLoaded,
      ),
    )
    .toBe(true);
  await popup.evaluate(() => {
    const gl = document.querySelector("canvas")!.getContext("webgl2")!;
    const extension = gl.getExtension("WEBGL_lose_context")!;
    (window as any).__restoreTestContext = () => extension.restoreContext();
    extension.loseContext();
  });
  await expect(page.getByRole("alert")).toContainText(
    "Graphics are unavailable",
  );
  await popup.evaluate(() => (window as any).__restoreTestContext());
  await expect
    .poll(() =>
      popup.evaluate(
        () => (window as any).__PROJECTION__.diagnostics().assetsLoaded,
      ),
    )
    .toBe(true);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await popup.close();
});
