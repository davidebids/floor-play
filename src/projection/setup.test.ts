import { describe, expect, it } from "vitest";
import { alignmentMatches, alignmentSource, restoredAlignment } from "./setup";
import { DEFAULT_SETTINGS } from "./storage";
import type { TrackingStatus } from "./types";

const output = "output-v1:projector:fixture";
const camera: TrackingStatus = {
  deviceId: "test-camera",
  state: "ready",
  message: "Live",
  fps: 10,
  inferenceMs: 20,
  width: 1280,
  height: 720,
  regions: 0,
  hands: 0,
};
const settings = {
  ...structuredClone(DEFAULT_SETTINGS),
  cameraId: camera.deviceId!,
  calibration: {
    ...structuredClone(DEFAULT_SETTINGS.calibration),
    cameraId: camera.deviceId!,
    cameraWidth: camera.width,
    cameraHeight: camera.height,
    calibrated: true,
    outputSignature: output,
  },
};
describe("setup alignment trust", () => {
  it("only reuses corners for the same live camera resolution and output", () => {
    expect(alignmentMatches(settings.calibration, camera, output)).toBe(true);
    for (const changed of [
      { ...camera, deviceId: "other" },
      { ...camera, width: 1920 },
      { ...camera, height: 1080 },
      { ...camera, width: 0 },
    ])
      expect(alignmentMatches(settings.calibration, changed, output)).toBe(
        false,
      );
    expect(
      alignmentMatches(
        settings.calibration,
        camera,
        "output-v1:preview:fixture",
      ),
    ).toBe(false);
    expect(alignmentMatches(settings.calibration, camera, "")).toBe(false);
  });
  it("invalidates a marking session for mirror, physical floor, warp, camera and output changes", () => {
    const initial = alignmentSource(settings, camera, output);
    const changed = [
      { ...settings, floorWidth: 2 },
      { ...settings, floorHeight: 2 },
      {
        ...settings,
        calibration: {
          ...settings.calibration,
          mirrored: !settings.calibration.mirrored,
        },
      },
      {
        ...settings,
        calibration: {
          ...settings.calibration,
          outputCorners: settings.calibration.outputCorners.map((p) => ({
            x: p.x * 0.9,
            y: p.y,
          })) as typeof settings.calibration.outputCorners,
        },
      },
    ];
    changed.forEach((next) =>
      expect(alignmentSource(next, camera, output)).not.toBe(initial),
    );
    expect(
      alignmentSource(settings, { ...camera, width: 1920 }, output),
    ).not.toBe(initial);
    expect(alignmentSource(settings, camera, `${output}-moved`)).not.toBe(
      initial,
    );
    expect(alignmentSource(settings, camera, "")).toBe("");
  });
  it("restores an unchanged profile and preserves a projector profile on preview handback", () => {
    expect(
      restoredAlignment(settings.calibration, camera, output).calibrated,
    ).toBe(true);
    expect(
      restoredAlignment(settings.calibration, camera, "output-v1:preview:other")
        .calibrated,
    ).toBe(true);
  });
  it("cancellation cannot resurrect trust after a camera or output change", () => {
    expect(
      restoredAlignment(
        settings.calibration,
        { ...camera, width: 1920 },
        output,
      ).calibrated,
    ).toBe(false);
    expect(
      restoredAlignment(settings.calibration, camera, `${output}-resized`)
        .calibrated,
    ).toBe(false);
    expect(settings.calibration.calibrated).toBe(true);
  });
});
