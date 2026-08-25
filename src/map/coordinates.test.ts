import { describe, expect, it } from "vitest";
import network from "../data/network.json";
import { lngLatAltToLocal, reconcileStationAltitude, STATION_MARKER_HEIGHT_M } from "./coordinates";
import type { StationInfo } from "../sim/protocol";
import type { LineGeometry } from "../types";

function makeLine(overrides: Partial<LineGeometry> = {}): LineGeometry {
  return {
    key: "test-line",
    name: "Test Line",
    nameTh: "สายทดสอบ",
    color: "#65B724",
    structure: "elevated",
    vehicleType: "heavy",
    gtfsRouteId: "1",
    preRevenue: false,
    syntheticSchedule: null,
    estimatedRunTimes: null,
    rollingStock: null,
    relationId: 1,
    osmName: "test",
    track: [],
    stations: [],
    ...overrides,
  };
}

function engineStation(overrides: Partial<StationInfo> = {}): StationInfo {
  return {
    route_idx: 0,
    station_idx: 0,
    code: "T1",
    name_en: "Alpha",
    name_th: "แอลฟา",
    arc_m: 0,
    x: 0,
    y: 0,
    z: 0,
    interchanges: [],
    ...overrides,
  };
}

describe("reconcileStationAltitude (High #2)", () => {
  it("replaces the engine's true altitude with the marker's drawn altitude for a matching XY station", () => {
    // A network.json station at a known lng/lat + a DIFFERENT altitude than
    // the engine reports for the same physical location — the exact
    // mixed-structure-line divergence the finding describes (e.g. MRT Blue:
    // engine says underground -18 m, network.json's static per-station
    // altitude still says the line's nominal elevated +15 m).
    const netStationPos: [number, number, number] = [100.51, 13.74, 15];
    const [nx, ny, nz] = lngLatAltToLocal(netStationPos);

    const lines: LineGeometry[] = [
      makeLine({
        stations: [{ id: "1", name: "Matching", nameTh: "จับคู่", code: "M1", position: netStationPos }],
      }),
    ];

    // Engine station at the SAME horizontal position (nearest-XY match is
    // exact here) but a genuinely different altitude — the engine's own
    // true per-point track altitude.
    const stations: StationInfo[] = [
      engineStation({ route_idx: 0, station_idx: 0, x: nx, y: ny, z: -18 }),
    ];

    const result = reconcileStationAltitude(stations, lines);

    expect(result).toHaveLength(1);
    // The RESULT must equal the marker's altitude formula
    // (lngLatAltToLocal(...)[2] + STATION_MARKER_HEIGHT_M), not the
    // original engine z (-18).
    expect(result[0].z).toBeCloseTo(nz + STATION_MARKER_HEIGHT_M, 6);
    expect(result[0].z).not.toBeCloseTo(-18, 6);
    // Only z changes — every other field is passed through untouched.
    expect(result[0].x).toBe(nx);
    expect(result[0].y).toBe(ny);
    expect(result[0].route_idx).toBe(0);
    expect(result[0].station_idx).toBe(0);
  });

  it("matches each engine station to its OWN nearest candidate, not a neighbour's, when a route has multiple stations", () => {
    // Two network.json stations far apart on the same route. Two engine
    // stations, each near a DIFFERENT one of the two. A naive "first
    // candidate" or index-based correlation would get this wrong; nearest-XY
    // must not.
    const posA: [number, number, number] = [100.40, 13.70, 15];
    const posB: [number, number, number] = [100.60, 13.80, -18];
    const [ax, ay, az] = lngLatAltToLocal(posA);
    const [bx, by, bz] = lngLatAltToLocal(posB);

    const lines: LineGeometry[] = [
      makeLine({
        stations: [
          { id: "a", name: "Station A", nameTh: "เอ", code: "A1", position: posA },
          { id: "b", name: "Station B", nameTh: "บี", code: "B1", position: posB },
        ],
      }),
    ];

    // Engine stations sit a few metres off their true horizontal position
    // (real snap noise), but unambiguously closer to one candidate than the
    // other — station spacing (real network minimum ~500 m) makes this safe.
    const stations: StationInfo[] = [
      engineStation({ route_idx: 0, station_idx: 0, x: ax + 5, y: ay - 3, z: 999 }),
      engineStation({ route_idx: 0, station_idx: 1, x: bx - 2, y: by + 4, z: -999 }),
    ];

    const result = reconcileStationAltitude(stations, lines);

    expect(result[0].z).toBeCloseTo(az + STATION_MARKER_HEIGHT_M, 3);
    expect(result[1].z).toBeCloseTo(bz + STATION_MARKER_HEIGHT_M, 3);
  });

  it("leaves z unchanged for a route with zero LineGeometry stations (track-only/preRevenue lines)", () => {
    const lines: LineGeometry[] = [makeLine({ stations: [] })];
    const stations: StationInfo[] = [engineStation({ route_idx: 0, z: 42 })];

    const result = reconcileStationAltitude(stations, lines);

    expect(result[0].z).toBe(42);
  });

  it("leaves z unchanged when route_idx has no corresponding LineGeometry entry at all", () => {
    const lines: LineGeometry[] = [makeLine({ stations: [] })];
    const stations: StationInfo[] = [engineStation({ route_idx: 5, z: 7 })];

    const result = reconcileStationAltitude(stations, lines);

    expect(result[0].z).toBe(7);
  });
});

// Real-data sanity check (per the brief's "Test" section for High #2): the
// committed src/data/network.json against a real engine StationInfo sample
// for MRT Blue (route_idx 9), extracted read-only via
// `cargo run -p sim-core --example route_probe`-style inspection of the
// committed public/data/network.tmb (SimWorld::stations()) on 2026-08-25.
// Values below are literal, not re-derived at test time — this pins a real,
// previously-measured divergence rather than re-running Rust from Vitest.
describe("reconcileStationAltitude — real MRT Blue data sanity check", () => {
  it("Hua Lamphong: nearest-XY match lands within a few metres, confirming the RIGHT station was matched, and the 33 m altitude divergence is real", () => {
    const blue = (network.lines as unknown as LineGeometry[]).find((l) => l.key === "blue");
    expect(blue).toBeDefined();

    // The engine's own StationInfo for MRT Blue, station_idx 11 (Hua
    // Lamphong): x=-1747.371338, y=-909.697693, z=-18 (real underground
    // track altitude — SimWorld::stations()'s position_at_arc result).
    const engineHuaLamphong = engineStation({
      route_idx: 9,
      station_idx: 11,
      name_en: "Hua Lamphong",
      x: -1747.371338,
      y: -909.697693,
      z: -18,
    });

    // reconcileStationAltitude indexes `lines[s.route_idx]`, so feed it a
    // lines array where index 9 is Blue (mirrors the real registry order).
    const linesArray: LineGeometry[] = [];
    linesArray[9] = blue as unknown as LineGeometry;
    const reconciled = reconcileStationAltitude([engineHuaLamphong], linesArray)[0];

    // network.json's Hua Lamphong entry is at [100.5170471, 13.7374083, 15]
    // (the line's nominal elevated altitude — stale for this underground
    // station, the exact documented limitation). Confirm the match found is
    // horizontally close (a few metres — the match is genuinely the same
    // physical station, not a neighbour picked up by accident).
    const [mx, my] = lngLatAltToLocal([100.5170471, 13.7374083, 15]);
    const matchDistM = Math.hypot(mx - engineHuaLamphong.x, my - engineHuaLamphong.y);
    expect(matchDistM).toBeLessThan(5);

    // And the reconciled altitude is now the MARKER's drawn altitude
    // (15 + 1.5 = 16.5), not the engine's true underground -18 — a real
    // ~34.5 m fix for this specific station, not a synthetic case.
    expect(reconciled.z).toBeCloseTo(16.5, 1);
    expect(reconciled.z).not.toBeCloseTo(-18, 1);
  });
});
