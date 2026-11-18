import { test, expect, type Page } from "@playwright/test";
const scenes = [
  ["koi-pond", "Koi pond"],
  ["forest-floor", "Forest floor"],
  ["tide-pool", "Tide pool"],
  ["butterfly-meadow", "Butterfly meadow"],
  ["sandy-beach", "Sandy beach"],
] as const;
const diagnostics = (page: Page) =>
  page.evaluate(() => (window as any).__PROJECTION__?.diagnostics());
const settings = (page: Page) =>
  page.evaluate(() => (window as any).__PROJECTION__.settings());
async function ready(page: Page, id: string) {
  await expect
    .poll(async () => {
      const d = await diagnostics(page);
      return d?.activityId === id && d?.assetsLoaded;
    })
    .toBe(true);
}
async function choose(page: Page, id: string, title: string) {
  await page.getByRole("combobox", { name: "Scene", exact: true }).click();
  await page.getByRole("option", { name: new RegExp(`^${title}`) }).click();
  await ready(page, id);
}
async function pixelDiversity(page: Page) {
  return page.evaluate(
    () =>
      new Promise<number>((resolve) =>
        requestAnimationFrame(() => {
          const canvas = document.querySelector("canvas")!,
            gl = canvas.getContext("webgl2")!;
          const data = new Uint8Array(canvas.width * canvas.height * 4);
          gl.readPixels(
            0,
            0,
            canvas.width,
            canvas.height,
            gl.RGBA,
            gl.UNSIGNED_BYTE,
            data,
          );
          const colors = new Set<string>();
          for (let y = 0; y < 8; y++)
            for (let x = 0; x < 8; x++) {
              const index =
                (Math.floor(canvas.height * (0.08 + y * 0.12)) * canvas.width +
                  Math.floor(canvas.width * (0.08 + x * 0.12))) *
                4;
              colors.add(
                `${data[index]},${data[index + 1]},${data[index + 2]}`,
              );
            }
          resolve(colors.size);
        }),
      ),
  );
}

test("all five scenes display artwork, respond to input, pause, blank and switch repeatedly", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto("/");
  await ready(page, "koi-pond");
  for (const [id, title] of scenes) {
    await choose(page, id, title);
    // Catch an uploaded but culled/missing background, not just failed fetches.
    await expect.poll(() => pixelDiversity(page)).toBeGreaterThan(28);
    const before = await diagnostics(page),
      canvas = page.getByLabel(`Interactive scene: ${title}`, { exact: true }),
      bounds = (await canvas.boundingBox())!;
    await page.mouse.click(
      bounds.x + bounds.width * 0.5,
      bounds.y + bounds.height * 0.55,
    );
    await expect
      .poll(async () => {
        const d = await diagnostics(page);
        return d.impulseCount ?? d.splashCount;
      })
      .toBeGreaterThan(before.impulseCount ?? before.splashCount);
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    const positions = JSON.stringify((await diagnostics(page)).positions);
    await page.waitForTimeout(140);
    expect(JSON.stringify((await diagnostics(page)).positions)).toBe(positions);
    await page.getByRole("button", { name: "Resume", exact: true }).click();
    await page
      .getByRole("button", { name: "Blank floor", exact: true })
      .click();
    await expect(page.locator(".blank-cover")).toBeVisible();
    await page
      .getByRole("button", { name: "Restore picture", exact: true })
      .click();
  }
  for (const [id, title] of [...scenes].reverse())
    await choose(page, id, title);
  expect(await page.locator("canvas").count()).toBe(1);
  expect(errors).toEqual([]);
});

test("new-scene preferences stay independent and selected scene survives reload", async ({
  page,
}) => {
  await page.goto("/");
  await ready(page, "koi-pond");
  await choose(page, "forest-floor", "Forest floor");
  const leaves = page.getByRole("slider", { name: "Leaves", exact: true });
  await leaves.focus();
  await leaves.press("Home");
  await leaves.press("ArrowRight");
  await leaves.press("ArrowRight");
  await expect.poll(async () => (await diagnostics(page)).actors).toBe(14);
  await choose(page, "butterfly-meadow", "Butterfly meadow");
  const butterflies = page.getByRole("slider", {
    name: "Butterflies",
    exact: true,
  });
  await butterflies.focus();
  await butterflies.press("Home");
  await butterflies.press("ArrowRight");
  await butterflies.press("ArrowRight");
  await expect.poll(async () => (await diagnostics(page)).actors).toBe(6);
  await choose(page, "forest-floor", "Forest floor");
  await expect.poll(async () => (await diagnostics(page)).actors).toBe(14);
  expect(
    (await settings(page)).activitySettings["butterfly-meadow"].butterflyCount,
  ).toBe(6);
  expect((await settings(page)).fishCount).toBe(8);
  await page.reload();
  await ready(page, "forest-floor");
  await expect.poll(async () => (await diagnostics(page)).actors).toBe(14);
});

test("projector follows new-scene selection and hands rendering back on close", async ({
  page,
}) => {
  await page.goto("/");
  await ready(page, "koi-pond");
  await choose(page, "sandy-beach", "Sandy beach");
  const pending = page.waitForEvent("popup");
  await page
    .getByRole("button", { name: "Open projector", exact: true })
    .click();
  const projector = await pending;
  await ready(projector, "sandy-beach");
  await expect.poll(async () => (await diagnostics(page)).active).toBe(false);
  await choose(page, "forest-floor", "Forest floor");
  await ready(projector, "forest-floor");
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await expect.poll(async () => (await settings(projector)).paused).toBe(true);
  await projector.close();
  await expect.poll(async () => (await diagnostics(page)).active).toBe(true);
  await expect
    .poll(async () => (await diagnostics(page)).activityId)
    .toBe("forest-floor");
});

test("recorded sound stays live across scene changes and all voices stop on pause, blank and mute", async ({
  page,
  context,
}) => {
  await context.addInitScript(() => {
    const Native = window.AudioContext,
      w = window as any;
    w.__auditContexts = [];
    w.__auditVoices = new Set();
    window.AudioContext = class extends Native {
      constructor(options?: AudioContextOptions) {
        super(options);
        w.__auditContexts.push(this);
      }
      createBufferSource() {
        const source = super.createBufferSource(),
          start = source.start.bind(source),
          stop = source.stop.bind(source);
        source.start = ((...args: any[]) => {
          w.__auditVoices.add(source);
          return (start as any)(...args);
        }) as any;
        source.stop = ((...args: any[]) => {
          w.__auditVoices.delete(source);
          return (stop as any)(...args);
        }) as any;
        source.addEventListener("ended", () => w.__auditVoices.delete(source));
        return source;
      }
    };
  });
  await page.goto("/");
  await ready(page, "koi-pond");
  const voices = () => page.evaluate(() => (window as any).__auditVoices.size);
  expect(
    await page.evaluate(() => (window as any).__auditContexts.length),
  ).toBe(0);
  await page.getByRole("button", { name: "Enable sound", exact: true }).click();
  await expect.poll(voices).toBeGreaterThan(0);
  for (const [id, title] of scenes.slice(1)) {
    await choose(page, id, title);
    // No canvas click is allowed here: this must carry the earlier sound gesture.
    await expect
      .poll(() =>
        page.evaluate(() => (window as any).__auditContexts.at(-1)?.state),
      )
      .toBe("running");
    await expect.poll(voices).toBeGreaterThan(0);
    expect(
      await page.evaluate(
        () =>
          (window as any).__auditContexts.filter(
            (c: AudioContext) => c.state !== "closed",
          ).length,
      ),
    ).toBe(1);
  }
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await expect.poll(voices).toBe(0);
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await expect.poll(voices).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Blank floor", exact: true }).click();
  await expect.poll(voices).toBe(0);
  await page
    .getByRole("button", { name: "Restore picture", exact: true })
    .click();
  await expect.poll(voices).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Mute sound", exact: true }).click();
  await expect.poll(voices).toBe(0);
});

test("a slow obsolete scene load cannot replace or blank the scene chosen afterward", async ({
  page,
}) => {
  let release!: () => void, intercepted!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const requestSeen = new Promise<void>((resolve) => {
    intercepted = resolve;
  });
  await page.route("**/activities/forest-meadow.ts*", async (route) => {
    intercepted();
    await held;
    await route.continue();
  });
  await page.goto("/");
  await ready(page, "koi-pond");
  await page.getByRole("combobox", { name: "Scene", exact: true }).click();
  await page.getByRole("option", { name: /^Forest floor/ }).click();
  await requestSeen;
  await choose(page, "tide-pool", "Tide pool");
  release();
  await page.waitForTimeout(400);
  expect((await diagnostics(page)).activityId).toBe("tide-pool");
  expect(await pixelDiversity(page)).toBeGreaterThan(28);
  const before = (await diagnostics(page)).frames;
  await expect
    .poll(async () => (await diagnostics(page)).frames)
    .toBeGreaterThan(before);
});
