import { describe, expect, it } from "vitest";
import { InteractionEngine } from "./interaction";
import type { InteractionFrame } from "./types";
const frame = (
  timestamp: number,
  id = "hand-1",
  x = 0.3,
): InteractionFrame => ({
  timestamp,
  source: "camera",
  presence: [
    { id: "body", center: { x, y: 0.5 }, radius: 0.15, confidence: 0.9 },
  ],
  motion: [
    {
      id,
      position: { x, y: 0.5 },
      radius: 0.05,
      strength: 0.6,
      confidence: 0.9,
    },
  ],
  impulses: [
    { id, position: { x, y: 0.5 }, strength: 0.8, confidence: 0.9, timestamp },
  ],
});
describe("activity-independent interactions", () => {
  it("expires pending actions during ingestion even when the scene is not sampling", () => {
    const engine = new InteractionEngine();
    for (let index = 0; index < 100; index++)
      engine.ingest(frame(1000 + index * 500, `tap-${index}`));
    expect(engine.diagnostics().expiredActions).toBe(99);
    expect(engine.sample(50500).impulses).toHaveLength(1);
  });
  it("reports why actions are filtered and clears counters on reset", () => {
    const engine = new InteractionEngine();
    engine.ingest(frame(1000, "first"));
    engine.sample(1010);
    engine.ingest(frame(1100, "repeat"));
    engine.ingest(frame(1200, "repeat"));
    engine.ingest(frame(1600, "late"));
    engine.sample(1900);
    expect(engine.diagnostics()).toEqual({
      duplicateActions: 1,
      invalidActions: 1,
      expiredActions: 1,
    });
    engine.reset();
    expect(engine.diagnostics()).toEqual({
      duplicateActions: 0,
      invalidActions: 0,
      expiredActions: 0,
    });
  });
  it("emits an impulse once and keeps presence while the sample is fresh", () => {
    const engine = new InteractionEngine();
    engine.ingest(frame(1000));
    expect(engine.sample(1010).impulses).toHaveLength(1);
    expect(engine.sample(1020).impulses).toHaveLength(0);
    expect(engine.sample(1020).presence).toHaveLength(1);
  });
  it("rejects duplicate event IDs even after a cooldown, but permits separate hands", () => {
    const engine = new InteractionEngine();
    engine.ingest(frame(1000));
    engine.sample(1000);
    engine.ingest(frame(1500));
    expect(engine.sample(1500).impulses).toHaveLength(0);
    engine.ingest(frame(1510, "hand-2", 0.8));
    expect(engine.sample(1510).impulses).toHaveLength(1);
  });
  it("debounces repeated spatial events despite changing IDs, then allows a later pat", () => {
    const engine = new InteractionEngine();
    engine.ingest(frame(1000, "a"));
    engine.sample(1000);
    engine.ingest(frame(1100, "b", 0.32));
    expect(engine.sample(1100).impulses).toHaveLength(0);
    engine.ingest(frame(1400, "c", 0.32));
    expect(engine.sample(1400).impulses).toHaveLength(1);
  });
  it("expires stale input, rejects late impulses and ignores out-of-order frames", () => {
    const engine = new InteractionEngine();
    engine.ingest(frame(1000));
    expect(engine.sample(1400).impulses).toHaveLength(0);
    expect(engine.sample(1501)).toMatchObject({
      presence: [],
      motion: [],
      impulses: [],
    });
    engine.ingest(frame(900, "old", 0.9));
    expect(engine.sample(1501).presence).toHaveLength(0);
  });
  it("does not replay a stale impulse and fades present regions before expiry", () => {
    const engine = new InteractionEngine();
    engine.ingest(frame(1000));
    const a = engine.sample(1000),
      b = engine.sample(1250);
    expect(b.presence[0].confidence).toBeLessThan(a.presence[0].confidence);
    expect(b.impulses).toHaveLength(0);
  });
  it("filters invalid/low-confidence signals and clears all state on reset", () => {
    const engine = new InteractionEngine();
    const input = frame(1000);
    input.presence[0].center.x = NaN;
    input.motion[0].confidence = 0.01;
    input.impulses[0].strength = Infinity;
    engine.ingest(input);
    expect(engine.sample(1000)).toMatchObject({
      presence: [],
      motion: [],
      impulses: [],
    });
    engine.ingest(frame(1100));
    engine.reset();
    expect(engine.sample(1100)).toMatchObject({
      presence: [],
      motion: [],
      impulses: [],
    });
  });
});
