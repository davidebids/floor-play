import { createSceneAudio, type SceneAudio } from "./scene-audio";

/** Compatibility adapter: the koi activity shares the recorded nature mixer. */
export class KoiAudio {
  private readonly audio: SceneAudio = createSceneAudio("koi-pond");
  unlock(): void {
    this.audio.unlock();
  }
  configure(enabled: boolean, volume: number, active: boolean): void {
    this.audio.configure(enabled, volume, active);
  }
  impulse(strength: number): void {
    this.audio.impulse(strength);
  }
  diagnostics() {
    return this.audio.diagnostics();
  }
  dispose(): void {
    this.audio.dispose();
  }
}
