import { afterEach, describe, expect, it, vi } from "vitest";
import { createVisionController } from "./controller";
import { DEFAULT_SETTINGS } from "../storage";
import type {
  InteractionFrame,
  ProjectionSettings,
  TrackingStatus,
  VisionController,
} from "../types";
import type { WorkerInput, WorkerOutput } from "./protocol";

const activeControllers: VisionController[] = [];
afterEach(() => {
  activeControllers.splice(0).forEach((controller) => controller.stop());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function session(
  options: { ready?: boolean; fixedFrameRate?: number } = {},
) {
  let now = 1000;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  const status: TrackingStatus[] = [];
  const frames: InteractionFrame[] = [];
  const previews: string[] = [];
  const stopTrack = vi.fn();
  const track = {
    onended: null,
    stop: stopTrack,
    getSettings: () => ({ deviceId: "hero10" }),
  };
  const stream = { getVideoTracks: () => [track], getTracks: () => [track] };
  const getUserMedia = vi.fn(async (constraints: MediaStreamConstraints) => {
    const rate =
      typeof constraints.video === "object"
        ? constraints.video.frameRate
        : undefined;
    if (
      options.fixedFrameRate &&
      typeof rate === "object" &&
      rate.max !== undefined &&
      rate.max < options.fixedFrameRate
    )
      throw new DOMException(
        "No video mode satisfies frameRate.max",
        "OverconstrainedError",
      );
    return stream;
  });
  vi.stubGlobal("navigator", {
    mediaDevices: {
      getUserMedia,
      enumerateDevices: vi
        .fn()
        .mockResolvedValue([
          { kind: "videoinput", deviceId: "hero10", label: "HERO10 Black" },
        ]),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    },
  });
  let onVideoFrame: (() => void) | undefined;
  const video = {
    muted: false,
    autoplay: false,
    playsInline: false,
    style: { cssText: "" },
    srcObject: null,
    readyState: 4,
    videoWidth: 1280,
    videoHeight: 720,
    currentTime: 1,
    play: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn(),
    remove: vi.fn(),
    setAttribute: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    requestVideoFrameCallback: vi.fn((callback: () => void) => {
      onVideoFrame = callback;
      return 1;
    }),
    cancelVideoFrameCallback: vi.fn(),
  };
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ({
      setTransform: vi.fn(),
      drawImage: vi.fn(),
      resetTransform: vi.fn(),
    }),
    toDataURL: () => "data:image/jpeg;base64,preview",
  };
  vi.stubGlobal("document", {
    createElement: (name: string) => (name === "video" ? video : canvas),
    body: { append: vi.fn() },
  });
  vi.stubGlobal("window", { location: { origin: "http://localhost:5188" } });
  const bitmapClose = vi.fn();
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn().mockResolvedValue({ close: bitmapClose }),
  );
  class FakeWorker {
    static current: FakeWorker;
    onmessage?: (event: { data: WorkerOutput }) => void;
    onerror?: (event: { message: string }) => void;
    messages: WorkerInput[] = [];
    terminate = vi.fn();
    constructor() {
      FakeWorker.current = this;
    }
    postMessage(message: WorkerInput) {
      this.messages.push(message);
      if (message.type === "init" && options.ready !== false)
        queueMicrotask(() =>
          this.onmessage?.({ data: { type: "ready", handTracking: true } }),
        );
    }
    emit(message: WorkerOutput) {
      this.onmessage?.({ data: message });
    }
  }
  vi.stubGlobal("Worker", FakeWorker);
  const controller = createVisionController({
    onStatus: (value) => status.push(value),
    onFrame: (frame) => frames.push(frame),
    onPreview: (preview) => previews.push(preview),
  });
  activeControllers.push(controller);
  const settings: ProjectionSettings = structuredClone(DEFAULT_SETTINGS);
  settings.inputMode = "camera";
  settings.cameraId = "hero10";
  settings.calibration = {
    ...settings.calibration,
    calibrated: true,
    cameraId: "hero10",
    cameraWidth: 1280,
    cameraHeight: 720,
  };
  controller.configure(settings);
  const starting = controller.start("");
  const waitForWorker = async () => {
    for (let i = 0; i < 15; i++) {
      await Promise.resolve();
      if (FakeWorker.current) break;
    }
  };
  await waitForWorker();
  if (options.ready !== false) await starting;
  await Promise.resolve();
  const worker = FakeWorker.current;
  const request = () =>
    worker.messages
      .filter(
        (message): message is Extract<WorkerInput, { type: "frame" }> =>
          message.type === "frame",
      )
      .at(-1)!;
  const emit = (changes: Partial<InteractionFrame> = {}) => {
    const input = request();
    worker.emit({
      type: "frame",
      frameId: input.frameId,
      frame: {
        source: "camera",
        timestamp: input.timestamp,
        presence: [
          {
            id: "body",
            center: { x: 0.5, y: 0.5 },
            radius: 0.1,
            confidence: 0.9,
          },
        ],
        motion: [],
        impulses: [
          {
            id: "hit",
            position: { x: 0.5, y: 0.5 },
            timestamp: input.timestamp,
            strength: 0.8,
            confidence: 0.9,
          },
        ],
        ...changes,
      },
      inferenceMs: 25,
      hands: 1,
    });
  };
  return {
    controller,
    starting,
    settings,
    status,
    frames,
    previews,
    video,
    worker,
    request,
    emit,
    getUserMedia,
    stopTrack,
    bitmapClose,
    elapseClock: (delta: number) => {
      now += delta;
    },
    advance: async (delta = 100) => {
      now += delta;
      video.currentTime += delta / 1000;
      onVideoFrame?.();
      await Promise.resolve();
    },
  };
}

describe("active camera session recovery", () => {
  it("measures sustained completed updates instead of spiking above camera rate when inference gets faster", async () => {
    const s = await session();
    s.elapseClock(25);
    s.emit();
    for (let i = 0; i < 40; i++) {
      await s.advance(9);
      s.elapseClock(25);
      s.emit();
    }
    // Faster completion can shorten one result interval without adding camera frames.
    await s.advance(9);
    s.elapseClock(1);
    s.emit();
    expect(s.status.at(-1)?.fps).toBeLessThanOrEqual(31);
    expect(s.status.at(-1)?.fps).toBeGreaterThan(28);
  });
  it("ignores duplicate and mismatched worker replies without releasing current work or recounting actions", async () => {
    const s = await session();
    s.elapseClock(25);
    s.emit();
    s.emit();
    expect(s.status.at(-1)?.actionsDetected).toBe(1);
    await s.advance(100);
    const current = s.request();
    s.worker.emit({
      type: "frame",
      frameId: current.frameId - 1,
      frame: {
        timestamp: current.timestamp,
        source: "camera",
        presence: [],
        motion: [],
        impulses: [],
      },
      inferenceMs: 1,
      hands: 0,
    });
    const count = s.worker.messages.filter(
      (message) => message.type === "frame",
    ).length;
    await s.advance(100);
    expect(
      s.worker.messages.filter((message) => message.type === "frame"),
    ).toHaveLength(count);
    s.emit();
    expect(s.status.at(-1)?.actionsDetected).toBe(2);
  });
  it("counts delivered camera actions only while calibrated, fresh and playing", async () => {
    const s = await session();
    s.emit();
    expect(s.status.at(-1)?.actionsDetected).toBe(1);
    s.settings.paused = true;
    s.controller.configure(s.settings);
    await s.advance();
    s.emit();
    expect(s.status.at(-1)?.actionsDetected).toBe(1);
    s.settings.paused = false;
    s.settings.calibration.calibrated = false;
    s.controller.configure(s.settings);
    await s.advance();
    s.emit();
    expect(s.status.at(-1)?.actionsDetected).toBe(1);
    s.controller.stop();
    expect(s.status.at(-1)?.actionsDetected).toBe(0);
  });
  it("processes 30 Hz camera updates without the former 70 ms cap or queued duplicate frames", async () => {
    vi.useFakeTimers();
    const s = await session();
    const count = () =>
      s.worker.messages.filter((message) => message.type === "frame").length;
    s.emit();
    for (let i = 1; i <= 10; i++) {
      s.video.currentTime += 0.034;
      s.elapseClock(34);
      await vi.advanceTimersByTimeAsync(34);
      expect(count()).toBe(i + 1);
      s.emit();
    }
    expect(s.status.at(-1)?.fps).toBeGreaterThan(28);
    expect(s.request().floorCorners).toEqual(
      s.settings.calibration.cameraCorners,
    );
    await vi.advanceTimersByTimeAsync(100);
    expect(count()).toBe(11);
    s.settings.calibration.calibrated = false;
    s.controller.configure(s.settings);
    s.video.currentTime += 0.034;
    s.elapseClock(34);
    await vi.advanceTimersByTimeAsync(34);
    expect(s.request().floorCorners).toBeUndefined();
  });

  it("keeps processing advancing hidden video when compositor callbacks stop, with one frame in flight", async () => {
    vi.useFakeTimers();
    const s = await session();
    s.emit();
    const count = () =>
      s.worker.messages.filter((message) => message.type === "frame").length;
    expect(count()).toBe(1);
    // The camera decoder advances, but requestVideoFrameCallback never fires.
    s.video.currentTime += 0.08;
    s.elapseClock(80);
    await vi.advanceTimersByTimeAsync(80);
    expect(count()).toBe(2);
    s.video.currentTime += 0.24;
    s.elapseClock(240);
    await vi.advanceTimersByTimeAsync(240);
    expect(count()).toBe(2);
    s.emit();
    s.elapseClock(80);
    await vi.advanceTimersByTimeAsync(80);
    expect(count()).toBe(3);
    s.emit();
    // No duplicate capture of an unchanged frame, or extra compositor subscriptions.
    await vi.advanceTimersByTimeAsync(160);
    expect(count()).toBe(3);
    expect(s.video.requestVideoFrameCallback).toHaveBeenCalledTimes(1);
    s.controller.stop();
    s.video.currentTime += 1;
    s.elapseClock(1000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(count()).toBe(3);
  });
  it("prefers the actual HERO10 label and clears signature/preview on stop", async () => {
    const s = await session();
    expect(s.getUserMedia.mock.calls[0][0].video).toMatchObject({
      deviceId: { exact: "hero10" },
    });
    s.emit();
    expect(s.frames.at(-1)?.presence).toHaveLength(1);
    s.controller.stop();
    expect(s.status.at(-1)).toMatchObject({
      state: "idle",
      width: 0,
      height: 0,
      regions: 0,
      hands: 0,
    });
    expect(s.status.at(-1)?.deviceId).toBeUndefined();
    expect(s.previews.at(-1)).toBe("");
    expect(s.stopTrack).toHaveBeenCalled();
  });
  it("accepts a fixed-rate camera while preferring 30 fps without a mandatory cap", async () => {
    const s = await session({ fixedFrameRate: 60 });
    s.elapseClock(25);
    s.emit();
    expect(s.status.at(-1)?.state).toBe("ready");
    expect(s.getUserMedia).toHaveBeenCalledOnce();
    expect(s.getUserMedia.mock.calls[0][0].audio).toBe(false);
  });
  it("drops an already-processing frame when mirror/calibration changes in place", async () => {
    const s = await session();
    s.settings.calibration.mirrored = true;
    s.controller.configure(s.settings);
    s.emit();
    expect(s.frames.at(-1)?.presence).toHaveLength(0);
    expect(s.frames.at(-1)?.impulses).toHaveLength(0);
    await s.advance();
    s.emit();
    expect(s.frames.at(-1)?.presence).toHaveLength(1);
  });
  it("discards a pending gesture when changing to another activity", async () => {
    const s = await session();
    s.settings.activityId = "forest-floor";
    s.controller.configure(s.settings);
    s.emit();
    expect(s.frames.at(-1)?.impulses).toHaveLength(0);
    await s.advance();
    s.emit();
    expect(s.frames.at(-1)?.presence).toHaveLength(1);
  });
  it("does not resurrect a pre-pause impulse after immediate resume", async () => {
    const s = await session();
    s.settings.paused = true;
    s.controller.configure(s.settings);
    s.settings.paused = false;
    s.controller.configure(s.settings);
    s.emit();
    expect(s.frames.at(-1)?.impulses).toHaveLength(0);
  });
  it("invalidates calibration on a live resolution change and rejects old in-flight work", async () => {
    const s = await session();
    s.video.videoWidth = 1920;
    s.video.videoHeight = 1080;
    await s.advance();
    s.emit();
    expect(s.frames.at(-1)?.presence).toHaveLength(0);
    expect(s.status.at(-1)).toMatchObject({
      state: "limited",
      width: 1920,
      height: 1080,
    });
    await s.advance();
    s.emit();
    expect(s.frames.at(-1)?.presence).toHaveLength(0);
    expect(s.status.at(-1)?.message).toContain("Calibrate");
  });
  it("clears the prior preview and positive fps immediately when camera dimensions change", async () => {
    const s = await session();
    s.elapseClock(25);
    s.emit();
    expect(s.status.at(-1)?.fps).toBeGreaterThan(0);
    expect(s.previews.at(-1)).toContain("data:image");
    await s.advance(); // Keep an old-resolution inference in flight.
    s.video.videoWidth = 1920;
    s.video.videoHeight = 1080;
    await s.advance(100);
    expect(s.status.at(-1)).toMatchObject({
      width: 1920,
      height: 1080,
      fps: 0,
      state: "limited",
    });
    expect(s.previews.at(-1)).toBe("");
    s.emit(); // Work submitted using the old resolution stays invalid.
    expect(s.previews.at(-1)).toBe("");
    await s.advance();
    s.emit();
    expect(s.status.at(-1)?.fps).toBeGreaterThan(0);
    expect(s.previews.at(-1)).toContain("data:image");
  });
  it("rejects model-worker startup errors and releases camera resources", async () => {
    const s = await session({ ready: false });
    const rejected = expect(s.starting).rejects.toThrow(
      "Worker could not initialize",
    );
    s.worker.onerror?.({ message: "Worker could not initialize" });
    await rejected;
    expect(s.status.at(-1)).toMatchObject({
      state: "error",
      width: 0,
      height: 0,
      fps: 0,
    });
    expect(s.stopTrack).toHaveBeenCalled();
    expect(s.worker.terminate).toHaveBeenCalled();
    expect(s.previews.at(-1)).toBe("");
  });
  it("closes an untransferred bitmap if posting a frame fails", async () => {
    const s = await session();
    s.emit();
    vi.spyOn(s.worker, "postMessage").mockImplementation(() => {
      throw new DOMException("Transfer failed", "DataCloneError");
    });
    await s.advance();
    await Promise.resolve();
    expect(s.bitmapClose).toHaveBeenCalledOnce();
    expect(s.status.at(-1)?.state).toBe("error");
    expect(s.status.at(-1)?.message).toContain("Transfer failed");
    expect(s.stopTrack).toHaveBeenCalled();
  });
  it("reports slow processing as limited and drops stale interactions", async () => {
    const s = await session();
    await s.advance(600);
    s.emit();
    expect(s.frames.at(-1)?.presence).toHaveLength(0);
    expect(s.status.at(-1)?.state).toBe("limited");
    expect(s.status.at(-1)?.message).toContain("late");
    expect(s.status.at(-1)?.fps).toBe(0);
    expect(s.previews.at(-1)).toBe("");
  });
  it("clears a frozen preview on watchdog stall and republishes only after fresh inference resumes", async () => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"],
    });
    const s = await session();
    s.emit();
    expect(s.previews.at(-1)).toContain("data:image");
    s.elapseClock(1600);
    await vi.advanceTimersByTimeAsync(1500);
    expect(s.status.at(-1)).toMatchObject({ state: "limited", fps: 0 });
    expect(s.previews.at(-1)).toBe("");
    await vi.advanceTimersByTimeAsync(500);
    expect(s.previews.at(-1)).toBe("");
    await s.advance(100);
    expect(s.previews.at(-1)).toBe("");
    s.emit();
    expect(s.status.at(-1)?.state).toBe("ready");
    expect(s.status.at(-1)?.fps).toBeGreaterThan(0);
    expect(s.previews.at(-1)).toContain("data:image");
  });
  it("does not keep publishing the same frozen video frame as a live preview", async () => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"],
    });
    const s = await session();
    s.emit();
    const previewCount = s.previews.length;
    s.elapseClock(600);
    await vi.advanceTimersByTimeAsync(500);
    expect(s.previews).toHaveLength(previewCount);
  });
  it("settles a cancelled model startup immediately and removes its timeout", async () => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"],
    });
    const s = await session({ ready: false });
    s.controller.stop();
    await s.starting;
    expect(s.worker.terminate).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
