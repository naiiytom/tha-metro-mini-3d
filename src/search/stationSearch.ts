import type { StationInfo } from "../sim/protocol";

const MAX_RESULTS = 8;

/**
 * Case-insensitive substring match against either the English or Thai
 * station name. No fuzzy matching — 193 stations is few enough that a plain
 * substring search is sufficient (mini-tokyo-3d, this roadmap's parity
 * reference, does the same).
 */
export function filterStations(stations: StationInfo[], query: string): StationInfo[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return stations
    .filter((s) => s.name_en.toLowerCase().includes(q) || s.name_th.toLowerCase().includes(q))
    .sort((a, b) => a.name_en.localeCompare(b.name_en))
    .slice(0, MAX_RESULTS);
}

export interface NearestStationResult {
  station: StationInfo;
  distanceM: number;
}

/**
 * Flat Euclidean distance in the app's local east/north/up meter frame
 * (src/map/coordinates.ts) — accurate to well under a meter of error at
 * Bangkok's ~50 km network extent, the same trust the rest of the app
 * already places in that frame. No haversine needed.
 */
export function nearestStation(
  userLocal: [number, number],
  stations: StationInfo[],
): NearestStationResult | null {
  if (stations.length === 0) return null;
  const [ux, uy] = userLocal;
  let best: NearestStationResult | null = null;
  for (const station of stations) {
    const distanceM = Math.hypot(station.x - ux, station.y - uy);
    if (best === null || distanceM < best.distanceM) {
      best = { station, distanceM };
    }
  }
  return best;
}
