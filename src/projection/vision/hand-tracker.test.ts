import { afterEach, describe, it, expect, vi } from "vitest";
const mocks = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("@mediapipe/tasks-vision", () => ({
  HandLandmarker: { createFromOptions: mocks.create },
}));
import { createHandTracker } from "./hand-tracker";
afterEach(() => {
  vi.unstubAllGlobals();
  mocks.create.mockReset();
});
const result = {
  landmarks: [],
  worldLandmarks: [],
  handedness: [],
  handednesses: [],
};
const detector = () => ({
  detectForVideo: vi.fn().mockReturnValue(result),
  close: vi.fn(),
});
const files = {} as Parameters<typeof createHandTracker>[0];
const image = {} as OffscreenCanvas;
function canvas() {
  vi.stubGlobal(
    "OffscreenCanvas",
    class {
      constructor(
        public width: number,
        public height: number,
      ) {}
    },
  );
}
describe("accelerated hand tracking recovery", () => {
  it("uses the same model and thresholds with an explicit GPU canvas", async () => {
    canvas();
    const gpu = detector();
    mocks.create.mockResolvedValue(gpu);
    const tracker = await createHandTracker(files, "/models/hand.task");
    expect(tracker.backend).toBe("GPU");
    expect(await tracker.detectForVideo(image, 100)).toBe(result);
    expect(mocks.create).toHaveBeenCalledWith(
      files,
      expect.objectContaining({
        baseOptions: { modelAssetPath: "/models/hand.task", delegate: "GPU" },
        canvas: expect.any(OffscreenCanvas),
        numHands: 2,
        minHandDetectionConfidence: 0.45,
      }),
    );
    tracker.close();
    expect(gpu.close).toHaveBeenCalledOnce();
  });
  it("retains CPU hand detection if GPU initialization fails", async () => {
    canvas();
    mocks.create
      .mockRejectedValueOnce(new Error("no GPU"))
      .mockResolvedValueOnce(detector());
    const tracker = await createHandTracker(files, "hand.task");
    expect(tracker.backend).toBe("CPU");
    expect(await tracker.detectForVideo(image, 100)).toBe(result);
    expect(mocks.create.mock.calls[1][1].baseOptions.delegate).toBe("CPU");
  });
  it("rebuilds once on CPU after a live GPU failure and does not keep retrying GPU", async () => {
    canvas();
    const gpu = detector(),
      cpu = detector();
    gpu.detectForVideo.mockImplementation(() => {
      throw new Error("context lost");
    });
    mocks.create.mockResolvedValueOnce(gpu).mockResolvedValueOnce(cpu);
    const tracker = await createHandTracker(files, "hand.task");
    expect(await tracker.detectForVideo(image, 100)).toBe(result);
    expect(tracker.backend).toBe("CPU");
    expect(await tracker.detectForVideo(image, 200)).toBe(result);
    expect(gpu.close).toHaveBeenCalledOnce();
    expect(mocks.create).toHaveBeenCalledTimes(2);
  });
  it("reports unavailable models or a CPU runtime failure to the existing recovery path", async () => {
    canvas();
    mocks.create.mockRejectedValue(new Error("unavailable"));
    await expect(createHandTracker(files, "hand.task")).rejects.toThrow(
      "unavailable",
    );
    const cpu = detector();
    cpu.detectForVideo.mockImplementation(() => {
      throw new Error("bad frame");
    });
    mocks.create
      .mockRejectedValueOnce(new Error("GPU missing"))
      .mockResolvedValueOnce(cpu);
    const tracker = await createHandTracker(files, "hand.task");
    await expect(tracker.detectForVideo(image, 100)).rejects.toThrow(
      "bad frame",
    );
  });
});
