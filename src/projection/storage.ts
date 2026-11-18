import { DEFAULT_QUAD, validQuad } from "./calibration";
import type {
  ActivitySettings,
  ActivitySettingsMap,
  CalibrationProfile,
  ProjectionSettings,
  Quad,
} from "./types";

export const SETTINGS_KEY = "projection-app.settings.v1";
const freshQuad = (): Quad =>
  DEFAULT_QUAD.map((point) => ({ ...point })) as Quad;
export const DEFAULT_SETTINGS: ProjectionSettings = {
  activityId: "koi-pond",
  activitySettings: { "koi-pond": { fishCount: 8, fishSpeed: 0.8 } },
  fishCount: 8,
  fishSpeed: 0.8,
  sensitivity: 0.65,
  volume: 0.18,
  sound: false,
  paused: false,
  blank: false,
  diagnostics: false,
  calibrationGrid: false,
  inputMode: "pointer",
  cameraId: "",
  floorWidth: 1.8288,
  floorHeight: 1.2192,
  calibration: {
    version: 1,
    cameraCorners: freshQuad(),
    outputCorners: freshQuad(),
    cameraId: "",
    cameraWidth: 0,
    cameraHeight: 0,
    mirrored: false,
    calibrated: false,
  },
};
interface SettingsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const number = (
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
const boolean = (value: unknown, fallback: boolean): boolean =>
  typeof value === "boolean" ? value : fallback;
const text = (value: unknown, fallback = "", max = 256): string =>
  typeof value === "string" ? value.slice(0, max) : fallback;
const quad = (value: unknown): Quad =>
  validQuad(value)
    ? (value.map((point) => ({ x: point.x, y: point.y })) as Quad)
    : freshQuad();

const activityIdPattern = /^[a-z][a-z0-9-]{0,63}$/;
const settingKeyPattern = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/;
const reservedKeys = new Set(["constructor", "prototype", "__proto__"]);

/** Preserve bounded scene-local primitive settings without accepting nested objects or unsafe keys. */
export function sanitizeActivitySettings(input: unknown): ActivitySettingsMap {
  const result: ActivitySettingsMap = {};
  for (const [id, raw] of Object.entries(object(input)).slice(0, 32)) {
    if (!activityIdPattern.test(id) || reservedKeys.has(id)) continue;
    const fields: ActivitySettings = {};
    for (const [key, value] of Object.entries(object(raw)).slice(0, 64)) {
      if (!settingKeyPattern.test(key) || reservedKeys.has(key)) continue;
      if (typeof value === "boolean") fields[key] = value;
      else if (typeof value === "string") fields[key] = value.slice(0, 1024);
      else if (typeof value === "number" && Number.isFinite(value))
        fields[key] = Math.max(-1e6, Math.min(1e6, value));
    }
    result[id] = fields;
  }
  return result;
}

/** Only known fields survive; values, bounds, calibration consistency and future schema versions are validated. */
export function sanitizeSettings(input: unknown): ProjectionSettings {
  const envelope = object(input);
  const raw =
    envelope.version === 1 && envelope.settings
      ? object(envelope.settings)
      : envelope;
  const c = object(raw.calibration);
  const requestedCalibration = c.calibrated === true;
  const calibrationValid =
    c.version === 1 &&
    validQuad(c.cameraCorners) &&
    validQuad(c.outputCorners) &&
    typeof c.cameraId === "string" &&
    c.cameraId.length > 0 &&
    typeof c.cameraWidth === "number" &&
    Number.isInteger(c.cameraWidth) &&
    c.cameraWidth >= 1 &&
    c.cameraWidth <= 8192 &&
    typeof c.cameraHeight === "number" &&
    Number.isInteger(c.cameraHeight) &&
    c.cameraHeight >= 1 &&
    c.cameraHeight <= 8192;
  const calibration: CalibrationProfile = {
    version: 1,
    cameraCorners: quad(c.cameraCorners),
    outputCorners: quad(c.outputCorners),
    cameraId: text(c.cameraId),
    cameraWidth: Math.round(number(c.cameraWidth, 0, 0, 8192)),
    cameraHeight: Math.round(number(c.cameraHeight, 0, 0, 8192)),
    mirrored: boolean(c.mirrored, false),
    calibrated: requestedCalibration && calibrationValid,
    ...(typeof c.outputSignature === "string" && c.outputSignature.length > 0
      ? { outputSignature: c.outputSignature.slice(0, 2048) }
      : {}),
  };
  const cameraId = text(raw.cameraId);
  if (calibration.calibrated && cameraId !== calibration.cameraId)
    calibration.calibrated = false;
  const activity = text(raw.activityId, DEFAULT_SETTINGS.activityId, 64);
  const activitySettings = sanitizeActivitySettings(raw.activitySettings);
  const koi = activitySettings["koi-pond"] ?? {};
  const fishCount = Math.round(
    number(raw.fishCount, number(koi.fishCount, 8, 1, 24), 1, 24),
  );
  const fishSpeed = number(
    raw.fishSpeed,
    number(koi.fishSpeed, 0.8, 0.2, 2),
    0.2,
    2,
  );
  // Existing controls write top-level aliases; nested-only profiles migrate in the other direction.
  activitySettings["koi-pond"] = { ...koi, fishCount, fishSpeed };
  return {
    activityId: /^[a-z][a-z0-9-]{0,63}$/.test(activity)
      ? activity
      : DEFAULT_SETTINGS.activityId,
    activitySettings,
    fishCount,
    fishSpeed,
    sensitivity: number(raw.sensitivity, 0.65, 0.05, 1),
    volume: number(raw.volume, 0.18, 0, 1),
    sound: boolean(raw.sound, false),
    paused: boolean(raw.paused, false),
    blank: boolean(raw.blank, false),
    diagnostics: boolean(raw.diagnostics, false),
    calibrationGrid: boolean(raw.calibrationGrid, false),
    inputMode: raw.inputMode === "camera" ? "camera" : "pointer",
    cameraId,
    floorWidth: number(raw.floorWidth, 1.8288, 0.3, 10),
    floorHeight: number(raw.floorHeight, 1.2192, 0.3, 10),
    calibration,
  };
}

/** Future activity editors use this helper; global camera/calibration preferences stay untouched. */
export function setActivitySettings(
  settings: ProjectionSettings,
  activityId: string,
  patch: ActivitySettings,
): ProjectionSettings {
  if (!activityIdPattern.test(activityId) || reservedKeys.has(activityId))
    throw new RangeError("Invalid activity ID.");
  const clean =
    sanitizeActivitySettings({ [activityId]: patch })[activityId] ?? {};
  return sanitizeSettings({
    ...settings,
    ...(activityId === "koi-pond"
      ? {
          fishCount:
            typeof clean.fishCount === "number"
              ? clean.fishCount
              : settings.fishCount,
          fishSpeed:
            typeof clean.fishSpeed === "number"
              ? clean.fishSpeed
              : settings.fishSpeed,
        }
      : {}),
    activitySettings: {
      ...settings.activitySettings,
      [activityId]: { ...settings.activitySettings[activityId], ...clean },
    },
  });
}

function browserStorage(): SettingsStorage | undefined {
  try {
    return typeof localStorage !== "undefined" ? localStorage : undefined;
  } catch {
    return undefined;
  }
}
export function loadSettings(
  storage: SettingsStorage | undefined = browserStorage(),
): ProjectionSettings {
  try {
    const value = storage?.getItem(SETTINGS_KEY);
    const parsed = value ? JSON.parse(value) : {};
    const envelope = object(parsed);
    if ("version" in envelope && envelope.version !== 1)
      return sanitizeSettings({});
    const settings = sanitizeSettings(parsed);
    // Never reopen to an unexplained black screen, frozen scene or calibration grid.
    return { ...settings, paused: false, blank: false, calibrationGrid: false };
  } catch {
    return sanitizeSettings({});
  }
}
export function saveSettings(
  settings: ProjectionSettings,
  storage: SettingsStorage | undefined = browserStorage(),
): boolean {
  try {
    if (!storage) return false;
    storage.setItem(SETTINGS_KEY, exportSettings(settings));
    return true;
  } catch {
    return false;
  }
}
export function exportSettings(settings: ProjectionSettings): string {
  return JSON.stringify(
    { version: 1, settings: sanitizeSettings(settings) },
    null,
    2,
  );
}
export function importSettings(json: string): ProjectionSettings {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("The settings file is not valid JSON.");
  }
  const envelope = object(parsed);
  if (
    envelope.version !== 1 ||
    !envelope.settings ||
    typeof envelope.settings !== "object" ||
    Array.isArray(envelope.settings)
  )
    throw new Error("This is not a supported Projection App settings file.");
  return sanitizeSettings(envelope);
}
