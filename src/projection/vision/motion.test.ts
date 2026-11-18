import { describe, expect, it } from "vitest";
import {
  analyzeForeground,
  MotionInterpreter,
  patchActivity,
  imageMotionGain,
  type ForegroundObservation,
} from "./motion";
import { calibrationMatches, mapCameraFrame } from "./controller";
import { DEFAULT_SETTINGS } from "../storage";
import type { Quad } from "../types";

const person = {
  id: "body",
  center: { x: 0.5, y: 0.5 },
  radius: 0.08,
  confidence: 0.95,
};
const observation = (x: number, activity: number): ForegroundObservation => ({
  presence: [person],
  motion: [],
  hands: [{ position: { x, y: 0.5 }, radius: 0.04, confidence: 0.9, activity }],
});

describe("image motion gestures", () => {
  it("counts five separated repeat taps at 30 Hz after initial contact despite noisy projected pixels", () => {
    const interpreter = new MotionInterpreter();
    const taps: number[] = [];
    for (let index = 0; index < 170; index++) {
      const timestamp = index * (1000 / 30);
      const phase = timestamp % 1000;
      const lifting = timestamp >= 1000 && timestamp < 5200 && phase < 100;
      const input = observation(
        0.5 + Math.sin(index) * 0.0005,
        index % 2 ? 0.4 : 0.7,
      );
      input.hands[0].radius =
        (lifting ? 0.05 : 0.04) + Math.sin(index) * 0.0003;
      // Establish initial contact during the first second, then count repeats.
      for (const impulse of interpreter.update(input, timestamp).impulses)
        if (timestamp >= 1000) taps.push(impulse.timestamp);
    }
    expect(taps).toHaveLength(5);
    taps.forEach((timestamp, index) => {
      expect(timestamp).toBeGreaterThanOrEqual((index + 1) * 1000);
      expect(timestamp).toBeLessThan((index + 1) * 1000 + 120);
    });
  });
  it("accepts repeated lifts/taps in place while projected texture keeps image activity high", () => {
    const interpreter = new MotionInterpreter();
    const hand = (radius: number) => {
      const input = observation(0.5, 0.45);
      input.hands[0].radius = radius;
      return input;
    };
    interpreter.update({ presence: [], hands: [], motion: [] }, 0);
    expect(interpreter.update(hand(0.04), 100).impulses).toHaveLength(1);
    for (let time = 200; time <= 500; time += 100)
      expect(interpreter.update(hand(0.04), time).impulses).toHaveLength(0);
    expect(interpreter.update(hand(0.05), 600).impulses).toHaveLength(1);
    for (let time = 700; time <= 1000; time += 100)
      expect(interpreter.update(hand(0.04), time).impulses).toHaveLength(0);
    expect(interpreter.update(hand(0.05), 1100).impulses).toHaveLength(1);
  });
  it("re-arms a steady pose without converting projected flicker or small landmark jitter into repeated taps", () => {
    const interpreter = new MotionInterpreter();
    interpreter.update({ presence: [], hands: [], motion: [] }, 0);
    interpreter.update(observation(0.5, 0.6), 100);
    for (let i = 1; i < 90; i++) {
      const input = observation(
        0.5 + (i % 2 ? 0.0007 : -0.0007),
        i % 2 ? 0.3 : 0.8,
      );
      input.hands[0].radius = 0.04 + (i % 2 ? 0.0007 : -0.0007);
      expect(interpreter.update(input, 100 + i * 34).impulses).toHaveLength(0);
    }
  });
  it("registers a brief entering hand only with strong semantic and recent image evidence", () => {
    const interpreter = new MotionInterpreter();
    interpreter.update({ presence: [], hands: [], motion: [] }, 100);
    expect(
      interpreter.update(observation(0.5, 0.6), 134).impulses,
    ).toHaveLength(1);
    for (let time = 168; time < 1000; time += 34)
      expect(
        interpreter.update(observation(0.5, 0.6), time).impulses,
      ).toHaveLength(0);
  });
  it("does not turn first startup, low confidence, stale history or lighting changes into entering-hand taps", () => {
    expect(
      new MotionInterpreter().update(observation(0.5, 0.9), 100).impulses,
    ).toHaveLength(0);
    for (const kind of ["confidence", "stale", "lighting", "quiet"]) {
      const interpreter = new MotionInterpreter();
      interpreter.update({ presence: [], hands: [], motion: [] }, 100);
      const input = observation(0.5, kind === "quiet" ? 0.1 : 0.9);
      if (kind === "confidence") input.hands[0].confidence = 0.7;
      if (kind === "lighting") input.illuminationChange = true;
      expect(
        interpreter.update(input, kind === "stale" ? 500 : 134).impulses,
      ).toHaveLength(0);
    }
  });
  it("keeps fish away from a resting recognized hand even when the body mask misses it", () => {
    const interpreter = new MotionInterpreter();
    const input = { ...observation(0.63, 0), presence: [] };
    const first = interpreter.update(input, 100);
    const next = interpreter.update(input, 200);
    expect(first.presence).toHaveLength(1);
    expect(next.presence[0]).toMatchObject({
      center: { x: 0.63, y: 0.5 },
      radius: 0.04,
      confidence: 0.9,
    });
    expect(next.presence[0].id).toBe(first.presence[0].id);
    expect(next.impulses).toHaveLength(0);
    expect(input.presence).toEqual([]);
    expect(
      interpreter.update({ presence: [], hands: [], motion: [] }, 300).presence,
    ).toEqual([]);
  });
  it("does not treat a newly seen or resting hand as repeated strikes", () => {
    const interpreter = new MotionInterpreter();
    expect(interpreter.update(observation(0.5, 0), 100).impulses).toHaveLength(
      0,
    );
    for (let i = 1; i < 30; i++)
      expect(
        interpreter.update(observation(0.5, 0), 100 + i * 100).impulses,
      ).toHaveLength(0);
  });
  it("emits a spatially localized quick-motion event with a per-hand cooldown", () => {
    const interpreter = new MotionInterpreter();
    interpreter.update(observation(0.5, 0), 100);
    const strike = interpreter.update(observation(0.53, 0.5), 200);
    expect(strike.impulses).toHaveLength(1);
    expect(strike.impulses[0].position).toEqual({ x: 0.53, y: 0.5 });
    expect(
      interpreter.update(observation(0.56, 0.5), 300).impulses,
    ).toHaveLength(0);
    expect(
      interpreter.update(observation(0.59, 0.5), 700).impulses,
    ).toHaveLength(1);
  });
  it("suppresses illumination bursts, stale timestamps, and unsupported motion", () => {
    const interpreter = new MotionInterpreter();
    interpreter.update(observation(0.5, 0), 100);
    expect(
      interpreter.update(
        { ...observation(0.53, 0.8), illuminationChange: true },
        200,
      ).impulses,
    ).toHaveLength(0);
    expect(
      interpreter.update(observation(0.53, 0.8), 199).presence,
    ).toHaveLength(0);
    expect(
      interpreter.update({ presence: [], hands: [], motion: [] }, 300).impulses,
    ).toHaveLength(0);
  });
  it("provides bounded semantic foreground fallback when no hands are visible", () => {
    const interpreter = new MotionInterpreter();
    const input = {
      presence: [person],
      hands: [],
      motion: [
        {
          position: person.center,
          radius: 0.06,
          strength: 0.9,
          confidence: 0.9,
        },
      ],
    };
    expect(interpreter.update(input, 100).impulses).toHaveLength(1);
    expect(interpreter.update(input, 200).impulses).toHaveLength(0);
    expect(interpreter.update(input, 900).impulses).toHaveLength(0);
    interpreter.update({ ...input, motion: [] }, 1000);
    expect(interpreter.update(input, 1100).impulses).toHaveLength(1);
  });
});

describe("foreground fallback recovery", () => {
  it("does not let stronger low-confidence motion hide a valid confident fallback tap", () => {
    const input = {
      presence: [],
      hands: [],
      motion: [
        {
          position: { x: 0.4, y: 0.4 },
          radius: 0.06,
          strength: 1,
          confidence: 0.6,
        },
        {
          position: { x: 0.6, y: 0.6 },
          radius: 0.06,
          strength: 0.7,
          confidence: 0.9,
        },
      ],
    };
    const result = new MotionInterpreter().update(input, 100);
    expect(result.impulses).toHaveLength(1);
    expect(result.impulses[0].position).toEqual({ x: 0.6, y: 0.6 });
  });
  it("does not re-arm fallback from a lighting burst or continuous foreground motion while hands are visible", () => {
    for (const illuminated of [false, true]) {
      const interpreter = new MotionInterpreter();
      const moving = {
        presence: [person],
        hands: [],
        motion: [
          {
            position: person.center,
            radius: 0.06,
            strength: 0.9,
            confidence: 0.9,
          },
        ],
      };
      interpreter.update(moving, 100);
      for (let time = 200; time < 1000; time += 100)
        interpreter.update(
          {
            ...observation(0.5, 0),
            motion: illuminated ? [] : moving.motion,
            illuminationChange: illuminated,
          },
          time,
        );
      expect(interpreter.update(moving, 1000).impulses).toHaveLength(0);
    }
  });
  it("re-arms fallback while landmarks are visible so a later hand dropout does not lose the next tap", () => {
    const interpreter = new MotionInterpreter();
    const moving = {
      presence: [person],
      hands: [],
      motion: [
        {
          position: person.center,
          radius: 0.06,
          strength: 0.9,
          confidence: 0.9,
        },
      ],
    };
    expect(interpreter.update(moving, 100).impulses).toHaveLength(1);
    for (let time = 200; time < 1000; time += 100)
      interpreter.update(observation(0.5, 0), time);
    expect(interpreter.update(moving, 1000).impulses).toHaveLength(1);
  });
  const floor: Quad = [
    { x: 0.3, y: 0.2 },
    { x: 0.8, y: 0.3 },
    { x: 0.7, y: 0.8 },
    { x: 0.2, y: 0.7 },
  ];
  const inside = {
    position: { x: 0.5, y: 0.5 },
    radius: 0.04,
    confidence: 0.9,
    strength: 0.7,
  };
  const outside = { ...inside, position: { x: 0.1, y: 0.1 }, strength: 1 };
  it("chooses floor motion over a stronger off-floor forearm", () => {
    const frame = new MotionInterpreter().update(
      { presence: [], hands: [], motion: [outside, inside] },
      100,
      0.65,
      floor,
    );
    expect(frame.impulses).toHaveLength(1);
    expect(frame.impulses[0].position).toEqual(inside.position);
    expect(frame.motion).toHaveLength(1);
  });
  it("does not let an off-floor hand disable the floor fallback", () => {
    const frame = new MotionInterpreter().update(
      {
        presence: [],
        hands: [{ ...outside, activity: 0.9 }],
        motion: [inside],
      },
      100,
      0.65,
      floor,
    );
    expect(frame.impulses).toHaveLength(1);
    expect(frame.impulses[0].position).toEqual(inside.position);
  });
  it("ignores off-floor motion and preserves full-view behavior without calibration", () => {
    const input = { presence: [], hands: [], motion: [outside] };
    expect(
      new MotionInterpreter().update(input, 100, 0.65, floor).impulses,
    ).toEqual([]);
    expect(new MotionInterpreter().update(input, 100).impulses).toHaveLength(1);
    const reversed = [...floor].reverse() as Quad;
    expect(
      new MotionInterpreter().update(
        { ...input, motion: [inside] },
        100,
        0.65,
        reversed,
      ).impulses,
    ).toHaveLength(1);
  });
  it("re-arms during a quiet frame inside cooldown so the next deliberate motion is accepted", () => {
    const interpreter = new MotionInterpreter();
    const input = {
      presence: [person],
      hands: [],
      motion: [
        {
          position: person.center,
          radius: 0.06,
          strength: 0.9,
          confidence: 0.9,
        },
      ],
    };
    expect(interpreter.update(input, 100).impulses).toHaveLength(1);
    interpreter.update({ ...input, motion: [] }, 200);
    expect(interpreter.update(input, 900).impulses).toHaveLength(1);
  });
});

describe("resting hand impulse suppression", () => {
  it("requires a hand to settle or move away before sustained patch activity can trigger again", () => {
    const interpreter = new MotionInterpreter();
    interpreter.update(observation(0.5, 0), 100);
    expect(
      interpreter.update(observation(0.5, 0.6), 200).impulses,
    ).toHaveLength(1);
    for (let timestamp = 300; timestamp <= 2300; timestamp += 100)
      expect(
        interpreter.update(observation(0.5, 0.6), timestamp).impulses,
      ).toHaveLength(0);
    interpreter.update(observation(0.5, 0), 2400);
    expect(
      interpreter.update(observation(0.5, 0.6), 2500).impulses,
    ).toHaveLength(1);
  });
});

describe("semantic foreground analysis", () => {
  it("ignores animated pixels without semantic foreground evidence", () => {
    const previous = new Uint8Array(140 * 100).fill(40);
    const gray = previous.map((value, i) => value + (i % 7) * 20);
    const result = analyzeForeground(
      new Float32Array(14 * 10),
      14,
      10,
      gray,
      previous,
      140,
      100,
    );
    expect(result.presence).toHaveLength(0);
    expect(result.motion).toHaveLength(0);
  });
  it("retains stationary body occupancy while stopping motion", () => {
    const gray = new Uint8Array(140 * 100).fill(80);
    const mask = new Float32Array(14 * 10);
    for (let y = 3; y < 7; y++)
      for (let x = 4; x < 10; x++) mask[y * 14 + x] = 0.95;
    const result = analyzeForeground(mask, 14, 10, gray, gray, 140, 100);
    expect(result.presence.length).toBeGreaterThan(1);
    expect(result.motion).toHaveLength(0);
  });
  it("detects global exposure change without generating motion", () => {
    const before = new Uint8Array(140 * 100).fill(40);
    const after = new Uint8Array(140 * 100).fill(110);
    const result = analyzeForeground(
      new Float32Array(14 * 10).fill(0.9),
      14,
      10,
      after,
      before,
      140,
      100,
    );
    expect(result.illuminationChange).toBe(true);
    expect(result.motion).toHaveLength(0);
    expect(result.presence.length).toBeGreaterThan(0);
  });
  it("handles zero-area and unchanged hand patches", () => {
    const pixels = new Uint8Array(100).fill(10);
    expect(patchActivity({ x: 0.5, y: 0.5 }, 0.1, pixels, pixels, 10, 10)).toBe(
      0,
    );
    expect(patchActivity({ x: -1, y: -1 }, 0, pixels, pixels, 10, 10)).toBe(0);
  });
});

describe("camera profile validity and floor mapping", () => {
  const profile = {
    ...DEFAULT_SETTINGS.calibration,
    calibrated: true,
    cameraId: "gopro",
    cameraWidth: 1280,
    cameraHeight: 720,
  };
  it("requires the calibrated device and actual dimensions", () => {
    expect(
      calibrationMatches(profile, {
        cameraId: "gopro",
        width: 1280,
        height: 720,
      }),
    ).toBe(true);
    expect(
      calibrationMatches(profile, {
        cameraId: "other",
        width: 1280,
        height: 720,
      }),
    ).toBe(false);
    expect(
      calibrationMatches(profile, {
        cameraId: "gopro",
        width: 1920,
        height: 1080,
      }),
    ).toBe(false);
    expect(
      calibrationMatches(
        { ...profile, calibrated: false },
        { cameraId: "gopro", width: 1280, height: 720 },
      ),
    ).toBe(false);
  });
  it("maps regions and impulses and rejects observations outside the calibrated floor", () => {
    const frame = {
      timestamp: 100,
      source: "camera" as const,
      presence: [person],
      motion: [],
      impulses: [
        {
          id: "a",
          timestamp: 100,
          position: { x: 0.5, y: 0.5 },
          strength: 0.8,
          confidence: 1,
        },
        {
          id: "b",
          timestamp: 100,
          position: { x: 0.02, y: 0.02 },
          strength: 0.8,
          confidence: 1,
        },
      ],
    };
    const mapped = mapCameraFrame(frame, {
      ...profile,
      cameraCorners: [
        { x: 0.1, y: 0.1 },
        { x: 0.9, y: 0.1 },
        { x: 0.9, y: 0.9 },
        { x: 0.1, y: 0.9 },
      ],
    });
    expect(mapped.impulses).toHaveLength(1);
    expect(mapped.impulses[0].position.x).toBeCloseTo(0.5);
    expect(mapped.presence[0].radius).toBeGreaterThan(person.radius);
  });
});

describe("frame-rate independent image motion", () => {
  it("preserves comparable motion energy at 10 and 30 observations per second", () => {
    expect(0.12 * imageMotionGain(100)).toBeCloseTo(
      0.04 * imageMotionGain(1000 / 30),
    );
    expect(0.12 * imageMotionGain(100)).toBeCloseTo(
      0.24 * imageMotionGain(200),
    );
  });
  it("rejects old or nonfinite history and bounds amplification for short intervals", () => {
    for (const value of [0, -1, 300, Infinity, NaN])
      expect(imageMotionGain(value)).toBe(0);
    expect(imageMotionGain(1)).toBe(3);
  });
});
