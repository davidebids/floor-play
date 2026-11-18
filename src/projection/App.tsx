import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  ArrowUpRight,
  Camera,
  Check,
  ChevronDown,
  Download,
  Shapes,
  Maximize,
  MousePointer2,
  Pause,
  Play,
  RefreshCw,
  Settings2,
  SlidersHorizontal,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { Select } from "@base-ui/react/select";
import { ProjectionRuntime } from "./runtime";
import {
  DEFAULT_QUAD,
  homography,
  outputToFloor,
  outputGeometrySignature,
  validQuad,
} from "./calibration";
import {
  exportSettings,
  importSettings,
  loadSettings,
  sanitizeSettings,
  saveSettings,
  setActivitySettings,
} from "./storage";
import { activities } from "./registry";
import { alignmentMatches, alignmentSource, restoredAlignment } from "./setup";
import { holdProjectorLease, projectorLeaseHeld } from "./output-lease";
import type { Point, ProjectionSettings, Quad, TrackingStatus } from "./types";
const IS_PROJECTOR =
  new URLSearchParams(location.search).get("view") === "projector";
const idleTracking: TrackingStatus = {
  state: "idle",
  message: "Choose a camera to begin",
  fps: 0,
  inferenceMs: 0,
  width: 0,
  height: 0,
  regions: 0,
  hands: 0,
};
const names = ["Top left", "Top right", "Bottom right", "Bottom left"];
function warpStyle(quad: Quad, width: number, height: number): CSSProperties {
  if (width < 1 || height < 1 || !validQuad(quad)) return {};
  const h = homography(DEFAULT_QUAD, quad);
  return {
    transformOrigin: "0 0",
    transform: `matrix3d(${h[0]},${(h[3] * height) / width},0,${h[6] / width},${(h[1] * width) / height},${h[4]},0,${h[7] / height},0,0,1,0,${h[2] * width},${h[5] * height},0,${h[8]})`,
  };
}
function settingsForOutput(
  settings: ProjectionSettings,
  signature: string,
): ProjectionSettings {
  const expected = `output-v1:${IS_PROJECTOR ? "projector" : "preview"}:`;
  const aligned =
    settings.calibration.calibrated &&
    signature.startsWith(expected) &&
    settings.calibration.outputSignature === signature;
  return {
    ...settings,
    calibration: { ...settings.calibration, calibrated: aligned },
  };
}

function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  display,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  display: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="setting-slider">
      <span>
        {label}
        <output>{display}</output>
      </span>
      <input
        aria-label={label}
        type="range"
        style={
          {
            "--slider-fill": `${Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100))}%`,
          } as CSSProperties
        }
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}
function FloorDimension({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (meters: number) => void;
}) {
  const feet = Number((value / 0.3048).toFixed(1));
  const [draft, setDraft] = useState(String(feet));
  useEffect(() => setDraft(String(feet)), [feet]);
  const commit = () => {
    const entered = Number(draft);
    const next =
      draft.trim() && Number.isFinite(entered)
        ? Math.max(2, Math.min(12, entered))
        : feet;
    setDraft(String(next));
    if (next !== feet) onChange(next * 0.3048);
  };
  return (
    <label>
      {label} (ft)
      <input
        aria-label={`Floor ${label === "Width" ? "width" : "depth"} in feet`}
        type="number"
        min={2}
        max={12}
        step={0.5}
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value);
          const next = Number(event.target.value);
          if (
            event.target.value &&
            Number.isFinite(next) &&
            next >= 2 &&
            next <= 12 &&
            next !== feet
          )
            onChange(next * 0.3048);
        }}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
      />
    </label>
  );
}
export function ProjectionApp() {
  const [config, setConfig] = useState(() => {
    const loaded = loadSettings();
    return activities.some((activity) => activity.id === loaded.activityId)
      ? loaded
      : { ...loaded, activityId: activities[0].id };
  });
  const scene =
    activities.find((scene) => scene.id === config.activityId) ?? activities[0];
  const configRef = useRef(config);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<ProjectionRuntime | null>(null);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const own = useRef(crypto.randomUUID());
  const [tracking, setTracking] = useState<TrackingStatus>(idleTracking);
  const trackingRef = useRef(tracking);
  const [metrics, setMetrics] = useState<Record<string, unknown>>({});
  const metricsRef = useRef(metrics);
  const [preview, setPreview] = useState("");
  const previewRef = useRef("");
  const [error, setError] = useState("");
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [external, setExternal] = useState(false);
  const lastExternal = useRef(0);
  const projectorUnloading = useRef(0);
  const externalRef = useRef(false);
  const externalOrigin = useRef<string | null>(null);
  const projectorWindow = useRef<Window | null>(null);
  const localGeometry = useRef("");
  const outputSignature = useRef("");
  const [activeOutput, setActiveOutput] = useState("");
  const [projectorFullscreen, setProjectorFullscreen] = useState(false);
  const discoveryComplete = useRef(false);
  const runtimeError = useRef("");
  const remoteError = useRef("");
  const [calibration, setCalibration] = useState<"camera" | "output" | null>(
    null,
  );
  const calibrationActive = useRef(false);
  const [remoteAlignment, setRemoteAlignment] = useState(false);
  const calibrationRestore = useRef({
    profile: config.calibration,
    paused: config.paused,
    blank: config.blank,
    grid: config.calibrationGrid,
  });
  const [corners, setCorners] = useState<Quad>(
    config.calibration.cameraCorners,
  );
  const [selected, setSelected] = useState(0);
  const [touched, setTouched] = useState<number[]>([]);
  const markedSource = useRef("");
  const markedCorners = useRef(new Set<number>());
  const modalRef = useRef<HTMLElement>(null);
  const [stageSize, setStageSize] = useState({ width: 960, height: 640 });
  const [full, setFull] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);
  const update = useCallback((patch: Partial<ProjectionSettings>) => {
    if (
      externalRef.current &&
      patch.calibration &&
      patch.calibration.mirrored !== configRef.current.calibration.mirrored
    ) {
      previewRef.current = "";
      setPreview("");
    }
    const next = sanitizeSettings({ ...configRef.current, ...patch });
    configRef.current = next;
    setConfig(next);
    saveSettings(next);
    runtimeRef.current?.configure(
      settingsForOutput(next, localGeometry.current),
    );
    channelRef.current?.postMessage({
      type: "settings",
      role: IS_PROJECTOR ? "projector" : "control",
      origin: own.current,
      settings: next,
    });
  }, []);
  const validateOutput = useCallback(
    (signature: string) => {
      if (!signature || !discoveryComplete.current) return;
      const profile = configRef.current.calibration;
      const storedRole = profile.outputSignature?.split(":")[1];
      const currentRole = signature.split(":")[1];
      // A saved projector profile survives returning to the Mac preview; only a
      // geometry change on its actual output invalidates the persisted mapping.
      if (
        profile.calibrated &&
        (!profile.outputSignature ||
          (storedRole === currentRole && profile.outputSignature !== signature))
      ) {
        update({ calibration: { ...profile, calibrated: false } });
        setError(
          "The projection moved or resized. Align the camera again before playing with camera input.",
        );
      }
    },
    [update],
  );
  const refreshDevices = useCallback(async () => {
    try {
      setDevices(
        (await navigator.mediaDevices.enumerateDevices()).filter(
          (d) => d.kind === "videoinput",
        ),
      );
    } catch {
      setError(
        "Camera access is unavailable. Open this app at localhost in Chrome.",
      );
    }
  }, []);
  useEffect(() => {
    void refreshDevices();
    navigator.mediaDevices?.addEventListener("devicechange", refreshDevices);
    return () =>
      navigator.mediaDevices?.removeEventListener(
        "devicechange",
        refreshDevices,
      );
  }, [refreshDevices]);
  useEffect(() => {
    if (!canvasRef.current) return;
    let alive = true;
    let probingOutput = false;
    let staleRemoteShown = false;
    const releaseOutput = IS_PROJECTOR
      ? holdProjectorLease(navigator.locks)
      : undefined;
    const runtime = new ProjectionRuntime(
      canvasRef.current,
      {
        ...configRef.current,
        inputMode: "pointer",
        blank: IS_PROJECTOR || configRef.current.blank,
      },
      {
        onTracking: (status) => {
          const previous = trackingRef.current;
          trackingRef.current = status;
          setTracking(status);
          if (
            status.width &&
            (status.deviceId !== previous.deviceId ||
              status.width !== previous.width ||
              status.height !== previous.height)
          )
            void refreshDevices();
        },
        onPreview: (url) => {
          previewRef.current = url;
          setPreview(url);
        },
        onMetrics: (value) => {
          metricsRef.current = value;
          setMetrics(value);
          if (import.meta.env.DEV)
            (
              window as unknown as { __THREE_GAME_DIAGNOSTICS__: unknown }
            ).__THREE_GAME_DIAGNOSTICS__ = {
              renderer: { ...value, calls: value.drawCalls },
              ...value,
            };
        },
        onError: (message) => {
          runtimeError.current = message;
          setError(message);
        },
      },
    );
    runtimeRef.current = runtime;
    if (!IS_PROJECTOR) runtime.requestPreview();
    const channel = new BroadcastChannel("projection-app-v1");
    channelRef.current = channel;
    const role = IS_PROJECTOR ? "projector" : "control";
    const heartbeat = () =>
      channel.postMessage({
        type: "heartbeat",
        role,
        origin: own.current,
        tracking: trackingRef.current,
        metrics: metricsRef.current,
        preview: previewRef.current,
        previewMirrored: configRef.current.calibration.mirrored,
        outputSignature: localGeometry.current,
        runtimeError: runtimeError.current,
        fullscreen: Boolean(document.fullscreenElement),
      });
    const acceptProjector = (origin: string) => {
      staleRemoteShown = false;
      externalRef.current = true;
      externalOrigin.current = origin;
      lastExternal.current = Date.now();
      projectorUnloading.current = 0;
      setExternal(true);
      runtime.setActive(false);
    };
    const resumePreview = () => {
      externalRef.current = false;
      externalOrigin.current = null;
      lastExternal.current = 0;
      projectorUnloading.current = 0;
      projectorWindow.current = null;
      outputSignature.current = localGeometry.current;
      setActiveOutput(localGeometry.current);
      setProjectorFullscreen(false);
      setExternal(false);
      validateOutput(localGeometry.current);
      runtime.setActive(true);
    };
    channel.onmessage = (event) => {
      const data = event.data;
      if (
        !data ||
        data.origin === own.current ||
        (data.recipient && data.recipient !== own.current)
      )
        return;
      if (
        data.type === "alignment" &&
        IS_PROJECTOR &&
        data.role === "control"
      ) {
        calibrationActive.current = data.active === true;
        setRemoteAlignment(data.active === true);
      }
      if (data.type === "settings") {
        if (!IS_PROJECTOR && data.role === "projector")
          acceptProjector(data.origin);
        const next = sanitizeSettings(data.settings);
        configRef.current = next;
        setConfig(next);
        saveSettings(next);
        runtime.configure(settingsForOutput(next, localGeometry.current));
      }
      if (data.type === "hello") {
        // A running projector supplies state to a reloaded control window; a new
        // projector receives state from its parent. Don't broadcast stale startup state.
        if (
          (IS_PROJECTOR && data.role === "control") ||
          (!IS_PROJECTOR && data.role === "projector")
        ) {
          channel.postMessage({
            type: "settings",
            role,
            origin: own.current,
            recipient: data.origin,
            settings: configRef.current,
          });
          if (IS_PROJECTOR) heartbeat();
          else
            channel.postMessage({
              type: "alignment",
              role,
              origin: own.current,
              recipient: data.origin,
              active: calibrationActive.current,
            });
        }
      }
      if (
        data.type === "heartbeat" &&
        data.role === "projector" &&
        !IS_PROJECTOR
      ) {
        acceptProjector(data.origin);
        if (typeof data.outputSignature === "string" && data.outputSignature) {
          outputSignature.current = data.outputSignature;
          setActiveOutput(data.outputSignature);
          validateOutput(data.outputSignature);
        }
        setProjectorFullscreen(data.fullscreen === true);
        if (data.tracking) {
          trackingRef.current = data.tracking;
          setTracking(data.tracking);
        }
        if (data.metrics) {
          metricsRef.current = data.metrics;
          setMetrics(data.metrics);
        }
        if (typeof data.preview === "string") {
          const image =
            data.previewMirrored === configRef.current.calibration.mirrored
              ? data.preview
              : "";
          previewRef.current = image;
          setPreview(image);
        }
        if (typeof data.runtimeError === "string") {
          const previous = remoteError.current;
          remoteError.current = data.runtimeError;
          if (data.runtimeError) setError(data.runtimeError);
          else if (previous)
            setError((current) => (current === previous ? "" : current));
        }
      }
      if (
        data.type === "gone" &&
        !IS_PROJECTOR &&
        (!externalOrigin.current || data.origin === externalOrigin.current)
      ) {
        // beforeunload also fires on reload. Keep capture with the still-open
        // output window; the close check / discovery timeout handles real exits.
        lastExternal.current = Date.now();
        projectorUnloading.current = Date.now();
        trackingRef.current = {
          ...idleTracking,
          message: "Waiting for projector…",
        };
        setTracking(trackingRef.current);
        previewRef.current = "";
        setPreview("");
      }
      if (data.type === "retry" && IS_PROJECTOR) runtime.retryCamera();
      if (data.type === "reload-scene" && IS_PROJECTOR) {
        setError("");
        runtimeError.current = "";
        runtime.retryActivity();
      }
    };
    channel.postMessage({ type: "hello", role, origin: own.current });
    const discovery = window.setTimeout(() => {
      discoveryComplete.current = true;
      if (IS_PROJECTOR || !externalRef.current) {
        outputSignature.current = localGeometry.current;
        setActiveOutput(localGeometry.current);
        validateOutput(localGeometry.current);
        runtime.configure(
          settingsForOutput(configRef.current, localGeometry.current),
        );
      }
    }, 300);
    const timer = window.setInterval(() => {
      if (IS_PROJECTOR) heartbeat();
      else if (externalRef.current) {
        const child = projectorWindow.current;
        // Background timer throttling is not evidence that a known popup has closed.
        if (child?.closed) resumePreview();
        else if (
          lastExternal.current &&
          Date.now() - lastExternal.current > 2500
        ) {
          if (!staleRemoteShown) {
            staleRemoteShown = true;
            trackingRef.current = {
              ...idleTracking,
              state: "limited",
              message:
                "Waiting for the projector connection. Camera readiness will return with fresh updates.",
            };
            setTracking(trackingRef.current);
            previewRef.current = "";
            setPreview("");
          }
          // A reloaded control has no popup handle. Missing heartbeats alone
          // must not start a competing camera or render loop in that control.
          if (
            !probingOutput &&
            Date.now() - lastExternal.current > 4000 &&
            (!child ||
              (projectorUnloading.current > 0 &&
                Date.now() - projectorUnloading.current > 5000))
          ) {
            probingOutput = true;
            const heartbeatAtProbe = lastExternal.current;
            void projectorLeaseHeld(navigator.locks)
              .then((held) => {
                if (
                  alive &&
                  externalRef.current &&
                  lastExternal.current === heartbeatAtProbe &&
                  held === false
                )
                  resumePreview();
              })
              .finally(() => {
                probingOutput = false;
              });
          }
        }
      }
    }, 600);
    const gone = () => {
      if (!IS_PROJECTOR && calibrationActive.current) {
        const restore = calibrationRestore.current;
        const next = sanitizeSettings({
          ...configRef.current,
          calibration: restoredAlignment(
            restore.profile,
            trackingRef.current,
            outputSignature.current,
          ),
          paused: restore.paused,
          blank: restore.blank,
          calibrationGrid: restore.grid,
        });
        saveSettings(next);
        channel.postMessage({
          type: "settings",
          role,
          origin: own.current,
          settings: next,
        });
        channel.postMessage({
          type: "alignment",
          role,
          origin: own.current,
          active: false,
        });
        calibrationActive.current = false;
      }
      if (IS_PROJECTOR) {
        // Release the camera before requesting handback to the control window.
        runtime.setActive(false);
        releaseOutput?.();
        channel.postMessage({ type: "gone", role, origin: own.current });
      }
    };
    window.addEventListener("beforeunload", gone);
    if (import.meta.env.DEV)
      (window as unknown as { __PROJECTION__: unknown }).__PROJECTION__ = {
        diagnostics: () => runtime.diagnostics(),
        settings: () => configRef.current,
        replay: runtime.replay.bind(runtime),
        outputSignature: () =>
          discoveryComplete.current ? outputSignature.current : "",
        tracking: () => trackingRef.current,
      };
    return () => {
      alive = false;
      gone();
      window.removeEventListener("beforeunload", gone);
      clearInterval(timer);
      clearTimeout(discovery);
      discoveryComplete.current = false;
      runtime.dispose();
      runtimeRef.current = null;
      channel.close();
    };
  }, [refreshDevices, validateOutput]);
  useEffect(() => {
    const element = stageRef.current;
    if (!element) return;
    let alive = true;
    const measure = () => {
      if (!alive) return;
      const rect = element.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      setStageSize((previous) =>
        previous.width === element.clientWidth &&
        previous.height === element.clientHeight
          ? previous
          : { width: element.clientWidth, height: element.clientHeight },
      );
      const currentScreen = window.screen as Screen & {
        availLeft?: number;
        availTop?: number;
      };
      const signature = outputGeometrySignature({
        role: IS_PROJECTOR ? "projector" : "preview",
        stage: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        viewport: { width: innerWidth, height: innerHeight },
        window: {
          x: screenX,
          y: screenY,
          width: outerWidth,
          height: outerHeight,
        },
        screen: {
          width: currentScreen.width,
          height: currentScreen.height,
          x: currentScreen.availLeft ?? 0,
          y: currentScreen.availTop ?? 0,
        },
        devicePixelRatio,
      });
      localGeometry.current = signature;
      if (IS_PROJECTOR || !externalRef.current) {
        outputSignature.current = signature;
        setActiveOutput(signature);
        validateOutput(signature);
      }
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    const timer = window.setInterval(measure, 600);
    window.addEventListener("resize", measure);
    document.addEventListener("fullscreenchange", measure);
    void document.fonts.ready.then(measure);
    measure();
    return () => {
      alive = false;
      observer.disconnect();
      clearInterval(timer);
      window.removeEventListener("resize", measure);
      document.removeEventListener("fullscreenchange", measure);
    };
  }, [validateOutput]);
  useEffect(() => {
    const fullscreenRequest = () => {
      runtimeRef.current?.unlockAudio();
      void document.documentElement
        .requestFullscreen()
        .catch(() =>
          setError("Fullscreen was unavailable. Use the browser View menu."),
        );
    };
    const keys = (e: KeyboardEvent) => {
      if (
        e.defaultPrevented ||
        calibrationActive.current ||
        (e.target as HTMLElement).closest(
          "input,select,textarea,button,[role=listbox],[role=option]",
        )
      )
        return;
      if (e.code === "Space") {
        e.preventDefault();
        update({ paused: !configRef.current.paused });
      }
      if (e.code === "KeyB") update({ blank: !configRef.current.blank });
      if (e.code === "KeyF") fullscreenRequest();
    };
    const fullscreen = () => setFull(Boolean(document.fullscreenElement));
    window.addEventListener("keydown", keys);
    document.addEventListener("fullscreenchange", fullscreen);
    return () => {
      window.removeEventListener("keydown", keys);
      document.removeEventListener("fullscreenchange", fullscreen);
    };
  }, [update]);
  const source = alignmentSource(config, tracking, activeOutput);
  useEffect(() => {
    if (calibration !== "camera" || markedSource.current === source) return;
    const hadMarks = markedCorners.current.size > 0;
    markedSource.current = source;
    markedCorners.current.clear();
    setTouched([]);
    setSelected(0);
    if (hadMarks)
      setError(
        "The camera or projection changed. Mark all four floor corners again.",
      );
  }, [calibration, source]);
  useEffect(() => {
    const profile = configRef.current.calibration;
    if (
      config.inputMode === "camera" &&
      profile.calibrated &&
      tracking.deviceId &&
      tracking.width > 0 &&
      ["ready", "limited"].includes(tracking.state) &&
      (profile.cameraId !== tracking.deviceId ||
        profile.cameraWidth !== tracking.width ||
        profile.cameraHeight !== tracking.height)
    ) {
      update({ calibration: { ...profile, calibrated: false } });
      setError("The camera changed. Align its four floor corners again.");
    }
  }, [
    config.inputMode,
    config.calibration,
    tracking.deviceId,
    tracking.width,
    tracking.height,
    tracking.state,
    update,
  ]);
  useEffect(() => {
    if (!calibration) return;
    const previous = document.activeElement as HTMLElement | null;
    modalRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => {
      if (previous?.isConnected) previous.focus();
    };
  }, [calibration]);
  const aligned = alignmentMatches(config.calibration, tracking, activeOutput);
  const cameraLive =
    tracking.fps > 0 && ["ready", "limited"].includes(tracking.state);
  const connect = () => {
    setError("");
    runtimeRef.current?.unlockAudio();
    const alreadyCamera = configRef.current.inputMode === "camera";
    update({ inputMode: "camera" });
    if (alreadyCamera) {
      if (external)
        channelRef.current?.postMessage({ type: "retry", origin: own.current });
      else runtimeRef.current?.retryCamera();
    }
  };
  const openProjector = () => {
    runtimeRef.current?.unlockAudio();
    runtimeRef.current?.setActive(false);
    const child = window.open(
      `${location.origin}${location.pathname}?view=projector`,
      "projection-app-projector",
      "popup,width=1280,height=800",
    );
    if (!child) {
      runtimeRef.current?.setActive(true);
      setError(
        "Allow pop-up windows for this app, then open the projector again.",
      );
      return;
    }
    projectorWindow.current = child;
    externalRef.current = true;
    outputSignature.current = "";
    setActiveOutput("");
    setProjectorFullscreen(false);
    lastExternal.current = Date.now();
    setExternal(true);
  };
  const beginCalibration = (kind: "camera" | "output") => {
    calibrationRestore.current = {
      profile: structuredClone(configRef.current.calibration),
      paused: configRef.current.paused,
      blank: configRef.current.blank,
      grid: configRef.current.calibrationGrid,
    };
    calibrationActive.current = true;
    channelRef.current?.postMessage({
      type: "alignment",
      role: "control",
      origin: own.current,
      active: true,
    });
    setCalibration(kind);
    setSelected(0);
    setTouched([]);
    markedCorners.current.clear();
    markedSource.current = alignmentSource(
      configRef.current,
      trackingRef.current,
      outputSignature.current,
    );
    setCorners(
      kind === "camera"
        ? config.calibration.cameraCorners
        : config.calibration.outputCorners,
    );
    setError("");
    update({ calibrationGrid: true, paused: true, blank: false });
  };
  const setCorner = (p: Point) => {
    if (calibration === "camera") {
      const source = alignmentSource(
        configRef.current,
        trackingRef.current,
        outputSignature.current,
      );
      if (!source || !previewRef.current) return;
      if (markedSource.current !== source) markedCorners.current.clear();
      markedSource.current = source;
      markedCorners.current.add(selected);
    }
    const next = corners.map((q, i) =>
      i === selected
        ? { x: Math.max(0, Math.min(1, p.x)), y: Math.max(0, Math.min(1, p.y)) }
        : q,
    ) as Quad;
    setCorners(next);
    setTouched((t) =>
      calibration === "camera"
        ? [...markedCorners.current]
        : Array.from(new Set([...t, selected])),
    );
    setSelected((selected + 1) % 4);
  };
  const finishCalibration = () => {
    calibrationActive.current = false;
    channelRef.current?.postMessage({
      type: "alignment",
      role: "control",
      origin: own.current,
      active: false,
    });
    setCalibration(null);
  };
  const closeCalibration = () => {
    finishCalibration();
    update({
      calibration: restoredAlignment(
        calibrationRestore.current.profile,
        trackingRef.current,
        outputSignature.current,
      ),
      calibrationGrid: calibrationRestore.current.grid,
      paused: calibrationRestore.current.paused,
      blank: calibrationRestore.current.blank,
    });
  };
  const saveCalibration = () => {
    if (!validQuad(corners)) {
      setError(
        "The four corners must form a rectangle-like shape without crossing. Check their order.",
      );
      return;
    }
    if (
      calibration === "camera" &&
      (!tracking.width ||
        tracking.fps <= 0 ||
        !tracking.deviceId ||
        !preview ||
        !["ready", "limited"].includes(tracking.state))
    ) {
      setError("Connect the camera before saving its alignment.");
      return;
    }
    if (
      calibration === "camera" &&
      !alignmentMatches(
        configRef.current.calibration,
        trackingRef.current,
        outputSignature.current,
      ) &&
      (markedCorners.current.size < 4 ||
        markedSource.current !==
          alignmentSource(
            configRef.current,
            trackingRef.current,
            outputSignature.current,
          ))
    ) {
      setError(
        "Mark all four floor corners in the camera preview before saving.",
      );
      return;
    }
    update({
      ...(calibration === "camera" ? { cameraId: tracking.deviceId! } : {}),
      calibration: {
        ...config.calibration,
        ...(calibration === "camera"
          ? {
              cameraCorners: corners,
              cameraId: tracking.deviceId!,
              cameraWidth: tracking.width,
              cameraHeight: tracking.height,
              calibrated: true,
              outputSignature: outputSignature.current,
            }
          : { outputCorners: corners, calibrated: false }),
      },
      calibrationGrid: calibrationRestore.current.grid,
      paused: calibrationRestore.current.paused,
      blank: calibrationRestore.current.blank,
    });
    setError("");
    finishCalibration();
  };
  const onStagePointer = (event: React.PointerEvent, impulse = false) => {
    if (calibration === "output") {
      if (impulse) {
        const r = stageRef.current!.getBoundingClientRect();
        setCorner({
          x: (event.clientX - r.left) / r.width,
          y: (event.clientY - r.top) / r.height,
        });
      }
      return;
    }
    const r = stageRef.current!.getBoundingClientRect();
    const point = outputToFloor(
      {
        x: (event.clientX - r.left) / r.width,
        y: (event.clientY - r.top) / r.height,
      },
      config.calibration,
    );
    if (point) runtimeRef.current?.pointer(point, impulse);
  };
  const download = () => {
    const url = URL.createObjectURL(
      new Blob([exportSettings(config)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "projection-app-setup.json";
    a.click();
    URL.revokeObjectURL(url);
  };
  const reloadScene = () => {
    const localFailure = Boolean(runtimeError.current);
    setError("");
    runtimeError.current = "";
    if (!external || localFailure) runtimeRef.current?.retryActivity();
    if (external && (!localFailure || remoteError.current))
      channelRef.current?.postMessage({
        type: "reload-scene",
        origin: own.current,
      });
  };
  const sceneFailed = Boolean(
    error && (error === runtimeError.current || error === remoteError.current),
  );
  const stateLabel = external
    ? "Projector connected"
    : config.inputMode === "camera"
      ? aligned && cameraLive
        ? "Camera connected"
        : tracking.state === "error"
          ? "Camera needs attention"
          : "Camera setup"
      : "Mouse preview";
  const sceneStyle = {
    aspectRatio: `${config.floorWidth}/${config.floorHeight}`,
    ...warpStyle(
      config.calibration.outputCorners,
      stageSize.width,
      stageSize.height,
    ),
  };
  const stage = (
    <div
      className={`scene-stage ${config.blank ? "is-blank" : ""}`}
      ref={stageRef}
      style={{ aspectRatio: `${config.floorWidth}/${config.floorHeight}` }}
      onPointerMove={onStagePointer}
      onPointerDown={(e) => {
        runtimeRef.current?.unlockAudio();
        onStagePointer(e, true);
      }}
      onPointerLeave={() => runtimeRef.current?.clearInput()}
    >
      <div className="scene-warp" style={sceneStyle}>
        <canvas
          ref={canvasRef}
          aria-label={`Interactive scene: ${scene.title}`}
        />
        {config.calibrationGrid && (
          <div className="alignment-grid">
            {DEFAULT_QUAD.map((p, i) => (
              <span
                key={i}
                style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }}
              >
                {i + 1}
              </span>
            ))}
            <strong>
              {Number((config.floorWidth / 0.3048).toFixed(1))} ×{" "}
              {Number((config.floorHeight / 0.3048).toFixed(1))} ft · floor
              alignment
            </strong>
          </div>
        )}
      </div>
      {config.paused && !calibration && !remoteAlignment && !config.blank && (
        <div className="stage-message">
          <Pause size={22} />
          <span>Scene paused</span>
        </div>
      )}
      {config.blank && <div className="blank-cover" />}
      {calibration === "output" && (
        <div className="corner-overlay">
          {corners.map((p, i) => (
            <span
              className={selected === i ? "selected" : ""}
              key={i}
              style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }}
            >
              {i + 1}
            </span>
          ))}
        </div>
      )}
    </div>
  );
  if (IS_PROJECTOR)
    return (
      <main className={`projector-screen ${full ? "is-fullscreen" : ""}`}>
        <div
          className="projection-fit"
          style={{
            width: `min(100vw, ${(100 * config.floorWidth) / config.floorHeight}vh)`,
          }}
        >
          {stage}
        </div>
        <div className="projector-tools">
          <button
            disabled={remoteAlignment}
            onClick={() => {
              runtimeRef.current?.unlockAudio();
              void document.documentElement
                .requestFullscreen()
                .catch(() =>
                  setError(
                    "Fullscreen was unavailable. Use the browser View menu.",
                  ),
                );
            }}
          >
            <Maximize size={16} /> Fullscreen
          </button>
          <button
            disabled={remoteAlignment}
            onClick={() => update({ paused: !config.paused })}
          >
            {config.paused ? <Play size={16} /> : <Pause size={16} />}
          </button>
          <span>
            {remoteAlignment
              ? "Alignment in progress on your Mac"
              : "Space pause · B blank · F fullscreen"}
          </span>
        </div>
        {error && (
          <div className="projector-error">
            {error}{" "}
            {sceneFailed && <button onClick={reloadScene}>Reload scene</button>}
          </div>
        )}
      </main>
    );
  return (
    <div
      className="app-shell"
      style={
        {
          "--scene-aspect": config.floorWidth / config.floorHeight,
        } as CSSProperties
      }
    >
      <header className="app-header" inert={Boolean(calibration)}>
        <a className="wordmark" href="/">
          <span className="brand-mark">
            <Shapes size={23} />
          </span>
          <span>
            Floor Play<small>INTERACTIVE FLOOR PLAY</small>
          </span>
        </a>
        <div className="header-right">
          <span
            className={`connection-indicator ${(aligned && cameraLive) || external ? "connected" : ""}`}
          >
            <i />
            {stateLabel}
          </span>
          <button className="button button-primary" onClick={openProjector}>
            Open projector <ArrowUpRight size={17} />
          </button>
        </div>
      </header>
      <main className="workspace" inert={Boolean(calibration)}>
        <section className="scene-column">
          <div className="section-heading">
            <div>
              <span className="eyebrow">PLAY STUDIO</span>
              <h1>{scene.title}</h1>
            </div>
            <span className="size-label">
              {(config.floorWidth / 0.3048).toFixed(0)} ×{" "}
              {(config.floorHeight / 0.3048).toFixed(0)} ft
            </span>
          </div>
          <div className="scene-frame">
            {stage}
            <div className="scene-caption">
              <span>
                <i className="live-dot" />
                {external
                  ? "Playing on your projector"
                  : config.inputMode === "pointer"
                    ? scene.pointerHint
                    : tracking.message}
              </span>
              <button
                title="Fullscreen preview"
                aria-label="Fullscreen preview"
                onClick={() => {
                  runtimeRef.current?.unlockAudio();
                  void stageRef.current?.parentElement
                    ?.requestFullscreen()
                    .catch(() =>
                      setError(
                        "Fullscreen was unavailable. Use the browser View menu.",
                      ),
                    );
                }}
              >
                <Maximize size={16} />
              </button>
            </div>
          </div>
          <div className="under-scene">
            <div className="transport">
              <button
                className="button button-soft"
                onClick={() => update({ paused: !config.paused })}
              >
                {config.paused ? <Play size={15} /> : <Pause size={15} />}{" "}
                {config.paused ? "Resume" : "Pause"}
              </button>
              <button
                className={`button ${config.blank ? "button-primary" : "button-soft"}`}
                onClick={() => update({ blank: !config.blank })}
              >
                {config.blank ? "Restore picture" : "Blank floor"}
              </button>
            </div>
          </div>
          {error && (
            <div role="alert" className="notice error">
              <span>{error}</span>
              {sceneFailed && (
                <button onClick={reloadScene}>Reload scene</button>
              )}
              <button aria-label="Dismiss error" onClick={() => setError("")}>
                <X size={16} />
              </button>
            </div>
          )}
          {external && (
            <div className="notice">
              <Check size={17} />
              <span>
                The projector window owns the live camera. Close it to return to
                this preview.
              </span>
            </div>
          )}
          {config.inputMode === "camera" && !aligned && (
            <div className="notice">
              <Settings2 size={17} />
              <span>
                Align the camera’s four floor corners to enable interactions.
              </span>
              <button onClick={() => beginCalibration("camera")}>
                Align camera
              </button>
            </div>
          )}
          {config.diagnostics && (
            <section className="diagnostics">
              <h3>Live diagnostics</h3>
              <dl>
                <div>
                  <dt>Rendering</dt>
                  <dd>{String(metrics.renderFps ?? "—")} fps</dd>
                </div>
                <div>
                  <dt>Image detail</dt>
                  <dd>
                    {metrics.renderWidth
                      ? `${metrics.renderWidth} × ${metrics.renderHeight}`
                      : "—"}
                  </dd>
                </div>
                <div>
                  <dt>Tracking</dt>
                  <dd>{tracking.fps} fps</dd>
                </div>
                <div>
                  <dt>Camera clock</dt>
                  <dd>{(tracking.videoTimeSeconds ?? 0).toFixed(1)} s</dd>
                </div>
                <div>
                  <dt>Video / processed frames</dt>
                  <dd>
                    {tracking.decodedFrames ?? 0} /{" "}
                    {tracking.submittedFrames ?? 0}
                  </dd>
                </div>
                <div>
                  <dt>Model time</dt>
                  <dd>{Math.round(tracking.inferenceMs)} ms</dd>
                </div>
                <div>
                  <dt>Camera actions</dt>
                  <dd>{tracking.actionsDetected ?? 0}</dd>
                </div>
                <div>
                  <dt>Scene responses</dt>
                  <dd>
                    {String(metrics.splashCount ?? metrics.impulseCount ?? 0)}
                  </dd>
                </div>
                <div>
                  <dt>Filtered actions</dt>
                  <dd>
                    {String(metrics.duplicateActions ?? 0)} repeated ·{" "}
                    {String(metrics.dryActions ?? 0)} outside water ·{" "}
                    {Number(metrics.expiredActions ?? 0) +
                      Number(metrics.invalidActions ?? 0)}{" "}
                    stale/invalid
                  </dd>
                </div>
                <div>
                  <dt>Hand processing</dt>
                  <dd>
                    {tracking.handBackend ?? "—"} ·{" "}
                    {Math.round(tracking.timings?.hands ?? 0)} ms
                  </dd>
                </div>
                <div>
                  <dt>Frame processing delay</dt>
                  <dd>{Math.round(tracking.frameAgeMs ?? 0)} ms</dd>
                </div>
                <div>
                  <dt>Video feed</dt>
                  <dd>
                    {tracking.width
                      ? `${tracking.width} × ${tracking.height}`
                      : "Not connected"}
                  </dd>
                </div>
                <div>
                  <dt>People / hands</dt>
                  <dd>
                    {tracking.regions} / {tracking.hands}
                  </dd>
                </div>
                <div>
                  <dt>Draw calls</dt>
                  <dd>{String(metrics.calls ?? metrics.drawCalls ?? "—")}</dd>
                </div>
              </dl>
              {preview && (
                <img
                  className="diagnostic-camera"
                  src={preview}
                  alt="Local camera tracking preview"
                />
              )}
              <p>
                Model time excludes camera and projector delay. Hand actions are
                estimated from camera motion.
              </p>
            </section>
          )}
        </section>
        <aside className="control-panel">
          <section className="activity-card">
            <div
              className="scene-cover"
              aria-hidden="true"
              style={
                scene.thumbnail
                  ? {
                      backgroundImage: `url(${import.meta.env.BASE_URL}${scene.thumbnail})`,
                    }
                  : undefined
              }
            >
              <span className="scene-cover-label">
                <Shapes size={12} /> YOUR SCENE
              </span>
            </div>
            <label className="eyebrow" htmlFor="scene-choice">
              SCENE
            </label>
            <div className="activity-title">
              <div className="activity-icon">
                <Shapes size={24} />
              </div>
              <div className="scene-choice">
                <Select.Root
                  value={scene.id}
                  modal={false}
                  items={activities.map((item) => ({
                    value: item.id,
                    label: item.title,
                  }))}
                  onValueChange={(value) => {
                    if (value) {
                      runtimeRef.current?.unlockAudio();
                      update({ activityId: value });
                    }
                  }}
                >
                  <Select.Trigger
                    id="scene-choice"
                    aria-label="Scene"
                    className="scene-select-trigger"
                  >
                    <Select.Value />
                    <Select.Icon className="scene-select-chevron">
                      <ChevronDown size={17} />
                    </Select.Icon>
                  </Select.Trigger>
                  <Select.Portal>
                    <Select.Positioner
                      className="scene-menu-layer"
                      sideOffset={8}
                      align="start"
                      alignItemWithTrigger={false}
                    >
                      <Select.Popup className="scene-menu">
                        <div className="scene-menu-heading">CHOOSE A SCENE</div>
                        <Select.List>
                          {activities.map((item) => (
                            <Select.Item
                              className="scene-option"
                              value={item.id}
                              label={item.title}
                              key={item.id}
                            >
                              <span
                                className="scene-option-art"
                                aria-hidden="true"
                                style={
                                  item.thumbnail
                                    ? {
                                        backgroundImage: `url(${import.meta.env.BASE_URL}${item.thumbnail})`,
                                      }
                                    : undefined
                                }
                              />
                              <span className="scene-option-copy">
                                <Select.ItemText>{item.title}</Select.ItemText>
                                <span>{item.description}</span>
                              </span>
                              <Select.ItemIndicator className="scene-option-check">
                                <Check size={16} />
                              </Select.ItemIndicator>
                            </Select.Item>
                          ))}
                        </Select.List>
                      </Select.Popup>
                    </Select.Positioner>
                  </Select.Portal>
                </Select.Root>
                <p>{scene.description}</p>
              </div>
            </div>
          </section>
          <section className="control-section">
            <h3>
              <SlidersHorizontal size={16} /> Scene settings
            </h3>
            {scene.controls.map((control) => {
              const stored = config.activitySettings[scene.id]?.[control.key];
              const value =
                typeof stored === "number" ? stored : control.defaultValue;
              return (
                <Slider
                  key={control.key}
                  label={control.label}
                  value={value}
                  min={control.min}
                  max={control.max}
                  step={control.step}
                  display={control.format?.(value) ?? String(value)}
                  onChange={(next) =>
                    update(
                      setActivitySettings(configRef.current, scene.id, {
                        [control.key]: next,
                      }),
                    )
                  }
                />
              );
            })}
            {scene.supportsAudio && (
              <div className="sound-row">
                <button
                  className={`sound-toggle ${config.sound ? "enabled" : ""}`}
                  aria-label={config.sound ? "Mute sound" : "Enable sound"}
                  aria-pressed={config.sound}
                  onClick={() => {
                    runtimeRef.current?.unlockAudio();
                    update({ sound: !config.sound });
                  }}
                >
                  {config.sound ? <Volume2 size={17} /> : <VolumeX size={17} />}
                </button>
                <Slider
                  label="Volume"
                  value={config.volume}
                  min={0}
                  max={0.6}
                  step={0.02}
                  display={
                    config.sound ? `${Math.round(config.volume * 100)}%` : "Off"
                  }
                  onChange={(volume) => update({ volume })}
                />
              </div>
            )}
          </section>
          <section className="control-section">
            <h3>
              <Camera size={16} /> Camera & interaction
            </h3>
            <div
              className="segmented"
              role="group"
              aria-label="Interaction source"
            >
              <button
                className={config.inputMode === "pointer" ? "active" : ""}
                onClick={() => update({ inputMode: "pointer" })}
              >
                <MousePointer2 size={14} /> Mouse
              </button>
              <button
                className={config.inputMode === "camera" ? "active" : ""}
                onClick={connect}
              >
                <Camera size={14} /> Camera
              </button>
            </div>
            <label className="field-label">
              Video source
              <select
                aria-label="Video source"
                value={config.cameraId}
                onChange={(e) =>
                  update({
                    cameraId: e.target.value,
                    calibration: { ...config.calibration, calibrated: false },
                  })
                }
              >
                <option value="">Default camera</option>
                {config.cameraId &&
                  !devices.some(
                    (device) => device.deviceId === config.cameraId,
                  ) && (
                    <option value={config.cameraId}>
                      Saved camera (unavailable)
                    </option>
                  )}
                {devices.map((d, i) => (
                  <option value={d.deviceId} key={d.deviceId || i}>
                    {d.label || `Camera ${i + 1}`}
                  </option>
                ))}
              </select>
            </label>
            <div className="camera-actions">
              <button className="button button-soft" onClick={connect}>
                <Camera size={14} />
                {tracking.width ? "Reconnect" : "Connect camera"}
              </button>
              <button
                className="icon-button"
                aria-label="Refresh cameras"
                title="Refresh cameras"
                onClick={() => void refreshDevices()}
              >
                <RefreshCw size={15} />
              </button>
            </div>
            {config.inputMode === "camera" && (
              <p
                className={`camera-status ${tracking.state === "error" ? "needs-attention" : ""}`}
                role="status"
              >
                {tracking.message}
              </p>
            )}
            <Slider
              label="Interaction sensitivity"
              value={config.sensitivity}
              min={0.1}
              max={1}
              step={0.05}
              display={`${Math.round(config.sensitivity * 100)}%`}
              onChange={(sensitivity) => update({ sensitivity })}
            />
          </section>
          <section className="control-section">
            <h3>
              <Settings2 size={16} /> Floor setup
            </h3>
            <div className="setup-output" role="status">
              <span
                className={`setup-status-dot ${external && projectorFullscreen ? "complete" : ""}`}
              />
              <div>
                <strong>
                  {external
                    ? projectorFullscreen
                      ? "Projector fullscreen"
                      : "Projector window open"
                    : "Using Mac preview"}
                </strong>
                {external && !projectorFullscreen && (
                  <p>
                    Move the window onto the projector, then choose Fullscreen
                    there before aligning.
                  </p>
                )}
              </div>
              <button
                className="text-button"
                onClick={() =>
                  external &&
                  projectorWindow.current &&
                  !projectorWindow.current.closed
                    ? projectorWindow.current.focus()
                    : openProjector()
                }
              >
                {external ? "Show" : "Open"}
              </button>
            </div>
            <div className="floor-dimensions">
              <FloorDimension
                label="Width"
                value={config.floorWidth}
                onChange={(floorWidth) =>
                  update({
                    floorWidth,
                    calibration: {
                      ...configRef.current.calibration,
                      calibrated: false,
                    },
                  })
                }
              />
              <span>×</span>
              <FloorDimension
                label="Depth"
                value={config.floorHeight}
                onChange={(floorHeight) =>
                  update({
                    floorHeight,
                    calibration: {
                      ...configRef.current.calibration,
                      calibrated: false,
                    },
                  })
                }
              />
            </div>
            <button
              className="button button-outline full-width"
              onClick={() => beginCalibration("output")}
            >
              Adjust projector corners
            </button>
            <button
              className="button button-outline full-width"
              onClick={() => beginCalibration("camera")}
            >
              Align camera{" "}
              <span>
                {aligned ? <Check size={15} /> : <ArrowUpRight size={15} />}
              </span>
            </button>
            <p className="setup-alignment-status" role="status">
              {aligned && cameraLive
                ? "Camera aligned · ready to play"
                : config.calibration.calibrated &&
                    config.calibration.outputSignature !== activeOutput
                  ? "Saved alignment belongs to another output."
                  : !cameraLive
                    ? config.calibration.calibrated
                      ? "Connect camera to verify saved alignment."
                      : "Connect camera, then align the floor."
                    : "Camera alignment needed for floor interaction."}
            </p>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={config.calibrationGrid}
                onChange={(e) => update({ calibrationGrid: e.target.checked })}
              />{" "}
              Show alignment grid
            </label>
          </section>
          <section className="control-section setup-footer">
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={config.diagnostics}
                onChange={(e) => update({ diagnostics: e.target.checked })}
              />{" "}
              Show diagnostics
            </label>
            <div className="profile-actions">
              <button onClick={download}>
                <Download size={13} /> Save setup
              </button>
              <button onClick={() => importRef.current?.click()}>
                Load setup
              </button>
            </div>
            <input
              ref={importRef}
              hidden
              type="file"
              accept="application/json,.json"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                try {
                  const imported = importSettings(await file.text());
                  if (
                    !activities.some(
                      (activity) => activity.id === imported.activityId,
                    )
                  )
                    throw new Error(
                      "This activity is not installed in this app.",
                    );
                  update(imported);
                  setError("");
                } catch (error) {
                  setError(String(error));
                }
                e.target.value = "";
              }}
            />
          </section>
        </aside>
      </main>
      {calibration && (
        <div className="modal-backdrop">
          <section
            className="calibration-modal"
            ref={modalRef}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                closeCalibration();
              }
              if (event.key === "Tab") {
                const controls = [
                  ...event.currentTarget.querySelectorAll<HTMLElement>(
                    "button:not(:disabled),input:not(:disabled),select:not(:disabled),[tabindex='0']",
                  ),
                ];
                const first = controls[0];
                const last = controls[controls.length - 1];
                if (event.shiftKey && document.activeElement === first) {
                  event.preventDefault();
                  last?.focus();
                } else if (!event.shiftKey && document.activeElement === last) {
                  event.preventDefault();
                  first?.focus();
                }
              }
            }}
            role="dialog"
            aria-modal="true"
            aria-label={
              calibration === "camera"
                ? "Align camera"
                : "Adjust projector corners"
            }
          >
            <header>
              <div>
                <span className="eyebrow">FLOOR SETUP</span>
                <h2>
                  {calibration === "camera"
                    ? "Let’s line things up."
                    : "Square up the projection."}
                </h2>
              </div>
              <button
                aria-label="Close alignment"
                className="icon-button"
                onClick={closeCalibration}
              >
                <X size={20} />
              </button>
            </header>
            <p>
              {calibration === "camera"
                ? "Click the four projected floor corners in this camera image, in order. The numbers must match the alignment grid on the floor."
                : "Use the corner controls to adjust the projected image. Check the numbered grid on your floor."}
            </p>
            <div className="corner-tabs">
              {names.map((name, i) => (
                <button
                  key={name}
                  className={selected === i ? "selected" : ""}
                  onClick={() => setSelected(i)}
                >
                  <span>{i + 1}</span>
                  {name}
                  {touched.includes(i) && <Check size={12} />}
                </button>
              ))}
            </div>
            {calibration === "camera" ? (
              <div
                className="camera-alignment"
                style={{
                  aspectRatio: tracking.width
                    ? `${tracking.width}/${tracking.height}`
                    : "16/9",
                }}
                onPointerDown={(e) => {
                  if (!preview) return;
                  const r = e.currentTarget.getBoundingClientRect();
                  setCorner({
                    x: (e.clientX - r.left) / r.width,
                    y: (e.clientY - r.top) / r.height,
                  });
                }}
              >
                {preview ? (
                  <img
                    src={preview}
                    alt="Click the projected floor corners in this camera preview"
                  />
                ) : (
                  <div className="camera-placeholder">
                    <Camera size={32} />
                    <p>Connect your camera to see the floor.</p>
                    <button
                      className="button button-primary"
                      onClick={(e) => {
                        e.stopPropagation();
                        connect();
                      }}
                    >
                      Start camera preview
                    </button>
                  </div>
                )}
                <svg viewBox="0 0 100 100" preserveAspectRatio="none">
                  <polygon
                    points={corners
                      .map((p) => `${p.x * 100},${p.y * 100}`)
                      .join(" ")}
                  />
                </svg>
                {corners.map((p, i) => (
                  <span
                    className={`camera-corner ${selected === i ? "selected" : ""}`}
                    key={i}
                    style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }}
                  >
                    {i + 1}
                  </span>
                ))}
              </div>
            ) : (
              <div className="output-editor">
                {names.map((name, i) => (
                  <div key={name}>
                    <strong>
                      {i + 1}. {name}
                    </strong>
                    {(["x", "y"] as const).map((axis) => (
                      <label key={axis}>
                        {axis.toUpperCase()}
                        <input
                          type="number"
                          aria-label={`${name} ${axis}`}
                          min={0}
                          max={100}
                          step={0.5}
                          value={Number((corners[i][axis] * 100).toFixed(1))}
                          onChange={(e) => {
                            const next = corners.map((p, j) =>
                              j === i
                                ? {
                                    ...p,
                                    [axis]: Math.max(
                                      0,
                                      Math.min(1, Number(e.target.value) / 100),
                                    ),
                                  }
                                : p,
                            ) as Quad;
                            setCorners(next);
                            if (validQuad(next))
                              update({
                                calibration: {
                                  ...configRef.current.calibration,
                                  outputCorners: next,
                                  calibrated: false,
                                },
                              });
                          }}
                        />
                        %
                      </label>
                    ))}
                  </div>
                ))}
              </div>
            )}
            {calibration === "camera" && (
              <p className="alignment-feed-status" role="status">
                {!cameraLive
                  ? tracking.message
                  : `${external ? "Projector" : "Mac preview"} · ${tracking.width} × ${tracking.height} camera · ${touched.length}/4 corners marked`}
              </p>
            )}
            {calibration === "camera" && (
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={config.calibration.mirrored}
                  onChange={(e) => {
                    update({
                      calibration: {
                        ...config.calibration,
                        mirrored: e.target.checked,
                        calibrated: false,
                      },
                    });
                    markedCorners.current.clear();
                    setTouched([]);
                  }}
                />{" "}
                Mirror camera preview
              </label>
            )}
            <footer>
              <button
                className="text-button"
                onClick={() => {
                  setCorners(DEFAULT_QUAD.map((p) => ({ ...p })) as Quad);
                  markedCorners.current.clear();
                  setTouched([]);
                  if (calibration === "output")
                    update({
                      calibration: {
                        ...config.calibration,
                        outputCorners: DEFAULT_QUAD,
                        calibrated: false,
                      },
                    });
                }}
              >
                Reset corners
              </button>
              <button
                className="button button-primary"
                disabled={
                  calibration === "camera" &&
                  tracking.width > 0 &&
                  tracking.state !== "error" &&
                  (tracking.state === "starting" ||
                    tracking.fps <= 0 ||
                    !preview)
                }
                onClick={saveCalibration}
              >
                Save alignment <Check size={15} />
              </button>
            </footer>
            {error && (
              <p role="alert" className="modal-error">
                {error}
              </p>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
