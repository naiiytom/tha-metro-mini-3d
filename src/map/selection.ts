import { LANE_ROUTE_IDX, LANE_RUN_IDX, LANE_X, LANE_Y, LANE_Z, VEHICLE_STRIDE, type StationInfo } from "../sim/protocol";
import { projectLocal, type ViewProjection } from "./screenProject";

/**
 * Screen-space click picking for trains and stations (MVP 4).
 *
 * Candidates are projected to screen pixels and the nearest within a pixel
 * radius wins. This is deliberately NOT a Three.js raycast: the layer's
 * projection matrix is assembled per frame from MapLibre's, and there is no
 * Three camera with a real view matrix to raycast through.
 *
 * Projection goes through `projectLocal` against that same per-frame matrix,
 * so ALTITUDE IS CARRIED. It previously went through `map.project()`, which
 * takes a LngLat and silently drops it — comparing +15 m elevated track and
 * -18 m tunnels against the click at ground level. That is ~23 px of error
 * at z18/60° pitch, larger than the pick radii, so from about z18 upward the
 * hit region was entirely disjoint from the drawn target (issue #25).
 */

const VEHICLE_PICK_PX = 22;
const STATION_PICK_PX = 16;

export type Picked =
  | { type: "vehicle"; runIdx: number }
  | { type: "station"; routeIdx: number; stationIdx: number };

interface Point {
  x: number;
  y: number;
}

function screenDistanceSq(
  view: ViewProjection,
  x: number,
  y: number,
  z: number,
  at: Point,
): number {
  // `projectLocal` returns null for anything at or behind the camera plane,
  // which is what keeps a point beyond the horizon from projecting back
  // inside the viewport and reading as a false hit.
  const p = projectLocal(view, x, y, z);
  if (p === null) return Number.POSITIVE_INFINITY;
  const dx = p.x - at.x;
  const dy = p.y - at.y;
  return dx * dx + dy * dy;
}

/** `pickRadiusPx` lands in Task 3 (zoom-scaled pick radii); this is a
 *  temporary passthrough so this task's tests pass on their own. */
function pickRadiusPx(basePx: number, _zoom: number): number {
  return basePx;
}

/**
 * Nearest train or station to a click, or null. Trains win ties inside their
 * radius — they sit on top of the station markers and are the smaller target.
 *
 * @param view the layer's current mercator->clip matrix + canvas size
 *   (`NetworkLayer.viewProjection()`)
 * @param vehicles interpolated stride-8 records (SimClient.getInterpolated)
 * @param at click position in canvas pixels
 * @param hiddenRoutes route indices switched off in the line selector — their
 *   trains and stations must not be clickable, or a user picks something that
 *   is not on screen.
 */
export function pickAt(
  view: ViewProjection,
  vehicles: Float32Array,
  count: number,
  stations: StationInfo[],
  at: Point,
  hiddenRoutes: number[] = [],
  zoom = 15,
): Picked | null {
  const vehicleRadius = pickRadiusPx(VEHICLE_PICK_PX, zoom);
  const stationRadius = pickRadiusPx(STATION_PICK_PX, zoom);

  let bestVehicle: { runIdx: number; d2: number } | null = null;
  for (let i = 0; i < count; i++) {
    const o = i * VEHICLE_STRIDE;
    if (hiddenRoutes.includes(vehicles[o + LANE_ROUTE_IDX] | 0)) continue;
    const d2 = screenDistanceSq(
      view, vehicles[o + LANE_X], vehicles[o + LANE_Y], vehicles[o + LANE_Z], at,
    );
    if (d2 <= vehicleRadius * vehicleRadius && (!bestVehicle || d2 < bestVehicle.d2)) {
      bestVehicle = { runIdx: vehicles[o + LANE_RUN_IDX], d2 };
    }
  }
  if (bestVehicle) return { type: "vehicle", runIdx: bestVehicle.runIdx };

  let bestStation: { station: StationInfo; d2: number } | null = null;
  for (const s of stations) {
    if (hiddenRoutes.includes(s.route_idx)) continue;
    const d2 = screenDistanceSq(view, s.x, s.y, s.z, at);
    if (d2 <= stationRadius * stationRadius && (!bestStation || d2 < bestStation.d2)) {
      bestStation = { station: s, d2 };
    }
  }
  if (bestStation) {
    return {
      type: "station",
      routeIdx: bestStation.station.route_idx,
      stationIdx: bestStation.station.station_idx,
    };
  }
  return null;
}
