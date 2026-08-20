import type { Map as MapLibreMap } from "maplibre-gl";
import {
  PARSED_NIGHT_THEME,
  type BasemapTheme,
  type RgbaColor,
  mixParsedColor,
  nightFactor,
  parseColor,
} from "./basemapTheme";

/**
 * Everything that must be RE-CREATED on every `style.load`, isolated from
 * everything that must NOT be.
 *
 * `map.setStyle()` destroys every custom layer and invalidates every layer id
 * and captured paint value. Through MVP 6 that only happened once per mount,
 * so this all lived inline in MapContainer's `style.load` handler and the
 * repeat case was guarded only for React StrictMode. The basemap style cycle
 * (roadmap item 21) makes repeat firing the normal case.
 *
 * What belongs here: the underground opacity snapshot, the basemap colour
 * snapshot, and their apply functions — all of which are per-STYLE.
 *
 * What deliberately does NOT belong here: SimClient, FollowCamera,
 * TrainTooltip, the click/drag handlers and the rAF loop. Those are per-MAP.
 * Re-creating a SimClient on a style swap would spawn a second worker holding
 * a second copy of the timetable cache.
 */

// SRS §F3.2 specifies a 0.1-0.4 opacity band for the dimmed basemap.
const UNDERGROUND_BASEMAP_OPACITY = 0.25;

type ColorProp =
  | "background-color"
  | "fill-color"
  | "fill-extrusion-color"
  | "line-color"
  | "text-color"
  | "text-halo-color";
type ThemeRole = keyof BasemapTheme;

interface UndergroundTarget {
  setUndergroundMode(on: boolean): void;
}

export interface StyleBinding {
  /** Underground view mode. Owns every `*-opacity` property, and only those. */
  applyUnderground(on: boolean): void;
  /** Day/night colour. Owns colour properties, and only those. */
  applyThemeElevation(effectiveElevationDeg: number): void;
  /** Force the next applyThemeElevation to write even if the bucket matches. */
  resetThemeCache(): void;
  readonly themeableCount: number;
  readonly skippedCount: number;
}

export function bindStyle(map: MapLibreMap, layer: UndergroundTarget): StyleBinding {
  // ---- underground: opacity only -----------------------------------------
  // Layer ids are discovered from the loaded style, never hardcoded: this is
  // OpenFreeMap Liberty today and the style cycle swaps it at runtime.
  const dimmable = map
    .getStyle()
    .layers.filter((l) => l.type === "fill-extrusion" || l.type === "fill")
    .map((l) => {
      const prop = (
        l.type === "fill-extrusion" ? "fill-extrusion-opacity" : "fill-opacity"
      ) as "fill-extrusion-opacity" | "fill-opacity";
      const raw = map.getPaintProperty(l.id, prop);
      // Some basemap styles (Bright, Positron) use a zoom EXPRESSION (an
      // array) for fill-opacity/fill-extrusion-opacity on several
      // landcover/landuse/aeroway layers, not a plain number. Treating that
      // as a number lies about the type: Math.min(expressionArray, 0.25)
      // evaluates to NaN, and setPaintProperty(..., NaN) fails MapLibre's
      // validation (a console error) and never actually dims. Skip it
      // instead — same shape as the colour-capture guard below.
      const original = raw === undefined ? 1 : typeof raw === "number" ? raw : null;
      return { id: l.id, prop, original };
    })
    .filter(
      (d): d is { id: string; prop: "fill-extrusion-opacity" | "fill-opacity"; original: number } =>
        d.original !== null,
    );

  const applyUnderground = (on: boolean) => {
    layer.setUndergroundMode(on);
    for (const d of dimmable) {
      map.setPaintProperty(
        d.id,
        d.prop,
        on ? Math.min(d.original, UNDERGROUND_BASEMAP_OPACITY) : d.original,
      );
    }
    map.triggerRepaint();
  };

  // ---- theme: colour only ------------------------------------------------
  // `lastApplied` starts at `original` (nothing written yet) so a tick whose
  // blended colour has not changed skips its setPaintProperty entirely.
  // Liberty has 100+ themeable layers and the blend saturates well before `t`
  // stops moving, so this removes most writes at up to 2 Hz.
  const themeable: {
    id: string;
    prop: ColorProp;
    parsedOriginal: RgbaColor;
    parsedNight: RgbaColor;
    lastApplied: string;
  }[] = [];
  let skipped = 0;

  const capture = (id: string, prop: ColorProp, role: ThemeRole) => {
    const raw = map.getPaintProperty(id, prop);
    if (raw === undefined) return; // no override on this layer
    if (typeof raw !== "string") {
      skipped++;
      return;
    }
    const parsedOriginal = parseColor(raw);
    if (parsedOriginal === null) {
      // A MapLibre expression (array), a stop-function (object), or a CSS
      // colour syntax parseColor does not handle. Cannot be interpolated.
      skipped++;
      return;
    }
    themeable.push({
      id,
      prop,
      parsedOriginal,
      parsedNight: PARSED_NIGHT_THEME[role],
      lastApplied: raw,
    });
  };

  for (const l of map.getStyle().layers) {
    if (l.type === "background") capture(l.id, "background-color", "background");
    else if (l.type === "fill")
      capture(l.id, "fill-color", l.id.includes("water") ? "water" : "land");
    else if (l.type === "fill-extrusion") capture(l.id, "fill-extrusion-color", "building");
    else if (l.type === "line") capture(l.id, "line-color", "road");
    else if (l.type === "symbol") {
      capture(l.id, "text-color", "labelText");
      capture(l.id, "text-halo-color", "labelHalo");
    }
  }

  let lastNightBucket = -1;
  const applyThemeElevation = (effectiveElevationDeg: number) => {
    const t = nightFactor(effectiveElevationDeg);
    // Quantised: without this the sun barely moving still costs dozens of
    // no-op setPaintProperty calls a second.
    const bucket = Math.round(t * 200);
    if (bucket === lastNightBucket) return;
    lastNightBucket = bucket;
    for (const entry of themeable) {
      // ALWAYS from `entry.parsedOriginal`. Blending from the live value compounds
      // every tick and drives the whole map to black within seconds — this
      // shipped as a real bug once.
      const next = mixParsedColor(entry.parsedOriginal, entry.parsedNight, t);
      if (next === entry.lastApplied) continue;
      entry.lastApplied = next;
      map.setPaintProperty(entry.id, entry.prop, next);
    }
  };

  return {
    applyUnderground,
    applyThemeElevation,
    resetThemeCache: () => {
      lastNightBucket = -1;
    },
    get themeableCount() {
      return themeable.length;
    },
    get skippedCount() {
      return skipped;
    },
  };
}
