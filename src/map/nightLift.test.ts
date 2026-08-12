import { describe, expect, test } from "vitest";
import network from "../data/network.json";
import { skyPalette, sunDirection } from "./sun";
import {
  CONTRAST_REFERENCE,
  MIN_CONTRAST,
  SHADING_SCALE,
  contrastRatio,
  nightLift,
  predictRendered,
  relativeLuminance,
} from "./nightLift";

/** Bangkok local noon and 02:00 as UTC epoch ms (UTC+7, no DST). */
const NOON = Date.UTC(2026, 7, 15, 5, 0, 0);
const DEEP_NIGHT = Date.UTC(2026, 7, 14, 19, 0, 0);

function paletteAt(epochMs: number) {
  const dir = sunDirection(epochMs);
  return { palette: skyPalette(dir.elevationDeg), ndotl: Math.max(dir.up, 0.05) };
}

describe("relative luminance", () => {
  test("matches the WCAG reference values", () => {
    expect(relativeLuminance(0xffffff)).toBeCloseTo(1, 5);
    expect(relativeLuminance(0x000000)).toBeCloseTo(0, 5);
    expect(relativeLuminance(0x1c222c)).toBeCloseTo(0.0157, 3);
  });

  test("contrast is symmetric and bounded by 21:1", () => {
    expect(contrastRatio(0xffffff, 0x000000)).toBeCloseTo(21, 2);
    expect(contrastRatio(0x000000, 0xffffff)).toBeCloseTo(21, 2);
  });
});

describe("night lift", () => {
  test("is inert for a colour that already clears the floor on its own", () => {
    // Yellow at noon needs nothing. Deliberately NOT asserted for a dark
    // livery at noon: the deleted MVP 7 harness measured real noon failures
    // for Sukhumvit, Yellow, Gold, Red Light and Blue, so the lift is driven
    // by whether the floor is met, not by the time of day.
    const { palette, ndotl } = paletteAt(NOON);
    expect(nightLift(0xfbc02d, palette, ndotl).intensity).toBe(0);
  });

  test("preserves hue exactly while the material's own colour is enough", () => {
    // Yellow clears the floor without any whitening (stage 0 or 1 only).
    const { palette, ndotl } = paletteAt(DEEP_NIGHT);
    expect(nightLift(0xfbc02d, palette, ndotl).emissive).toBe(0xfbc02d);
  });

  test("whitens only a colour its own hue cannot save", () => {
    // MRT Purple cannot clear the floor at full emissive with its own hue.
    const { palette, ndotl } = paletteAt(DEEP_NIGHT);
    const lift = nightLift(0x660066, palette, ndotl);
    expect(lift.intensity).toBe(1);
    expect(lift.emissive).not.toBe(0x660066);
  });

  test("EVERY registry line clears WCAG 3:1 at noon and at 02:00", () => {
    const failures: string[] = [];
    for (const when of [NOON, DEEP_NIGHT]) {
      const { palette, ndotl } = paletteAt(when);
      for (const line of network.lines) {
        const albedo = parseInt(line.color.slice(1), 16);
        const rendered = predictRendered(albedo, palette, ndotl, nightLift(albedo, palette, ndotl));
        const ratio = contrastRatio(rendered, CONTRAST_REFERENCE);
        if (ratio < MIN_CONTRAST) {
          failures.push(`${line.key} @ ${when === NOON ? "noon" : "02:00"}: ${ratio.toFixed(2)}:1`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  test("the floor is the real WCAG value, never weakened to pass", () => {
    expect(MIN_CONTRAST).toBe(3);
  });

  // A bare "every line clears 3:1" assertion above passes trivially: stage 2
  // always succeeds by construction (it blends toward white, and white
  // clears any dark backdrop). The real regression signal is HOW MUCH
  // whitening each line needs, since whitening is what costs colour
  // identity. This pins exactly which lines ever leave stage 1 (own hue,
  // `emissive === albedo`) for stage 2 (`emissive` changed).
  //
  // NOTE on the task brief's stated split: the brief says "12 of 14 registry
  // lines clear the floor as their own colour; only MRT Blue and MRT Purple /
  // Purple Phase 2 need stage 2." Measured against this implementation, the
  // real split is 11/3, not 12/2 — MRT Purple and MRT Purple Phase 2
  // (`purple`, `purple-ext`) are two distinct registry entries sharing one
  // colour (`#660066`), so "Blue and Purple/Purple Phase 2" is three
  // registry rows, not two, leaving 11 (not 12) lines that never whiten:
  // sukhumvit, silom, arl, pink, yellow, gold, red-dark, red-light, orange,
  // pink-spur, apm. This test pins the measured 11/3 behaviour rather than
  // the brief's stated 12/2 — see the Task 6 report for the full computed
  // table and the discrepancy flagged for human adjudication.
  //
  // UPDATE 2026-08-15 (Task 8, SHADING_SCALE set to the derived 1/π ≈
  // 0.31831, corroborated by real-pixel measurement — see nightLift.ts's own
  // doc comment): the SET of lines that ever need stage 2 did NOT change —
  // still exactly blue/purple/purple-ext, 11/3 as above. What DID change is
  // WHEN: with the real renderer running ~1/π ≈ 3.1x darker than the
  // uncalibrated model assumed, MRT Purple and Purple Phase 2's `#660066` no
  // longer clears the floor at noon either (ratio lands right at 3.01:1,
  // i.e. it now needs full stage-2 whitening at BOTH times, not just at
  // night) — the old "none needs it at noon" premise is false for those two
  // lines under the corrected model. MRT Blue is unaffected: its noon ratio
  // (3.09:1) still clears on its own (stage 0, no lift at all) even at the
  // darker scale, and it still only needs stage 2 at night. See
  // tools/calibrate-night-lift.mjs and the Task 8 report for the full
  // per-line noon/night table.
  test("only MRT Blue and MRT Purple / Purple Phase 2 ever need stage-2 whitening", () => {
    // Per-line expectation of whether stage 2 (whitening) is needed at each
    // time, now that noon and night no longer behave uniformly across the
    // three stage-2 lines (see the UPDATE note above).
    const stage2Expectation: Record<string, { noon: boolean; night: boolean }> = {
      blue: { noon: false, night: true },
      purple: { noon: true, night: true },
      "purple-ext": { noon: true, night: true },
    };
    const unexpectedlyWhitened: string[] = [];
    const mismatches: string[] = [];

    for (const line of network.lines) {
      const albedo = parseInt(line.color.slice(1), 16);
      const whitenedAtNoon = nightLift(albedo, paletteAt(NOON).palette, paletteAt(NOON).ndotl).emissive !== albedo;
      const { palette, ndotl } = paletteAt(DEEP_NIGHT);
      const whitenedAtNight = nightLift(albedo, palette, ndotl).emissive !== albedo;

      const expected = stage2Expectation[line.key];
      if (expected) {
        if (whitenedAtNoon !== expected.noon || whitenedAtNight !== expected.night) {
          mismatches.push(
            `${line.key}: expected noon=${expected.noon}/night=${expected.night}, got noon=${whitenedAtNoon}/night=${whitenedAtNight}`,
          );
        }
      } else if (whitenedAtNoon || whitenedAtNight) {
        unexpectedlyWhitened.push(line.key);
      }
    }

    expect(mismatches).toEqual([]);
    expect(unexpectedlyWhitened).toEqual([]);
  });

  test("white needs far less lift than a dark livery like MRT Blue, at the same moment", () => {
    // NOT a regression guard on the vertexColors wiring — this calls
    // `nightLift` directly with hardcoded hex values, so it never touches
    // `VehicleManager`, `buildMarkerPair`, or `ThreeLayer`'s `materialAlbedo`
    // lookup; deleting either stamp (or reverting ThreeLayer to always read
    // `m.color`) would leave this test green. What it actually pins is
    // `nightLift`'s own standalone numeric behaviour at one fixed moment:
    // white's lift is real but small, Blue's is much larger. The actual
    // wiring regression guard — "does a vehicle/disc material really report
    // its route's colour, not white" — lives in `materialAlbedo.test.ts`,
    // built against the real `VehicleManager`/`buildStationMarkers` output.
    //
    // NOTE on the task brief's stated assertion: the brief asserts
    // `nightLift(0xffffff, ...).intensity` is exactly 0 at deep night.
    // Measured against this implementation it is not (0.087) — DEEP_NIGHT's
    // ambient/sun palette is itself a dim navy colour (`sun.ts`'s NIGHT_SUN /
    // NIGHT_AMBIENT floors), so even a pure-white material's unlifted render
    // (albedo * light) falls just short of the 3:1 floor and needs a small
    // lift of its own. That is correct, physically-based model behaviour
    // (there is no special case for white in `nightLift`) — the same class
    // of brief-vs-measured gap the "11/3 not 12/2" note above already
    // documents.
    //
    // UPDATE 2026-08-15 (Task 8, SHADING_SCALE set to the derived 1/π ≈
    // 0.31831 — see nightLift.ts's own doc comment): the darker corrected
    // scale means white's own deep-night intensity rose from 0.087 to
    // ~0.128 (still small, still far below Blue's, but no longer under the
    // old 0.1 bound) — a real, expected consequence of the whole model
    // getting darker, not a threshold picked to make this pass.
    const { palette, ndotl } = paletteAt(DEEP_NIGHT);
    const whiteLift = nightLift(0xffffff, palette, ndotl);
    const blueLift = nightLift(0x1964b7, palette, ndotl);
    expect(whiteLift.intensity).toBeLessThan(0.2);
    expect(blueLift.intensity).toBeGreaterThan(whiteLift.intensity);
  });

  test("the shading scale is the derived value, not a fit", () => {
    // Three's MeshLambertMaterial bakes the Lambertian BRDF's 1/π
    // (RECIPROCAL_PI) normalization in unconditionally — see nightLift.ts's
    // SHADING_SCALE doc comment for the exact shader-source citations
    // (ShaderChunk/common.glsl.js's BRDF_Lambert, applied in both
    // RE_Direct_Lambert and RE_IndirectDiffuse_Lambert by
    // lights_lambert_pars_fragment.glsl.js). Corroborated, not just derived:
    // tools/calibrate-night-lift.mjs measured real rendered pixels on
    // 2026-08-15 (headless Edge, SwiftShader, Three r185
    // MeshLambertMaterial) and found 13 informative channel samples across 6
    // colour/time cases implying mean 0.3271, stdev 0.0108 — only 0.81σ from
    // 1/π, with the noon-only subset (least affected by 8-bit rounding)
    // landing at 0.315-0.318, bracketing 1/π almost exactly. Re-run that
    // script before changing this.
    expect(SHADING_SCALE).toBe(1 / Math.PI);
  });
});
