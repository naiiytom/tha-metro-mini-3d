import type { StationHub, StationInfo } from "../sim/protocol";
import type { LineGeometry } from "../types";

const stopKey = (routeIdx: number, stationIdx: number) => `${routeIdx}:${stationIdx}`;

function normalizedName(name: string): string {
  return name.trim().toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
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

/**
 * Creates physical station complexes from the cache's directed interchange
 * graph and from names shared by independently-modelled operators. `routes`
 * is deliberately accepted here because hubs are a network-level projection;
 * route metadata is consumed by presentation layers for colour chips.
 */
export function buildStationHubs(stations: StationInfo[], _routes: LineGeometry[]): StationHub[] {
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
  const firstByName = new Map<string, number>();
  for (const [index, station] of stations.entries()) {
    const name = normalizedName(station.name_en);
    if (!name) continue;
    const first = firstByName.get(name);
    if (first === undefined) firstByName.set(name, index);
    else join(first, index);
  }

  const groups = new Map<number, StationInfo[]>();
  for (const [index, station] of stations.entries()) {
    const root = find(index);
    const group = groups.get(root) ?? [];
    group.push(station);
    groups.set(root, group);
  }

  return [...groups.values()].map((unsorted) => {
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
}

export function findStationHub(stations: StationInfo[], routes: LineGeometry[], routeIdx: number, stationIdx: number): StationHub | null {
  return buildStationHubs(stations, routes).find((hub) => hub.stops.some((stop) => stop.routeIdx === routeIdx && stop.stationIdx === stationIdx)) ?? null;
}
