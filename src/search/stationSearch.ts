import type { StationInfo } from "../sim/protocol";

const MAX_RESULTS = 8;

/**
 * Case-insensitive substring match against either the English or Thai
 * station name. No fuzzy matching — 193 stations is few enough that a plain
 * substring search is sufficient (mini-tokyo-3d, this roadmap's parity
 * reference, does the same).
 */
function matchesQuery(s: StationInfo, q: string): boolean {
  return s.name_en.toLowerCase().includes(q) || s.name_th.toLowerCase().includes(q);
}

export function filterStations(
  stations: StationInfo[],
  query: string,
  limit = MAX_RESULTS,
): StationInfo[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return stations
    .filter((s) => matchesQuery(s, q))
    .sort((a, b) => a.name_en.localeCompare(b.name_en))
    .slice(0, limit);
}

/**
 * Total match count for a typed query, BEFORE `filterStations`'s own
 * `limit` truncation — lets a caller show "N of M" when a search is capped,
 * rather than a truncated list that looks complete. Empty query returns the
 * full station count: `stationOptions`'s browse-all path never truncates,
 * so there is nothing to disclose there (see its own comment).
 */
export function countMatches(stations: StationInfo[], query: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return stations.length;
  let n = 0;
  for (const s of stations) {
    if (matchesQuery(s, q)) n++;
  }
  return n;
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

export function stationOptions(
  stations: StationInfo[],
  query: string,
  limit = MAX_RESULTS,
): StationInfo[] {
  if (query.trim() === "") {
    // `limit` is INTENTIONALLY ignored here, by design, not an oversight:
    // issue #28 wants a fully BROWSABLE (not just searchable) combobox, so
    // the empty-query "browse all stations, grouped by line" path always
    // returns the WHOLE list uncapped. `limit` only ever bounds SEARCH
    // (typed-query) results, below. Do not make this branch respect `limit`
    // — that would regress issue #28's browsable requirement.
    return [...stations].sort(
      (a, b) => a.route_idx - b.route_idx || a.arc_m - b.arc_m,
    );
  }
  // Pass `limit` straight through rather than `filterStations(stations,
  // query).slice(0, limit)`: `filterStations` used to always cap to its own
  // internal MAX_RESULTS (8) regardless of what `limit` this caller wants,
  // so a caller asking for more than 8 (e.g. `stationOptions(s, q, 20)`)
  // silently never got more than 8 — the double-slice bug (Minor #12).
  return filterStations(stations, query, limit);
}

export interface StationGroup {
  routeIdx: number;
  stations: StationInfo[];
}

export function groupByRoute(stations: StationInfo[]): StationGroup[] {
  const groups: StationGroup[] = [];
  const byRoute = new Map<number, StationGroup>();
  for (const station of stations) {
    let group = byRoute.get(station.route_idx);
    if (!group) {
      group = { routeIdx: station.route_idx, stations: [] };
      byRoute.set(station.route_idx, group);
      groups.push(group);
    }
    group.stations.push(station);
  }
  return groups;
}

/**
 * Format browser geolocation error codes into human-readable user messages.
 */
export function geoErrorMessage(err: GeolocationPositionError | { code: number }): string {
  switch (err.code) {
    case 1:
      return "Location permission denied.";
    case 2:
      return "Location unavailable.";
    case 3:
      return "Location request timed out.";
    default:
      return "Could not determine your location.";
  }
}

/**
 * Format distance in meters into human-readable km or m.
 */
export function formatDistance(distanceM: number): string {
  return distanceM >= 1000 ? `${(distanceM / 1000).toFixed(1)} km` : `${Math.round(distanceM)} m`;
}

