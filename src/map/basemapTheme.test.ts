import { describe, expect, it } from "vitest";
import { NIGHT_THEME, mixColor, nightFactor, parseColor } from "./basemapTheme";

/** Relative luminance (simple perceptual weighting) from a "#rrggbb" string. */
function luminance(hex: string): number {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) throw new Error(`not a #rrggbb colour: ${hex}`);
  const r = parseInt(m[1], 16);
  const g = parseInt(m[2], 16);
  const b = parseInt(m[3], 16);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const HEX_RE = /^#[0-9a-f]{6}$/i;

describe("nightFactor", () => {
  it("is 0 (full day) when the sun is high", () => {
    expect(nightFactor(60)).toBe(0);
  });

  it("is 1 (full night) when the sun is well below the horizon", () => {
    expect(nightFactor(-20)).toBe(1);
  });

  it("is strictly between 0 and 1 through civil twilight", () => {
    const dusk = nightFactor(0);
    const laterDusk = nightFactor(-6);
    expect(dusk).toBeGreaterThan(0);
    expect(dusk).toBeLessThan(1);
    expect(laterDusk).toBeGreaterThan(0);
    expect(laterDusk).toBeLessThan(1);
  });

  it("is monotonic non-increasing as elevation rises", () => {
    const samples = [-30, -20, -10, -8, -6, -3, 0, 3, 6, 10, 30, 60, 89];
    for (let i = 1; i < samples.length; i++) {
      expect(nightFactor(samples[i])).toBeLessThanOrEqual(nightFactor(samples[i - 1]));
    }
  });

  it("is deterministic", () => {
    expect(nightFactor(-4)).toBe(nightFactor(-4));
  });
});

// `basemapTheme(elevationDeg)` (an elevation-dependent DAY->NIGHT blend) was
// removed as part of the Task 10b review fix — see the doc comment on
// `NIGHT_THEME` in basemapTheme.ts for why keeping it around was itself the
// bug. `NIGHT_THEME` is a fixed constant now; the elevation dependence lives
// entirely in `nightFactor`, and the only blend is
// `mixColor(original, NIGHT_THEME[role], nightFactor(elevationDeg))` in
// MapContainer.tsx (covered by the regression test below).
describe("NIGHT_THEME", () => {
  it("every colour is a valid #rrggbb string MapLibre will accept", () => {
    for (const value of Object.values(NIGHT_THEME)) {
      expect(value).toMatch(HEX_RE);
    }
  });

  it("stays legible — label text is not pitch black", () => {
    expect(luminance(NIGHT_THEME.labelText)).toBeGreaterThan(80);
  });

  it("reads as dark for every backdrop role", () => {
    // Absolute brightness ceilings a "night" colour should sit under, not a
    // comparison against a day palette — this module doesn't keep one.
    for (const role of ["background", "water", "land", "building", "road"] as const) {
      expect(luminance(NIGHT_THEME[role])).toBeLessThan(120);
    }
  });
});

// The real Liberty style's paint properties use hex, rgb()/rgba() and
// hsl()/hsla() flat colours (verified against the live style JSON), plus
// expressions/stop-functions which never reach parseColor as strings at
// all. mixColor must handle every flat form without throwing.
describe("parseColor", () => {
  it("parses 3- and 6-digit hex", () => {
    expect(parseColor("#fff")).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseColor("#f8f4f0")).toEqual({ r: 0xf8, g: 0xf4, b: 0xf0, a: 1 });
  });

  it("parses rgb() and rgba()", () => {
    expect(parseColor("rgba(255, 255, 255, 0.7)")).toEqual({ r: 255, g: 255, b: 255, a: 0.7 });
    expect(parseColor("rgb(176, 213, 154)")).toEqual({ r: 176, g: 213, b: 154, a: 1 });
  });

  it("parses hsl() and hsla()", () => {
    const c = parseColor("hsl(35, 8%, 85%)")!;
    // hsl(35, 8%, 85%) -> rgb(~219.81, ~217.26, ~213.69), independently
    // worked out from the standard HSL->RGB conversion.
    expect(c.r).toBeCloseTo(219.81, 1);
    expect(c.g).toBeCloseTo(217.26, 1);
    expect(c.b).toBeCloseTo(213.69, 1);
    expect(c.a).toBe(1);
  });

  it("returns null for anything it does not recognise", () => {
    expect(parseColor("papayawhip")).toBeNull();
    expect(parseColor("not-a-colour")).toBeNull();
  });
});

// Regression test for the double-application bug (Task 10b review finding).
// Before the fix, MapContainer.tsx composed
// `mixColor(original, basemapTheme(elevationDeg)[role], t)`, where
// `basemapTheme(elevationDeg)` was *itself* already a DAY->NIGHT blend by
// `t`. Composing the two applied `t` twice:
//   final(t) = (1-t)*original + t(1-t)*DAY[role] + t^2*NIGHT[role]
// which only agreed with a direct blend at t=0 and t=1 — at t=0.5 it was
// pulled toward a hardcoded generic DAY[role] reference that should never
// reach the map. (This is provable directly against the old code: with
// original="#3355ff", elevationDeg=-2.5 (t=0.5), the old composition
// produced "#486aca" versus "#2040a5" for a direct blend — the RED result
// recorded in the task-10b-report.md fix entry.)
//
// The fix deleted that intermediate day palette entirely — see the doc
// comment on `NIGHT_THEME` in basemapTheme.ts. The only blend that exists
// now is `mixColor(original, NIGHT_THEME[role], t)`, applying `t` exactly
// once. This test pins that shape: the result must equal an independently
// (not via mixColor again) computed direct blend from `original` to
// `NIGHT_THEME[role]`, for an `original` deliberately far from any
// plausible day-ish colour — the exact case that distinguished single from
// double application above.
describe("night theming composition (regression: t must be applied exactly once)", () => {
  it("blends directly from the original to the fixed NIGHT_THEME colour, with no intermediate day-reference step", () => {
    const original = "#3355ff";
    const t = 0.5;

    const applied = mixColor(original, NIGHT_THEME.water, t);

    // Independently computed component-by-component, not by calling
    // mixColor again, so this doesn't just restate the implementation
    // under test.
    const orig = parseColor(original)!;
    const night = parseColor(NIGHT_THEME.water)!;
    const direct = `#${[orig.r, orig.g, orig.b]
      .map((c, i) => Math.round(c + ([night.r, night.g, night.b][i] - c) * t))
      .map((v) => v.toString(16).padStart(2, "0"))
      .join("")}`;

    expect(applied).toBe(direct);
  });
});

describe("mixColor", () => {
  it("at t=0 returns exactly the original colour, preserving alpha", () => {
    expect(mixColor("rgba(255, 255, 255, 0.7)", "#0a1220", 0)).toBe("rgba(255, 255, 255, 0.7)");
  });

  it("at t=1 takes the target's hue but keeps the original's alpha", () => {
    expect(mixColor("rgba(255, 255, 255, 0.7)", "#0a1220", 1)).toBe("rgba(10, 18, 32, 0.7)");
  });

  it("never writes an opacity property — it stays a colour string throughout", () => {
    // No literal 'opacity' key anywhere in the output shape; alpha travels
    // only inside the colour string itself, same as the input did.
    const out = mixColor("#ffffff", "#0a1220", 0.5);
    expect(out).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("recomputing twice from the same original is stable (no compounding)", () => {
    const original = "#f8f4f0";
    const first = mixColor(original, "#0a1220", 0.5);
    const second = mixColor(original, "#0a1220", 0.5);
    expect(first).toBe(second);
  });
});
