const OUTPUT_LOCK = "projection-app-projector-output";

/** A browser-owned lease survives throttled timers and is released on window close. */
export function holdProjectorLease(
  manager: LockManager | undefined,
): () => void {
  let stopped = false;
  let release: (() => void) | undefined;
  void manager
    ?.request(OUTPUT_LOCK, async () => {
      if (stopped) return;
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    })
    .catch(() => undefined);
  return () => {
    stopped = true;
    release?.();
  };
}

/** Unknown lease state is not permission to take over a potentially live output. */
export async function projectorLeaseHeld(
  manager: LockManager | undefined,
): Promise<boolean | undefined> {
  if (!manager?.query) return undefined;
  try {
    const state = await manager.query();
    return state.held?.some((lock) => lock.name === OUTPUT_LOCK) ?? false;
  } catch {
    return undefined;
  }
}
