import type { SkyPalette } from "./sun";

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
 */
export const CONTRAST_REFERENCE = 0x1c222c;

export interface NightLift {
  /** Emissive colour — the material's own colour, whitened only if forced. */
  emissive: number;
  /**
   * 0 when the material already clears the floor under the current palette,
   * up to 1 when it does not.
   *
   * Driven by the contrast shortfall, NOT by the time of day — the deleted
   * MVP 7 harness measured real noon failures for five lines, so "day means
   * no lift" would be false. In practice this is 0 at noon for most liveries
   * and non-zero at night for most, but that is an outcome, not a rule.
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
 * Three's shader actually produces. Currently an UNVALIDATED PLACEHOLDER of
 * 1 — `tools/calibrate-night-lift.mjs` does not exist yet. Task 8 creates
 * that tool, measures real rendered pixels against this model's prediction,
 * and pins the measured value here. Do not adjust it by eye in the meantime;
 * modelling the shader wrong is exactly how the deleted legibility harness
 * failed.
 *
 * Known symptom that the placeholder is wrong, recorded here for whoever
 * calibrates: at `SHADING_SCALE = 1` this model predicts NO line needs any
 * lift at noon, Blue included (`nightLift` returns `intensity: 0` for every
 * one of the 14 registry colours at noon). The deleted real-pixel harness
 * measured genuine noon failures for five lines — Sukhumvit, Yellow, Gold,
 * Red Light, and Blue. That gap between "predicted fine" and "measured
 * failing" is the evidence this constant needs a real value, not 1.
 */
export const SHADING_SCALE = 1;

export function predictRendered(
  albedo: number,
  palette: SkyPalette,
  ndotl: number,
  lift: NightLift,
): number {
  const [ar, ag, ab] = channels(albedo).map(toLinear);
  const [sr, sg, sb] = channels(palette.sun).map(toLinear);
  const [mr, mg, mb] = channels(palette.ambient).map(toLinear);
  const [er, eg, eb] = channels(lift.emissive).map(toLinear);

  const light = (sun: number, ambient: number) =>
    ambient * palette.ambientIntensity + sun * palette.sunIntensity * Math.max(ndotl, 0);

  const out = (a: number, sun: number, ambient: number, emissive: number) =>
    toSrgb(SHADING_SCALE * a * light(sun, ambient) + emissive * lift.intensity);

  return pack(out(ar, sr, mr, er), out(ag, sg, mg, eg), out(ab, sb, mb, eb));
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

export function nightLift(albedo: number, palette: SkyPalette, ndotl: number): NightLift {
  if (clears(albedo, palette, ndotl, NO_LIFT(albedo))) return NO_LIFT(albedo);

  // Stage 1: the material's own colour, as little of it as possible.
  const full: NightLift = { emissive: albedo, intensity: 1 };
  if (clears(albedo, palette, ndotl, full)) {
    const intensity = smallest((t) => clears(albedo, palette, ndotl, { emissive: albedo, intensity: t }));
    return { emissive: albedo, intensity };
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
  return { emissive: whiten(albedo, t), intensity: 1 };
}
