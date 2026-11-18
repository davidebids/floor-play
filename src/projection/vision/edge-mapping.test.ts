import { describe, expect, it } from "vitest";
import { DEFAULT_QUAD, homography, transformPoint } from "../calibration";
import { DEFAULT_SETTINGS } from "../storage";
import { mapCameraFrame } from "./controller";
import { MotionInterpreter } from "./motion";
import type { Point, Quad } from "../types";
const targets: Point[] = [
  { x: 0.5, y: 0.5 },
  { x: 0.015, y: 0.5 },
  { x: 0.985, y: 0.5 },
  { x: 0.5, y: 0.015 },
  { x: 0.5, y: 0.985 },
  { x: 0.015, y: 0.015 },
  { x: 0.985, y: 0.015 },
  { x: 0.985, y: 0.985 },
  { x: 0.015, y: 0.985 },
  ...DEFAULT_QUAD,
];
describe("camera coverage at floor edges", () => {
  for (const mirrored of [false, true])
    for (const path of ["hand", "foreground"])
      it(`${path} maps center, four sides and corners through perspective with mirror=${mirrored}`, () => {
        const corners = [
          { x: 0.26, y: 0.14 },
          { x: 0.78, y: 0.26 },
          { x: 0.66, y: 0.85 },
          { x: 0.12, y: 0.68 },
        ].map((p) => ({ x: mirrored ? 1 - p.x : p.x, y: p.y })) as Quad;
        const profile = {
          ...structuredClone(DEFAULT_SETTINGS.calibration),
          cameraCorners: corners,
          calibrated: true,
          mirrored,
        };
        const toCamera = homography(DEFAULT_QUAD, corners);
        for (const target of [
          ...targets,
          { x: -0.03, y: 0.5 },
          { x: 1.03, y: 0.5 },
          { x: 0.5, y: -0.03 },
          { x: 0.5, y: 1.03 },
        ]) {
          const point = transformPoint(toCamera, target),
            interpreter = new MotionInterpreter();
          const hand = {
            position: point,
            radius: 0.025,
            confidence: 0.95,
            activity: 0.8,
          };
          interpreter.update(
            {
              presence: [],
              motion: [],
              hands: path === "hand" ? [{ ...hand, activity: 0 }] : [],
            },
            0,
            0.65,
            corners,
          );
          const observation = {
            presence: [],
            hands: path === "hand" ? [hand] : [],
            motion:
              path === "foreground"
                ? [
                    {
                      position: point,
                      radius: 0.04,
                      confidence: 0.95,
                      strength: 0.8,
                    },
                  ]
                : [],
          };
          const mapped = mapCameraFrame(
            interpreter.update(observation, 100, 0.65, corners),
            profile,
          );
          const inside =
            target.x >= 0 && target.x <= 1 && target.y >= 0 && target.y <= 1;
          expect(mapped.impulses).toHaveLength(inside ? 1 : 0);
          if (inside) {
            expect(mapped.impulses[0].position.x).toBeCloseTo(target.x, 7);
            expect(mapped.impulses[0].position.y).toBeCloseTo(target.y, 7);
          }
        }
      });
});
