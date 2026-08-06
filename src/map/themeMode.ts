import { DAY_ELEVATION_DEG, NIGHT_ELEVATION_DEG } from "./basemapTheme";

/**
 * Tri-state day/night control (roadmap item 21).
 *
 * `auto` is the SRS F3.3 behaviour delivered in MVP 6: appearance follows the
 * simulated clock. `light` and `dark` pin it.
 *
 * Pure module, same discipline as `sun.ts` and `basemapTheme.ts`: no Three,
 * no MapLibre, no DOM, no clock reads.
 */
export type ThemeMode = "auto" | "light" | "dark";

export const THEME_MODES: readonly ThemeMode[] = ["auto", "light", "dark"];

/**
 * The solar elevation the APPEARANCE should be computed from — which in
 * `auto` is the real one and otherwise is a pinned endpoint.
 *
 * Both consumers go through this single function on purpose. `basemapTheme`'s
 * `nightFactor` colours the MapLibre basemap and `sun.ts`'s `skyPalette`
 * lights the Three.js scene; when they each interpreted the old boolean
 * separately they drifted apart, producing a reported defect (a bright day
 * basemap under a dark night-lit track scene). One elevation in, two
 * consistent appearances out.
 *
 * This governs the palette ONLY. The sun's DIRECTION stays clock-driven in
 * every mode — `verify:mvp6` check 5 asserts the light position tracks the
 * simulated clock, and freezing it would be both a test failure and wrong.
 */
export function effectiveElevationDeg(mode: ThemeMode, actualElevationDeg: number): number {
  switch (mode) {
    case "light":
      return DAY_ELEVATION_DEG;
    case "dark":
      return NIGHT_ELEVATION_DEG;
    case "auto":
      return actualElevationDeg;
  }
}
