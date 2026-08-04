import { MercatorCoordinate } from "maplibre-gl";
import type { LngLatAlt } from "../types";

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
