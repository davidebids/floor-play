import { afterEach, describe, expect, it, vi } from "vitest";
import { activities, loadActivity, type ActivityFactory } from "./registry";
import { DEFAULT_SETTINGS } from "./storage";
import type { ActivityContext } from "./types";
afterEach(() => vi.restoreAllMocks());
describe("scene factory ownership", () => {
  it("never constructs a late scene after its canvas ownership was superseded", async () => {
    let resolve!: (factory: ActivityFactory) => void,
      current = true;
    const pending = new Promise<ActivityFactory>((done) => {
      resolve = done;
    });
    const factory = vi.fn();
    vi.spyOn(activities[0], "load").mockReturnValue(pending);
    const context: ActivityContext = {
      canvas: {} as HTMLCanvasElement,
      settings: DEFAULT_SETTINGS,
      isCurrent: () => current,
    };
    const loading = loadActivity(activities[0].id, context);
    current = false;
    resolve(factory);
    await expect(loading).rejects.toThrow(/superseded/);
    expect(factory).not.toHaveBeenCalled();
  });
  it("skips the module request when ownership is already obsolete", async () => {
    const loader = vi.spyOn(activities[0], "load");
    await expect(
      loadActivity(activities[0].id, {
        canvas: {} as HTMLCanvasElement,
        settings: DEFAULT_SETTINGS,
        isCurrent: () => false,
      }),
    ).rejects.toThrow(/superseded/);
    expect(loader).not.toHaveBeenCalled();
  });
});
