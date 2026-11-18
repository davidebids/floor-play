import { loadActivity } from "./registry";
import { InteractionEngine } from "./interaction";
import { createVisionController } from "./vision/controller";
import {
  emptyFrame,
  type Activity,
  type InteractionFrame,
  type Point,
  type ProjectionSettings,
  type TrackingStatus,
} from "./types";
export interface RuntimeCallbacks {
  onTracking: (status: TrackingStatus) => void;
  onPreview: (url: string) => void;
  onMetrics: (metrics: Record<string, unknown>) => void;
  onError: (message: string) => void;
}
export class ProjectionRuntime {
  private activity?: Activity;
  private engine = new InteractionEngine();
  private vision;
  private settings: ProjectionSettings;
  private active = true;
  private disposed = false;
  private raf = 0;
  private time = 0;
  private lastTime = 0;
  private lastMetrics = 0;
  private frameCount = 0;
  private cameraKey = "";
  private sequence = 0;
  private lastPointer?: { point: Point; time: number };
  private error = "";
  private reportedError = false;
  private requestedActivityId = "";
  private activityGeneration = 0;
  private audioUnlocked = false;
  private contextLost = false;
  private previewRequested = false;
  private previewPending = false;
  private onContextLost = (event: Event): void => {
    event.preventDefault();
    this.contextLost = true;
    this.failActivity(
      "Graphics are unavailable. Waiting for the browser to restore them.",
    );
  };
  private onContextRestored = (): void => {
    if (this.disposed) return;
    this.contextLost = false;
    this.callbacks.onError("");
    this.retryActivity();
  };
  constructor(
    private canvas: HTMLCanvasElement,
    initial: ProjectionSettings,
    private callbacks: RuntimeCallbacks,
  ) {
    this.settings = initial;
    canvas.addEventListener?.("webglcontextlost", this.onContextLost);
    canvas.addEventListener?.("webglcontextrestored", this.onContextRestored);
    this.vision = createVisionController({
      onFrame: (frame) => {
        if (
          this.active &&
          this.activity &&
          !this.disposed &&
          this.settings.inputMode === "camera"
        )
          this.engine.ingest(frame);
      },
      onStatus: callbacks.onTracking,
      onPreview: callbacks.onPreview,
    });
    this.configure(initial);
    // One loop owns rendering for this runtime, including across asynchronous scene switches.
    this.raf = requestAnimationFrame(this.tick);
  }
  configure(settings: ProjectionSettings): void {
    if (this.disposed) return;
    if (!this.active && this.previewRequested) this.previewPending = true;
    const changed =
      this.settings.inputMode !== settings.inputMode ||
      this.settings.paused !== settings.paused ||
      this.settings.blank !== settings.blank;
    this.settings = settings;
    if (changed) this.clearInput();
    if (!this.contextLost && this.requestedActivityId !== settings.activityId)
      this.switchActivity(settings.activityId);
    else {
      try {
        this.activity?.configure(settings);
      } catch (error) {
        this.failActivity(error);
      }
    }
    this.vision.configure(settings);
    this.activity?.audio?.configure(
      settings.sound,
      settings.volume,
      this.active && !settings.paused && !settings.blank && !this.error,
    );
    const key =
      this.active && settings.inputMode === "camera"
        ? settings.cameraId || "default"
        : "";
    if (key !== this.cameraKey) {
      this.cameraKey = key;
      this.vision.stop();
      if (key)
        void this.vision.start(settings.cameraId).catch(() => {
          // Camera failures already publish an actionable tracking status. Keep
          // scene recovery separate so reconnecting cannot leave a stale alert.
        });
    }
  }
  private switchActivity(id: string): void {
    const generation = ++this.activityGeneration;
    this.requestedActivityId = id;
    const previous = this.activity;
    this.activity = undefined;
    try {
      previous?.dispose();
    } catch {
      // Cleanup failure in the old scene must not prevent the selected one loading.
    }
    this.clearInput();
    this.time = 0;
    this.frameCount = 0;
    this.lastTime = 0;
    this.error = "";
    const context = {
      canvas: this.canvas,
      settings: this.settings,
      isCurrent: () => !this.disposed && generation === this.activityGeneration,
    };
    // Deferring also catches a synchronous loader/factory failure in the same recovery path.
    void Promise.resolve()
      .then(() => loadActivity(id, context))
      .then((activity) => {
        if (this.disposed || generation !== this.activityGeneration) {
          activity.dispose();
          return;
        }
        try {
          activity.configure(this.settings);
        } catch (error) {
          activity.dispose();
          throw error;
        }
        this.activity = activity;
        this.error = "";
        if (this.reportedError) {
          this.reportedError = false;
          this.callbacks.onError("");
        }
        this.activity?.audio?.configure(
          this.settings.sound,
          this.settings.volume,
          this.active && !this.settings.paused && !this.settings.blank,
        );
        // A scene swap follows the user's existing sound gesture; it must not
        // leave a newly created scene silent while the sound control stays on.
        if (this.audioUnlocked) activity.audio?.unlock();
      })
      .catch((error) => {
        if (this.disposed || generation !== this.activityGeneration) return;
        this.requestedActivityId = "";
        this.failActivity(error);
      });
  }
  private failActivity(error: unknown): void {
    ++this.activityGeneration;
    this.requestedActivityId = "";
    this.error = `The scene stopped. Reload it to try again. ${String(error)}`;
    const activity = this.activity;
    this.activity = undefined;
    this.clearInput();
    activity?.audio?.configure(
      this.settings.sound,
      this.settings.volume,
      false,
    );
    try {
      activity?.dispose();
    } catch {
      // A broken renderer must not prevent the controls from offering recovery.
    }
    this.callbacks.onMetrics({
      error: this.error,
      renderFps: 0,
      active: this.active,
    });
    this.callbacks.onError(this.error);
    this.reportedError = true;
  }
  retryActivity(): void {
    if (!this.disposed && !this.contextLost)
      this.switchActivity(this.settings.activityId);
  }
  setActive(active: boolean): void {
    if (this.active === active) return;
    this.active = active;
    this.lastTime = 0;
    this.engine.reset();
    this.configure(this.settings);
  }
  /** Keep one fully loaded still in the controls while the projector owns play. */
  requestPreview(): void {
    this.previewRequested = true;
    this.previewPending = true;
  }
  retryCamera(): void {
    this.cameraKey = "";
    this.configure(this.settings);
  }
  unlockAudio(): void {
    if (this.disposed) return;
    this.audioUnlocked = true;
    this.activity?.audio?.unlock();
  }
  pointer(point: Point, impulse = false): void {
    if (
      !this.activity ||
      this.disposed ||
      !this.active ||
      this.settings.inputMode !== "pointer" ||
      this.settings.paused ||
      this.settings.blank
    )
      return;
    const now = performance.now();
    const previous = this.lastPointer;
    const speed = previous
      ? Math.min(
          1,
          Math.hypot(point.x - previous.point.x, point.y - previous.point.y) /
            Math.max((now - previous.time) / 1000, 0.016),
        )
      : 0.25;
    this.lastPointer = { point, time: now };
    const frame: InteractionFrame = {
      timestamp: now,
      source: "pointer",
      presence: [
        { id: "pointer", center: point, radius: 0.075, confidence: 1 },
      ],
      motion: [
        {
          id: "pointer",
          position: point,
          radius: 0.035,
          strength: speed,
          confidence: 1,
        },
      ],
      impulses: impulse
        ? [
            {
              id: `pointer-${++this.sequence}`,
              position: point,
              strength: Math.max(0.6, speed),
              confidence: 1,
              timestamp: now,
            },
          ]
        : [],
    };
    this.engine.ingest(frame);
  }
  replay(frame: InteractionFrame): void {
    if (
      !this.activity ||
      !this.active ||
      this.disposed ||
      this.settings.paused ||
      this.settings.blank
    )
      return;
    const now = performance.now(),
      offset = now - frame.timestamp;
    this.engine.ingest({
      ...frame,
      timestamp: now,
      source: "replay",
      impulses: frame.impulses.map((impulse) => ({
        ...impulse,
        timestamp: impulse.timestamp + offset,
      })),
    });
  }
  clearInput(): void {
    this.lastPointer = undefined;
    this.engine.reset();
  }
  private tick = (now: number): void => {
    if (this.disposed) return;
    const elapsed = this.lastTime
      ? Math.min((now - this.lastTime) / 1000, 0.06)
      : 1 / 60;
    this.lastTime = now;
    try {
      if (
        !this.active &&
        this.previewPending &&
        this.activity &&
        !this.settings.blank
      ) {
        const state = this.activity.diagnostics();
        if (state.assetError) throw new Error(String(state.assetError));
        if (state.assetsLoaded !== false) {
          this.activity.render(this.time);
          this.previewPending = false;
        }
      }
      if (this.active && this.activity) {
        const interactions =
          this.settings.paused || this.settings.blank
            ? emptyFrame(now)
            : this.engine.sample(now);
        if (!this.settings.paused && !this.settings.blank) {
          this.time += elapsed;
          const accepted = this.activity.update(
            elapsed,
            this.time,
            interactions,
          );
          for (const impulse of accepted ?? interactions.impulses)
            this.activity.audio?.impulse(impulse.strength);
        }
        if (!this.settings.blank) {
          this.activity.render(this.time);
          this.previewPending = false;
          this.frameCount++;
        }
        if (now - this.lastMetrics > 500) {
          this.callbacks.onMetrics({
            ...this.activity.diagnostics(),
            ...this.engine.diagnostics(),
            activityId: this.activity.id,
            renderFps: Math.round(
              (this.frameCount * 1000) / Math.max(now - this.lastMetrics, 1),
            ),
            presence: interactions.presence.length,
            source: interactions.source,
            active: this.active,
            error: this.error,
          });
          this.lastMetrics = now;
          this.frameCount = 0;
        }
      }
    } catch (error) {
      this.failActivity(error);
    }
    this.raf = requestAnimationFrame(this.tick);
  };
  diagnostics(): Record<string, unknown> {
    return {
      ...this.activity?.diagnostics(),
      activityId: this.activity?.id ?? null,
      active: this.active,
      error: this.error,
    };
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.canvas.removeEventListener?.("webglcontextlost", this.onContextLost);
    this.canvas.removeEventListener?.(
      "webglcontextrestored",
      this.onContextRestored,
    );
    ++this.activityGeneration;
    cancelAnimationFrame(this.raf);
    this.vision.stop();
    this.activity?.dispose();
    this.activity = undefined;
    this.engine.reset();
  }
}
