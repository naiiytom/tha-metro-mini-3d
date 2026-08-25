import { describe, expect, it } from "vitest";
import { windowGlowOpacity, WINDOW_GLOW_MAX_OPACITY } from "./windowGlow";
import { DAY_ELEVATION_DEG, NIGHT_ELEVATION_DEG } from "./basemapTheme";

describe("windowGlowOpacity", () => {
  it("is fully invisible at or above the day threshold", () => {
    expect(windowGlowOpacity(DAY_ELEVATION_DEG)).toBe(0);
    expect(windowGlowOpacity(DAY_ELEVATION_DEG + 10)).toBe(0);
  });

  it("reaches its max at or below the night threshold", () => {
    expect(windowGlowOpacity(NIGHT_ELEVATION_DEG)).toBe(WINDOW_GLOW_MAX_OPACITY);
    expect(windowGlowOpacity(NIGHT_ELEVATION_DEG - 10)).toBe(WINDOW_GLOW_MAX_OPACITY);
  });

  it("ramps continuously and monotonically between the two thresholds", () => {
    const samples = [3, 1, -1, -3, -5, -8].map(windowGlowOpacity);
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i]).toBeGreaterThanOrEqual(samples[i - 1]);
    }
    expect(samples[0]).toBe(0);
    expect(samples[samples.length - 1]).toBe(WINDOW_GLOW_MAX_OPACITY);
    // Strictly between the endpoints somewhere in the middle of the ramp —
    // not a step function.
    expect(samples[2]).toBeGreaterThan(0);
    expect(samples[2]).toBeLessThan(WINDOW_GLOW_MAX_OPACITY);
  });

  it("never exceeds WINDOW_GLOW_MAX_OPACITY regardless of how far past night the elevation goes", () => {
    expect(windowGlowOpacity(-90)).toBeLessThanOrEqual(WINDOW_GLOW_MAX_OPACITY);
  });
});
