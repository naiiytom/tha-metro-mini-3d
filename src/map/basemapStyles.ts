/**
 * Selectable basemap styles (roadmap item 21).
 *
 * Every entry MUST be key-free. No-API-key is a standing project constraint
 * — it is why OpenFreeMap Liberty was chosen in MVP 1 — and a keyed source
 * would break static deploy targets that cannot hold a secret.
 *
 * Vector styles ONLY, deliberately. Satellite and terrain are raster sources
 * with no `fill`/`fill-extrusion`/`line` layers, so BOTH the underground
 * dimming and the day/night theming would silently become no-ops on them
 * (they mutate vector layer opacity and colour respectively). Adding a raster
 * style needs `raster-opacity`/`raster-brightness-*` equivalents plus a
 * provider ToS review and its own rendered attribution — a separate piece of
 * work, not a rider on this one.
 */
export type BasemapStyleKey = "liberty" | "bright" | "positron";

export const BASEMAP_STYLES = [
  { key: "liberty", label: "Liberty", url: "https://tiles.openfreemap.org/styles/liberty" },
  { key: "bright", label: "Bright", url: "https://tiles.openfreemap.org/styles/bright" },
  { key: "positron", label: "Positron", url: "https://tiles.openfreemap.org/styles/positron" },
] as const satisfies readonly { key: BasemapStyleKey; label: string; url: string }[];

/** Falls back to the first (default) style rather than throwing — a bad key
 *  from persisted state should degrade to the MVP 6 look, not a blank map. */
export function styleUrl(key: BasemapStyleKey): string {
  return (BASEMAP_STYLES.find((s) => s.key === key) ?? BASEMAP_STYLES[0]).url;
}
