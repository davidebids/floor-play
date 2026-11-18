import type { Quad } from "../types";
import type { InteractionFrame } from "../types";
export type WorkerInput =
  | { type: "init"; baseUrl: string }
  | {
      type: "frame";
      bitmap: ImageBitmap;
      timestamp: number;
      frameId: number;
      mirrored: boolean;
      sensitivity: number;
      floorCorners?: Quad;
    }
  | { type: "reset" };
export type WorkerOutput =
  | {
      type: "ready";
      handTracking: boolean;
      handBackend?: "CPU" | "GPU";
      warning?: string;
    }
  | {
      type: "frame";
      frameId: number;
      frame: InteractionFrame;
      inferenceMs: number;
      hands: number;
      handBackend?: "CPU" | "GPU";
      timings?: Record<string, number>;
    }
  | { type: "error"; message: string; frameId?: number };
