import { chromium } from "playwright";
import { mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { performance as clock } from "node:perf_hooks";

const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const [key, value] = arg.replace(/^--/, "").split("=");
    return [key, value ?? true];
  }),
);
const base = String(args.base ?? "http://127.0.0.1:5189");
const label = String(args.label ?? "baseline").replace(/[^a-zA-Z0-9_-]/g, "");
const duration = Number(args.duration ?? 6500);
const scenes = [
  "tide-pool",
  "koi-pond",
  "forest-floor",
  "butterfly-meadow",
  "sandy-beach",
  "starlit-cosmos",
];
const sizes = [
  { width: 1280, height: 720, dpr: 1 },
  { width: 1920, height: 1080, dpr: 2 },
];
const selectedScenes = args.scene
  ? scenes.filter((id) => id === args.scene)
  : scenes;
const selectedSizes = args.dpr
  ? sizes.filter((size) => size.dpr === Number(args.dpr))
  : sizes;
const settings = {
  activityId: "koi-pond",
  fishCount: 20,
  fishSpeed: 1.5,
  sound: false,
  diagnostics: true,
  inputMode: "pointer",
  floorWidth: 1.8288,
  floorHeight: 1.2192,
  activitySettings: {
    "koi-pond": { fishCount: 20, fishSpeed: 1.5 },
    "forest-floor": { leafCount: 48, breeze: 1 },
    "tide-pool": { crabCount: 12, waterMotion: 1 },
    "butterfly-meadow": { butterflyCount: 16, breeze: 1 },
    "sandy-beach": { trailDuration: 12, waveMotion: 1 },
    "starlit-cosmos": { starCount: 360, drift: 1, starlight: 1 },
  },
};
const quantile = (sorted, p) =>
  sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? null;
const browser = await chromium.launch({ channel: "chrome", headless: true });
const browserSession = await browser.newBrowserCDPSession();
const gpu = (await browserSession.send("SystemInfo.getInfo")).gpu;
await mkdir("artifacts/qa", { recursive: true });
const builds = [];
for (const name of await readdir("dist/assets"))
  if (name.endsWith(".js"))
    builds.push({
      name,
      sha256: createHash("sha256")
        .update(await readFile(`dist/assets/${name}`))
        .digest("hex"),
    });
const report = {
  label,
  base,
  date: new Date().toISOString(),
  browser: browser.version(),
  gpu,
  builds,
  method: {
    headless: true,
    production: true,
    camera: false,
    highCountSettings: settings.activitySettings,
    durationMs: duration,
    warmupMs: 1500,
    interaction:
      "Synthetic browser PointerEvents at30Hz, tap400ms; actual requestAnimationFrame timestamps, no appFPS substitution.",
    limitation:
      "Headless Chrome compositor timing on this Mac, not physical projector/camera, and CDP CPU duration is not direct GPU time.",
  },
  cases: [],
};
const output = `artifacts/qa/performance-${label}.json`;
try {
  for (const size of selectedSizes)
    for (const id of selectedScenes) {
      const errors = [],
        consoleErrors = [];
      const context = await browser.newContext({
        viewport: { width: 1280, height: 800 },
        deviceScaleFactor: size.dpr,
      });
      await context.addInitScript(
        ({ config, id }) => {
          localStorage.setItem(
            "projection-app.settings.v1",
            JSON.stringify({
              version: 1,
              settings: { ...config, activityId: id },
            }),
          );
        },
        { config: settings, id },
      );
      const parent = await context.newPage();
      context.on("page", (page) => {
        page.on("pageerror", (error) => errors.push(String(error)));
        page.on("console", (message) => {
          if (message.type() === "error") consoleErrors.push(message.text());
        });
      });
      parent.on("pageerror", (error) => errors.push(String(error)));
      const started = clock.now();
      await parent.goto(base, { waitUntil: "networkidle" });
      const popupPromise = parent.waitForEvent("popup");
      await parent
        .getByRole("button", { name: "Open projector", exact: true })
        .click();
      const page = await popupPromise;
      await page.setViewportSize({ width: size.width, height: size.height });
      await page.bringToFront();
      await page.waitForLoadState("networkidle");
      await page.locator(".scene-stage canvas").waitFor({ state: "visible" });
      await page.waitForFunction(
        () =>
          document.querySelector("canvas")?.width > 0 &&
          !document.querySelector(".blank-cover"),
      );
      const loadAndProjectorMs = clock.now() - started;
      await page.waitForTimeout(1500);
      const device = await page.evaluate(() => {
        const c = document.querySelector("canvas");
        const gl = c.getContext("webgl2");
        const ext = gl?.getExtension("WEBGL_debug_renderer_info");
        return {
          canvas: {
            width: c.width,
            height: c.height,
            cssWidth: c.clientWidth,
            cssHeight: c.clientHeight,
          },
          dpr: devicePixelRatio,
          renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null,
          vendor: ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : null,
          visibility: document.visibilityState,
        };
      });
      const cdp = await context.newCDPSession(page);
      await cdp.send("Performance.enable");
      const before = (await cdp.send("Performance.getMetrics")).metrics;
      if (args.profile) {
        await cdp.send("Profiler.enable");
        await cdp.send("Profiler.setSamplingInterval", { interval: 1000 });
        await cdp.send("Profiler.start");
      }
      const beforeHeap = await cdp.send("Runtime.getHeapUsage");
      const measured = await page.evaluate(async (duration) => {
        const intervals = [],
          longTasks = [];
        let last = 0;
        const observer = new PerformanceObserver((entries) => {
          for (const entry of entries.getEntries())
            longTasks.push({
              start: entry.startTime,
              duration: entry.duration,
            });
        });
        observer.observe({ entryTypes: ["longtask"] });
        const stage = document.querySelector(".scene-stage");
        let sequence = 0;
        const events = setInterval(() => {
          const rect = stage.getBoundingClientRect();
          const t = sequence++ / 30;
          const point = {
            clientX: rect.left + rect.width * (0.5 + Math.sin(t * 2.3) * 0.34),
            clientY: rect.top + rect.height * (0.5 + Math.cos(t * 1.9) * 0.28),
            pointerId: 1,
            pointerType: "mouse",
            bubbles: true,
          };
          stage.dispatchEvent(new PointerEvent("pointermove", point));
          if (sequence % 12 === 0)
            stage.dispatchEvent(
              new PointerEvent("pointerdown", { ...point, buttons: 1 }),
            );
        }, 1000 / 30);
        const start = performance.now();
        await new Promise((resolve) => {
          function frame(timestamp) {
            if (last) intervals.push(timestamp - last);
            last = timestamp;
            if (performance.now() - start >= duration) resolve();
            else requestAnimationFrame(frame);
          }
          requestAnimationFrame(frame);
        });
        clearInterval(events);
        observer.disconnect();
        return {
          intervals,
          longTasks,
          elapsed: performance.now() - start,
          interactions: sequence,
        };
      }, duration);
      if (args.profile) {
        const { profile } = await cdp.send("Profiler.stop");
        await writeFile(
          `artifacts/qa/performance-${label}-${id}-dpr${size.dpr}-cpu.json`,
          JSON.stringify(profile),
        );
      }
      const after = (await cdp.send("Performance.getMetrics")).metrics;
      const afterHeap = await cdp.send("Runtime.getHeapUsage");
      const cpu = {};
      for (const key of [
        "ScriptDuration",
        "TaskDuration",
        "LayoutDuration",
        "RecalcStyleDuration",
      ]) {
        const delta =
          (after.find((m) => m.name === key)?.value ?? 0) -
          (before.find((m) => m.name === key)?.value ?? 0);
        cpu[key + "Ms"] = delta * 1000;
        cpu[key + "Percent"] = ((delta * 1000) / measured.elapsed) * 100;
      }
      const sorted = [...measured.intervals].sort((a, b) => a - b);
      const result = {
        id,
        viewport: size,
        device,
        loadAndProjectorMs,
        elapsedMs: measured.elapsed,
        frames: sorted.length,
        medianMs: quantile(sorted, 0.5),
        p95Ms: quantile(sorted, 0.95),
        p99Ms: quantile(sorted, 0.99),
        averageMs: sorted.reduce((a, b) => a + b, 0) / sorted.length,
        over25Ms: sorted.filter((v) => v > 25).length,
        over50Ms: sorted.filter((v) => v > 50).length,
        cpu,
        heapBefore: beforeHeap,
        heapAfter: afterHeap,
        longTasks: measured.longTasks,
        interactions: measured.interactions,
        errors,
        consoleErrors,
        diagnostics: await parent
          .locator(".diagnostics")
          .innerText()
          .catch(() => ""),
        intervals: measured.intervals,
      };
      report.cases.push(result);
      await writeFile(output, JSON.stringify(report, null, 2));
      console.log(
        JSON.stringify({
          id,
          dpr: size.dpr,
          canvas: device.canvas,
          median: result.medianMs,
          p95: result.p95Ms,
          p99: result.p99Ms,
          over25: result.over25Ms,
          over50: result.over50Ms,
          scriptPercent: cpu.ScriptDurationPercent,
          taskPercent: cpu.TaskDurationPercent,
          errors,
        }),
      );
      await context.close();
    }
} finally {
  await writeFile(output, JSON.stringify(report, null, 2));
  await browser.close();
}
