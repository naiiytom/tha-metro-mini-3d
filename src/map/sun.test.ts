import { describe, expect, it } from "vitest";
import { skyPalette, sunDirection } from "./sun";

/** Bangkok local time -> epoch ms (UTC+7 fixed, no DST). */
const bkk = (y: number, m: number, d: number, h: number, min = 0) =>
  Date.UTC(y, m - 1, d, h - 7, min);

describe("sunDirection", () => {
  it("puts the sun near-overhead at Bangkok noon on the March equinox", () => {
    // Latitude 13.75°N, declination ~0 → zenith angle ~13.75°, elevation ~76°.
    const { elevationDeg } = sunDirection(bkk(2026, 3, 20, 12));
    expect(elevationDeg).toBeGreaterThan(70);
    expect(elevationDeg).toBeLessThan(90);
  });

  it("puts the sun below the horizon at midnight", () => {
    expect(sunDirection(bkk(2026, 3, 20, 0)).elevationDeg).toBeLessThan(-30);
  });

  it("has the sun low and rising shortly after Bangkok sunrise (~06:20)", () => {
    const { elevationDeg } = sunDirection(bkk(2026, 3, 20, 7));
    expect(elevationDeg).toBeGreaterThan(0);
    expect(elevationDeg).toBeLessThan(25);
  });

  it("puts the morning sun in the east and the afternoon sun in the west", () => {
    expect(sunDirection(bkk(2026, 3, 20, 8)).east).toBeGreaterThan(0);
    expect(sunDirection(bkk(2026, 3, 20, 16)).east).toBeLessThan(0);
  });

  it("returns a unit vector", () => {
    const { east, north, up } = sunDirection(bkk(2026, 6, 21, 14));
    expect(Math.hypot(east, north, up)).toBeCloseTo(1, 6);
  });
});

describe("skyPalette", () => {
  it("goes dim and cool at night", () => {
    const night = skyPalette(-20);
    const noon = skyPalette(80);
    expect(night.sunIntensity).toBeLessThan(noon.sunIntensity);
    expect(night.ambientIntensity).toBeLessThan(noon.ambientIntensity);
  });

  it("never goes fully black — the network must stay legible at 03:00", () => {
    expect(skyPalette(-40).ambientIntensity).toBeGreaterThan(0.2);
  });

  it("warms the light near the horizon", () => {
    // Golden hour: more red than blue in the sun colour.
    const c = skyPalette(3).sun;
    expect((c >> 16) & 0xff).toBeGreaterThan(c & 0xff);
  });

  it("keeps the deep-night lighting floor bright enough for the network to read against a dark basemap", () => {
    // Regression for the reported "night theme makes all the lines
    // invisible" defect: the previous floors (sunIntensity 0.15,
    // ambientIntensity 0.55) left MeshLambertMaterial track/station/vehicle
    // colours reading as near-black once multiplied by dark line colours
    // (e.g. Blue's #1964B7). Both floors must stay strictly below noon's
    // values (the "goes dim and cool at night" test above already pins
    // that), but high enough to actually light the network.
    const night = skyPalette(-40);
    const noon = skyPalette(80);
    expect(night.ambientIntensity).toBeGreaterThanOrEqual(1.2);
    expect(night.ambientIntensity).toBeLessThan(noon.ambientIntensity);
    expect(night.sunIntensity).toBeGreaterThanOrEqual(0.8);
    expect(night.sunIntensity).toBeLessThan(noon.sunIntensity);
  });
});
