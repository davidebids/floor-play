import {
  HandLandmarker,
  type HandLandmarkerResult,
} from "@mediapipe/tasks-vision";
export type HandBackend = "GPU" | "CPU";
/** Same model/thresholds on both backends; GPU failure retains semantic hand tracking. */
export async function createHandTracker(
  vision: Parameters<typeof HandLandmarker.createFromOptions>[0],
  modelAssetPath: string,
) {
  const options = {
    runningMode: "VIDEO" as const,
    numHands: 2,
    minHandDetectionConfidence: 0.45,
    minHandPresenceConfidence: 0.45,
    minTrackingConfidence: 0.45,
  };
  const load = (delegate: HandBackend) =>
    HandLandmarker.createFromOptions(vision, {
      ...options,
      baseOptions: { modelAssetPath, delegate },
      ...(delegate === "GPU" ? { canvas: new OffscreenCanvas(1, 1) } : {}),
    });
  let backend: HandBackend = "GPU";
  let detector: HandLandmarker;
  try {
    detector = await load("GPU");
  } catch {
    backend = "CPU";
    detector = await load("CPU");
  }
  return {
    get backend() {
      return backend;
    },
    async detectForVideo(
      image: OffscreenCanvas,
      timestamp: number,
    ): Promise<HandLandmarkerResult> {
      try {
        return detector.detectForVideo(image, timestamp);
      } catch (error) {
        if (backend === "CPU") throw error;
        try {
          detector.close();
        } catch {
          /* A lost GPU context must not prevent recovery. */
        }
        backend = "CPU";
        detector = await load("CPU");
        return detector.detectForVideo(image, timestamp);
      }
    },
    close() {
      detector.close();
    },
  };
}
export type HandTracker = Awaited<ReturnType<typeof createHandTracker>>;
