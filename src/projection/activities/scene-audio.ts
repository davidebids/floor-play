import type { ActivityAudio } from "../types";

const ROOT = `${import.meta.env.BASE_URL}assets/audio/`;
const water = ["water-plop-a.mp3", "water-plop-b.mp3", "water-plop-c.mp3"];
const flutter = [
  "wing-flutter-a.mp3",
  "wing-flutter-b.mp3",
  "wing-flutter-c.mp3",
];
const sand = ["sand-brush-a.mp3", "sand-brush-b.mp3", "sand-brush-c.mp3"];
const tide = ["tide-touch-a.mp3", "tide-touch-b.mp3", "tide-touch-c.mp3"];
const leaves = ["leaf-rustle-a.mp3", "leaf-rustle-b.mp3", "leaf-rustle-c.mp3"];
/** Recorded outdoor sound, rather than synthesized noise or music. */
export const SCENE_SOUNDTRACKS: Readonly<
  Record<
    string,
    {
      ambience: string;
      impulses: readonly string[];
      ambienceDb: number;
      effectDb: number;
    }
  >
> = {
  "koi-pond": {
    ambience: "pond-stream.mp3",
    impulses: water,
    ambienceDb: -7,
    effectDb: -5,
  },
  "forest-floor": {
    ambience: "forest-birds.mp3",
    impulses: leaves,
    ambienceDb: -7,
    effectDb: -9,
  },
  "butterfly-meadow": {
    ambience: "meadow-breeze.mp3",
    impulses: flutter,
    ambienceDb: -9,
    effectDb: -11,
  },
  "tide-pool": {
    ambience: "tide-rocks.mp3",
    impulses: tide,
    ambienceDb: -8,
    effectDb: -4,
  },
  "sandy-beach": {
    ambience: "beach-surf.mp3",
    impulses: sand,
    ambienceDb: -7,
    effectDb: -9,
  },
};
const db = (value: number) => Math.pow(10, value / 20);
const MAX_VOICES = 3;
const MAX_CACHE_BYTES = 64 * 1024 * 1024;
const MAX_CACHE_ENTRIES = 16;
const cache = new Map<
  string,
  { promise: Promise<AudioBuffer>; bytes: number }
>();
let cachedBytes = 0;

// AudioBuffers are immutable after decoding and may be shared between contexts.
// Include sample rate because decodeAudioData resamples to its owning context.
async function loadBuffer(
  context: AudioContext,
  file: string,
): Promise<AudioBuffer> {
  const key = `${context.sampleRate}:${file}`;
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
    return hit.promise;
  }
  const entry = {
    promise: Promise.resolve(null as unknown as AudioBuffer),
    bytes: 0,
  };
  entry.promise = fetch(`${ROOT}${file}`)
    .then((response) => {
      if (!response.ok)
        throw new Error(`Sound ${file}: HTTP ${response.status}`);
      return response.arrayBuffer();
    })
    .then((data) => context.decodeAudioData(data))
    .then((buffer) => {
      if (cache.get(key) === entry) {
        entry.bytes = buffer.length * buffer.numberOfChannels * 4;
        cachedBytes += entry.bytes;
        pruneCache();
      }
      return buffer;
    })
    .catch((error: unknown) => {
      if (cache.get(key) === entry) {
        cache.delete(key);
        cachedBytes -= entry.bytes;
      }
      throw error;
    });
  cache.set(key, entry);
  pruneCache();
  return entry.promise;
}
function pruneCache(): void {
  while (cache.size > MAX_CACHE_ENTRIES || cachedBytes > MAX_CACHE_BYTES) {
    const oldest = cache.keys().next().value as string | undefined;
    if (!oldest) break;
    const entry = cache.get(oldest)!;
    cachedBytes -= entry.bytes;
    cache.delete(oldest);
  }
}

type Voice = { source: AudioBufferSourceNode; gain: GainNode };
export interface SceneAudio extends ActivityAudio {
  dispose(): void;
  diagnostics(): {
    scene: string;
    unlocked: boolean;
    playing: boolean;
    loaded: number;
    voices: number;
    ambienceVoices: number;
    error: string | null;
    cacheEntries: number;
    cacheBytes: number;
  };
}

class RecordedSceneAudio implements SceneAudio {
  private context?: AudioContext;
  private master?: GainNode;
  private ambienceBus?: GainNode;
  private effectsBus?: GainNode;
  private enabled = false;
  private active = true;
  private volume = 0.18;
  private disposed = false;
  private error: string | null = null;
  private buffers = new Map<string, AudioBuffer>();
  private loading?: Promise<void>;
  private retryAfter = 0;
  private ambient = new Set<Voice>();
  private effects: Voice[] = [];
  private loopTimer?: ReturnType<typeof setInterval>;
  private nextLoop = 0;
  private variant = 0;
  private lastImpulse = -Infinity;
  private readonly track;
  constructor(private readonly scene: string) {
    this.track = SCENE_SOUNDTRACKS[scene];
  }

  unlock(): void {
    if (this.disposed || !this.track) return;
    try {
      // This method is called only by the user's click/tap. Muted by default.
      if (!this.context) {
        const c = new AudioContext();
        this.context = c;
        this.master = c.createGain();
        this.master.gain.value = 0;
        this.ambienceBus = c.createGain();
        this.effectsBus = c.createGain();
        this.ambienceBus.gain.value = db(this.track.ambienceDb);
        this.effectsBus.gain.value = db(this.track.effectDb);
        this.ambienceBus.connect(this.master);
        this.effectsBus.connect(this.master);
        this.master.connect(c.destination);
      }
      void this.context
        .resume()
        .then(() => this.apply())
        .catch((error: unknown) => {
          if (!this.disposed)
            this.error = `Audio could not start: ${String(error)}`;
        });
      this.apply();
    } catch (error) {
      this.error = `Audio unavailable: ${String(error)}`;
    }
  }
  configure(enabled: boolean, volume: number, active: boolean): void {
    this.enabled = enabled;
    this.active = active;
    this.volume = Number.isFinite(volume)
      ? Math.min(1, Math.max(0, volume))
      : 0;
    this.apply();
  }
  private get audible(): boolean {
    return !this.disposed && this.enabled && this.active && this.volume > 0;
  }
  private apply(): void {
    const c = this.context;
    if (!c || !this.master) return;
    this.master.gain.cancelScheduledValues(c.currentTime);
    // Every ambience and one-shot routes through this one master control.
    if (!this.audible) {
      this.master.gain.setValueAtTime(0, c.currentTime);
      this.stopAll();
      return;
    }
    this.master.gain.setTargetAtTime(this.volume, c.currentTime, 0.035);
    if (c.state !== "running") return;
    this.load();
    this.startAmbience();
  }
  private load(): void {
    if (
      !this.context ||
      !this.track ||
      this.loading ||
      Date.now() < this.retryAfter
    )
      return;
    const files = [this.track.ambience, ...this.track.impulses].filter(
      (file) => !this.buffers.has(file),
    );
    if (!files.length) return;
    const c = this.context;
    this.loading = Promise.allSettled(
      files.map(async (file) => {
        const buffer = await loadBuffer(c, file);
        if (!this.disposed) this.buffers.set(file, buffer);
      }),
    )
      .then((results) => {
        if (this.disposed) return;
        const failures = results.filter(
          (result) => result.status === "rejected",
        );
        this.error = failures.length
          ? `${failures.length} nature sound(s) could not load. Tap again to retry.`
          : null;
        this.retryAfter = failures.length ? Date.now() + 2500 : 0;
        this.startAmbience();
      })
      .finally(() => {
        this.loading = undefined;
      });
  }
  private startAmbience(): void {
    const c = this.context;
    const buffer = this.track && this.buffers.get(this.track.ambience);
    if (
      !c ||
      c.state !== "running" ||
      !buffer ||
      !this.audible ||
      this.loopTimer ||
      buffer.duration <= 0
    )
      return;
    this.nextLoop = c.currentTime + 0.02;
    this.scheduleLoop(true);
    this.loopTimer = setInterval(() => {
      if (!this.audible || c.state !== "running") return;
      // Schedule against the audio clock, not timer accuracy. Recover from a
      // sleeping/background tab without queuing missed loops.
      if (this.nextLoop < c.currentTime) this.nextLoop = c.currentTime + 0.02;
      if (this.nextLoop < c.currentTime + 1) this.scheduleLoop(false);
    }, 200);
  }
  private scheduleLoop(first: boolean): void {
    const buffer = this.buffers.get(this.track!.ambience)!;
    const start = this.nextLoop;
    const overlap = Math.min(2, buffer.duration * 0.2);
    const fadeIn = first ? Math.min(0.5, overlap) : overlap;
    const voice = this.makeVoice(buffer, this.ambienceBus!);
    this.ambient.add(voice);
    voice.gain.gain.setValueAtTime(0, start);
    voice.gain.gain.linearRampToValueAtTime(1, start + fadeIn);
    voice.gain.gain.setValueAtTime(1, start + buffer.duration - overlap);
    // Complementary linear fades preserve a quiet, steady floor without the
    // +3 dB rise equal-power fades add to correlated water recordings.
    voice.gain.gain.linearRampToValueAtTime(0, start + buffer.duration);
    voice.source.onended = () => {
      this.ambient.delete(voice);
      this.disconnect(voice);
    };
    voice.source.start(start);
    this.nextLoop = start + buffer.duration - overlap;
  }
  impulse(strength: number): void {
    const c = this.context;
    if (
      !c ||
      c.state !== "running" ||
      !this.audible ||
      !this.track ||
      c.currentTime - this.lastImpulse < 0.2
    )
      return;
    this.load();
    const loaded = this.track.impulses
      .map((file) => this.buffers.get(file))
      .filter((buffer): buffer is AudioBuffer => !!buffer);
    if (!loaded.length) {
      this.load();
      return;
    }
    this.lastImpulse = c.currentTime;
    const buffer = loaded[this.variant++ % loaded.length];
    while (this.effects.length >= MAX_VOICES)
      this.stopVoice(this.effects.shift()!);
    const voice = this.makeVoice(buffer, this.effectsBus!);
    const amount = Number.isFinite(strength)
      ? Math.min(1, Math.max(0, strength))
      : 0;
    voice.gain.gain.value = 0.4 + amount * 0.5;
    voice.source.playbackRate.value = 0.97 + Math.random() * 0.06;
    this.effects.push(voice);
    voice.source.onended = () => {
      this.effects = this.effects.filter((item) => item !== voice);
      this.disconnect(voice);
    };
    voice.source.start();
  }
  private makeVoice(buffer: AudioBuffer, bus: GainNode): Voice {
    const source = this.context!.createBufferSource();
    const gain = this.context!.createGain();
    source.buffer = buffer;
    source.connect(gain);
    gain.connect(bus);
    return { source, gain };
  }
  private disconnect(voice: Voice): void {
    voice.source.disconnect();
    voice.gain.disconnect();
  }
  private stopVoice(voice: Voice): void {
    voice.source.onended = null;
    try {
      voice.source.stop();
    } catch {
      /* Already ended. */
    }
    this.disconnect(voice);
  }
  private stopAll(): void {
    if (this.loopTimer) clearInterval(this.loopTimer);
    this.loopTimer = undefined;
    for (const voice of this.ambient) this.stopVoice(voice);
    this.ambient.clear();
    for (const voice of this.effects) this.stopVoice(voice);
    this.effects = [];
    this.lastImpulse = -Infinity;
  }
  diagnostics() {
    return {
      scene: this.scene,
      unlocked: !!this.context,
      playing: this.audible && this.context?.state === "running",
      loaded: this.buffers.size,
      voices: this.effects.length,
      ambienceVoices: this.ambient.size,
      error: this.error,
      cacheEntries: cache.size,
      cacheBytes: cachedBytes,
    };
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.context && this.master) {
      this.master.gain.cancelScheduledValues(this.context.currentTime);
      this.master.gain.setValueAtTime(0, this.context.currentTime);
    }
    this.stopAll();
    this.buffers.clear();
    this.ambienceBus?.disconnect();
    this.effectsBus?.disconnect();
    this.master?.disconnect();
    void this.context?.close().catch(() => {});
  }
}

export function createSceneAudio(sceneId: string): SceneAudio {
  return new RecordedSceneAudio(sceneId);
}
