import { afterEach, describe, expect, it, vi } from "vitest";
import { createVisionController } from "./controller";
import type { TrackingStatus } from "../types";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
function callbacks() {
  const statuses: TrackingStatus[] = [];
  return {
    statuses,
    onStatus: (status: TrackingStatus) => statuses.push(status),
    onFrame: vi.fn(),
  };
}

describe("camera startup and cleanup", () => {
  it("surfaces denied permission and clears old interaction input", async () => {
    const media = {
      getUserMedia: vi
        .fn()
        .mockRejectedValue(new DOMException("Denied", "NotAllowedError")),
      enumerateDevices: vi.fn().mockResolvedValue([]),
    };
    vi.stubGlobal("navigator", { mediaDevices: media });
    const events = callbacks();
    const controller = createVisionController(events);
    await expect(controller.start("hero10")).rejects.toThrow(
      "permission was denied",
    );
    expect(events.statuses.at(-1)?.state).toBe("error");
    expect(events.onFrame).toHaveBeenCalled();
    expect(media.getUserMedia.mock.calls[0][0].audio).toBe(false);
    expect(media.getUserMedia.mock.calls[0][0].video.deviceId).toEqual({
      exact: "hero10",
    });
  });
  it("stops a camera that finishes opening after startup has timed out", async () => {
    vi.useFakeTimers();
    let resolveStream!: (stream: MediaStream) => void;
    const opening = new Promise<MediaStream>((resolve) => {
      resolveStream = resolve;
    });
    vi.stubGlobal("navigator", {
      mediaDevices: { getUserMedia: vi.fn().mockReturnValue(opening) },
    });
    const events = callbacks();
    const controller = createVisionController(events);
    const start = controller.start("hero10");
    const rejected = expect(start).rejects.toThrow("did not complete");
    await vi.advanceTimersByTimeAsync(20001);
    await rejected;
    const stop = vi.fn();
    resolveStream({ getTracks: () => [{ stop }] } as unknown as MediaStream);
    await Promise.resolve();
    expect(stop).toHaveBeenCalled();
    expect(events.statuses.at(-1)?.state).toBe("error");
  });
  it("releases late video tracks after an explicit stop without starting a worker", async () => {
    let resolveStream!: (stream: MediaStream) => void;
    const opening = new Promise<MediaStream>((resolve) => {
      resolveStream = resolve;
    });
    const getUserMedia = vi.fn().mockReturnValue(opening);
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
    const events = callbacks();
    const controller = createVisionController(events);
    const start = controller.start("hero10");
    await Promise.resolve();
    await Promise.resolve();
    expect(getUserMedia).toHaveBeenCalled();
    controller.stop();
    const stop = vi.fn();
    resolveStream({ getTracks: () => [{ stop }] } as unknown as MediaStream);
    await start;
    expect(stop).toHaveBeenCalled();
    expect(events.statuses.at(-1)?.state).toBe("idle");
  });
  it("reports unsupported camera contexts without opening any device", async () => {
    vi.stubGlobal("navigator", {});
    const events = callbacks();
    const controller = createVisionController(events);
    expect(await controller.listDevices()).toEqual([]);
    await expect(controller.start("hero10")).rejects.toThrow(
      "localhost or HTTPS",
    );
  });
});
