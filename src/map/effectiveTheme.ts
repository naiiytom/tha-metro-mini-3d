import { nightFactor } from "./basemapTheme";
import { effectiveElevationDeg, type ThemeMode } from "./themeMode";

/**
 * Which appearance the DOM chrome should wear.
 *
 * The Three.js scene and the basemap both already resolve `themeMode` into a
 * continuous night factor and blend smoothly. The DOM cannot: a panel is
 * either light or dark, so this collapses the same single source of truth
 * (`effectiveElevationDeg` -> `nightFactor`) into a boolean at the halfway
 * point. Going through the same two functions is what keeps the chrome from
 * drifting out of step with the map, which is exactly the class of defect
 * `effectiveElevationDeg`'s own doc comment records having happened before.
 *
 * Pure module: no DOM, no clock reads, no store.
 */
export type Appearance = "light" | "dark";

/** `nightFactor` at or above which the chrome flips to dark. */
export const DARK_THRESHOLD = 0.5;

export function effectiveTheme(mode: ThemeMode, actualElevationDeg: number): Appearance {
  const night = nightFactor(effectiveElevationDeg(mode, actualElevationDeg));
  return night >= DARK_THRESHOLD ? "dark" : "light";
}
