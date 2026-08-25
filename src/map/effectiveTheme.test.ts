import { describe, expect, it } from "vitest";
import { effectiveTheme } from "./effectiveTheme";

describe("effectiveTheme", () => {
  it("pins light regardless of the clock", () => {
    expect(effectiveTheme("light", -30)).toBe("light");
    expect(effectiveTheme("light", 60)).toBe("light");
  });

  it("pins dark regardless of the clock", () => {
    expect(effectiveTheme("dark", 60)).toBe("dark");
    expect(effectiveTheme("dark", -30)).toBe("dark");
  });

  it("follows the clock in auto", () => {
    expect(effectiveTheme("auto", 60)).toBe("light");   // high noon
    expect(effectiveTheme("auto", -30)).toBe("dark");   // deep night
  });

  it("crosses over once night has more than half taken hold", () => {
    // nightFactor is monotonic non-increasing in elevation, so the crossover
    // is a single point; assert the ORDER rather than a hand-picked degree.
    expect(effectiveTheme("auto", 3)).toBe("light");    // DAY_ELEVATION_DEG
    expect(effectiveTheme("auto", -8)).toBe("dark");    // NIGHT_ELEVATION_DEG
  });
});
