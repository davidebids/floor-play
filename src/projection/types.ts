export interface Point {
  x: number;
  y: number;
}
export type Quad = [Point, Point, Point, Point];
export interface PresenceRegion {
  id: string;
  center: Point;
  radius: number;
  confidence: number;
}
export interface MotionSample {
  id: string;
  position: Point;
  strength: number;
  radius: number;
  confidence: number;
}
export interface Impulse {
  id: string;
  position: Point;
  strength: number;
  confidence: number;
  timestamp: number;
}
export interface InteractionFrame {
  timestamp: number;
  presence: PresenceRegion[];
  motion: MotionSample[];
  impulses: Impulse[];
  source: "camera" | "pointer" | "replay";
}
export interface CalibrationProfile {
  version: 1;
  cameraCorners: Quad;
  outputCorners: Quad;
  cameraId: string;
  cameraWidth: number;
  cameraHeight: number;
  mirrored: boolean;
  calibrated: boolean;
  /** Geometry of the actual output window at camera alignment time. */
  outputSignature?: string;
}
export type ActivitySettingValue = string | number | boolean;
export type ActivitySettings = Record<string, ActivitySettingValue>;
export type ActivitySettingsMap = Record<string, ActivitySettings>;
export interface ProjectionSettings {
  activityId: string;
  /** Independently persisted scene preferences. */
  activitySettings: ActivitySettingsMap;
  /** Legacy v1 koi aliases kept for saved-profile compatibility; scene controls use activitySettings. */
  fishCount: number;
  fishSpeed: number;
  sensitivity: number;
  volume: number;
  sound: boolean;
  paused: boolean;
  blank: boolean;
  diagnostics: boolean;
  calibrationGrid: boolean;
  inputMode: "pointer" | "camera";
  cameraId: string;
  floorWidth: number;
  floorHeight: number;
  calibration: CalibrationProfile;
}
export interface TrackingStatus {
  actionsDetected?: number;
  handBackend?: "CPU" | "GPU";
  frameAgeMs?: number;
  timings?: Record<string, number>;
  videoTimeSeconds?: number;
  decodedFrames?: number;
  submittedFrames?: number;
  deviceId?: string;
  state: "idle" | "starting" | "ready" | "limited" | "error";
  message: string;
  fps: number;
  inferenceMs: number;
  width: number;
  height: number;
  regions: number;
  hands: number;
}
export interface VisionCallbacks {
  onFrame: (frame: InteractionFrame) => void;
  onStatus: (status: TrackingStatus) => void;
  onPreview?: (dataUrl: string) => void;
}
export interface VisionController {
  start: (deviceId: string) => Promise<void>;
  stop: () => void;
  configure: (settings: ProjectionSettings) => void;
  listDevices: () => Promise<MediaDeviceInfo[]>;
}
export interface ActivityContext {
  /** Prevent late module loads from creating a renderer after another scene has taken ownership. */
  isCurrent?: () => boolean;
  canvas: HTMLCanvasElement;
  settings: ProjectionSettings;
}
/** Optional scene-owned sound; scenes dispose their own audio resources. */
export interface ActivityAudio {
  unlock: () => void;
  configure: (enabled: boolean, volume: number, active: boolean) => void;
  impulse: (strength: number) => void;
}
export interface Activity {
  audio?: ActivityAudio;
  id: string;
  title: string;
  /** Return scene-accepted impulses to filter sound; void accepts the input impulses. */
  update: (
    dt: number,
    time: number,
    interactions: InteractionFrame,
  ) => void | readonly Impulse[];
  render: (time: number) => void;
  configure: (settings: ProjectionSettings) => void;
  dispose: () => void;
  diagnostics: () => Record<string, unknown>;
}
export const emptyFrame = (
  timestamp = performance.now(),
): InteractionFrame => ({
  timestamp,
  presence: [],
  motion: [],
  impulses: [],
  source: "pointer",
});
