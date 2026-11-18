import { chromium } from "playwright";
import { writeFile, mkdir } from "node:fs/promises";
const actual = process.env.VISION_ACTUAL === "1";
const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: actual
    ? ["--use-fake-ui-for-media-stream"]
    : ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
});
const context = await browser.newContext({ permissions: ["camera"] });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
const percentile = (values, p) => {
  const sorted = [...values].sort((a, b) => a - b);
  return (
    sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0
  );
};
const summarize = (result) => {
  const frames = result.frames;
  const time = frames.map((f) => f.inferenceMs),
    age = frames.map((f) => f.received - f.captured);
  const phases = {};
  for (const key of Object.keys(frames[0]?.timings ?? {}))
    phases[key] = {
      median: percentile(
        frames.map((f) => f.timings[key]),
        0.5,
      ),
      p95: percentile(
        frames.map((f) => f.timings[key]),
        0.95,
      ),
    };
  return {
    ...result,
    summary: {
      fps: (frames.length * 1000) / result.durationMs,
      frameCount: frames.length,
      inferenceMs: {
        median: percentile(time, 0.5),
        p95: percentile(time, 0.95),
      },
      frameAgeMs: { median: percentile(age, 0.5), p95: percentile(age, 0.95) },
      handFrames: frames.filter((f) => f.hands > 0).length,
      phases,
    },
  };
};
try {
  await page.goto("http://127.0.0.1:5193/vision-bench.html");
  await page.waitForFunction(() => typeof window.runBenchmark === "function");
  const results = [];
  const kinds = (process.env.VISION_KINDS ?? "baseline").split(",");
  for (const kind of kinds) {
    const result = await page.evaluate(
      async ({ kind, actual }) => window.runBenchmark(kind, 10000, actual),
      { kind, actual },
    );
    results.push(summarize(result));
    console.log(JSON.stringify({ kind, summary: results.at(-1).summary }));
  }
  await mkdir("artifacts/qa/vision-performance", { recursive: true });
  await writeFile(
    process.env.VISION_REPORT ??
      `artifacts/qa/vision-performance/${actual ? "actual" : "synthetic"}-baseline.json`,
    JSON.stringify({ actual, errors, results }, null, 2),
  );
  if (errors.length || results.some((r) => r.summary.frameCount < 5))
    process.exitCode = 1;
} finally {
  await browser.close();
}
