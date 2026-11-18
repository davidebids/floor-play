import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS,
  exportSettings,
  importSettings,
  loadSettings,
  sanitizeSettings,
  saveSettings,
  SETTINGS_KEY,
  setActivitySettings,
  sanitizeActivitySettings,
} from "./storage";
function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
}
describe("projection settings", () => {
  it("round-trips a valid calibrated profile and independent output corners", () => {
    const settings = sanitizeSettings({
      ...DEFAULT_SETTINGS,
      cameraId: "gopro",
      calibration: {
        ...DEFAULT_SETTINGS.calibration,
        calibrated: true,
        cameraId: "gopro",
        cameraWidth: 1280,
        cameraHeight: 720,
        outputCorners: [
          { x: 0.05, y: 0.02 },
          { x: 0.95, y: 0.06 },
          { x: 0.9, y: 0.92 },
          { x: 0.1, y: 0.94 },
        ],
      },
    });
    const store = memoryStorage();
    expect(saveSettings(settings, store)).toBe(true);
    expect(loadSettings(store)).toEqual(settings);
    expect(importSettings(exportSettings(settings))).toEqual(settings);
  });
  it("bounds untrusted values and invalidates calibration on camera mismatch", () => {
    const settings = sanitizeSettings({
      fishCount: 1e9,
      volume: -2,
      sensitivity: NaN,
      fishSpeed: Infinity,
      floorWidth: 0,
      cameraId: "new",
      paused: "yes",
      calibration: {
        version: 1,
        calibrated: true,
        cameraId: "old",
        cameraWidth: 1280,
        cameraHeight: 720,
        cameraCorners: DEFAULT_SETTINGS.calibration.cameraCorners,
        outputCorners: DEFAULT_SETTINGS.calibration.outputCorners,
      },
    });
    expect(settings.fishCount).toBe(24);
    expect(settings.volume).toBe(0);
    expect(settings.sensitivity).toBe(0.65);
    expect(settings.fishSpeed).toBe(0.8);
    expect(settings.floorWidth).toBe(0.3);
    expect(settings.paused).toBe(false);
    expect(settings.calibration.calibrated).toBe(false);
  });
  it("invalidates fractional video dimensions rather than rounding into a trusted signature", () => {
    const settings = sanitizeSettings({
      ...DEFAULT_SETTINGS,
      cameraId: "gopro",
      calibration: {
        ...DEFAULT_SETTINGS.calibration,
        calibrated: true,
        cameraId: "gopro",
        cameraWidth: 0.1,
        cameraHeight: 720,
      },
    });
    expect(settings.calibration.calibrated).toBe(false);
  });
  it("never shares mutable default corner arrays", () => {
    const one = sanitizeSettings({}),
      two = sanitizeSettings({});
    one.calibration.cameraCorners[0].x = 0.2;
    expect(two.calibration.cameraCorners[0].x).toBe(0);
    expect(DEFAULT_SETTINGS.calibration.cameraCorners[0].x).toBe(0);
  });
  it("recovers from malformed, unsupported and inaccessible browser storage", () => {
    const store = memoryStorage();
    store.setItem(SETTINGS_KEY, "{broken");
    expect(loadSettings(store)).toEqual(DEFAULT_SETTINGS);
    store.setItem(
      SETTINGS_KEY,
      JSON.stringify({ version: 999, settings: { fishCount: 24 } }),
    );
    expect(loadSettings(store)).toEqual(DEFAULT_SETTINGS);
    const unavailable = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("full");
      },
    };
    expect(loadSettings(unavailable)).toEqual(DEFAULT_SETTINGS);
    expect(saveSettings(DEFAULT_SETTINGS, unavailable)).toBe(false);
  });
  it("does not restore transient blank/pause/grid state on launch", () => {
    const store = memoryStorage();
    saveSettings(
      { ...DEFAULT_SETTINGS, blank: true, paused: true, calibrationGrid: true },
      store,
    );
    expect(loadSettings(store)).toMatchObject({
      blank: false,
      paused: false,
      calibrationGrid: false,
    });
  });
  it("rejects unsupported imports rather than silently accepting unrelated JSON", () => {
    expect(() => importSettings("oops")).toThrow(/JSON/);
    expect(() => importSettings("{}")).toThrow(/supported/);
    expect(() => importSettings('{"version":2,"settings":{}}')).toThrow(
      /supported/,
    );
  });
});

describe("per-activity preferences", () => {
  it("migrates old profiles and synchronizes the existing koi controls", () => {
    const old = sanitizeSettings({ fishCount: 12, fishSpeed: 1.2 });
    expect(old.activitySettings["koi-pond"]).toMatchObject({
      fishCount: 12,
      fishSpeed: 1.2,
    });
    const nested = sanitizeSettings({
      activitySettings: { "koi-pond": { fishCount: 10, fishSpeed: 0.5 } },
    });
    expect(nested.fishCount).toBe(10);
    expect(nested.fishSpeed).toBe(0.5);
  });
  it("persists separate future scene settings while preserving koi preferences", () => {
    const koi = setActivitySettings(sanitizeSettings({}), "koi-pond", {
      fishCount: 14,
      fishSpeed: 1.1,
    });
    const flowers = setActivitySettings(koi, "flower-garden", {
      bloomSize: 0.6,
      palette: "meadow",
      gentle: true,
    });
    const loaded = importSettings(exportSettings(flowers));
    expect(loaded.activitySettings["flower-garden"]).toEqual({
      bloomSize: 0.6,
      palette: "meadow",
      gentle: true,
    });
    expect(loaded.activitySettings["koi-pond"]).toMatchObject({
      fishCount: 14,
      fishSpeed: 1.1,
    });
    expect(loaded.fishCount).toBe(14);
    expect(loaded.cameraId).toBe(koi.cameraId);
    expect(loaded.calibration).toEqual(koi.calibration);
  });
  it("copies preference maps without mutating defaults or other activity profiles", () => {
    const first = sanitizeSettings({}),
      second = sanitizeSettings({});
    first.activitySettings["koi-pond"].fishCount = 23;
    expect(second.activitySettings["koi-pond"].fishCount).toBe(8);
    expect(DEFAULT_SETTINGS.activitySettings["koi-pond"].fishCount).toBe(8);
  });
  it("rejects nested, nonfinite, unsafe and unbounded imported activity settings", () => {
    const result = sanitizeActivitySettings(
      JSON.parse(
        '{"flower-garden":{"constructor":2,"nested":{"x":1},"safe":true,"huge":1e99},"__proto__":{"polluted":true}}',
      ),
    );
    expect(result).toEqual({ "flower-garden": { safe: true, huge: 1e6 } });
    expect(
      sanitizeActivitySettings({ bad: { nan: NaN, infinity: Infinity } }),
    ).toEqual({ bad: {} });
    expect(() =>
      setActivitySettings(sanitizeSettings({}), "__proto__", {}),
    ).toThrow(/activity/);
  });
});

it("preserves optional output signatures and rejects array-shaped setup payloads", () => {
  const current = sanitizeSettings({
    ...DEFAULT_SETTINGS,
    calibration: {
      ...DEFAULT_SETTINGS.calibration,
      outputSignature: "output-v1:projector:[1,2,3]",
    },
  });
  expect(
    importSettings(exportSettings(current)).calibration.outputSignature,
  ).toBe("output-v1:projector:[1,2,3]");
  expect(sanitizeSettings({}).calibration.outputSignature).toBeUndefined();
  expect(() => importSettings('{"version":1,"settings":[]}')).toThrow(
    /supported/,
  );
});
