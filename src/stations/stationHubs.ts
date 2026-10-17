import type { StationHub, StationHubStopRef, StationInfo } from "../sim/protocol";
import type { LineGeometry } from "../types";
import { INTERCHANGE_OVERRIDES } from "../../tools/lines.config.mjs";

export type { StationHub, StationHubStopRef };

const stopKey = (routeIdx: number, stationIdx: number) => `${routeIdx}:${stationIdx}`;

const EARTH_RADIUS_M = 6_371_008.8;

function haversineMeters(
  a: readonly [number, number, ...unknown[]],
  b: readonly [number, number, ...unknown[]],
): number {
  const toRad = Math.PI / 180;
  const [lon1, lat1] = a;
  const [lon2, lat2] = b;
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(s)));
}

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
export function buildStationHubs(stations: StationInfo[], cache = true): StationHub[] {
  if (cache && stations === cachedStations) {
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

  if (cache) {
    cachedStations = stations;
    cachedHubs = hubs;
    cachedStopToHub = new Map();
    for (const hub of hubs) {
      for (const stop of hub.stops) {
        cachedStopToHub.set(stopKey(stop.routeIdx, stop.stationIdx), hub);
      }
    }
  }

  return hubs;
}

export function findStationHub(stations: StationInfo[], routeIdx: number, stationIdx: number): StationHub | null {
  buildStationHubs(stations, true);
  return cachedStopToHub.get(stopKey(routeIdx, stationIdx)) ?? null;
}

/**
 * Attaches computed `hubId` to every station in `lines`, enabling landmark 3D
 * station overrides and hub-wide queries to match stations across lines.
 */
export function assignStationHubIds(lines: LineGeometry[]): void {
  const stationInfos: StationInfo[] = [];
  const lineIndexByKey = new Map<string, number>();

  for (let rIdx = 0; rIdx < lines.length; rIdx++) {
    const line = lines[rIdx];
    lineIndexByKey.set(line.key, rIdx);
    for (let sIdx = 0; sIdx < line.stations.length; sIdx++) {
      const st = line.stations[sIdx];
      stationInfos.push({
        route_idx: rIdx,
        station_idx: sIdx,
        code: st.code ?? "",
        name_en: st.name,
        name_th: st.nameTh,
        x: st.position?.[0] ?? 0,
        y: st.position?.[1] ?? 0,
        z: st.position?.[2] ?? 0,
        arc_m: 0,
        interchanges: [],
      });
    }
  }

  const infoByStop = new Map<string, StationInfo>();
  for (const info of stationInfos) {
    infoByStop.set(stopKey(info.route_idx, info.station_idx), info);
  }

  // 1. Link stations within 300 m across different lines
  for (let i = 0; i < stationInfos.length; i++) {
    const stA = stationInfos[i];
    const lineA = lines[stA.route_idx];
    const posA = lineA.stations[stA.station_idx]?.position;
    if (!posA || (posA[0] === 0 && posA[1] === 0)) continue;

    for (let j = i + 1; j < stationInfos.length; j++) {
      const stB = stationInfos[j];
      if (stA.route_idx === stB.route_idx) continue;
      const lineB = lines[stB.route_idx];
      const posB = lineB.stations[stB.station_idx]?.position;
      if (!posB || (posB[0] === 0 && posB[1] === 0)) continue;

      if (haversineMeters(posA, posB) <= 300) {
        stA.interchanges.push({ route_idx: stB.route_idx, station_idx: stB.station_idx });
        stB.interchanges.push({ route_idx: stA.route_idx, station_idx: stA.station_idx });
      }
    }
  }

  // 2. Apply INTERCHANGE_OVERRIDES (imported from ../../tools/lines.config.mjs)
  for (const override of INTERCHANGE_OVERRIDES) {
    const rIdxA = lineIndexByKey.get(override.aLine);
    const rIdxB = lineIndexByKey.get(override.bLine);
    if (rIdxA === undefined || rIdxB === undefined) continue;

    const lineA = lines[rIdxA];
    const lineB = lines[rIdxB];

    let matchedAIdx: number | null = null;
    let matchedBIdx: number | null = null;

    for (let sIdx = 0; sIdx < lineA.stations.length; sIdx++) {
      const s = lineA.stations[sIdx];
      if (s.code === override.aStop || String(s.id) === override.aStop) {
        matchedAIdx = sIdx;
        break;
      }
    }
    for (let sIdx = 0; sIdx < lineB.stations.length; sIdx++) {
      const s = lineB.stations[sIdx];
      if (s.code === override.bStop || String(s.id) === override.bStop) {
        matchedBIdx = sIdx;
        break;
      }
    }

    if (matchedAIdx !== null && matchedBIdx !== null) {
      const infoA = infoByStop.get(stopKey(rIdxA, matchedAIdx));
      const infoB = infoByStop.get(stopKey(rIdxB, matchedBIdx));
      if (infoA && infoB) {
        infoA.interchanges.push({ route_idx: rIdxB, station_idx: matchedBIdx });
        infoB.interchanges.push({ route_idx: rIdxA, station_idx: matchedAIdx });
      }
      continue;
    }

    let closestA: number | null = null;
    let closestB: number | null = null;
    let minD = Infinity;

    for (let sIdxA = 0; sIdxA < lineA.stations.length; sIdxA++) {
      const posA = lineA.stations[sIdxA]?.position;
      if (!posA || (posA[0] === 0 && posA[1] === 0)) continue;
      for (let sIdxB = 0; sIdxB < lineB.stations.length; sIdxB++) {
        const posB = lineB.stations[sIdxB]?.position;
        if (!posB || (posB[0] === 0 && posB[1] === 0)) continue;
        const d = haversineMeters(posA, posB);
        if (d <= 600 && d < minD) {
          minD = d;
          closestA = sIdxA;
          closestB = sIdxB;
        }
      }
    }

    if (closestA !== null && closestB !== null) {
      const infoA = infoByStop.get(stopKey(rIdxA, closestA));
      const infoB = infoByStop.get(stopKey(rIdxB, closestB));
      if (infoA && infoB) {
        infoA.interchanges.push({ route_idx: rIdxB, station_idx: closestB });
        infoB.interchanges.push({ route_idx: rIdxA, station_idx: closestA });
      }
    }
  }

  const hubs = buildStationHubs(stationInfos, false);
  for (const hub of hubs) {
    for (const stop of hub.stops) {
      const st = lines[stop.routeIdx]?.stations[stop.stationIdx];
      if (st && !st.hubId) {
        st.hubId = hub.id;
      }
    }
  }
}

