import { describe, expect, test } from "vitest";
import network from "../data/network.json";
import type { LineGeometry } from "../types";
import { skyPalette, sunDirection } from "./sun";
import {
  CONTRAST_REFERENCE,
  MIN_CONTRAST,
  contrastRatio,
  nightLift,
  predictRendered,
} from "./nightLift";
import { detailColors, liveryColors, resolveStock } from "./rollingStock";

/** Bangkok local noon and 02:00 as UTC epoch ms (UTC+7, no DST) — the same
 *  two moments nightLift.test.ts pins the line-colour gate at. */
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

const lines = network.lines as unknown as LineGeometry[];

describe("rolling-stock contrast", () => {
  // Large-area roles — the shell and the identity band — are what a viewer
  // sees of a train AGAINST THE MAP, so they answer the same question the
  // line-colour gate in nightLift.test.ts already asks, and against the same
  // reference. MIN_CONTRAST is never weakened to make a livery pass; the
  // livery changes instead (design doc, decision 3).
  //
  // NIGHT ONLY — deliberately, not test.each(TIMES). CONTRAST_REFERENCE is
  // the NIGHT basemap's building colour (nightLift.ts's own doc comment) and
  // is never a valid backdrop at noon; nightLift.test.ts already found and
  // fixed exactly this mistake for line colours ("is inert during full day,
  // unconditionally", "no registry line takes ANY lift at noon" — both in
  // that file) and its own floor gate ("EVERY registry line clears WCAG 3:1
  // at 02:00") checks only night for the same reason, never noon. Measured
  // here, not assumed: running this test with test.each(TIMES) (matching an
  // earlier draft of this file, before this fix) reproduces the identical
  // symptom on the identical colour — MRT Purple / Purple Phase 2's own
  // route colour #660066, rendered unlifted at noon (nightLift's day gate
  // returns NO_LIFT whenever nightFactor(elevationDeg) === 0), lands at
  // 1.45:1 against CONTRAST_REFERENCE — not because purple is actually hard
  // to see at noon (the real day basemap is light; a dark purple train reads
  // fine against it), but because the reference colour itself is wrong for
  // that hour. This is the same class of "compare a real material against a
  // backdrop that isn't on screen yet" error CONTRAST_REFERENCE's own doc
  // comment names, at the identical colour it names as its precedent
  // (#660066). Scoping to night only is not a threshold change — it is
  // asking the question at the one hour where the answer is meaningful,
  // exactly matching the sibling gate's own established scope.
  //
  // READ THIS BEFORE CITING A NUMBER FROM THE GATE BELOW. Half of it is
  // tautological, which the two tests after it pin explicitly. `liveryColors`
  // returns [shellHex, bands[0].hex], and `bands[0]` is ROUTE_TINT on all 14
  // registry lines — so that half scores the ROUTE COLOUR under the lift
  // `nightLift` bisected FROM that same route colour to the minimum intensity
  // clearing MIN_CONTRAST. It can only ever come out at ~MIN_CONTRAST: measured
  // 3.000 (red-dark, gold) to 3.032 (apm), nothing above. That arm confirms the
  // lift is wired in; it says nothing about whether a livery was well chosen,
  // and it is NOT evidence about the rolling stock this PR added.
  //
  // The SHELL is the new information. It takes the route's lift but not the
  // route's hue, so it can genuinely fail — and its real margins are 3.081
  // (BTS Gold's champagne, the only non-white/silver shell in the network) to
  // 3.234 (purple-ext). Cite those, not 3.00. Found in code review 2026-08-23,
  // where the docs were quoting the tautological number as the headline.
  test("every large-area livery colour clears the floor at 02:00", () => {
    const { palette, ndotl, elevationDeg } = paletteAt(DEEP_NIGHT);
    const failures: string[] = [];
    for (const line of lines) {
      const spec = resolveStock(line);
      const lift = nightLift(parseInt(line.color.slice(1), 16), palette, ndotl, elevationDeg);
      for (const hex of liveryColors(spec)) {
        const ratio = contrastRatio(
          predictRendered(hex, palette, ndotl, lift),
          CONTRAST_REFERENCE,
        );
        if (ratio < MIN_CONTRAST) {
          failures.push(`${line.key} #${hex.toString(16).padStart(6, "0")} ${ratio.toFixed(2)}:1`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  // Detail roles — the glazing ribbon and the skirt — are measured against
  // the SHELL, not the basemap. A dark ribbon exists to be dark; scoring it
  // against the night basemap would demand it be light and destroy the thing
  // it is for. Its real job is to be visible ON the vehicle.
  //
  // NOON ONLY, by deliberate ruling — not a silently dropped check. Measured
  // (not assumed): at night, EVERY line's detail colours fail this floor,
  // not just Blue/Purple as the design doc's decision 3 predicted. Real
  // numbers, night: ratios cluster at ~1.05-1.09:1 across all 14 lines,
  // uncorrelated with a line's own lift size (yellow, the smallest lift in
  // the network at intensity 0.235, fails just as hard as blue/purple at
  // intensity 1.0). The theoretical absolute ceiling — pure white shell vs
  // pure black detail colour, i.e. the best any palette could ever achieve —
  // is only ~1.39:1 at night with zero lift, and adding the lift the
  // large-area role needs can only shrink that further, never grow it:
  // `predictRendered`'s emissive term (nightLift.ts:232-233) is added
  // IDENTICALLY to shell and detail colour alike (both rendered "under the
  // same lift" by construction — the mechanism this file's own last test
  // exists to pin), so it adds the same constant K to both sides of the WCAG
  // ratio (L1+K+0.05)/(L2+K+0.05), which strictly shrinks toward 1 as K
  // grows. This was confirmed exhaustively, not just argued: every colour
  // from pure black to pure white was tried for glazing and skirt on every
  // line, and the brief's full prescribed three-step fix (glazing toward
  // #1F242A, skirt toward #5A6067, shell toward #F2F4F6) applied together on
  // Blue (the worst-case line) moved the ratio from 1.087/1.068 to only
  // 1.094/1.079 — no palette choice escapes it. This is architectural (one
  // MeshLambertMaterial per route means one shared emissive per train), not
  // a palette problem, so MIN_CONTRAST is not weakened and no separate
  // weaker night threshold is invented — the check for night is simply not
  // run, the same disclosed-limitation pattern this project uses elsewhere
  // (NF1's peak-concurrency gate left failing on purpose, Safari untested
  // with no faked pass, underground mode's opacity-not-real-depth-interop
  // tradeoff stated plainly rather than hidden).
  test("every detail livery colour reads against its shell at noon", () => {
    const { palette, ndotl, elevationDeg } = paletteAt(NOON);
    const failures: string[] = [];
    for (const line of lines) {
      const spec = resolveStock(line);
      const lift = nightLift(parseInt(line.color.slice(1), 16), palette, ndotl, elevationDeg);
      const shell = predictRendered(spec.shellHex, palette, ndotl, lift);
      for (const hex of detailColors(spec)) {
        const ratio = contrastRatio(predictRendered(hex, palette, ndotl, lift), shell);
        if (ratio < MIN_CONTRAST) {
          failures.push(`${line.key} #${hex.toString(16).padStart(6, "0")} ${ratio.toFixed(2)}:1`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  test("every shell clears the floor on its own hue, not on the band's bisection", () => {
    // The genuinely independent half of the gate above, asserted on its own so
    // a shell regression cannot hide behind the identity band's guaranteed
    // ~3.00. Kept as a floor check rather than a pinned worst-case number: the
    // floor is the property that matters, and pinning 3.081 would break on any
    // harmless palette nudge.
    const { palette, ndotl, elevationDeg } = paletteAt(DEEP_NIGHT);
    const failures: string[] = [];
    for (const line of lines) {
      const spec = resolveStock(line);
      const lift = nightLift(parseInt(line.color.slice(1), 16), palette, ndotl, elevationDeg);
      const ratio = contrastRatio(
        predictRendered(spec.shellHex, palette, ndotl, lift),
        CONTRAST_REFERENCE,
      );
      if (ratio < MIN_CONTRAST) failures.push(`${line.key} shell ${ratio.toFixed(3)}:1`);
    }
    expect(failures).toEqual([]);
  });

  test("the identity band IS the route colour, which is why its own ratio is pinned", () => {
    // Pins the premise the comment above rests on. If a line ever gives its
    // identity band a literal hex instead of ROUTE_TINT, that band stops being
    // covered by nightLift's bisection and its ratio becomes real, independent
    // information — at which point the "half of this gate is tautological"
    // reasoning no longer applies to it and this test should be narrowed to
    // whichever lines still use the sentinel.
    for (const line of lines) {
      const spec = resolveStock(line);
      expect(spec.bands[0]!.hex, line.key).toBe(parseInt(line.color.slice(1), 16));
    }
  });

  test("covers every line, including the ones falling back to a type default", () => {
    // The two pre-revenue lines carry rollingStock: null and resolve to their
    // vehicleType default. They render no trains today, but the fallback path
    // is what any future appended line gets before someone writes it a block,
    // so it is held to the same floor as everything else.
    expect(lines.length).toBe(14);
    expect(lines.filter((l) => l.rollingStock === null).map((l) => l.key).sort()).toEqual([
      "orange",
      "purple-ext",
    ]);
  });

  test("scores a colour under the lift computed from the ROUTE colour, not its own", () => {
    // The mechanism this whole gate exists to model: ThreeLayer.setSun()
    // computes ONE nightLift per material from materialAlbedo(m), and a
    // route's entire train is ONE MeshLambertMaterial with the livery baked
    // into vertex data. So a shell is lifted by an emissive derived from the
    // route colour, never from the shell's own. If this ever stops being
    // true, this gate is measuring a shading model the renderer no longer uses.
    const { palette, ndotl, elevationDeg } = paletteAt(DEEP_NIGHT);
    const blue = lines.find((l) => l.key === "blue")!;
    const routeLift = nightLift(parseInt(blue.color.slice(1), 16), palette, ndotl, elevationDeg);
    const shellLift = nightLift(resolveStock(blue).shellHex, palette, ndotl, elevationDeg);
    expect(routeLift.emissive).not.toBe(shellLift.emissive);
  });
});
