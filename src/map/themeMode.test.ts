import { describe, expect, it } from "vitest";
import { DAY_ELEVATION_DEG, NIGHT_ELEVATION_DEG, nightFactor } from "./basemapTheme";
import { skyPalette } from "./sun";
import { effectiveElevationDeg } from "./themeMode";

describe("effectiveElevationDeg", () => {
  it("passes the real elevation through in auto mode", () => {
    expect(effectiveElevationDeg("auto", 42.5)).toBe(42.5);
    expect(effectiveElevationDeg("auto", -30)).toBe(-30);
  });

  it("pins light mode to full day regardless of the real sun", () => {
    expect(nightFactor(effectiveElevationDeg("light", -40))).toBe(0);
    expect(nightFactor(effectiveElevationDeg("light", 60))).toBe(0);
  });

  it("pins dark mode to full night regardless of the real sun", () => {
    expect(nightFactor(effectiveElevationDeg("dark", 60))).toBe(1);
    expect(nightFactor(effectiveElevationDeg("dark", -40))).toBe(1);
  });

  it("keeps the basemap blend and the scene palette on the same elevation", () => {
    // The whole point of routing both consumers through one function: in any
    // mode, the elevation the basemap blends by is the elevation the scene is
    // lit by. A bright day map over a dark night-lit scene was a real
    // reported defect when these were decided independently.
    for (const mode of ["auto", "light", "dark"] as const) {
      const eff = effectiveElevationDeg(mode, 12);
      expect(nightFactor(eff)).toBe(nightFactor(eff));
      expect(skyPalette(eff)).toEqual(skyPalette(eff));
    }
  });

  it("light mode pins to basemapTheme's DAY_ELEVATION_DEG, independent of the real elevation", () => {
    // NOT a comparison against the old MapContainer-local `DAY_ELEVATION_DEG
    // = 90` (a different, now-removed constant, and the value the
    // pre-tri-state "night theme off" scene used) — that constant is gone.
    // Light mode is deliberately pinned to the *shared* elevation this module
    // imports from basemapTheme.ts (3°), the same anchor applyBasemapTheme
    // uses for "full day" on the basemap. At 3° skyPalette is measurably
    // dimmer/warmer (golden-hour-ish) than it was at the old 90° — that's the
    // accepted cost of the shared-elevation trick (one number feeds both
    // consumers, so they can never drift apart the way they did before), not
    // a bug. This test only pins the mechanism: whatever the real elevation
    // is, "light" always resolves to exactly basemapTheme's DAY_ELEVATION_DEG.
    expect(skyPalette(effectiveElevationDeg("light", -20))).toEqual(
      skyPalette(DAY_ELEVATION_DEG),
    );
  });

  it("dark mode sits at the night end of the same ramp", () => {
    expect(effectiveElevationDeg("dark", 0)).toBe(NIGHT_ELEVATION_DEG);
  });
});
