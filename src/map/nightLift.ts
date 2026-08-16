import type { SkyPalette } from "./sun";
import { nightFactor } from "./basemapTheme";

/**
 * A per-material minimum-brightness floor, so the network stays legible after
 * dark (roadmap item 20's unfinished half).
 *
 * MVP 6 raised the global lighting floors in `sun.ts`, which helped but cannot
 * reach the real cause for a dark livery: at 8-bit sRGB, a colour like MRT
 * Blue's #1964B7 saturates near-black under any ambient level. The fix is
 * per-material rather than per-light — each material gets an emissive term
 * built from its OWN colour, so hue is preserved exactly and the rendered line
 * still matches its swatch in the UI.
 *
 * Two stages, because there is a real ceiling. At `intensity = 1` a material
 * renders as exactly its own sRGB colour; going brighter means becoming a
 * different colour. Stage 2 applies only to a livery its own hue cannot save
 * (MRT Purple, and marginally MRT Blue): blend toward white by the MINIMUM
 * amount that clears the floor, never more.
 */

/** WCAG floor for non-text graphical objects. Never weaken this to pass. */
export const MIN_CONTRAST = 3;

/**
 * The night basemap's building colour (`NIGHT.building` in basemapTheme.ts).
 * Land (#14181f) is darker and easier to clear; buildings are the brighter of
 * the two roles that cover most of the map, so requiring the floor against
 * them is the conservative choice. Roads are brighter still, but requiring
 * 3:1 against those would wash six lines toward white and destroy colour
 * identity — a worse outcome than the problem.
 *
 * A FIXED constant — `basemapTheme.ts` deliberately has no day-side building
 * colour to blend from (see that file's own comment on `NIGHT`: an earlier
 * version tried one and double-applied the night blend). The real day colour
 * only exists live, captured once per basemap style in `MapContainer.tsx`,
 * and this module is pure and has no reach into that — so this reference is
 * only ever a valid proxy for what's actually on screen once the basemap has
 * begun blending toward it, i.e. once `nightFactor(elevationDeg) > 0`. See
 * `nightLift()`'s own day gate below for how that's enforced. Found in code
 * review 2026-08-15: without the gate, this reference was being checked
 * against at NOON too, where the real backdrop is nothing like it — MRT
 * Purple's `#660066` was landing at 1.09:1 against the real light Liberty
 * day basemap while this reference reported it as passing at 6.9:1, and the
 * model was force-whitening it toward `#ac3aac` at noon to satisfy a
 * backdrop that was never on screen.
 */
export const CONTRAST_REFERENCE = 0x1c222c;

export interface NightLift {
  /** Emissive colour — the material's own colour, whitened only if forced. */
  emissive: number;
  /**
   * 0 during full day (`nightFactor(elevationDeg) === 0`) — deliberately,
   * since `CONTRAST_REFERENCE` has no relevance to what's actually behind a
   * material until the basemap itself has begun blending toward it. Ramps
   * CONTINUOUSLY from there — scaled by `nightFactor(elevationDeg)`, the
   * same smoothstep curve the basemap's own darkening uses — up to the
   * value that clears the floor (or the material's own hue cannot save)
   * once nightFactor reaches 1 at full night. Not a step function: an
   * earlier version of this gate was binary (full lift the instant
   * nightFactor left zero), which popped the whole network discontinuously
   * at the elevation boundary and, more importantly, force-whitened liveries
   * throughout most of dusk against a backdrop that was still mostly its DAY
   * colours. Fixed in code review 2026-08-15 — see `nightLift()`'s own
   * comment on the fix and its honest limit (the "clears 3:1" guarantee is
   * exact once nightFactor reaches 1, not at every intermediate value).
   *
   * An earlier version of this doc comment claimed this was "driven by the
   * contrast shortfall, NOT by the time of day," citing the deleted MVP 7
   * harness's real noon failures as evidence "day means no lift" would be
   * false. That reasoning doesn't hold: the MVP 7 harness measured noon
   * failures against the REAL day basemap (a browser screenshot); this
   * model, before the day gate below existed, was checking noon against the
   * NIGHT basemap's reference colour — a different, wrong question. Fixed in
   * code review 2026-08-15 (see `CONTRAST_REFERENCE`'s own comment for the
   * concrete regression this caused).
   */
  intensity: number;
}

const channels = (hex: number): [number, number, number] => [
  (hex >> 16) & 0xff,
  (hex >> 8) & 0xff,
  hex & 0xff,
];

const pack = (r: number, g: number, b: number): number =>
  (Math.round(clamp01(r) * 255) << 16) | (Math.round(clamp01(g) * 255) << 8) | Math.round(clamp01(b) * 255);

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** sRGB 0-255 -> linear 0-1. */
const toLinear = (c: number): number => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
};

/** linear 0-1 -> sRGB 0-1. */
const toSrgb = (v: number): number => {
  const l = clamp01(v);
  return l <= 0.0031308 ? l * 12.92 : 1.055 * Math.pow(l, 1 / 2.4) - 0.055;
};

export function relativeLuminance(hex: number): number {
  const [r, g, b] = channels(hex);
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

export function contrastRatio(a: number, b: number): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * Predict the sRGB colour a MeshLambertMaterial resolves to on screen.
 *
 * Three r185 with default colour management: material colours are converted
 * sRGB -> linear, lighting is accumulated in linear space, and the render
 * target converts back to sRGB on output.
 */

/**
 * Scale factor between this model's predicted linear-light output and what
 * Three's shader actually produces.
 *
 * DERIVED from Three's own shipped shader source (`node_modules/three`,
 * matching the `^0.185.1` this project pins), not fitted from measurement.
 * `MeshLambertMaterial` bakes the Lambertian BRDF's `1/π` reciprocal-pi
 * normalization in unconditionally — `ShaderChunk/common.glsl.js`'s
 * `BRDF_Lambert(diffuseColor) { return RECIPROCAL_PI * diffuseColor; }`
 * (`RECIPROCAL_PI = 0.3183098861837907`, same file), applied by
 * `lights_lambert_pars_fragment.glsl.js` in BOTH `RE_Direct_Lambert` (the
 * sun term) and `RE_IndirectDiffuse_Lambert` (the ambient term) — it is not
 * specific to a "physically correct lights" opt-in path. `WebGLLights.js`
 * applies no extra normalization before that. `ThreeLayer.ts` never sets
 * `renderer.toneMapping`, so `NoToneMapping` (the default) applies and no
 * nonlinear tone curve breaks the multiplicative relationship. Three's real
 * output is therefore exactly
 * `albedo_lin × (1/π) × (ambient·ambientIntensity + sun·sunIntensity·max(N·L,0))`
 * — precisely `predictRendered`'s formula with `SHADING_SCALE = 1/π`.
 *
 * CORROBORATED 2026-08-15 by `tools/calibrate-night-lift.mjs` against the
 * real renderer (headless Edge, `--enable-unsafe-swiftshader`, Three r185,
 * `MeshLambertMaterial`, `renderer.outputColorSpace = "srgb"`). The script
 * adds its own known-albedo, upward-facing quad directly to the live
 * `NetworkLayer` scene (never the unlit `Line2` centerline — that geometry
 * mismatch is exactly what made the deleted legibility harness's numbers
 * meaningless for its whole life), drives `NetworkLayer.setSun()` with the
 * exact same `sunDirection`/`skyPalette` values `nightLift.test.ts` uses for
 * NOON and DEEP_NIGHT, and reads the rendered pixel back with `gl.readPixels`
 * at a screen position computed from the real per-frame projection matrix
 * (not assumed from camera framing). 6 colour/time cases (white and mid-gray
 * at both times, MRT Blue `#1964B7` at both times, MRT Purple `#660066` at
 * deep night), 18 channel samples, with `NO_LIFT` (emissive forced to 0) so
 * only this scale's own multiplier is isolated. After excluding samples that
 * are uninformative by construction (a channel that measured a saturated
 * 255, or predicted below 4/255 where 8-bit rounding dominates), 13 channel
 * samples solved independently for the scale implied by that one channel's
 * real pixel: mean 0.3271, stdev 0.0108 — only 0.81σ from 1/π (0.31831), not
 * a resolvable discrepancy. The residual is explained by which samples pull
 * it: the noon-only subset (least affected by 8-bit rounding at low signal)
 * lands at 0.315–0.318, bracketing 1/π almost exactly, while the deep-night
 * samples nearest the near-black exclusion threshold — where rounding bias
 * is largest — pull the full-sample mean up. That combination (derived
 * value, independently measured within under a standard deviation) is the
 * basis for pinning this to the exact derived constant rather than the
 * noisier raw fit.
 *
 * Re-run `tools/calibrate-night-lift.mjs` (with a live `npm run dev`) as a
 * fresh corroboration if the renderer, material type, or Three version
 * changes — starting from `SHADING_SCALE = 1` the way this derivation did,
 * since the script's own near-black exclusion threshold (`predicted >= 4`)
 * is evaluated against whatever `SHADING_SCALE` happens to be live when it
 * runs.
 */
export const SHADING_SCALE = 1 / Math.PI;

/**
 * Straight alpha-over, in the SAME space the values already arrive in
 * (packed 8-bit sRGB channels) — matching Three's default transparent-
 * material blend: the fragment shader's own `colorspace_fragment` chunk
 * already converts to sRGB before the GPU's fixed-function blend stage
 * operates on it (this project never overrides `blending`, so it's
 * `THREE.NormalBlending`), so the blend itself happens on sRGB-encoded
 * values, not linear ones.
 */
function compositeOver(srcHex: number, alpha: number, dstHex: number): number {
  const [sr, sg, sb] = channels(srcHex);
  const [dr, dg, db] = channels(dstHex);
  const mix = (s: number, d: number) => Math.round(alpha * s + (1 - alpha) * d);
  return (mix(sr, dr) << 16) | (mix(sg, dg) << 8) | mix(sb, db);
}

export function predictRendered(
  albedo: number,
  palette: SkyPalette,
  ndotl: number,
  lift: NightLift,
  /**
   * The material's OWN opacity, as `ThreeLayer.applyUndergroundMode()` sets
   * it (1 when the material's structure band is the one currently
   * foregrounded; 0.35/0.3 for the deliberately-dimmed backgrounded band —
   * see that function's own comment). Defaults to 1 (fully opaque), so
   * every existing call site — including `nightLift()`'s own internal
   * `clears()` solve, which intentionally always targets full opacity, see
   * its doc comment — is unaffected.
   *
   * Added in code review 2026-08-15: this function previously had no
   * opacity concept at all, so both it and the WCAG gate built on it
   * silently assumed every material renders fully opaque. That is true for
   * whichever band is currently FOREGROUNDED (which is what the gate
   * actually asserts 3:1 for), but false for a line's BACKGROUNDED band —
   * concretely, MRT Blue's underground half in the app's DEFAULT view
   * (underground mode off) renders at 0.35 opacity, composited over the
   * basemap, and the real on-screen contrast there is measurably lower than
   * this function's opaque prediction (confirmed: 1.42:1 vs the opaque
   * model's 3.01:1) — exactly the "measured the wrong pixel" failure class
   * this whole PR exists to close for the deleted legibility harness.
   */
  opacity: number = 1,
): number {
  const [ar, ag, ab] = channels(albedo).map(toLinear);
  const [sr, sg, sb] = channels(palette.sun).map(toLinear);
  const [mr, mg, mb] = channels(palette.ambient).map(toLinear);
  const [er, eg, eb] = channels(lift.emissive).map(toLinear);

  const light = (sun: number, ambient: number) =>
    ambient * palette.ambientIntensity + sun * palette.sunIntensity * Math.max(ndotl, 0);

  const out = (a: number, sun: number, ambient: number, emissive: number) =>
    toSrgb(SHADING_SCALE * a * light(sun, ambient) + emissive * lift.intensity);

  const opaque = pack(out(ar, sr, mr, er), out(ag, sg, mg, eg), out(ab, sb, mb, eb));
  return opacity >= 1 ? opaque : compositeOver(opaque, opacity, CONTRAST_REFERENCE);
}

const NO_LIFT = (emissive: number): NightLift => ({ emissive, intensity: 0 });

function clears(albedo: number, palette: SkyPalette, ndotl: number, lift: NightLift): boolean {
  return contrastRatio(predictRendered(albedo, palette, ndotl, lift), CONTRAST_REFERENCE) >= MIN_CONTRAST;
}

/**
 * Smallest t in [0,1] satisfying `ok`, via 12 bisections — 1/4096 precision,
 * finer than the 1/256 an 8-bit sRGB channel can even express, so the result
 * is never coarser than the final rendered colour's own quantization.
 */
function smallest(ok: (t: number) => boolean): number {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2;
    if (ok(mid)) hi = mid;
    else lo = mid;
  }
  return hi;
}

const whiten = (hex: number, t: number): number => {
  const [r, g, b] = channels(hex).map((c) => c / 255);
  return pack(r + (1 - r) * t, g + (1 - g) * t, b + (1 - b) * t);
};

export function nightLift(
  albedo: number,
  palette: SkyPalette,
  ndotl: number,
  elevationDeg: number,
): NightLift {
  const nf = nightFactor(elevationDeg);
  // Full day: CONTRAST_REFERENCE isn't on screen yet (see its own comment),
  // so there is nothing meaningful to check against. Gated on the same
  // nightFactor threshold basemapTheme.ts uses for the basemap's own
  // darkening, so both night effects agree on when night begins.
  if (nf === 0) return NO_LIFT(albedo);
  if (clears(albedo, palette, ndotl, NO_LIFT(albedo))) return NO_LIFT(albedo);

  // Both stages below solve for the intensity/whitening that would be
  // needed if it WERE fully night (nf === 1), then scale the returned
  // intensity by nf itself before returning.
  //
  // Found in code review 2026-08-15: the day gate above stops the noon
  // regression, but on its own it is a hard step at nf === 0 — one instant
  // past the threshold, nf is astronomically small (~2e-8 right at the
  // elevation boundary) while the fully-solved lift still applied at FULL
  // strength, popping the whole network from "no lift" to "fully lifted"
  // discontinuously, and staying wrong (force-whitening toward the fully-
  // NIGHT target against a backdrop that is still mostly its DAY colours)
  // through most of the dusk band — not just a boundary sliver, confirmed by
  // probing the real function: MRT Purple was still at intensity 1.0 all the
  // way from elevation 2.999° down past 0°, only reaching genuine full
  // strength (by design, correctly) once nf itself reaches 1 near -8°. That
  // is exactly the class of "checking against a backdrop that isn't fully on
  // screen yet" bug `CONTRAST_REFERENCE`'s own comment already names for
  // noon — it just also applies, more softly, throughout dusk/dawn.
  //
  // Scaling intensity by nf (not re-solving the target colour at every nf)
  // is the minimal fix: continuous, monotonic, and exact at both endpoints
  // (nf=0 contributes zero emissive, matching the day gate above exactly;
  // nf=1 is byte-identical to the pre-fix full-night behaviour, so DEEP_NIGHT
  // test values are unaffected). It is NOT a proof that the result clears
  // 3:1 at every intermediate nf — CONTRAST_REFERENCE itself is always the
  // fully-night constant, never blended, so that guarantee only strictly
  // holds once nf reaches 1. What it does guarantee is that the boost is
  // never larger than how much night has actually arrived, closing the
  // reviewer's "reduces real contrast for no benefit against a still-light
  // backdrop" complaint by construction.

  // Stage 1: the material's own colour, as little of it as possible.
  const full: NightLift = { emissive: albedo, intensity: 1 };
  if (clears(albedo, palette, ndotl, full)) {
    const solved = smallest((t) => clears(albedo, palette, ndotl, { emissive: albedo, intensity: t }));
    return { emissive: albedo, intensity: solved * nf };
  }

  // Stage 2: this livery cannot reach the floor as itself. Whiten by the
  // minimum that does, and accept the identity cost knowingly.
  //
  // Unlike stage 1, there is no explicit `clears(whiten(albedo, 1))` guard
  // before searching — whiten(albedo, 1) is pure white, and white provably
  // clears any fixed, dark CONTRAST_REFERENCE (0x1c222c's luminance is far
  // below white's 1.0), so `smallest` always has a satisfying upper bound.
  // This is an intentional asymmetry with stage 1 (whose own ceiling is NOT
  // guaranteed to clear, hence its explicit check), not an oversight.
  const t = smallest((s) => clears(albedo, palette, ndotl, { emissive: whiten(albedo, s), intensity: 1 }));
  return { emissive: whiten(albedo, t), intensity: nf };
}
