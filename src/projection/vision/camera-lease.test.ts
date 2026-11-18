import { describe, expect, it } from "vitest";
import { CameraLease } from "./camera-lease";

class FakeLocks {
  held = false;
  async request(
    _name: string,
    _options: { ifAvailable: true },
    callback: (lock: unknown | null) => Promise<void>,
  ): Promise<void> {
    if (this.held) {
      await callback(null);
      return;
    }
    this.held = true;
    try {
      await callback({});
    } finally {
      await Promise.resolve();
      this.held = false;
    }
  }
}

describe("camera ownership", () => {
  it("waits for its own previous lock to release during immediate reconnect", async () => {
    const locks = new FakeLocks();
    const lease = new CameraLease();
    let generation = 1;
    await lease.acquire(locks, () => generation === 1);
    expect(locks.held).toBe(true);
    generation = 2;
    lease.release();
    await lease.acquire(locks, () => generation === 2);
    expect(locks.held).toBe(true);
    lease.release();
  });
  it("rejects a competing window without queueing indefinitely", async () => {
    const locks = new FakeLocks();
    const one = new CameraLease();
    const two = new CameraLease();
    await one.acquire(locks, () => true);
    await expect(two.acquire(locks, () => true)).rejects.toThrow(
      "another Projection App window",
    );
    one.release();
  });
  it("does not acquire a lock for a cancelled pending start", async () => {
    const locks = new FakeLocks();
    const lease = new CameraLease();
    let current = true;
    const acquiring = lease.acquire(locks, () => current);
    current = false;
    await expect(acquiring).rejects.toThrow("cancelled");
    expect(locks.held).toBe(false);
  });
});
