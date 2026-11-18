import { describe, expect, it } from "vitest";
import { setCanvasSize } from "../../config";
import { Koi, SwimState } from "../../koi";
import { School } from "../../school";
import { sampleTrail, advanceTrail, swimmingCenter } from "./swim-motion";

function cruisingSchool() {
  setCanvasSize(4000, 3000);
  const school = new School();
  school.setCount(1);
  const f = school.fish[0];
  f.position = { x: 2000, y: 1500 };
  f.heading = 0;
  f.angularVelocity = 0;
  f.bodyLength = 80;
  f.cruiseSpeed = 30;
  f.maximumSpeed = 50;
  f.speed = 30;
  f.state = SwimState.Glide;
  f.stateAge = 0;
  f.stateDuration = 100;
  f.resetTrail();
  return school;
}
describe("lifelike swimming motion", () => {
  it("body follows travelled path rather than rotating instantly with the head", () => {
    const f = new Koi();
    f.position = { x: 200, y: 100 };
    f.heading = 0;
    f.bodyLength = 80;
    f.tailEffort = 0;
    f.resetTrail();
    const before = sampleTrail(f, 50),
      bodyBefore = swimmingCenter(f, 0.6);
    f.heading = Math.PI / 2;
    expect(sampleTrail(f, 50)).toEqual(before);
    expect(swimmingCenter(f, 0.6)).toEqual(bodyBefore);
  });
  it("samples curved travel by physical distance without folding or jumping", () => {
    const f = new Koi();
    f.position = { x: 0, y: 0 };
    f.heading = 0;
    f.bodyLength = 80;
    f.resetTrail();
    for (let step = 1; step < 200; step++) {
      const a = step / 180;
      f.position = { x: 180 * Math.sin(a), y: 180 * (1 - Math.cos(a)) };
      f.heading = a;
      advanceTrail(f);
    }
    let previous = sampleTrail(f, 0);
    for (let distance = 2; distance < 100; distance += 2) {
      const point = sampleTrail(f, distance);
      expect(
        Math.hypot(point.x - previous.x, point.y - previous.y),
      ).toBeCloseTo(2, 1);
      previous = point;
    }
  });
  it("keeps a broad speed-dependent turning radius and forward travel", () => {
    const school = cruisingSchool(),
      f = school.fish[0];
    for (let step = 0; step < 900; step++) {
      school.update(1 / 60, step / 60);
      expect(Math.abs(f.angularVelocity)).toBeLessThanOrEqual(
        (f.speed / (f.bodyLength * 1.45)) * 1.03 + 0.001,
      );
      expect(
        f.velocity.x * Math.cos(f.heading) + f.velocity.y * Math.sin(f.heading),
      ).toBeCloseTo(f.speed, 7);
    }
  });
  it("does not stop or spin in place during a minute of passive play", () => {
    const school = cruisingSchool(),
      f = school.fish[0];
    f.stateDuration = 0.5;
    for (let step = 0; step < 3600; step++) {
      school.update(1 / 60, step / 60);
      expect(f.speed / f.cruiseSpeed).toBeGreaterThan(0.3);
    }
  });
  it("tail stroke frequency follows actual speed", () => {
    const slow = cruisingSchool(),
      fast = cruisingSchool();
    slow.fish[0].cruiseSpeed = slow.fish[0].speed = 10;
    fast.fish[0].cruiseSpeed = fast.fish[0].speed = 35;
    slow.fish[0].swimPhase = fast.fish[0].swimPhase = 0;
    for (let step = 0; step < 180; step++) {
      slow.update(1 / 60, step / 60);
      fast.update(1 / 60, step / 60);
    }
    expect(fast.fish[0].swimPhase).toBeGreaterThan(slow.fish[0].swimPhase + 5);
  });
});
