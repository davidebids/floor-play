import { test, expect } from "@playwright/test";

test.use({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2 });
test("fullscreen preview preserves floor proportions and renders every layer at Retina density", async ({
  page,
}) => {
  await page.goto("/");
  const diag = () =>
    page.evaluate(() => (window as any).__PROJECTION__.diagnostics());
  await expect.poll(async () => (await diag()).assetsLoaded).toBe(true);
  await page
    .getByRole("button", { name: "Fullscreen preview", exact: true })
    .click();
  await expect
    .poll(() => page.evaluate(() => document.fullscreenElement?.className))
    .toBe("scene-frame");
  const display = () =>
    page.locator("canvas").evaluate((canvas) => ({
      width: canvas.clientWidth,
      height: canvas.clientHeight,
      dpr: devicePixelRatio,
    }));
  await expect
    .poll(async () => {
      const s = await display();
      return Math.abs(s.width / s.height - 1.5);
    })
    .toBeLessThan(0.005);
  await expect
    .poll(async () => {
      const s = await display();
      return (await diag()).renderWidth / (s.width * s.dpr);
    })
    .toBeGreaterThanOrEqual(0.985);
  const large = await diag();
  expect(large.renderWidth).toBeGreaterThan(3000);
  expect(large.underwaterWidth).toBe(large.renderWidth);
  expect(large.compositeWidth).toBe(large.renderWidth);
  expect(large.underwaterHeight).toBe(large.renderHeight);
  expect(large.compositeHeight).toBe(large.renderHeight);
  expect(large.logicalWidth).toBe(960);
  expect(large.logicalHeight).toBe(640);
  await page.evaluate(() => document.exitFullscreen());
  await expect
    .poll(async () => (await diag()).renderWidth)
    .toBeLessThan(large.renderWidth);
  const restored = await diag();
  expect(restored.textures).toBe(large.textures);
  expect(restored.geometries).toBe(large.geometries);
});
