import { afterEach, expect, it, vi } from "vitest";
import type { WorkerInput, WorkerOutput } from "./protocol";
const mocks = vi.hoisted(() => ({ detect: vi.fn() }));
vi.mock("@mediapipe/tasks-vision", () => ({
  FilesetResolver: { forVisionTasks: vi.fn(async () => ({})) },
  ImageSegmenter: {
    createFromOptions: vi.fn(async () => ({
      segmentForVideo: (
        _image: unknown,
        _time: number,
        callback: (result: unknown) => void,
      ) =>
        callback({
          confidenceMasks: [
            {
              width: 16,
              height: 9,
              getAsFloat32Array: () => new Float32Array(144),
            },
          ],
        }),
    })),
  },
}));
vi.mock("./hand-tracker", () => ({
  createHandTracker: vi.fn(async () => ({
    backend: "CPU",
    detectForVideo: mocks.detect,
  })),
}));
vi.mock("./wasm-loader", () => ({ installMediaPipeModuleLoader: vi.fn() }));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
  mocks.detect.mockReset();
});
const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};
it.each(["resolve", "reject"])(
  "discards %s from a hand inference invalidated by reset without repopulating old history",
  async (outcome) => {
    vi.stubGlobal("onmessage", null);
    const outputs: WorkerOutput[] = [];
    vi.stubGlobal("postMessage", (message: WorkerOutput) =>
      outputs.push(message),
    );
    vi.stubGlobal(
      "OffscreenCanvas",
      class {
        width: number;
        height: number;
        constructor(w: number, h: number) {
          this.width = w;
          this.height = h;
        }
        getContext() {
          return {
            setTransform() {},
            resetTransform() {},
            drawImage() {},
            getImageData: () => ({
              data: new Uint8ClampedArray(this.width * this.height * 4).fill(
                100,
              ),
            }),
          };
        }
      },
    );
    await import("./worker");
    const send = (data: WorkerInput) =>
      (globalThis.onmessage as unknown as (e: { data: WorkerInput }) => void)({
        data,
      });
    send({ type: "init", baseUrl: "/" });
    await flush();
    let finish!: (result: unknown) => void, fail!: (error: Error) => void;
    mocks.detect.mockReturnValueOnce(
      new Promise((yes, no) => {
        finish = yes;
        fail = no;
      }),
    );
    const close = vi.fn();
    send({
      type: "frame",
      frameId: 1,
      timestamp: 100,
      bitmap: { width: 640, height: 360, close } as unknown as ImageBitmap,
      mirrored: false,
      sensitivity: 0.65,
    });
    send({ type: "reset" });
    const result = {
      landmarks: [Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5 }))],
      handedness: [[{ score: 0.95 }]],
    };
    if (outcome === "resolve") finish(result);
    else fail(new Error("obsolete GPU failure"));
    await flush();
    expect(outputs.at(-1)).toMatchObject({
      type: "frame",
      frameId: 1,
      hands: 0,
      frame: { presence: [], motion: [], impulses: [] },
    });
    expect(close).toHaveBeenCalledOnce();
    mocks.detect.mockResolvedValue(result);
    send({
      type: "frame",
      frameId: 2,
      timestamp: 200,
      bitmap: { width: 640, height: 360, close } as unknown as ImageBitmap,
      mirrored: true,
      sensitivity: 0.65,
    });
    await flush();
    expect(outputs.at(-1)).toMatchObject({
      type: "frame",
      frameId: 2,
      hands: 1,
      frame: { impulses: [] },
    });
  },
);
