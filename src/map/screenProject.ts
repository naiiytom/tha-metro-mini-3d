import { MERC_PER_METER, ORIGIN_MERC } from "./coordinates";

/**
 * Altitude-carrying screen projection for hit-testing.
 *
 * `map.project()` takes a LngLat only, so it silently drops altitude and
 * compares every candidate at GROUND level. At z18/60° pitch that is ~23 px
 * of error for +15 m elevated track and ~28 px for MRT Blue's -18 m tunnels
 * — both larger than the pick radii they were assumed to fit inside (see
 * issue #25). This projects through the SAME mercator->clip matrix the
 * layer already renders with, so the screen position is exact by
 * construction rather than corrected by an epsilon.
 *
 * Pure on purpose: no MapLibre, no Three, no DOM. `npm test` is the only
 * automated surface this project still has.
 */

export interface ViewProjection {
  /**
   * Mercator(0..1) -> clip, COLUMN-MAJOR, exactly as MapLibre v6 hands it to
   * a custom layer via `options.defaultProjectionData.mainMatrix`.
   * Element (row r, col c) is `matrix[c * 4 + r]`.
   */
  matrix: ArrayLike<number>;
  widthPx: number;
  heightPx: number;
}

export interface ScreenPoint {
  x: number;
  y: number;
}

/**
 * Local ENU metres -> canvas pixels, or `null` when the point is at or
 * behind the camera plane.
 *
 * The null return replaces the old viewport-bounds hack in `selection.ts`:
 * that existed because points beyond the horizon can project back inside
 * the viewport, and a `w <= 0` test rejects them exactly rather than
 * approximately.
 */
export function projectLocal(
  view: ViewProjection,
  x: number,
  y: number,
  z: number,
): ScreenPoint | null {
  // Local ENU -> mercator. Mercator y grows southward, hence the sign flip,
  // matching `coordinates.ts`'s own conversion.
  const mx = ORIGIN_MERC.x + x * MERC_PER_METER;
  const my = ORIGIN_MERC.y - y * MERC_PER_METER;
  const mz = z * MERC_PER_METER;

  const m = view.matrix;
  const clipX = m[0] * mx + m[4] * my + m[8] * mz + m[12];
  const clipY = m[1] * mx + m[5] * my + m[9] * mz + m[13];
  const clipW = m[3] * mx + m[7] * my + m[11] * mz + m[15];

  if (!(clipW > 0)) return null;

  const ndcX = clipX / clipW;
  const ndcY = clipY / clipW;
  return {
    x: (ndcX * 0.5 + 0.5) * view.widthPx,
    // NDC y is up, canvas y is down.
    y: (0.5 - ndcY * 0.5) * view.heightPx,
  };
}
