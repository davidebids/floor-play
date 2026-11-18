import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Activity, InteractionFrame, ProjectionSettings } from "./types";
const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  vision: {
    start: vi.fn(async () => {}),
    stop: vi.fn(),
    configure: vi.fn(),
    listDevices: vi.fn(async () => []),
  },
  audio: {
    configure: vi.fn(),
    unlock: vi.fn(),
    impulse: vi.fn(),
    dispose: vi.fn(),
  },
  cameraFrame: undefined as ((frame: InteractionFrame) => void) | undefined,
}));
vi.mock("./registry", () => ({ loadActivity: mocks.load }));
vi.mock("./vision/controller", () => ({
  createVisionController: (callbacks: {
    onFrame: (frame: InteractionFrame) => void;
  }) => {
    mocks.cameraFrame = callbacks.onFrame;
    return mocks.vision;
  },
}));
import { ProjectionRuntime } from "./runtime";
import { sanitizeSettings } from "./storage";
function scene(id = "koi-pond"): Activity {
  return {
    id,
    title: id,
    audio: mocks.audio,
    configure: vi.fn(),
    update: vi.fn(),
    render: vi.fn(),
    dispose: vi.fn(() => mocks.audio.dispose()),
    diagnostics: vi.fn(() => ({ id })),
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
async function flush() {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}
let now = 1000,
  rafId = 0,
  frames: Map<number, FrameRequestCallback>,
  settings: ProjectionSettings;
const callbacks = () => ({
  onTracking: vi.fn(),
  onPreview: vi.fn(),
  onMetrics: vi.fn(),
  onError: vi.fn(),
});
function tick(time = now) {
  now = time;
  const first = frames.entries().next().value as
    [number, FrameRequestCallback] | undefined;
  expect(first).toBeDefined();
  frames.delete(first![0]);
  first![1](time);
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.load.mockReset();
  now = 1000;
  rafId = 0;
  frames = new Map();
  settings = sanitizeSettings({});
  vi.spyOn(performance, "now").mockImplementation(() => now);
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    const id = ++rafId;
    frames.set(id, cb);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe("projection runtime activity lifecycle", () => {
  it("plays interaction audio only for actions the scene accepts", async () => {
    const a = scene();
    vi.mocked(a.update).mockReturnValue([]);
    mocks.load.mockResolvedValue(a);
    const runtime = new ProjectionRuntime(
      {} as HTMLCanvasElement,
      settings,
      callbacks(),
    );
    await flush();
    runtime.pointer({ x: 0.02, y: 0.5 }, true);
    tick();
    expect(a.update).toHaveBeenCalled();
    expect(mocks.audio.impulse).not.toHaveBeenCalled();
    runtime.dispose();
  });
  it.each(["pointer", "camera", "replay"])(
    "does not queue %s input while its activity is still loading",
    async (source) => {
      const pending = deferred<Activity>(),
        a = scene();
      mocks.load.mockReturnValueOnce(pending.promise);
      const runtime = new ProjectionRuntime(
        {} as HTMLCanvasElement,
        { ...settings, inputMode: source === "camera" ? "camera" : "pointer" },
        callbacks(),
      );
      const frame: InteractionFrame = {
        timestamp: now,
        source: "camera",
        presence: [],
        motion: [],
        impulses: [
          {
            id: "loading",
            position: { x: 0.5, y: 0.5 },
            timestamp: now,
            confidence: 0.9,
            strength: 1,
          },
        ],
      };
      if (source === "pointer") runtime.pointer({ x: 0.5, y: 0.5 }, true);
      if (source === "camera") mocks.cameraFrame!(frame);
      if (source === "replay") runtime.replay(frame);
      pending.resolve(a);
      await flush();
      tick(now + 17);
      expect(vi.mocked(a.update).mock.lastCall?.[2].impulses).toHaveLength(0);
      runtime.dispose();
    },
  );
  it("continues switching scenes if old graphics cleanup throws", async () => {
    const a = scene(),
      b = scene("forest-floor");
    mocks.load.mockResolvedValueOnce(a).mockResolvedValueOnce(b);
    const runtime = new ProjectionRuntime(
      {} as HTMLCanvasElement,
      settings,
      callbacks(),
    );
    await flush();
    vi.mocked(a.dispose).mockImplementation(() => {
      throw new Error("lost graphics context");
    });
    expect(() =>
      runtime.configure({ ...settings, activityId: "forest-floor" }),
    ).not.toThrow();
    await flush();
    tick();
    expect(b.render).toHaveBeenCalledOnce();
    runtime.dispose();
  });
  it("clears a scene failure after changing to a successfully loaded scene", async () => {
    const events = callbacks();
    mocks.load.mockRejectedValueOnce(new Error("broken scene"));
    const runtime = new ProjectionRuntime(
      {} as HTMLCanvasElement,
      settings,
      events,
    );
    await flush();
    expect(events.onError).toHaveBeenLastCalledWith(
      expect.stringContaining("broken scene"),
    );
    mocks.load.mockResolvedValueOnce(scene("forest-floor"));
    runtime.configure({ ...settings, activityId: "forest-floor" });
    await flush();
    expect(events.onError).toHaveBeenLastCalledWith("");
    runtime.dispose();
  });
  it("reports artwork errors even when an inactive preview is waiting for assets", async () => {
    const a = scene(),
      events = callbacks();
    vi.mocked(a.diagnostics).mockReturnValue({
      assetsLoaded: false,
      assetError: "Missing scene artwork",
    });
    mocks.load.mockResolvedValueOnce(a);
    const runtime = new ProjectionRuntime(
      {} as HTMLCanvasElement,
      settings,
      events,
    );
    runtime.requestPreview();
    runtime.setActive(false);
    await flush();
    tick();
    expect(events.onError).toHaveBeenLastCalledWith(
      expect.stringContaining("Missing scene artwork"),
    );
    runtime.dispose();
  });
  it("draws one loaded control preview while inactive without simulation or camera capture", async () => {
    const a = scene();
    let loaded = false;
    vi.mocked(a.diagnostics).mockImplementation(() => ({
      assetsLoaded: loaded,
    }));
    mocks.load.mockResolvedValue(a);
    const runtime = new ProjectionRuntime(
      {} as HTMLCanvasElement,
      settings,
      callbacks(),
    );
    runtime.requestPreview();
    runtime.setActive(false);
    await flush();
    tick();
    expect(a.render).not.toHaveBeenCalled();
    loaded = true;
    tick(now + 17);
    expect(a.render).toHaveBeenCalledOnce();
    for (let i = 0; i < 60; i++) tick(now + 17);
    expect(a.render).toHaveBeenCalledOnce();
    expect(a.update).not.toHaveBeenCalled();
    expect(mocks.vision.start).not.toHaveBeenCalled();
    runtime.configure({ ...settings, fishCount: 12 });
    tick(now + 17);
    expect(a.render).toHaveBeenCalledTimes(2);
    tick(now + 17);
    expect(a.render).toHaveBeenCalledTimes(2);
    runtime.dispose();
  });
  it("switches scenes, disposes the old scene, and keeps exactly one RAF loop", async () => {
    const a = scene(),
      b = scene("internal-test");
    mocks.load.mockResolvedValueOnce(a).mockResolvedValueOnce(b);
    const runtime = new ProjectionRuntime(
      {} as HTMLCanvasElement,
      settings,
      callbacks(),
    );
    await flush();
    expect(frames.size).toBe(1);
    tick();
    expect(a.render).toHaveBeenCalledTimes(1);
    runtime.configure({ ...settings, activityId: "internal-test" });
    expect(a.dispose).toHaveBeenCalledTimes(1);
    await flush();
    tick(now + 17);
    expect(b.render).toHaveBeenCalledTimes(1);
    expect(a.render).toHaveBeenCalledTimes(1);
    expect(frames.size).toBe(1);
    runtime.dispose();
    expect(b.dispose).toHaveBeenCalledTimes(1);
    expect(frames.size).toBe(0);
  });
  it("disposes late async results rather than installing an obsolete scene", async () => {
    const pendingA = deferred<Activity>(),
      pendingB = deferred<Activity>(),
      a = scene(),
      b = scene("internal-test");
    mocks.load
      .mockReturnValueOnce(pendingA.promise)
      .mockReturnValueOnce(pendingB.promise);
    const runtime = new ProjectionRuntime(
      {} as HTMLCanvasElement,
      settings,
      callbacks(),
    );
    await flush();
    runtime.configure({ ...settings, activityId: "internal-test" });
    await flush();
    pendingB.resolve(b);
    await flush();
    pendingA.resolve(a);
    await flush();
    expect(a.dispose).toHaveBeenCalledTimes(1);
    expect(b.dispose).not.toHaveBeenCalled();
    tick();
    expect(b.render).toHaveBeenCalledTimes(1);
    expect(a.render).not.toHaveBeenCalled();
    runtime.dispose();
  });
  it("disposes pending scenes resolved after runtime disposal and cancels its loop", async () => {
    const pending = deferred<Activity>(),
      a = scene();
    mocks.load.mockReturnValue(pending.promise);
    const runtime = new ProjectionRuntime(
      {} as HTMLCanvasElement,
      settings,
      callbacks(),
    );
    await flush();
    runtime.dispose();
    runtime.dispose();
    pending.resolve(a);
    await flush();
    expect(a.dispose).toHaveBeenCalledTimes(1);
    expect(a.configure).not.toHaveBeenCalled();
    expect(mocks.audio.dispose).toHaveBeenCalledTimes(1);
    expect(frames.size).toBe(0);
  });
  it("configures a newly loaded activity with preferences changed while it was loading", async () => {
    const pending = deferred<Activity>(),
      a = scene();
    mocks.load.mockReturnValue(pending.promise);
    const runtime = new ProjectionRuntime(
      {} as HTMLCanvasElement,
      settings,
      callbacks(),
    );
    await flush();
    const changed = { ...settings, fishCount: 12 };
    runtime.configure(changed);
    pending.resolve(a);
    await flush();
    expect(mocks.load).toHaveBeenCalledTimes(1);
    expect(a.configure).toHaveBeenLastCalledWith(changed);
    runtime.dispose();
  });
  it("ignores obsolete loader failures and reports a current failure without starting another loop", async () => {
    const pending = deferred<Activity>(),
      b = scene("internal-test"),
      events = callbacks();
    mocks.load.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(b);
    const runtime = new ProjectionRuntime(
      {} as HTMLCanvasElement,
      settings,
      events,
    );
    await flush();
    runtime.configure({ ...settings, activityId: "internal-test" });
    await flush();
    pending.reject(new Error("obsolete"));
    await flush();
    expect(events.onError).not.toHaveBeenCalled();
    expect(frames.size).toBe(1);
    mocks.load.mockRejectedValueOnce(new Error("current"));
    runtime.configure({ ...settings, activityId: "unavailable" });
    await flush();
    expect(events.onError).toHaveBeenLastCalledWith(
      expect.stringContaining("Error: current"),
    );
    expect(b.dispose).toHaveBeenCalledTimes(1);
    expect(frames.size).toBe(1);
    runtime.dispose();
  });
  it("disposes a new activity whose configure method throws", async () => {
    const a = scene(),
      events = callbacks();
    vi.mocked(a.configure).mockImplementation(() => {
      throw new Error("bad settings");
    });
    mocks.load.mockResolvedValue(a);
    const runtime = new ProjectionRuntime(
      {} as HTMLCanvasElement,
      settings,
      events,
    );
    await flush();
    expect(a.dispose).toHaveBeenCalledTimes(1);
    expect(events.onError).toHaveBeenCalledWith(
      expect.stringContaining("Error: bad settings"),
    );
    runtime.dispose();
    expect(a.dispose).toHaveBeenCalledTimes(1);
  });
  it("clears queued pointer impulses across pause, blank and activity transitions", async () => {
    const a = scene();
    mocks.load.mockResolvedValue(a);
    const runtime = new ProjectionRuntime(
      {} as HTMLCanvasElement,
      settings,
      callbacks(),
    );
    await flush();
    runtime.pointer({ x: 0.4, y: 0.4 }, true);
    runtime.configure({ ...settings, paused: true });
    runtime.configure(settings);
    tick(now + 20);
    expect(vi.mocked(a.update).mock.lastCall?.[2].impulses).toHaveLength(0);
    runtime.pointer({ x: 0.4, y: 0.4 }, true);
    runtime.configure({ ...settings, blank: true });
    runtime.configure(settings);
    tick(now + 20);
    expect(vi.mocked(a.update).mock.lastCall?.[2].impulses).toHaveLength(0);
    runtime.dispose();
  });
  it("rebases recorded fixture impulse timestamps together with frame time", async () => {
    const a = scene();
    mocks.load.mockResolvedValue(a);
    const runtime = new ProjectionRuntime(
      {} as HTMLCanvasElement,
      settings,
      callbacks(),
    );
    await flush();
    const frame: InteractionFrame = {
      timestamp: 10,
      source: "replay",
      presence: [],
      motion: [],
      impulses: [
        {
          id: "fixture",
          position: { x: 0.4, y: 0.4 },
          confidence: 1,
          strength: 1,
          timestamp: 10,
        },
      ],
    };
    runtime.replay(frame);
    tick(now + 10);
    expect(vi.mocked(a.update).mock.lastCall?.[2].impulses).toHaveLength(1);
    runtime.dispose();
  });
  it("stops the camera while yielding ownership and restarts when active again", async () => {
    const a = scene();
    mocks.load.mockResolvedValue(a);
    const cameraSettings = {
      ...settings,
      inputMode: "camera" as const,
      cameraId: "fake",
    };
    const runtime = new ProjectionRuntime(
      {} as HTMLCanvasElement,
      cameraSettings,
      callbacks(),
    );
    await flush();
    expect(mocks.vision.start).toHaveBeenLastCalledWith("fake");
    runtime.setActive(false);
    expect(mocks.audio.configure).toHaveBeenLastCalledWith(false, 0.18, false);
    const renders = vi.mocked(a.render).mock.calls.length;
    tick();
    expect(a.render).toHaveBeenCalledTimes(renders);
    runtime.setActive(true);
    expect(mocks.vision.start).toHaveBeenCalledTimes(2);
    runtime.dispose();
  });
});

describe("runtime failure recovery", () => {
  it.each(["configure", "update", "render"] as const)(
    "keeps controls alive after a %s failure and reloads without duplicate loops",
    async (method) => {
      const broken = scene(),
        recovered = scene(),
        events = callbacks();
      mocks.load.mockResolvedValueOnce(broken).mockResolvedValueOnce(recovered);
      const runtime = new ProjectionRuntime(
        {} as HTMLCanvasElement,
        settings,
        events,
      );
      await flush();
      vi.mocked(broken[method]).mockImplementation(() => {
        throw new Error("renderer lost");
      });
      if (method === "configure")
        runtime.configure({ ...settings, fishSpeed: 1 });
      else tick();
      expect(events.onError).toHaveBeenLastCalledWith(
        expect.stringContaining("Reload"),
      );
      expect(broken.dispose).toHaveBeenCalledTimes(1);
      expect(mocks.audio.configure).toHaveBeenLastCalledWith(
        false,
        0.18,
        false,
      );
      expect(frames.size).toBe(1);
      tick(now + 17);
      runtime.retryActivity();
      await flush();
      expect(runtime.diagnostics().error).toBe("");
      tick(now + 17);
      expect(recovered.update).toHaveBeenCalledTimes(1);
      expect(recovered.render).toHaveBeenCalledTimes(1);
      expect(frames.size).toBe(1);
      runtime.dispose();
      runtime.retryActivity();
      expect(mocks.load).toHaveBeenCalledTimes(2);
    },
  );
});

it("restores a lost graphics context with one runtime loop and removes recovery listeners", async () => {
  const listeners = new Map<string, EventListener>();
  const canvas = {
    addEventListener: vi.fn((name, listener) => listeners.set(name, listener)),
    removeEventListener: vi.fn((name) => listeners.delete(name)),
  } as unknown as HTMLCanvasElement;
  const first = scene(),
    second = scene(),
    events = callbacks();
  mocks.load.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
  const runtime = new ProjectionRuntime(canvas, settings, events);
  await flush();
  const lost = new Event("webglcontextlost", { cancelable: true });
  listeners.get("webglcontextlost")!(lost);
  expect(lost.defaultPrevented).toBe(true);
  expect(first.dispose).toHaveBeenCalledTimes(1);
  runtime.retryActivity();
  expect(mocks.load).toHaveBeenCalledTimes(1);
  tick();
  listeners.get("webglcontextrestored")!(new Event("webglcontextrestored"));
  await flush();
  tick(now + 17);
  expect(second.render).toHaveBeenCalledTimes(1);
  expect(frames.size).toBe(1);
  runtime.dispose();
  expect(listeners.size).toBe(0);
});

it("uses only the active scene's optional audio and disposes it on scene switch", async () => {
  const audible = scene(),
    silent = scene("future-test-scene");
  delete silent.audio;
  mocks.load.mockResolvedValueOnce(audible).mockResolvedValueOnce(silent);
  const runtime = new ProjectionRuntime(
    {} as HTMLCanvasElement,
    { ...settings, sound: true },
    callbacks(),
  );
  await flush();
  runtime.unlockAudio();
  runtime.pointer({ x: 0.5, y: 0.5 }, true);
  tick();
  expect(mocks.audio.unlock).toHaveBeenCalledTimes(1);
  expect(mocks.audio.impulse).toHaveBeenCalledTimes(1);
  runtime.configure({
    ...settings,
    activityId: "future-test-scene",
    sound: true,
  });
  await flush();
  expect(audible.dispose).toHaveBeenCalledTimes(1);
  const configured = mocks.audio.configure.mock.calls.length;
  runtime.unlockAudio();
  runtime.pointer({ x: 0.5, y: 0.5 }, true);
  tick(now + 500);
  runtime.configure({
    ...settings,
    activityId: "future-test-scene",
    sound: false,
  });
  expect(mocks.audio.unlock).toHaveBeenCalledTimes(1);
  expect(mocks.audio.impulse).toHaveBeenCalledTimes(1);
  expect(mocks.audio.configure).toHaveBeenCalledTimes(configured);
  expect(silent.render).toHaveBeenCalledTimes(1);
  runtime.dispose();
});

it("keeps an existing sound gesture across asynchronous scene swaps without autoplay before a gesture", async () => {
  const first = scene(),
    second = scene("other-scene");
  const secondAudio = { configure: vi.fn(), unlock: vi.fn(), impulse: vi.fn() };
  second.audio = secondAudio;
  const next = deferred<Activity>();
  mocks.load.mockResolvedValueOnce(first).mockReturnValueOnce(next.promise);
  const runtime = new ProjectionRuntime(
    {} as HTMLCanvasElement,
    { ...settings, sound: true },
    callbacks(),
  );
  await flush();
  expect(mocks.audio.unlock).not.toHaveBeenCalled();
  runtime.unlockAudio();
  expect(mocks.audio.unlock).toHaveBeenCalledTimes(1);
  runtime.configure({ ...settings, sound: true, activityId: "other-scene" });
  await flush();
  expect(secondAudio.unlock).not.toHaveBeenCalled();
  next.resolve(second);
  await flush();
  expect(secondAudio.configure).toHaveBeenLastCalledWith(
    true,
    settings.volume,
    true,
  );
  expect(secondAudio.unlock).toHaveBeenCalledTimes(1);
  expect(runtime.diagnostics().activityId).toBe("other-scene");
  runtime.dispose();
  runtime.unlockAudio();
  expect(secondAudio.unlock).toHaveBeenCalledTimes(1);
});

it("invalidates scene factory construction permission when the selection changes or runtime closes", async () => {
  const first = deferred<Activity>(),
    second = deferred<Activity>();
  mocks.load
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(second.promise);
  const runtime = new ProjectionRuntime(
    {} as HTMLCanvasElement,
    settings,
    callbacks(),
  );
  await flush();
  const originalContext = mocks.load.mock.calls[0][1];
  expect(originalContext.isCurrent()).toBe(true);
  runtime.configure({ ...settings, activityId: "other-scene" });
  await flush();
  const replacementContext = mocks.load.mock.calls[1][1];
  expect(originalContext.isCurrent()).toBe(false);
  expect(replacementContext.isCurrent()).toBe(true);
  runtime.dispose();
  expect(replacementContext.isCurrent()).toBe(false);
  first.resolve(scene());
  second.resolve(scene("other-scene"));
  await flush();
});
