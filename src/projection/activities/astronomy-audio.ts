import type { ActivityAudio } from "../types";

interface Voice {
  nodes: OscillatorNode[];
  envelope: GainNode;
}
const NOTES = [293.665, 440, 369.994, 587.33, 493.883];

/** Optional musical sonification: quiet, tuned glass notes, with no noise bed. */
export function createAstronomyAudio(): ActivityAudio & {
  dispose(): void;
  diagnostics(): Record<string, unknown>;
} {
  let context: AudioContext | undefined, master: GainNode | undefined;
  let enabled = false,
    active = true,
    volume = 0.18,
    disposed = false,
    gesture = false,
    sequence = 0,
    last = -Infinity;
  const voices: Voice[] = [];
  function remove(voice: Voice) {
    const i = voices.indexOf(voice);
    if (i < 0) return;
    voices.splice(i, 1);
    voice.nodes.forEach((node) => {
      try {
        node.stop();
      } catch {
        /* Already ended. */
      }
      node.disconnect();
    });
    voice.envelope.disconnect();
  }
  const silence = () => {
    [...voices].forEach(remove);
    // A fresh play session must respond even if the preceding note was just stopped.
    last = -Infinity;
  };
  function start() {
    if (disposed || !gesture || !enabled) return;
    context ??= new AudioContext();
    if (!master) {
      master = context.createGain();
      master.gain.value = active ? volume : 0;
      master.connect(context.destination);
    }
    if (context.state === "suspended") void context.resume().catch(() => {});
  }
  return {
    unlock() {
      gesture = true;
      start();
    },
    configure(on, level, running) {
      enabled = on;
      active = running;
      volume = Number.isFinite(level) ? Math.max(0, Math.min(1, level)) : 0;
      start();
      if (master && context)
        master.gain.setValueAtTime(
          enabled && active ? volume : 0,
          context.currentTime,
        );
      if (!enabled || !active || volume === 0) silence();
    },
    impulse(strength) {
      if (
        disposed ||
        !enabled ||
        !active ||
        volume <= 0 ||
        !context ||
        context.state !== "running" ||
        !master
      )
        return;
      const now = context.currentTime;
      if (now - last < 0.22 || !Number.isFinite(strength)) return;
      last = now;
      if (voices.length >= 3) remove(voices[0]);
      const frequency = NOTES[sequence++ % NOTES.length];
      const envelope = context.createGain();
      envelope.connect(master);
      const peak = 0.045 * (0.55 + Math.max(0, Math.min(1, strength)) * 0.45);
      envelope.gain.setValueAtTime(0, now);
      envelope.gain.linearRampToValueAtTime(peak, now + 0.018);
      envelope.gain.exponentialRampToValueAtTime(0.0001, now + 1.55);
      const voice: Voice = { nodes: [], envelope };
      for (const [ratio, gain] of [
        [1, 1],
        [2, 0.22],
        [3, 0.06],
      ]) {
        const oscillator = context.createOscillator(),
          partial = context.createGain();
        oscillator.type = "sine";
        oscillator.frequency.value = frequency * ratio;
        partial.gain.value = gain;
        oscillator.connect(partial);
        partial.connect(envelope);
        oscillator.onended = () => {
          partial.disconnect();
          if (ratio === 1) remove(voice);
        };
        voice.nodes.push(oscillator);
        oscillator.start(now);
        oscillator.stop(now + 1.6);
      }
      voices.push(voice);
    },
    diagnostics: () => ({
      scene: "starlit-cosmos",
      unlocked: !!context,
      playing: voices.length > 0,
      voices: voices.length,
      error: null,
    }),
    dispose() {
      if (disposed) return;
      disposed = true;
      silence();
      master?.disconnect();
      if (context) void context.close().catch(() => {});
    },
  };
}
