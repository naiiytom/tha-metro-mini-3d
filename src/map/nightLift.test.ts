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
  return {
    palette: skyPalette(dir.elevationDeg),
    ndotl: Math.max(dir.up, 0.05),
    elevationDeg: dir.elevationDeg,
  };
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
  test("is inert during full day, unconditionally — not just for a colour that clears on its own", () => {
    // CONTRAST_REFERENCE is the NIGHT basemap's building colour — see its own
    // doc comment in nightLift.ts. It has no relevance to what's on screen at
    // noon, where the real backdrop is the light day basemap. Found in code
    // review 2026-08-15: before this gate existed, MRT Purple's #660066 was
    // being checked against CONTRAST_REFERENCE at noon too (reporting a
    // passing 6.9:1) and force-whitened toward #ac3aac to satisfy it, while
    // the real noon contrast against the actual Liberty day basemap
    // (buildings ≈ #e0dfdb) was ~1.09:1 — an active daytime regression this
    // gate exists specifically to close. Yellow (which genuinely never needs
    // help) is intentionally NOT the interesting case here; Purple is, since
    // it's the line the old code was wrongly "fixing" at noon.
    const { palette, ndotl, elevationDeg } = paletteAt(NOON);
    expect(nightLift(0x660066, palette, ndotl, elevationDeg)).toEqual({
      emissive: 0x660066,
      intensity: 0,
    });
  });

  test("preserves hue exactly while the material's own colour is enough", () => {
    // Yellow clears the floor without any whitening (stage 0 or 1 only).
    const { palette, ndotl, elevationDeg } = paletteAt(DEEP_NIGHT);
    expect(nightLift(0xfbc02d, palette, ndotl, elevationDeg).emissive).toBe(0xfbc02d);
  });

  test("whitens only a colour its own hue cannot save", () => {
    // MRT Purple cannot clear the floor at full emissive with its own hue.
    const { palette, ndotl, elevationDeg } = paletteAt(DEEP_NIGHT);
    const lift = nightLift(0x660066, palette, ndotl, elevationDeg);
    expect(lift.intensity).toBe(1);
    expect(lift.emissive).not.toBe(0x660066);
  });

  test("no registry line takes ANY lift at noon — the day gate applies uniformly", () => {
    // The meaningful noon invariant post-fix: CONTRAST_REFERENCE isn't on
    // screen at noon, so nightLift() must never compute against it there,
    // for ANY line — not "every line happens to clear it," which was the
    // old (wrong) noon assertion this test replaces.
    const { palette, ndotl, elevationDeg } = paletteAt(NOON);
    const stillLifted = network.lines
      .map((l) => l.key)
      .filter((key) => {
        const albedo = parseInt(network.lines.find((l) => l.key === key)!.color.slice(1), 16);
        return nightLift(albedo, palette, ndotl, elevationDeg).intensity !== 0;
      });
    expect(stillLifted).toEqual([]);
  });

  test("EVERY registry line clears WCAG 3:1 at 02:00", () => {
    // Deep night, unlike noon, IS a case where CONTRAST_REFERENCE is a valid
    // proxy for the real on-screen backdrop (the basemap has fully blended
    // toward NIGHT_THEME by then) — this is the one time-of-day where "does
    // it clear the floor" is still the right question to ask.
    const { palette, ndotl, elevationDeg } = paletteAt(DEEP_NIGHT);
    const failures: string[] = [];
    for (const line of network.lines) {
      const albedo = parseInt(line.color.slice(1), 16);
      const rendered = predictRendered(albedo, palette, ndotl, nightLift(albedo, palette, ndotl, elevationDeg));
      const ratio = contrastRatio(rendered, CONTRAST_REFERENCE);
      if (ratio < MIN_CONTRAST) {
        failures.push(`${line.key}: ${ratio.toFixed(2)}:1`);
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
  // longer cleared the floor AGAINST CONTRAST_REFERENCE at noon either
  // (ratio landed right at 3.01:1). MRT Blue was unaffected: its noon ratio
  // (3.09:1) still cleared on its own even at the darker scale.
  //
  // UPDATE 2026-08-15 (code review, day gate added): the paragraph above
  // described checking noon against CONTRAST_REFERENCE at all — which turned
  // out to be the actual bug (see the day-gate tests above). Purple's "noon
  // ratio 3.01:1" was never a real number: CONTRAST_REFERENCE is the NIGHT
  // basemap colour, never on screen at noon, and checking against it there
  // was actively forcing Purple/Purple-ext into stage-2 whitening at noon in
  // the real running app to satisfy a backdrop nobody sees at that hour. Now
  // that `nightLift()` returns NO_LIFT unconditionally whenever
  // `nightFactor(elevationDeg) === 0`, EVERY line's noon expectation is
  // `false` — not just the 11 that would have cleared anyway. Night
  // expectations are unchanged; night is the one time CONTRAST_REFERENCE
  // genuinely is the on-screen backdrop.
  test("only MRT Blue and MRT Purple / Purple Phase 2 ever need stage-2 whitening", () => {
    // Per-line expectation of whether stage 2 (whitening) is needed at each
    // time — noon is uniformly false for every line now (see the UPDATE
    // note above), so this test's remaining job is pinning that ONLY these
    // three lines ever whiten, and only at night.
    const stage2Expectation: Record<string, { noon: boolean; night: boolean }> = {
      blue: { noon: false, night: true },
      purple: { noon: false, night: true },
      "purple-ext": { noon: false, night: true },
    };
    const unexpectedlyWhitened: string[] = [];
    const mismatches: string[] = [];

    for (const line of network.lines) {
      const albedo = parseInt(line.color.slice(1), 16);
      const noon = paletteAt(NOON);
      const whitenedAtNoon = nightLift(albedo, noon.palette, noon.ndotl, noon.elevationDeg).emissive !== albedo;
      const { palette, ndotl, elevationDeg } = paletteAt(DEEP_NIGHT);
      const whitenedAtNight = nightLift(albedo, palette, ndotl, elevationDeg).emissive !== albedo;

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
    const { palette, ndotl, elevationDeg } = paletteAt(DEEP_NIGHT);
    const whiteLift = nightLift(0xffffff, palette, ndotl, elevationDeg);
    const blueLift = nightLift(0x1964b7, palette, ndotl, elevationDeg);
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
