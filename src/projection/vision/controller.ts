import { CameraLease } from "./camera-lease";
import { cameraToFloor } from "../calibration";
import type {
  CalibrationProfile,
  InteractionFrame,
  Point,
  ProjectionSettings,
  TrackingStatus,
  VisionCallbacks,
  VisionController,
} from "../types";
import type { WorkerInput, WorkerOutput } from "./protocol";

interface CameraSignature {
  cameraId: string;
  width: number;
  height: number;
}
export function calibrationMatches(
  profile: CalibrationProfile,
  signature: CameraSignature,
): boolean {
  return (
    profile.calibrated &&
    profile.cameraId === signature.cameraId &&
    profile.cameraWidth === signature.width &&
    profile.cameraHeight === signature.height &&
    signature.width > 0 &&
    signature.height > 0
  );
}
const clamp = (value: number, low: number, high: number): number =>
  Math.max(low, Math.min(high, value));
function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
  signal?: AbortSignal,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const cancel = (): void => {
      cleanup();
      reject(new Error("Camera request cancelled."));
    };
    const cleanup = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(message));
    }, timeoutMs);
    if (signal?.aborted) {
      cancel();
      return;
    }
    signal?.addEventListener("abort", cancel, { once: true });
    promise.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error) => {
        cleanup();
        reject(error);
      },
    );
  });
}
const noInput = (): InteractionFrame => ({
  timestamp: performance.now(),
  source: "camera",
  presence: [],
  motion: [],
  impulses: [],
});

export function mapCameraFrame(
  frame: InteractionFrame,
  calibration: CalibrationProfile,
): InteractionFrame {
  const map = (point: Point): Point | null => cameraToFloor(point, calibration);
  const radiusAt = (point: Point, radius: number): number => {
    const center = map(point);
    if (!center) return 0;
    const offsets = [
      { x: point.x + radius, y: point.y },
      { x: point.x - radius, y: point.y },
      { x: point.x, y: point.y + radius },
      { x: point.x, y: point.y - radius },
    ];
    const distances = offsets
      .map(map)
      .filter((value): value is Point => value !== null)
      .map((value) => Math.hypot(value.x - center.x, value.y - center.y));
    return clamp(
      distances.length ? Math.max(...distances) : radius,
      0.015,
      0.3,
    );
  };
  return {
    ...frame,
    presence: frame.presence.flatMap((region) => {
      const center = map(region.center);
      return center
        ? [
            {
              ...region,
              center,
              radius: radiusAt(region.center, region.radius),
            },
          ]
        : [];
    }),
    motion: frame.motion.flatMap((sample) => {
      const position = map(sample.position);
      return position
        ? [
            {
              ...sample,
              position,
              radius: radiusAt(sample.position, sample.radius),
            },
          ]
        : [];
    }),
    impulses: frame.impulses.flatMap((impulse) => {
      const position = map(impulse.position);
      return position ? [{ ...impulse, position }] : [];
    }),
  };
}

export function createVisionController(
  callbacks: VisionCallbacks,
): VisionController {
  let settings: ProjectionSettings | undefined;
  let video: HTMLVideoElement | undefined;
  let stream: MediaStream | undefined;
  let worker: Worker | undefined;
  let currentRun = 0;
  let startupAbort: AbortController | undefined;
  let observationRevision = 0;
  let observationKey = "";
  let submittedRevision = 0;
  let submittedFrameId = 0;
  let frameCallbackId = 0;
  let animationFrameId = 0;
  let watchdog: ReturnType<typeof setInterval> | undefined;
  let captureWake: ReturnType<typeof setTimeout> | undefined;
  let capturePoll: ReturnType<typeof setInterval> | undefined;
  const cameraLease = new CameraLease();
  let lastScheduled = -Infinity;
  let lastPreview = -Infinity;
  let lastPreviewMediaTime = -1;
  let previewStale = false;
  let lastCompleted = 0;
  const rateSamples: number[] = [];
  let lastSubmitted = 0;
  let lastMediaTime = -1;
  let busy = false;
  let ready = false;
  let frameId = 0;
  let actionsDetected = 0;
  let consecutiveErrors = 0;
  let handTracking = true;
  let signature: CameraSignature = { cameraId: "", width: 0, height: 0 };
  let deviceChangeListener: (() => void) | undefined;
  let previewCanvas: HTMLCanvasElement | undefined;
  let rawFrame: InteractionFrame | undefined;
  let status: TrackingStatus = {
    state: "idle",
    message: "Choose a camera to begin.",
    fps: 0,
    inferenceMs: 0,
    width: 0,
    height: 0,
    regions: 0,
    hands: 0,
  };
  const publish = (patch: Partial<TrackingStatus>): void => {
    status = {
      ...status,
      videoTimeSeconds: video?.currentTime ?? 0,
      decodedFrames: video?.getVideoPlaybackQuality?.().totalVideoFrames ?? 0,
      submittedFrames: frameId,
      actionsDetected,
      ...patch,
    };
    callbacks.onStatus(status);
  };
  const send = (message: WorkerInput, transfer?: Transferable[]): void => {
    worker?.postMessage(message, transfer ?? []);
  };

  const clearPreview = (): void => {
    if (!previewStale) callbacks.onPreview?.("");
    previewStale = true;
    lastPreview = -Infinity;
    lastPreviewMediaTime = -1;
    rawFrame = undefined;
  };

  const stop = (): void => {
    actionsDetected = 0;
    rateSamples.length = 0;
    currentRun++;
    startupAbort?.abort();
    startupAbort = undefined;
    ready = false;
    busy = false;
    if (watchdog) clearInterval(watchdog);
    if (capturePoll) clearInterval(capturePoll);
    if (captureWake) clearTimeout(captureWake);
    captureWake = undefined;
    capturePoll = undefined;
    watchdog = undefined;
    if (video && frameCallbackId && "cancelVideoFrameCallback" in video)
      video.cancelVideoFrameCallback(frameCallbackId);
    if (animationFrameId) cancelAnimationFrame(animationFrameId);
    frameCallbackId = 0;
    animationFrameId = 0;
    if (deviceChangeListener)
      navigator.mediaDevices?.removeEventListener(
        "devicechange",
        deviceChangeListener,
      );
    deviceChangeListener = undefined;
    worker?.terminate();
    worker = undefined;
    stream?.getTracks().forEach((track) => {
      track.onended = null;
      track.stop();
    });
    stream = undefined;
    if (video) {
      video.pause();
      video.srcObject = null;
      video.remove();
      video = undefined;
    }
    cameraLease.release();
    rawFrame = undefined;
    signature = { cameraId: "", width: 0, height: 0 };
    callbacks.onPreview?.("");
    previewStale = true;
    lastPreview = -Infinity;
    lastPreviewMediaTime = -1;
    callbacks.onFrame(noInput());
    publish({
      deviceId: undefined,
      width: 0,
      height: 0,
      inferenceMs: 0,
      state: "idle",
      message: "Camera stopped. The scene is running without camera input.",
      fps: 0,
      regions: 0,
      hands: 0,
      handBackend: undefined,
      timings: undefined,
      frameAgeMs: undefined,
    });
  };

  const fail = (message: string): void => {
    stop();
    publish({ state: "error", message });
  };

  const preview = (): void => {
    if (
      !callbacks.onPreview ||
      !video ||
      previewStale ||
      video.readyState < 2 ||
      video.currentTime === lastPreviewMediaTime ||
      performance.now() - lastPreview < 400
    )
      return;
    lastPreview = performance.now();
    lastPreviewMediaTime = video.currentTime;
    previewCanvas ??= document.createElement("canvas");
    previewCanvas.width = Math.min(640, video.videoWidth);
    previewCanvas.height = Math.round(
      (previewCanvas.width * video.videoHeight) / video.videoWidth,
    );
    const context = previewCanvas.getContext("2d");
    if (!context) return;
    const mirror = settings?.calibration.mirrored ?? false;
    context.setTransform(
      mirror ? -1 : 1,
      0,
      0,
      1,
      mirror ? previewCanvas.width : 0,
      0,
    );
    context.drawImage(video, 0, 0, previewCanvas.width, previewCanvas.height);
    context.resetTransform();
    if (settings?.diagnostics && rawFrame) {
      context.strokeStyle = "rgba(115,255,183,0.55)";
      context.lineWidth = 1;
      for (const region of rawFrame.presence) {
        context.beginPath();
        context.arc(
          region.center.x * previewCanvas.width,
          region.center.y * previewCanvas.height,
          region.radius * previewCanvas.width,
          0,
          Math.PI * 2,
        );
        context.stroke();
      }
      context.strokeStyle = "#ffcf70";
      context.lineWidth = 2;
      for (const motion of rawFrame.motion.slice(0, 12)) {
        context.beginPath();
        context.arc(
          motion.position.x * previewCanvas.width,
          motion.position.y * previewCanvas.height,
          5,
          0,
          Math.PI * 2,
        );
        context.stroke();
      }
    }
    callbacks.onPreview(previewCanvas.toDataURL("image/jpeg", 0.8));
  };

  const start = async (requestedDeviceId: string): Promise<void> => {
    stop();
    const run = currentRun;
    let captureLatest: (() => void) | undefined;
    const abort = new AbortController();
    startupAbort = abort;
    publish({
      state: "starting",
      message:
        "Opening camera. Allow camera access in Chrome and macOS if prompted.",
      inferenceMs: 0,
    });
    try {
      if (!navigator.mediaDevices?.getUserMedia)
        throw new Error("Camera access needs Chrome on localhost or HTTPS.");
      await cameraLease.acquire(navigator.locks, () => run === currentRun);
      if (run !== currentRun) return;
      let deviceId = requestedDeviceId;
      if (!deviceId) {
        const known = await navigator.mediaDevices.enumerateDevices();
        deviceId =
          known.find(
            (device) =>
              device.kind === "videoinput" &&
              /gopro|hero\s*\d+/i.test(device.label),
          )?.deviceId ?? "";
      }
      if (run !== currentRun) return;
      const opening = navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30 },
        },
      });
      void opening
        .then((opened) => {
          if (run !== currentRun)
            opened.getTracks().forEach((track) => track.stop());
        })
        .catch(() => undefined);
      const opened = await withTimeout(
        opening,
        20000,
        "Camera access did not complete. Check the macOS camera permission prompt and GoPro Webcam app, then try again.",
        abort.signal,
      );
      if (run !== currentRun) {
        opened.getTracks().forEach((track) => track.stop());
        return;
      }
      stream = opened;
      const track = opened.getVideoTracks()[0];
      if (!track) throw new Error("The selected device did not provide video.");
      const trackSettings = track.getSettings();
      signature.cameraId = trackSettings.deviceId ?? deviceId;
      video = document.createElement("video");
      video.muted = true;
      video.autoplay = true;
      video.playsInline = true;
      video.style.cssText =
        "position:fixed;bottom:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none;";
      video.setAttribute("aria-hidden", "true");
      document.body.append(video);
      video.srcObject = stream;
      await withTimeout(
        video.play(),
        12000,
        "Camera connected but no playable video arrived. Check the GoPro Webcam app and USB connection.",
        abort.signal,
      );
      if (run !== currentRun || !video) return;
      if (!video.videoWidth || !video.videoHeight) {
        const activeVideo = video;
        let loaded!: () => void;
        try {
          await withTimeout(
            new Promise<void>((resolve) => {
              loaded = resolve;
              activeVideo.addEventListener("loadeddata", loaded, {
                once: true,
              });
            }),
            12000,
            "Camera opened but no video frames arrived. Check the GoPro Webcam app.",
            abort.signal,
          );
        } finally {
          activeVideo.removeEventListener("loadeddata", loaded);
        }
      }
      if (run !== currentRun || !video) return;
      signature = {
        cameraId: signature.cameraId,
        width: video.videoWidth,
        height: video.videoHeight,
      };
      publish({
        width: signature.width,
        height: signature.height,
        deviceId: signature.cameraId,
        message: "Video connected. Loading local vision models…",
      });
      track.onended = () => {
        if (run === currentRun)
          fail(
            "Camera disconnected. Reconnect it, then start the camera again.",
          );
      };
      deviceChangeListener = () => {
        void navigator.mediaDevices
          .enumerateDevices()
          .then((devices) => {
            if (
              run === currentRun &&
              signature.cameraId &&
              !devices.some(
                (device) =>
                  device.kind === "videoinput" &&
                  device.deviceId === signature.cameraId,
              )
            )
              fail(
                "The selected camera is no longer available. Reconnect it or choose another camera.",
              );
          })
          .catch(() => undefined);
      };
      navigator.mediaDevices.addEventListener(
        "devicechange",
        deviceChangeListener,
      );
      lastCompleted = performance.now();
      lastScheduled = -Infinity;
      lastMediaTime = -1;
      lastPreview = -Infinity;
      lastPreviewMediaTime = -1;
      previewStale = false;
      consecutiveErrors = 0;
      frameId = 0;
      worker = new Worker(new URL("./worker.ts", import.meta.url), {
        type: "module",
      });
      const activeWorker = worker;
      await new Promise<void>((resolve, reject) => {
        const cleanup = (): void => {
          clearTimeout(timer);
          abort.signal.removeEventListener("abort", cancelled);
        };
        const cancelled = (): void => {
          cleanup();
          reject(new Error("Camera request cancelled."));
        };
        const timer = setTimeout(() => {
          cleanup();
          reject(
            new Error(
              "Local vision models took too long to initialize. Reload and try again.",
            ),
          );
        }, 35000);
        abort.signal.addEventListener("abort", cancelled, { once: true });
        activeWorker.onerror = (event) => {
          if (run !== currentRun) return;
          cleanup();
          const message = event.message || "Vision worker failed to run.";
          reject(new Error(message));
          if (ready) fail(message);
        };
        activeWorker.onmessage = (event: MessageEvent<WorkerOutput>) => {
          if (run !== currentRun) return;
          const message = event.data;
          if (message.type === "ready") {
            cleanup();
            ready = true;
            handTracking = message.handTracking;
            const calibrated =
              settings && calibrationMatches(settings.calibration, signature);
            publish({
              handBackend: message.handBackend,
              state: calibrated && handTracking ? "ready" : "limited",
              message: !calibrated
                ? "Video ready. Calibrate the floor before camera interactions are enabled."
                : (message.warning ??
                  "Tracking ready. Hand actions are estimated from image motion."),
            });
            resolve();
          } else if (message.type === "frame") {
            if (!busy || message.frameId !== submittedFrameId) return;
            busy = false;
            if (
              submittedRevision !== observationRevision ||
              message.frameId !== submittedFrameId
            ) {
              callbacks.onFrame(noInput());
              return;
            }
            consecutiveErrors = 0;
            const now = performance.now();
            lastCompleted = now;
            rawFrame = message.frame;
            const calibrated =
              settings && calibrationMatches(settings.calibration, signature);
            const stale =
              !Number.isFinite(message.frame.timestamp) ||
              now - message.frame.timestamp > 400 ||
              now - message.frame.timestamp < -50;
            if (stale) rateSamples.length = 0;
            else {
              rateSamples.push(message.frame.timestamp);
              while (
                rateSamples.length > 1 &&
                rateSamples[0] < message.frame.timestamp - 1000
              )
                rateSamples.shift();
            }
            const rateSpan = rateSamples.at(-1)! - rateSamples[0];
            if (stale) clearPreview();
            else {
              previewStale = false;
              preview();
            }
            let mappedFrame: InteractionFrame | undefined;
            if (
              !calibrated ||
              !settings ||
              settings.paused ||
              settings.blank ||
              stale
            )
              callbacks.onFrame(noInput());
            else {
              mappedFrame = mapCameraFrame(message.frame, settings.calibration);
              actionsDetected += mappedFrame.impulses.length;
              callbacks.onFrame(mappedFrame);
            }
            publish({
              state:
                !calibrated || !handTracking || stale ? "limited" : "ready",
              message: stale
                ? "Vision frames arrived late. Old interactions were discarded."
                : !calibrated
                  ? "Video ready. Calibrate this camera and resolution to enable interactions."
                  : !handTracking
                    ? "Person-gated movement tracking. Hand model unavailable."
                    : message.hands
                      ? "Hands and body tracking. Actions estimate quick hand movements."
                      : "Body tracking. Looking for visible hands.",
              // Capture cadence of fresh completed observations, averaged over
              // one second. Variable model time must not produce 60+ fps spikes.
              fps: stale
                ? 0
                : rateSpan > 0
                  ? Math.round(((rateSamples.length - 1) * 10000) / rateSpan) /
                    10
                  : 1,
              inferenceMs: Math.round(message.inferenceMs),
              handBackend: message.handBackend ?? status.handBackend,
              frameAgeMs: Math.max(0, now - message.frame.timestamp),
              timings: message.timings,
              regions: mappedFrame?.presence.length ?? 0,
              hands: stale ? 0 : message.hands,
            });
            captureLatest?.();
          } else {
            if (
              ready &&
              (!busy ||
                (message.frameId !== undefined &&
                  message.frameId !== submittedFrameId))
            )
              return;
            busy = false;
            if (ready && submittedRevision !== observationRevision) {
              callbacks.onFrame(noInput());
              captureLatest?.();
              return;
            }
            consecutiveErrors++;
            callbacks.onFrame(noInput());
            clearPreview();
            publish({
              state: "limited",
              message: message.message,
              fps: 0,
              regions: 0,
              hands: 0,
            });
            if (!ready) {
              cleanup();
              reject(new Error(message.message));
            } else if (consecutiveErrors >= 3)
              fail(
                `Vision processing stopped after repeated errors: ${message.message}`,
              );
          }
        };
        send({
          type: "init",
          baseUrl: new URL(import.meta.env.BASE_URL, window.location.origin)
            .href,
        });
        // Preview remains available during model initialization, including failures.
        preview();
      });
      if (run !== currentRun) return;
      const capture = (fromPoll = false): void => {
        if (run !== currentRun || !video) return;
        const currentWidth = video.videoWidth;
        const currentHeight = video.videoHeight;
        if (
          currentWidth > 0 &&
          currentHeight > 0 &&
          (currentWidth !== signature.width ||
            currentHeight !== signature.height)
        ) {
          signature = {
            ...signature,
            width: currentWidth,
            height: currentHeight,
          };
          observationRevision++;
          rateSamples.length = 0;
          send({ type: "reset" });
          clearPreview();
          callbacks.onFrame(noInput());
          publish({
            state: "limited",
            fps: 0,
            width: currentWidth,
            height: currentHeight,
            regions: 0,
            hands: 0,
            message:
              "Camera resolution changed. Recalibrate before camera interactions resume.",
          });
        }
        preview();
        const now = performance.now();
        const remaining = 1000 / 30 - (now - lastScheduled);
        if (
          ready &&
          !busy &&
          video.readyState >= 2 &&
          video.currentTime !== lastMediaTime &&
          remaining > 0 &&
          !captureWake
        ) {
          captureWake = setTimeout(() => {
            captureWake = undefined;
            if (run === currentRun) captureLatest?.();
          }, Math.ceil(remaining));
        }
        if (
          ready &&
          !busy &&
          video.readyState >= 2 &&
          video.currentTime !== lastMediaTime &&
          remaining <= 0
        ) {
          if (captureWake) clearTimeout(captureWake);
          captureWake = undefined;
          busy = true;
          lastScheduled = now;
          lastSubmitted = now;
          lastMediaTime = video.currentTime;
          const activeVideo = video;
          const capturedRevision = observationRevision;
          void createImageBitmap(activeVideo)
            .then((bitmap) => {
              if (run !== currentRun || !worker) {
                bitmap.close();
                return;
              }
              if (capturedRevision !== observationRevision) {
                bitmap.close();
                busy = false;
                return;
              }
              submittedRevision = capturedRevision;
              submittedFrameId = ++frameId;
              try {
                send(
                  {
                    type: "frame",
                    bitmap,
                    timestamp: now,
                    frameId: submittedFrameId,
                    mirrored: settings?.calibration.mirrored ?? false,
                    sensitivity: settings?.sensitivity ?? 0.65,
                    floorCorners:
                      settings &&
                      calibrationMatches(settings.calibration, signature)
                        ? settings.calibration.cameraCorners
                        : undefined,
                  },
                  [bitmap],
                );
              } catch (error) {
                // Transfer failure leaves ownership on the main thread.
                bitmap.close();
                throw error;
              }
            })
            .catch((error) => {
              if (run !== currentRun) return;
              busy = false;
              if (run === currentRun)
                fail(
                  `Unable to read camera frames: ${error instanceof Error ? error.message : String(error)}`,
                );
            });
        }
        if (!fromPoll) {
          if ("requestVideoFrameCallback" in video)
            frameCallbackId = video.requestVideoFrameCallback(() => capture());
          else animationFrameId = requestAnimationFrame(() => capture());
        }
      };
      captureLatest = () => capture(true);
      capture();
      // Camera video is deliberately hidden. Chrome can keep decoding it while
      // suppressing compositor callbacks; polling advancing media time keeps
      // inference alive without queuing duplicate or outdated frames.
      capturePoll = setInterval(() => capture(true), 16);
      watchdog = setInterval(() => {
        if (run !== currentRun) return;
        if (busy && performance.now() - lastSubmitted > 10000)
          fail("Camera processing stalled. Start the camera again.");
        else if (performance.now() - lastCompleted > 1000) {
          rateSamples.length = 0;
          clearPreview();
          callbacks.onFrame(noInput());
          publish({
            state: "limited",
            message:
              "Waiting for fresh camera frames. Old interactions have been cleared.",
            fps: 0,
            regions: 0,
            hands: 0,
          });
        } else preview();
      }, 500);
    } catch (error) {
      if (run !== currentRun) return;
      const name = error instanceof DOMException ? error.name : "";
      const message =
        name === "NotAllowedError"
          ? "Camera permission was denied. Allow Chrome in macOS Privacy & Security → Camera, then try again."
          : name === "NotFoundError" || name === "OverconstrainedError"
            ? "Selected camera is unavailable. Connect the GoPro Webcam app or select another camera."
            : name === "NotReadableError"
              ? "The camera is busy or unavailable. Close other camera apps and try again."
              : error instanceof Error
                ? error.message
                : String(error);
      fail(message);
      throw new Error(message);
    }
  };

  return {
    start,
    stop,
    configure(next): void {
      const key = JSON.stringify([
        next.activityId,
        next.inputMode,
        next.paused,
        next.blank,
        next.calibration,
      ]);
      const reset = observationKey !== "" && observationKey !== key;
      observationKey = key;
      settings = next;
      if (reset) {
        observationRevision++;
        rateSamples.length = 0;
        send({ type: "reset" });
        clearPreview();
        callbacks.onFrame(noInput());
        if (video)
          publish({
            state: "limited",
            fps: 0,
            regions: 0,
            hands: 0,
            message:
              "Waiting for fresh camera frames after configuration changed.",
          });
      }
    },
    async listDevices(): Promise<MediaDeviceInfo[]> {
      if (!navigator.mediaDevices?.enumerateDevices) return [];
      return (await navigator.mediaDevices.enumerateDevices()).filter(
        (device) => device.kind === "videoinput",
      );
    },
  };
}
