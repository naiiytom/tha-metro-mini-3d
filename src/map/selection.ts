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

/**
 * Zoom at which the fixed pick radii were chosen. Below it the target is
 * already smaller than the radius, so growing further would only make
 * neighbouring lines steal each other's clicks.
 */
const REFERENCE_ZOOM = 15;

/**
 * Pick radius in pixels for a given zoom.
 *
 * A 65 m consist spans roughly 230 px at z19 and about 7 px at z14, so one
 * fixed pixel radius is either far too small or far too greedy depending on
 * where the user is. Doubling every 4 zoom levels tracks the rendered size
 * loosely without needing the metres-per-pixel of the live view; the 3x cap
 * keeps a click from claiming an implausible area.
 */
export function pickRadiusPx(basePx: number, zoom: number): number {
  const scaled = basePx * Math.pow(2, (zoom - REFERENCE_ZOOM) / 4);
  return Math.max(basePx, Math.min(basePx * 3, scaled));
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
  map3D = true,
): Picked | null {
  const vehicleRadius = pickRadiusPx(VEHICLE_PICK_PX, zoom);
  const stationRadius = pickRadiusPx(STATION_PICK_PX, zoom);

  let bestVehicle: { runIdx: number; d2: number } | null = null;
  for (let i = 0; i < count; i++) {
    const o = i * VEHICLE_STRIDE;
    if (hiddenRoutes.includes(vehicles[o + LANE_ROUTE_IDX] | 0)) continue;
    const vz = map3D ? vehicles[o + LANE_Z] : 0;
    const d2 = screenDistanceSq(
      view,
      vehicles[o + LANE_X],
      vehicles[o + LANE_Y],
      vz,
      at,
    );
    if (d2 <= vehicleRadius * vehicleRadius && (!bestVehicle || d2 < bestVehicle.d2)) {
      bestVehicle = { runIdx: vehicles[o + LANE_RUN_IDX], d2 };
    }
  }
  if (bestVehicle) return { type: "vehicle", runIdx: bestVehicle.runIdx };

  let bestStation: { station: StationInfo; d2: number } | null = null;
  for (const s of stations) {
    if (hiddenRoutes.includes(s.route_idx)) continue;
    const sz = map3D ? s.z : 0;
    const d2 = screenDistanceSq(view, s.x, s.y, sz, at);
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
