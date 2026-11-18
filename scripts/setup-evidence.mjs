import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";

const base = process.env.PROJECTION_URL || "http://127.0.0.1:5188";
await mkdir("artifacts/qa/setup", { recursive: true });
const browser = await chromium.launch({
  channel: "chrome",
  // Chrome headless on this Mac rejects fullscreen for popup windows; headed mode verifies the actual output.
  headless: process.env.PROJECTION_HEADED !== "1",
  args: [
    "--use-fake-device-for-media-stream",
    "--use-fake-ui-for-media-stream",
  ],
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  permissions: ["camera"],
});
const page = await context.newPage();
page.setDefaultTimeout(20000);
const errors = [];
try {
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.goto(base);
  await page.waitForLoadState("networkidle");
  await page.waitForFunction(
    () => window.__PROJECTION__?.diagnostics().assetsLoaded,
  );
  const layouts = [];
  for (const [name, width, height] of [
    ["desktop", 1440, 1000],
    ["compact", 656, 852],
    ["phone", 390, 844],
  ]) {
    await page.setViewportSize({ width, height });
    await page
      .getByRole("heading", { name: "Floor setup", exact: true })
      .locator("..")
      .scrollIntoViewIfNeeded();
    await page.screenshot({ path: `artifacts/qa/setup/${name}.png` });
    layouts.push(
      await page.evaluate(() => ({
        width: innerWidth,
        height: innerHeight,
        scrollWidth: document.documentElement.scrollWidth,
        output: document
          .querySelector(".setup-output")
          .getBoundingClientRect()
          .toJSON(),
      })),
    );
  }
  await page.setViewportSize({ width: 656, height: 852 });
  await page
    .getByRole("button", { name: "Connect camera", exact: true })
    .click();
  await page.waitForFunction(() => window.__PROJECTION__?.tracking().fps > 0);
  await page
    .getByRole("button", { name: "Align camera", exact: true })
    .last()
    .click();
  await page
    .getByAltText("Click the projected floor corners in this camera preview")
    .waitFor();
  await page.screenshot({ path: "artifacts/qa/setup/camera-alignment.png" });
  await page
    .getByRole("button", { name: "Close alignment", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Adjust projector corners", exact: true })
    .click();
  await page.screenshot({ path: "artifacts/qa/setup/output-alignment.png" });
  await page
    .getByRole("button", { name: "Close alignment", exact: true })
    .click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  const opened = page.waitForEvent("popup");
  await page
    .getByRole("button", { name: "Open projector", exact: true })
    .click();
  const projector = await opened;
  await projector.waitForFunction(
    () => window.__PROJECTION__?.diagnostics().assetsLoaded,
  );
  await page.getByText("Projector window open", { exact: true }).waitFor();
  await page
    .getByRole("heading", { name: "Floor setup", exact: true })
    .locator("..")
    .scrollIntoViewIfNeeded();
  await page.screenshot({ path: "artifacts/qa/setup/projector-window.png" });
  await projector.bringToFront();
  await projector
    .getByRole("button", { name: "Fullscreen", exact: true })
    .click();
  await projector.waitForFunction(() => Boolean(document.fullscreenElement));
  await page.getByText("Projector fullscreen", { exact: true }).waitFor();
  await page
    .getByRole("heading", { name: "Floor setup", exact: true })
    .locator("..")
    .scrollIntoViewIfNeeded();
  await page.screenshot({
    path: "artifacts/qa/setup/projector-fullscreen.png",
  });
  await context.close();
  await writeFile(
    "artifacts/qa/setup/evidence.json",
    JSON.stringify(
      {
        syntheticCamera: true,
        headed: process.env.PROJECTION_HEADED === "1",
        projectorFullscreen: true,
        errors,
        layouts,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ errors, layouts }));
} finally {
  await browser.close();
}
