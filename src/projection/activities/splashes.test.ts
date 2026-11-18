import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { dropletTrajectory, SplashPass, SPLASH_CAPACITY } from "./splashes";

const origins = (splash: SplashPass) =>
  (
    (splash.group.children[1] as THREE.Mesh).geometry.getAttribute(
      "origin",
    ) as THREE.InstancedBufferAttribute
  ).array;

describe("pond splash water motion", () => {
  it("rises under gravity then returns to the expanding surface footprint", () => {
    const p = { x: 480, y: 320, dx: 50, dy: 20, vz: 92, flight: 0.4 };
    const launch = dropletTrajectory(p, 0),
      apex = dropletTrajectory(p, 0.2),
      landing = dropletTrajectory(p, 0.4),
      after = dropletTrajectory(p, 3);
    expect(launch.height).toBe(0);
    expect(apex.height).toBeGreaterThan(landing.height);
    expect(apex.y).toBeLessThan(launch.y);
    expect(landing.height).toBeCloseTo(0);
    expect(landing.x).toBeCloseTo(500);
    expect(landing.y).toBeCloseTo(328);
    expect(after).toEqual(landing);
  });
  it("keeps the same ballistic paths at 30 and 120 frames per second", () => {
    const slow = new SplashPass(),
      fast = new SplashPass();
    slow.update(0);
    fast.update(0);
    slow.spawn(480, 320, 0.8);
    fast.spawn(480, 320, 0.8);
    for (let i = 1; i <= 9; i++) slow.update(i / 30);
    for (let i = 1; i <= 36; i++) fast.update(i / 120);
    expect(slow.diagnostics()).toEqual(fast.diagnostics());
    const a = origins(slow),
      b = origins(fast);
    for (let i = 0; i < a.length; i++) expect(a[i]).toBeCloseTo(b[i], 5);
    slow.dispose();
    fast.dispose();
  });
  it("gives a stronger impact more airborne water and a larger footprint", () => {
    const small = new SplashPass(),
      large = new SplashPass();
    for (const effect of [small, large]) effect.update(0);
    small.spawn(480, 320, 0.15);
    large.spawn(480, 320, 1);
    expect(large.diagnostics().droplets).toBeGreaterThan(
      small.diagnostics().droplets,
    );
    small.update(0.15);
    large.update(0.15);
    const extent = (effect: SplashPass) => {
      const data = origins(effect);
      let greatest = 0;
      for (let i = 0; i < data.length; i += 4)
        if (data[i + 2] > 0)
          greatest = Math.max(
            greatest,
            Math.hypot(data[i] - 480, data[i + 1] - 320),
          );
      return greatest;
    };
    expect(extent(large)).toBeGreaterThan(extent(small) * 1.4);
    small.dispose();
    large.dispose();
  });
  it("bounds repeated impacts and clears particles after a long render gap", () => {
    const splash = new SplashPass();
    splash.update(0);
    const resources = splash.group.children.map(
      (mesh) => (mesh as THREE.Mesh).geometry,
    );
    for (let i = 0; i < 100; i++) splash.spawn(480, 320, 1);
    expect(splash.diagnostics()).toEqual({
      impacts: SPLASH_CAPACITY.impacts,
      droplets: SPLASH_CAPACITY.droplets,
      capacity: SPLASH_CAPACITY,
    });
    expect(splash.group.children).toHaveLength(2);
    splash.update(4);
    expect(splash.diagnostics().droplets).toBe(0);
    expect(splash.diagnostics().impacts).toBe(0);
    expect(splash.group.visible).toBe(false);
    expect(
      splash.group.children.map((mesh) => (mesh as THREE.Mesh).geometry),
    ).toEqual(resources);
    splash.dispose();
  });
  it("disposes both pooled meshes once and rejects subsequent spawns", () => {
    const splash = new SplashPass();
    const released = vi.fn();
    for (const object of splash.group.children) {
      const mesh = object as THREE.Mesh;
      mesh.geometry.addEventListener("dispose", released);
      (mesh.material as THREE.Material).addEventListener("dispose", released);
    }
    splash.spawn(480, 320, 1);
    splash.dispose();
    splash.dispose();
    splash.spawn(480, 320, 1);
    splash.update(2);
    expect(released).toHaveBeenCalledTimes(4);
    expect(splash.diagnostics().impacts).toBe(0);
    expect(splash.diagnostics().droplets).toBe(0);
    expect(splash.group.children).toHaveLength(0);
  });
});
