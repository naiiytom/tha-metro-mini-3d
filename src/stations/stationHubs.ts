import type { StationHub, StationHubStopRef, StationInfo } from "../sim/protocol";

export type { StationHub, StationHubStopRef };

const stopKey = (routeIdx: number, stationIdx: number) => `${routeIdx}:${stationIdx}`;

export function normalizedName(name: string): string {
  return name.trim().toLocaleLowerCase().replace(/[^\p{L}\p{N}\p{M}]+/gu, " ").trim();
}

function hubName(stops: StationInfo[], field: "name_en" | "name_th"): string {
  const names = new Map<string, string>();
  for (const stop of stops) {
    const name = stop[field].trim();
    const key = normalizedName(name);
    if (key && !names.has(key)) names.set(key, name);
  }
  return [...names.values()].join(" / ");
}

let cachedStations: StationInfo[] | null = null;
let cachedHubs: StationHub[] = [];
let cachedStopToHub = new Map<string, StationHub>();

/**
 * Creates station hubs from the cache's directed interchange
 * graph and from names shared by independently-modelled operators.
 */
export function buildStationHubs(stations: StationInfo[]): StationHub[] {
  if (stations === cachedStations) {
    return cachedHubs;
  }

  const parent = stations.map((_, index) => index);
  const indexByStop = new Map(stations.map((station, index) => [stopKey(station.route_idx, station.station_idx), index]));
  const find = (index: number): number => {
    while (parent[index] !== index) {
      parent[index] = parent[parent[index]];
      index = parent[index];
    }
    return index;
  };
  const join = (a: number, b: number) => {
    const aRoot = find(a);
    const bRoot = find(b);
    if (aRoot !== bRoot) parent[bRoot] = aRoot;
  };

  for (const [index, station] of stations.entries()) {
    for (const interchange of station.interchanges) {
      const other = indexByStop.get(stopKey(interchange.route_idx, interchange.station_idx));
      if (other !== undefined) join(index, other);
    }
  }

  const firstByNameEn = new Map<string, number>();
  for (const [index, station] of stations.entries()) {
    const name = normalizedName(station.name_en);
    if (!name) continue;
    const first = firstByNameEn.get(name);
    if (first === undefined) firstByNameEn.set(name, index);
    else join(first, index);
  }

  const firstByNameTh = new Map<string, number>();
  for (const [index, station] of stations.entries()) {
    const name = normalizedName(station.name_th);
    if (!name) continue;
    const first = firstByNameTh.get(name);
    if (first === undefined) firstByNameTh.set(name, index);
    else join(first, index);
  }

  const groups = new Map<number, StationInfo[]>();
  for (const [index, station] of stations.entries()) {
    const root = find(index);
    const group = groups.get(root) ?? [];
    group.push(station);
    groups.set(root, group);
  }

  const hubs = [...groups.values()].map((unsorted) => {
    const stops = [...unsorted].sort((a, b) => a.route_idx - b.route_idx || a.station_idx - b.station_idx);
    const nameEn = hubName(stops, "name_en");
    const nameTh = hubName(stops, "name_th");
    const idWords = nameEn ? nameEn.split(" / ").map(normalizedName).filter(Boolean).sort() : stops.map((stop) => stopKey(stop.route_idx, stop.station_idx));
    return {
      id: `hub:${idWords.join("-").replace(/\s+/g, "-")}`,
      nameEn,
      nameTh,
      x: stops.reduce((sum, stop) => sum + stop.x, 0) / stops.length,
      y: stops.reduce((sum, stop) => sum + stop.y, 0) / stops.length,
      z: stops.reduce((sum, stop) => sum + stop.z, 0) / stops.length,
      routeIndices: [...new Set(stops.map((stop) => stop.route_idx))],
      stops: stops.map((stop) => ({ routeIdx: stop.route_idx, stationIdx: stop.station_idx, code: stop.code, nameEn: stop.name_en, nameTh: stop.name_th })),
    };
  }).sort((a, b) => a.id.localeCompare(b.id));

  cachedStations = stations;
  cachedHubs = hubs;
  cachedStopToHub = new Map();
  for (const hub of hubs) {
    for (const stop of hub.stops) {
      cachedStopToHub.set(stopKey(stop.routeIdx, stop.stationIdx), hub);
    }
  }

  return hubs;
}

export function findStationHub(stations: StationInfo[], routeIdx: number, stationIdx: number): StationHub | null {
  buildStationHubs(stations);
  return cachedStopToHub.get(stopKey(routeIdx, stationIdx)) ?? null;
}
