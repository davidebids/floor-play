import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SceneAudio } from "./scene-audio";

class Param {
  value = 1;
  cancelScheduledValues = vi.fn();
  setValueAtTime = vi.fn((value: number) => {
    this.value = value;
  });
  setTargetAtTime = vi.fn((value: number) => {
    this.value = value;
  });
  linearRampToValueAtTime = vi.fn();
}
class Node {
  connections: unknown[] = [];
  connect = vi.fn((node: unknown) => {
    this.connections.push(node);
  });
  disconnect = vi.fn();
}
class Gain extends Node {
  gain = new Param();
}
class Source extends Node {
  buffer: unknown;
  playbackRate = new Param();
  onended: (() => void) | null = null;
  start = vi.fn();
  stop = vi.fn();
}
const contexts: Context[] = [];
class Context {
  destination = {};
  sampleRate = 44100;
  currentTime = 0;
  state = "running";
  gains: Gain[] = [];
  sources: Source[] = [];
  constructor() {
    contexts.push(this);
  }
  createGain() {
    const node = new Gain();
    this.gains.push(node);
    return node;
  }
  createBufferSource() {
    const node = new Source();
    this.sources.push(node);
    return node;
  }
  decodeAudioData = vi.fn(async () => ({
    length: 44100 * 28,
    numberOfChannels: 2,
    duration: 28,
  }));
  resume = vi.fn(async () => {});
  close = vi.fn(async () => {
    this.state = "closed";
  });
}
const drain = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve();
};
let audios: SceneAudio[];
let make: typeof import("./scene-audio").createSceneAudio;
function create(id = "koi-pond") {
  const audio = make(id);
  audios.push(audio);
  return audio;
}
async function play(id = "koi-pond") {
  const audio = create(id);
  audio.configure(true, 0.5, true);
  audio.unlock();
  await drain();
  return audio;
}
beforeEach(async () => {
  vi.useFakeTimers();
  vi.resetModules();
  contexts.length = 0;
  audios = [];
  vi.stubGlobal("AudioContext", Context);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(4),
    })),
  );
  make = (await import("./scene-audio")).createSceneAudio;
});
afterEach(() => {
  audios.forEach((audio) => audio.dispose());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("recorded scene audio", () => {
  it("retries a failed ambience download on later camera impulses even when effect clips loaded", async () => {
    let failed = false;
    vi.mocked(fetch).mockImplementation(
      async (url) =>
        ({
          ok:
            String(url).includes("pond-stream") && !failed
              ? ((failed = true), false)
              : true,
          status: 503,
          arrayBuffer: async () => new ArrayBuffer(4),
        }) as Response,
    );
    const audio = await play();
    expect(audio.diagnostics().loaded).toBe(3);
    await vi.advanceTimersByTimeAsync(2600);
    contexts[0].currentTime += 3;
    audio.impulse(0.8);
    await drain();
    expect(audio.diagnostics().loaded).toBe(4);
    expect(audio.diagnostics().ambienceVoices).toBe(1);
    expect(audio.diagnostics().error).toBeNull();
  });
  it("does not create or fetch audio before a gesture; sound remains off by default", async () => {
    const audio = create();
    audio.configure(true, 0.5, true);
    audio.impulse(1);
    expect(contexts).toHaveLength(0);
    expect(fetch).not.toHaveBeenCalled();
    const muted = create();
    muted.unlock();
    await drain();
    expect(contexts).toHaveLength(1);
    expect(fetch).not.toHaveBeenCalled();
    expect(contexts[0].sources).toHaveLength(0);
    expect(contexts[0].gains[0].gain.value).toBe(0);
  });

  it("routes recorded ambience and every splash through the same volume master", async () => {
    const audio = await play();
    const c = contexts[0];
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(audio.diagnostics().loaded).toBe(4);
    expect(c.sources).toHaveLength(1);
    audio.impulse(0.8);
    expect(c.sources).toHaveLength(2);
    const [master, ambientBus, effectsBus] = c.gains;
    expect(master.connections).toEqual([c.destination]);
    expect(ambientBus.connections).toEqual([master]);
    expect(effectsBus.connections).toEqual([master]);
    expect(c.sources[0].connections[0]).toBe(c.gains[3]);
    expect(c.gains[3].connections).toEqual([ambientBus]);
    expect(c.gains[4].connections).toEqual([effectsBus]);
    audio.configure(true, 0.23, true);
    expect(master.gain.value).toBe(0.23);
    expect(
      c.gains.filter((node) => node.connections.includes(c.destination)),
    ).toEqual([master]);
  });

  it.each(["mute", "pause", "zero volume"])(
    "%s stops existing ambience and effects and blocks new impulses",
    async (mode) => {
      const audio = await play();
      const c = contexts[0];
      audio.impulse(1);
      audio.configure(
        mode !== "mute",
        mode === "zero volume" ? 0 : 0.5,
        mode !== "pause",
      );
      expect(c.gains[0].gain.value).toBe(0);
      expect(
        c.sources.every((source) => source.stop.mock.calls.length === 1),
      ).toBe(true);
      expect(audio.diagnostics()).toMatchObject({
        voices: 0,
        ambienceVoices: 0,
        playing: false,
      });
      c.currentTime = 10;
      audio.impulse(1);
      vi.advanceTimersByTime(1000);
      expect(c.sources).toHaveLength(2);
      audio.configure(true, 0.5, true);
      expect(c.sources).toHaveLength(3);
      expect(audio.diagnostics().ambienceVoices).toBe(1);
    },
  );

  it("crossfades successive loop sources using the audio clock without a hard loop seam", async () => {
    const audio = await play();
    const c = contexts[0];
    const first = c.sources[0];
    expect(first.start).toHaveBeenCalledWith(0.02);
    c.currentTime = 25.5;
    vi.advanceTimersByTime(200);
    expect(c.sources).toHaveLength(2);
    expect(c.sources[1].start.mock.calls[0][0]).toBeCloseTo(26.02);
    expect(c.gains[4].gain.linearRampToValueAtTime).toHaveBeenCalledWith(
      1,
      28.02,
    );
    expect(c.gains[3].gain.linearRampToValueAtTime).toHaveBeenCalledWith(
      0,
      28.02,
    );
    first.onended?.();
    expect(audio.diagnostics().ambienceVoices).toBe(1);
    expect(first.disconnect).toHaveBeenCalledOnce();
  });

  it("caps voices, debounces impulses, rotates real clips, and releases ended nodes", async () => {
    const audio = await play();
    const c = contexts[0];
    audio.impulse(1);
    audio.impulse(1);
    expect(audio.diagnostics().voices).toBe(1);
    const first = c.sources[1];
    for (let i = 1; i <= 4; i++) {
      c.currentTime = i * 0.3;
      audio.impulse(1);
    }
    expect(audio.diagnostics().voices).toBe(3);
    expect(first.stop).toHaveBeenCalledOnce();
    expect(first.disconnect).toHaveBeenCalledOnce();
    expect(c.sources[1].buffer).not.toBe(c.sources[2].buffer);
    expect(c.sources[1].buffer).toBe(c.sources[4].buffer);
    c.sources.at(-1)?.onended?.();
    expect(audio.diagnostics().voices).toBe(2);
  });

  it("shares decoded buffers between instances without sharing live audio nodes", async () => {
    const koi = await play();
    const tide = await play("koi-pond");
    expect(fetch).toHaveBeenCalledTimes(4); // Same immutable recordings, separate live nodes.
    expect(contexts).toHaveLength(2);
    expect(contexts[0].sources[0]).not.toBe(contexts[1].sources[0]);
    koi.dispose();
    expect(contexts[0].close).toHaveBeenCalledOnce();
    expect(tide.diagnostics().ambienceVoices).toBe(1);
    expect(contexts[1].close).not.toHaveBeenCalled();
  });

  it("bounds the shared cache while repeatedly changing scenes and output sample rates", async () => {
    vi.stubGlobal(
      "AudioContext",
      class extends Context {
        constructor() {
          super();
          this.sampleRate += contexts.length;
        }
      },
    );
    for (let i = 0; i < 9; i++) {
      const audio = await play(i % 2 ? "forest-floor" : "koi-pond");
      const status = audio.diagnostics();
      expect(status.cacheEntries).toBeLessThanOrEqual(16);
      expect(status.cacheBytes).toBeLessThanOrEqual(64 * 1024 * 1024);
      audio.dispose();
    }
    expect(
      contexts.every((context) => context.close.mock.calls.length === 1),
    ).toBe(true);
  });

  it("finishes background loading without playing while the scene is paused", async () => {
    const releases: Array<(value: Response) => void> = [];
    vi.mocked(fetch).mockImplementation(
      () => new Promise((resolve) => releases.push(resolve)),
    );
    const audio = create();
    audio.configure(true, 0.5, true);
    audio.unlock();
    audio.configure(true, 0.5, false);
    releases.forEach((release) =>
      release({
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(4),
      } as Response),
    );
    await drain();
    expect(audio.diagnostics()).toMatchObject({
      loaded: 4,
      ambienceVoices: 0,
      playing: false,
    });
    expect(contexts[0].sources).toHaveLength(0);
    audio.configure(true, 0.5, true);
    expect(contexts[0].sources).toHaveLength(1);
  });

  it("contains loading failures and retries after a short backoff", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error("offline"));
    const audio = await play();
    expect(audio.diagnostics().error).toContain("could not load");
    expect(audio.diagnostics().loaded).toBe(3);
    audio.unlock();
    await drain();
    expect(fetch).toHaveBeenCalledTimes(4);
    vi.advanceTimersByTime(2600);
    audio.unlock();
    await drain();
    expect(fetch).toHaveBeenCalledTimes(5);
    expect(audio.diagnostics()).toMatchObject({
      loaded: 4,
      error: null,
      ambienceVoices: 1,
    });
  });

  it("cannot start delayed loads after pause or disposal and disposes idempotently", async () => {
    const releases: Array<(value: Response) => void> = [];
    vi.mocked(fetch).mockImplementation(
      () =>
        new Promise((resolve) => {
          releases.push(resolve);
        }),
    );
    const audio = create();
    audio.configure(true, 0.5, true);
    audio.unlock();
    const c = contexts[0];
    audio.dispose();
    releases.forEach((release) =>
      release({
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(4),
      } as Response),
    );
    await drain();
    audio.configure(true, 1, true);
    audio.unlock();
    audio.dispose();
    expect(c.sources).toHaveLength(0);
    expect(c.close).toHaveBeenCalledOnce();
    expect(audio.diagnostics().loaded).toBe(0);
    expect(
      c.gains.every((gain) => gain.disconnect.mock.calls.length === 1),
    ).toBe(true);
  });

  it("has a distinct recorded ambience for every activity and keeps unknown scenes silent", async () => {
    const { SCENE_SOUNDTRACKS } = await import("./scene-audio");
    expect(
      new Set(Object.values(SCENE_SOUNDTRACKS).map((track) => track.ambience))
        .size,
    ).toBe(5);
    expect(
      new Set(
        Object.values(SCENE_SOUNDTRACKS).map((track) => track.impulses[0]),
      ).size,
    ).toBe(5);
    const unknown = create("not-yet-built");
    unknown.configure(true, 1, true);
    unknown.unlock();
    unknown.impulse(1);
    expect(contexts).toHaveLength(0);
  });
});
