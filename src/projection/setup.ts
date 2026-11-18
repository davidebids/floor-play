import type {
  CalibrationProfile,
  ProjectionSettings,
  TrackingStatus,
} from "./types";

/** Alignment may only be reused with the exact live camera and output it describes. */
export function alignmentMatches(
  profile: CalibrationProfile,
  camera: TrackingStatus,
  output: string,
): boolean {
  return Boolean(
    profile.calibrated &&
    output &&
    profile.outputSignature === output &&
    camera.deviceId &&
    profile.cameraId === camera.deviceId &&
    camera.width > 0 &&
    profile.cameraWidth === camera.width &&
    profile.cameraHeight === camera.height,
  );
}

/** Bind a set of corner clicks to the image and floor geometry being marked. */
export function alignmentSource(
  settings: ProjectionSettings,
  camera: TrackingStatus,
  output: string,
): string {
  if (!camera.deviceId || !camera.width || !camera.height || !output) return "";
  return JSON.stringify([
    camera.deviceId,
    camera.width,
    camera.height,
    settings.calibration.mirrored,
    settings.floorWidth,
    settings.floorHeight,
    settings.calibration.outputCorners,
    output,
  ]);
}

/** Cancellation restores the draft, but cannot restore trust in changed hardware. */
export function restoredAlignment(
  profile: CalibrationProfile,
  camera: TrackingStatus,
  output: string,
): CalibrationProfile {
  const cameraChanged =
    camera.deviceId &&
    camera.width > 0 &&
    (profile.cameraId !== camera.deviceId ||
      profile.cameraWidth !== camera.width ||
      profile.cameraHeight !== camera.height);
  const outputChanged =
    output &&
    profile.outputSignature &&
    output.split(":")[1] === profile.outputSignature.split(":")[1] &&
    output !== profile.outputSignature;
  return {
    ...profile,
    calibrated: profile.calibrated && !cameraChanged && !outputChanged,
  };
}
