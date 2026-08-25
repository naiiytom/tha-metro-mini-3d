import { nightFactor } from "./basemapTheme";

/**
 * How visible each train's glowing-window overlay should be, purely as a
 * function of solar elevation — invisible by day, a warm lit-interior glow
 * by night, independent of the route's own livery.
 *
 * Exists because `nightLift.ts`'s per-material floor-solving pushes every
 * material toward roughly the same minimum-legible luminance once it needs
 * real lift: measured directly, MRT Blue's track deck (`#1964B7`) and that
 * same line's train shell (`#D7DBDF`) land within 1.01:1 of each other at
 * deep night, and this isn't Blue-specific — ANY two materials that both
 * need real lift converge toward the same target ceiling, since the ceiling
 * itself ("just barely clears 3:1 against the fixed dark reference") is
 * nearly independent of either material's own hue. A lit-window cue
 * sidesteps that convergence entirely rather than fighting it: it is an
 * ADDITIVE overlay with its own fixed colour and its own opacity curve,
 * never solved against `nightLift`'s reference or any other material's
 * albedo, so it can never converge with the track (which gets no such
 * overlay at all) or with another line's rolling stock.
 *
 * Deliberately reuses `nightFactor` (the same smoothstep ramp the basemap's
 * own night-darkening and `nightLift`'s day gate already use) rather than a
 * bespoke curve, so every night-driven visual effect in the scene ramps in
 * lockstep instead of at its own arbitrary pace.
 */

/** Warm interior light — fixed, NOT route-dependent. Real train windows are
 *  lit this colour regardless of the operator's livery, and a route-tinted
 *  glow would just reintroduce the same convergence risk this exists to
 *  avoid (a route whose colour itself needs heavy lift would end up with a
 *  glow that's hard to tell from its own track again). */
export const WINDOW_GLOW_COLOR = 0xfff2c2;

/** Opacity at full night (`nightFactor === 1`). Not 1.0: a solid opaque
 *  strip would read as a lit sign, not a window — this keeps a hint of the
 *  darker glazing tint baked into the body underneath showing through. */
export const WINDOW_GLOW_MAX_OPACITY = 0.85;

/** `elevationDeg` -> the glow overlay material's opacity for this frame. */
export function windowGlowOpacity(elevationDeg: number): number {
  return nightFactor(elevationDeg) * WINDOW_GLOW_MAX_OPACITY;
}
