import { MercatorCoordinate } from "maplibre-gl";
import type { LineGeometry, LngLatAlt } from "../types";
import type { StationInfo } from "../sim/protocol";

/**
 * Floating-origin coordinate scheme (SRS §3A.5).
 *
 * WebGL runs on float32; absolute web-mercator coordinates at Bangkok's
 * latitude have too little precision left for city-scale geometry and cause
 * visible vertex jitter. So all Three.js geometry is built in a local
 * east/north/up METER frame relative to a fixed origin near the network
 * center, and the (float64) origin translation is folded into the camera
 * projection matrix each frame — never into vertex data.
 */

/** Local frame origin: Siam interchange, center of the Green Line network. */
export const ORIGIN_LNG_LAT: [number, number] = [100.5332, 13.7456];

const originMerc = MercatorCoordinate.fromLngLat(
  { lng: ORIGIN_LNG_LAT[0], lat: ORIGIN_LNG_LAT[1] },
  0,
);

/** Mercator units per meter at the origin's latitude. */
export const MERC_PER_METER = originMerc.meterInMercatorCoordinateUnits();

export const ORIGIN_MERC = { x: originMerc.x, y: originMerc.y };

/**
 * Project [lng, lat, altMeters] into the local ENU meter frame:
 * x = east, y = north, z = up. (Mercator y grows southward, hence the sign flip.)
 */
export function lngLatAltToLocal([lng, lat, alt]: LngLatAlt): [number, number, number] {
  const m = MercatorCoordinate.fromLngLat({ lng, lat }, 0);
  return [
    (m.x - ORIGIN_MERC.x) / MERC_PER_METER,
    -(m.y - ORIGIN_MERC.y) / MERC_PER_METER,
    alt,
  ];
}

/**
 * Inverse of {@link localToLngLat} — [lng, lat] to local ENU east/north
 * meters. Needed to keep scene-anchored geometry (e.g. the sky dome) centred
 * on the current map view: MapLibre APIs speak LngLat, but Three geometry
 * lives in the local ENU frame.
 */
export function lngLatToLocal(lng: number, lat: number): [number, number] {
  const m = MercatorCoordinate.fromLngLat({ lng, lat }, 0);
  return [(m.x - ORIGIN_MERC.x) / MERC_PER_METER, -(m.y - ORIGIN_MERC.y) / MERC_PER_METER];
}

/**
 * Inverse of {@link lngLatAltToLocal} — local ENU meters back to [lng, lat].
 * Needed to hand engine-frame positions (vehicles, stations) to MapLibre APIs
 * that speak LngLat: `map.project()` for click hit-testing and `jumpTo()` for
 * the follow camera.
 */
export function localToLngLat(x: number, y: number): { lng: number; lat: number } {
  const merc = new MercatorCoordinate(
    ORIGIN_MERC.x + x * MERC_PER_METER,
    ORIGIN_MERC.y - y * MERC_PER_METER,
    0,
  );
  const { lng, lat } = merc.toLngLat();
  return { lng, lat };
}

/**
 * Disc-height offset `buildMarkerPair` (`src/map/trackGeometry.ts`) draws
 * every station marker at, above the track's local-frame altitude:
 * `m.makeTranslation(x, y, z + 1.5)`. Kept as a named constant here — rather
 * than a bare `1.5` re-typed at each call site — specifically so
 * `reconcileStationAltitude` below and the marker-drawing code it must match
 * can never drift apart silently. If `trackGeometry.ts`'s own `+ 1.5` ever
 * changes, this must change with it.
 */
export const STATION_MARKER_HEIGHT_M = 1.5;

/**
 * Reconciles each engine `StationInfo.z` (the sim's own true per-point track
 * altitude, from `position_at_arc`) to the altitude the station's MARKER is
 * actually drawn at — `network.json`'s static per-station altitude, which on
 * a mixed-structure line (MRT Blue, SRT Dark/Light Red) can legitimately be
 * a different number entirely (see CLAUDE.md's MVP 6 notes on why
 * `network.json` station altitude is a documented, not-fixed-here known
 * limitation).
 *
 * Click/hover picking (`src/map/selection.ts`) must test against what is
 * actually ON SCREEN, not the more "correct" engine value — so this is
 * applied once, when stations are loaded (`MapContainer.tsx`), rather than
 * touching `selection.ts` itself.
 *
 * `StationInfo` (the engine/cache's own station table) and
 * `LineGeometry.stations` (network.json's OSM/GTFS-enriched station table)
 * are two independently-built arrays with NO guaranteed index alignment
 * (`RoutePlanner.tsx`'s own comment makes this explicit for the same pair of
 * sources) — so stations are correlated by nearest horizontal (x, y)
 * position within the same `route_idx`, never by array index. The two
 * sources agree closely on horizontal position; only altitude diverges, so a
 * nearest-XY match within one route is robust regardless of index
 * misalignment or GTFS/OSM name-text differences.
 *
 * A route with zero `LineGeometry` stations (track-only/`preRevenue` lines)
 * leaves its engine stations' `z` unchanged — those lines have no simulated
 * stations either, so this is never actually exercised for them, but it's a
 * safe no-op if it ever were.
 */
export function reconcileStationAltitude(
  stations: StationInfo[],
  lines: LineGeometry[],
): StationInfo[] {
  return stations.map((s) => {
    const candidates = lines[s.route_idx]?.stations ?? [];
    let best: { z: number; d2: number } | null = null;
    for (const c of candidates) {
      const [cx, cy, cz] = lngLatAltToLocal(c.position);
      const d2 = (cx - s.x) ** 2 + (cy - s.y) ** 2;
      if (best === null || d2 < best.d2) best = { z: cz + STATION_MARKER_HEIGHT_M, d2 };
    }
    return best ? { ...s, z: best.z } : s;
  });
}
