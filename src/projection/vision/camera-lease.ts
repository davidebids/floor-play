interface LockManagerLike {
  request(
    name: string,
    options: { ifAvailable: true },
    callback: (lock: unknown | null) => Promise<void>,
  ): Promise<void>;
}

/** Serializes this controller's lock teardown without waiting on another window. */
export class CameraLease {
  private previousRequest: Promise<void> = Promise.resolve();
  private releaseCurrent: (() => void) | undefined;

  release(): void {
    this.releaseCurrent?.();
    this.releaseCurrent = undefined;
  }

  async acquire(
    manager: LockManagerLike | undefined,
    isCurrent: () => boolean,
  ): Promise<void> {
    if (!manager) return;
    await this.previousRequest.catch(() => undefined);
    if (!isCurrent()) throw new Error("Camera request cancelled.");
    let resolveAcquired!: () => void;
    let rejectAcquired!: (error: Error) => void;
    const acquired = new Promise<void>((resolve, reject) => {
      resolveAcquired = resolve;
      rejectAcquired = reject;
    });
    this.previousRequest = manager
      .request("projection-app-camera", { ifAvailable: true }, async (lock) => {
        if (!lock) {
          rejectAcquired(
            new Error(
              "The camera is already running in another Projection App window. Stop that camera first.",
            ),
          );
          return;
        }
        if (!isCurrent()) {
          rejectAcquired(new Error("Camera request cancelled."));
          return;
        }
        await new Promise<void>((release) => {
          this.releaseCurrent = release;
          resolveAcquired();
        });
      })
      .catch((error) => {
        rejectAcquired(
          error instanceof Error ? error : new Error(String(error)),
        );
      });
    await acquired;
    if (!isCurrent()) throw new Error("Camera request cancelled.");
  }
}
