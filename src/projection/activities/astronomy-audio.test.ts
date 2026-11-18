import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAstronomyAudio } from "./astronomy-audio";

class Param {
  value = 1;
  setValueAtTime = vi.fn((value: number) => {
    this.value = value;
  });
  linearRampToValueAtTime = vi.fn();
  exponentialRampToValueAtTime = vi.fn();
}
class AudioNodeMock {
  connections: unknown[] = [];
  connect = vi.fn((node: unknown) => {
    this.connections.push(node);
  });
  disconnect = vi.fn();
}
class GainMock extends AudioNodeMock {
  gain = new Param();
}
class OscillatorMock extends AudioNodeMock {
  frequency = new Param();
  type = "";
  onended: (() => void) | null = null;
  start = vi.fn();
  stop = vi.fn();
}
const contexts: ContextMock[] = [];
class ContextMock {
  destination = {};
  currentTime = 0;
  state = "running";
  gains: GainMock[] = [];
  oscillators: OscillatorMock[] = [];
  constructor() {
    contexts.push(this);
  }
  createGain() {
    const node = new GainMock();
    this.gains.push(node);
    return node;
  }
  createOscillator() {
    const node = new OscillatorMock();
    this.oscillators.push(node);
    return node;
  }
  resume = vi.fn(async () => {
    this.state = "running";
  });
  close = vi.fn(async () => {
    this.state = "closed";
  });
}
type Audio = ReturnType<typeof createAstronomyAudio>;
let audios: Audio[] = [];
function create() {
  const audio = createAstronomyAudio();
  audios.push(audio);
  return audio;
}
function play() {
  const audio = create();
  audio.configure(true, 0.4, true);
  audio.unlock();
  return audio;
}
beforeEach(() => {
  contexts.length = 0;
  audios = [];
  vi.stubGlobal("AudioContext", ContextMock);
});
afterEach(() => {
  audios.forEach((audio) => audio.dispose());
  vi.unstubAllGlobals();
});

describe("astronomy musical feedback", () => {
  it("remembers the enable-button gesture before the settings change without allocating while muted", () => {
    const audio = create();
    audio.unlock(); // App handles the click before React commits sound=true.
    audio.impulse(1);
    expect(contexts).toHaveLength(0);
    audio.configure(true, 0.4, true);
    expect(contexts).toHaveLength(1);
    expect(contexts[0].oscillators).toHaveLength(0);
    audio.impulse(0.8);
    expect(contexts[0].oscillators).toHaveLength(3);
  });
  it("does not allocate a context for enabled settings without any user gesture", () => {
    const audio = create();
    audio.configure(true, 0.4, true);
    audio.impulse(1);
    expect(contexts).toHaveLength(0);
  });
  it("uses one volume master and a bounded three-partial note with a gentle attack and finite release", () => {
    const audio = play(),
      context = contexts[0],
      master = context.gains[0];
    audio.unlock();
    expect(contexts).toHaveLength(1);
    expect(master.connections).toEqual([context.destination]);
    audio.impulse(1);
    const envelope = context.gains[1];
    expect(envelope.connections).toEqual([master]);
    expect(envelope.gain.setValueAtTime).toHaveBeenCalledWith(0, 0);
    expect(envelope.gain.linearRampToValueAtTime).toHaveBeenCalledWith(
      0.045,
      0.018,
    );
    expect(envelope.gain.exponentialRampToValueAtTime).toHaveBeenCalledWith(
      0.0001,
      1.55,
    );
    context.oscillators.forEach((node, i) => {
      expect(node.frequency.value).toBeCloseTo(293.665 * (i + 1), 8);
    });
    for (const oscillator of context.oscillators) {
      expect(oscillator.type).toBe("sine");
      expect(oscillator.start).toHaveBeenCalledWith(0);
      expect(oscillator.stop).toHaveBeenCalledWith(1.6);
    }
    audio.configure(true, 0.23, true);
    expect(master.gain.value).toBe(0.23);
  });
  it("applies cooldown without consuming the next musical note and bounds simultaneous voices", () => {
    const audio = play(),
      context = contexts[0];
    audio.impulse(1);
    context.currentTime = 0.1;
    audio.impulse(1);
    expect(context.oscillators).toHaveLength(3);
    context.currentTime = 0.25;
    audio.impulse(1);
    expect(context.oscillators[3].frequency.value).toBe(440);
    context.currentTime = 0.5;
    audio.impulse(1);
    expect(audio.diagnostics().voices).toBe(3);
    const oldest = context.oscillators.slice(0, 3);
    context.currentTime = 0.75;
    audio.impulse(1);
    expect(audio.diagnostics().voices).toBe(3);
    for (const node of oldest) {
      expect(node.stop).toHaveBeenLastCalledWith();
      expect(node.disconnect).toHaveBeenCalled();
    }
    expect(context.gains[1].disconnect).toHaveBeenCalled();
  });
  for (const [label, on, volume, active] of [
    ["mute", false, 0.4, true],
    ["pause/blank/inactive", true, 0.4, false],
    ["zero volume", true, 0, true],
  ] as const)
    it(`immediately silences and releases existing voices on ${label}, then can resume`, () => {
      const audio = play(),
        context = contexts[0];
      audio.impulse(1);
      expect(audio.diagnostics().playing).toBe(true);
      audio.configure(on, volume, active);
      expect(audio.diagnostics().voices).toBe(0);
      expect(context.gains[0].gain.value).toBe(0);
      for (const node of context.oscillators) {
        expect(node.stop).toHaveBeenLastCalledWith();
        expect(node.disconnect).toHaveBeenCalled();
      }
      const count = context.oscillators.length;
      context.currentTime = 1;
      audio.impulse(1);
      expect(context.oscillators).toHaveLength(count);
      audio.configure(true, 0.4, true);
      audio.impulse(1);
      expect(audio.diagnostics().playing).toBe(true);
    });
  for (const [label, enabled, volume, active] of [
    ["pause/blank/inactive", true, 0.4, false],
    ["mute", false, 0.4, true],
    ["zero volume", true, 0, true],
  ] as const)
    it(`re-arms the first note immediately after ${label}, even inside the previous note cooldown`, () => {
      const audio = play(),
        context = contexts[0];
      audio.impulse(1);
      expect(audio.diagnostics().voices).toBe(1);
      context.currentTime = 0.05;
      audio.configure(enabled, volume, active);
      expect(audio.diagnostics().voices).toBe(0);
      audio.configure(true, 0.4, true);
      context.currentTime = 0.1;
      audio.impulse(1);
      expect(audio.diagnostics().voices).toBe(1);
      expect(context.oscillators).toHaveLength(6);
    });
  it("rejects non-finite strengths and clamps extreme note gain", () => {
    const audio = play(),
      context = contexts[0];
    audio.impulse(NaN);
    audio.impulse(Infinity);
    expect(context.oscillators).toHaveLength(0);
    audio.impulse(1e6);
    expect(context.gains[1].gain.linearRampToValueAtTime).toHaveBeenCalledWith(
      0.045,
      0.018,
    );
    context.currentTime = 1;
    audio.impulse(-1e6);
    expect(context.gains[5].gain.linearRampToValueAtTime).toHaveBeenCalledWith(
      0.045 * 0.55,
      1.018,
    );
  });
  it("releases every partial after natural completion without duplicate voice removal", () => {
    const audio = play(),
      context = contexts[0];
    audio.impulse(1);
    const nodes = context.oscillators.slice();
    for (const node of nodes) node.onended?.();
    expect(audio.diagnostics().voices).toBe(0);
    for (const node of nodes) {
      expect(node.disconnect).toHaveBeenCalled();
      expect((node.connections[0] as GainMock).disconnect).toHaveBeenCalled();
    }
  });
  it("disposes idempotently, closes its context and ignores all later gestures and late completion callbacks", () => {
    const audio = play(),
      context = contexts[0];
    audio.impulse(1);
    const nodes = context.oscillators.slice();
    audio.dispose();
    audio.dispose();
    expect(context.close).toHaveBeenCalledTimes(1);
    expect(audio.diagnostics().voices).toBe(0);
    expect(context.gains[0].disconnect).toHaveBeenCalled();
    for (const node of nodes) node.onended?.();
    context.currentTime = 4;
    audio.unlock();
    audio.impulse(1);
    expect(contexts).toHaveLength(1);
    expect(context.oscillators).toHaveLength(3);
  });
  it("resumes a suspended context without allocating a replacement graph", async () => {
    const audio = play(),
      context = contexts[0];
    context.state = "suspended";
    audio.impulse(1);
    expect(context.oscillators).toHaveLength(0);
    audio.unlock();
    await Promise.resolve();
    expect(context.resume).toHaveBeenCalledTimes(1);
    expect(contexts).toHaveLength(1);
    audio.impulse(0.5);
    expect(audio.diagnostics().voices).toBe(1);
  });
});
