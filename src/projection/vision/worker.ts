import { FilesetResolver, ImageSegmenter } from "@mediapipe/tasks-vision";
import {
  analyzeForeground,
  MotionInterpreter,
  patchActivity,
  imageMotionGain,
  type HandObservation,
} from "./motion";
import type { WorkerInput, WorkerOutput } from "./protocol";
import { createHandTracker, type HandTracker } from "./hand-tracker";
import { focusRegion, cameraPoint, sourceRegion } from "./focus-region";
import { installMediaPipeModuleLoader } from "./wasm-loader";

const worker = globalThis as unknown as {
  onmessage: ((event: MessageEvent<WorkerInput>) => void) | null;
  postMessage: (message: WorkerOutput) => void;
};
let segmenter: ImageSegmenter | undefined;
let handLandmarker: HandTracker | undefined;
let canvas: OffscreenCanvas | undefined;
let context: OffscreenCanvasRenderingContext2D | null = null;
let previousGray: Uint8Array | undefined;
let previousTimestamp = -Infinity;
let busy = false;
let revision = 0;
let handCanvas: OffscreenCanvas | undefined;
let handContext: OffscreenCanvasRenderingContext2D | null = null;
const motion = new MotionInterpreter();
const report = (message: WorkerOutput): void => worker.postMessage(message);

async function initialize(baseUrl: string): Promise<void> {
  installMediaPipeModuleLoader();
  const vision = await FilesetResolver.forVisionTasks(`${baseUrl}wasm`);
  segmenter = await ImageSegmenter.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: `${baseUrl}models/person_segmenter.tflite`,
      delegate: "CPU",
    },
    runningMode: "VIDEO",
    outputConfidenceMasks: true,
    outputCategoryMask: false,
  });
  let warning: string | undefined;
  try {
    handLandmarker = await createHandTracker(
      vision,
      `${baseUrl}models/hand_landmarker.task`,
    );
  } catch {
    warning =
      "Hand model unavailable. Using person-gated movement for approximate splashes.";
  }
  report({
    type: "ready",
    handTracking: Boolean(handLandmarker),
    handBackend: handLandmarker?.backend,
    warning,
  });
}

async function processFrame(
  message: Extract<WorkerInput, { type: "frame" }>,
): Promise<void> {
  const { bitmap, timestamp, frameId, mirrored, sensitivity } = message;
  if (!segmenter || busy) {
    bitmap.close();
    report({ type: "error", frameId, message: "Vision worker is not ready." });
    return;
  }
  busy = true;
  const frameRevision = revision;
  const started = performance.now();
  const discarded = () =>
    report({
      type: "frame",
      frameId,
      hands: 0,
      inferenceMs: performance.now() - started,
      frame: {
        timestamp,
        source: "camera",
        presence: [],
        motion: [],
        impulses: [],
      },
    });
  try {
    const width = Math.min(640, bitmap.width);
    const height = Math.max(
      1,
      Math.round((bitmap.height * width) / bitmap.width),
    );
    if (!canvas || canvas.width !== width || canvas.height !== height) {
      canvas = new OffscreenCanvas(width, height);
      context = canvas.getContext("2d", { willReadFrequently: true });
      previousGray = undefined;
    }
    if (!context)
      throw new Error("Unable to create the camera processing canvas.");
    context.setTransform(mirrored ? -1 : 1, 0, 0, 1, mirrored ? width : 0, 0);
    context.drawImage(bitmap, 0, 0, width, height);
    context.resetTransform();
    const rgba = context.getImageData(0, 0, width, height).data;
    const gray = new Uint8Array(width * height);
    for (let i = 0; i < gray.length; i++)
      gray[i] =
        (rgba[i * 4] * 77 + rgba[i * 4 + 1] * 150 + rgba[i * 4 + 2] * 29) >> 8;
    const preprocessed = performance.now();
    let mask: Float32Array | undefined;
    let maskWidth = 0;
    let maskHeight = 0;
    segmenter.segmentForVideo(canvas, timestamp, (result) => {
      const masks = result.confidenceMasks;
      if (masks?.length) {
        const foreground = masks[masks.length > 1 ? 1 : 0];
        mask = new Float32Array(foreground.getAsFloat32Array());
        maskWidth = foreground.width;
        maskHeight = foreground.height;
      }
    });
    if (!mask)
      throw new Error("Person model returned no foreground confidence mask.");
    const segmented = performance.now();
    const motionGain = imageMotionGain(timestamp - previousTimestamp);
    const foreground = analyzeForeground(
      mask,
      maskWidth,
      maskHeight,
      gray,
      previousGray,
      width,
      height,
    );
    foreground.motion = foreground.motion.map((sample) => ({
      ...sample,
      strength: Math.min(1, sample.strength * motionGain),
    }));
    const foregroundDone = performance.now();
    const hands: HandObservation[] = [];
    if (handLandmarker) {
      const region = focusRegion(message.floorCorners);
      const source = sourceRegion(region, mirrored);
      const cropWidth = source.width * bitmap.width,
        cropHeight = source.height * bitmap.height;
      const scale = Math.min(640 / cropWidth, 640 / cropHeight);
      const handWidth = Math.max(1, Math.round(cropWidth * scale)),
        handHeight = Math.max(1, Math.round(cropHeight * scale));
      if (
        !handCanvas ||
        handCanvas.width !== handWidth ||
        handCanvas.height !== handHeight
      ) {
        handCanvas = new OffscreenCanvas(handWidth, handHeight);
        handContext = handCanvas.getContext("2d");
      }
      if (!handContext)
        throw new Error("Unable to prepare hand tracking image.");
      handContext.setTransform(
        mirrored ? -1 : 1,
        0,
        0,
        1,
        mirrored ? handWidth : 0,
        0,
      );
      handContext.drawImage(
        bitmap,
        source.x * bitmap.width,
        source.y * bitmap.height,
        cropWidth,
        cropHeight,
        0,
        0,
        handWidth,
        handHeight,
      );
      handContext.resetTransform();
      const result = await handLandmarker.detectForVideo(handCanvas, timestamp);
      if (frameRevision !== revision) {
        discarded();
        return;
      }
      for (let i = 0; i < result.landmarks.length; i++) {
        const landmarks = result.landmarks[i].map((point) =>
          cameraPoint(point, region),
        );
        // Palm center/extent are image coordinates. Relative landmark z is not floor height.
        const palm = [
          landmarks[0],
          landmarks[5],
          landmarks[9],
          landmarks[13],
          landmarks[17],
        ];
        const position = {
          x: palm.reduce((sum, point) => sum + point.x, 0) / palm.length,
          y: palm.reduce((sum, point) => sum + point.y, 0) / palm.length,
        };
        const radius = Math.max(
          0.018,
          ...landmarks.map((point) =>
            Math.hypot(point.x - position.x, point.y - position.y),
          ),
        );
        const confidence = result.handedness[i]?.[0]?.score ?? 0.7;
        hands.push({
          position,
          radius: Math.min(radius, 0.18),
          confidence,
          activity: Math.min(
            1,
            motionGain *
              patchActivity(
                position,
                radius,
                gray,
                previousGray,
                width,
                height,
              ),
          ),
        });
      }
    }
    const handsDone = performance.now();
    const frame = motion.update(
      { ...foreground, hands },
      timestamp,
      sensitivity,
      message.floorCorners,
    );
    previousGray = gray;
    previousTimestamp = timestamp;
    report({
      type: "frame",
      frameId,
      frame,
      inferenceMs: performance.now() - started,
      hands: hands.length,
      handBackend: handLandmarker?.backend,
      timings: {
        preprocess: preprocessed - started,
        segmentation: segmented - preprocessed,
        foreground: foregroundDone - segmented,
        hands: handsDone - foregroundDone,
        postprocess: performance.now() - handsDone,
      },
    });
  } catch (error) {
    if (frameRevision !== revision) {
      discarded();
      return;
    }
    report({
      type: "error",
      frameId,
      message: error instanceof Error ? error.message : String(error),
    });
  } finally {
    bitmap.close();
    busy = false;
  }
}

worker.onmessage = (event) => {
  const message = event.data;
  if (message.type === "init") {
    void initialize(message.baseUrl).catch((error) =>
      report({
        type: "error",
        message: `Local vision assets could not load: ${error instanceof Error ? error.message : String(error)}`,
      }),
    );
  } else if (message.type === "reset") {
    revision++;
    previousGray = undefined;
    previousTimestamp = -Infinity;
    motion.reset();
  } else void processFrame(message);
};
