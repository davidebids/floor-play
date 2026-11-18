import { describe, expect, it } from "vitest";
import { setCanvasSize } from "../../config";
import { School } from "../../school";
import { SwimState } from "../../koi";
import { RippleSystem } from "../../ripple-system";

function makeSchool() {
  setCanvasSize(960, 640);
  const s = new School();
  s.setCount(2);
  const points = [
    { x: 480, y: 320 },
    { x: 200, y: 170 },
  ];
  s.fish.slice(0, 2).forEach((f, i) => {
    f.position = { ...points[i] };
    f.heading = 0;
    f.angularVelocity = 0;
    f.state = SwimState.Glide;
    f.stateAge = 0;
    f.stateDuration = 100;
    f.speed = 20;
    f.cruiseSpeed = 20;
    f.maximumSpeed = 36;
  });
  return s;
}
describe("localized pond response", () => {
  it("turns nearby fish away without scattering a distant fish", () => {
    const baseline = makeSchool(),
      reactive = makeSchool();
    reactive.avoidanceRegions = [{ x: 540, y: 320, radius: 100, strength: 1 }];
    for (let i = 0; i < 120; i++) {
      baseline.update(1 / 60, i / 60);
      reactive.update(1 / 60, i / 60);
    }
    expect(
      Math.abs(reactive.fish[0].heading - baseline.fish[0].heading),
    ).toBeGreaterThan(0.5);
    expect(reactive.fish[1].position.x).toBeCloseTo(
      baseline.fish[1].position.x,
      7,
    );
    expect(reactive.fish[1].heading).toBeCloseTo(baseline.fish[1].heading, 7);
  });
  it("scales impulse ripples while bounding encoded strength", () => {
    const quiet = new RippleSystem(),
      loud = new RippleSystem();
    quiet.trigger("touch", { x: 300, y: 200 }, 0.2);
    loud.trigger("touch", { x: 300, y: 200 }, 5);
    const a = quiet.instances.find((r) => r.alive)!,
      b = loud.instances.find((r) => r.alive)!;
    expect(b.strength).toBeGreaterThan(a.strength);
    expect(b.strength).toBeLessThan(2);
    expect(b.center).toEqual({ x: 300, y: 200 });
  });
});
