import { describe, expect, it } from "vitest";
import {
  countMatches,
  filterStations,
  formatDistance,
  geoErrorMessage,
  groupByRoute,
  nearestStation,
  stationOptions,
} from "./stationSearch";
import type { StationInfo } from "../sim/protocol";

function makeStation(overrides: Partial<StationInfo>): StationInfo {
  return {
    route_idx: 0,
    station_idx: 0,
    code: "",
    name_en: "",
    name_th: "",
    arc_m: 0,
    x: 0,
    y: 0,
    z: 0,
    interchanges: [],
    ...overrides,
  };
}

describe("filterStations", () => {
  const stations = [
    makeStation({ station_idx: 0, name_en: "Siam", name_th: "สยาม" }),
    makeStation({ station_idx: 1, name_en: "Asok", name_th: "อโศก" }),
    makeStation({ station_idx: 2, name_en: "Mo Chit", name_th: "หมอชิต" }),
  ];

  it("returns nothing for an empty or whitespace-only query", () => {
    expect(filterStations(stations, "")).toEqual([]);
    expect(filterStations(stations, "   ")).toEqual([]);
  });

  it("matches English names case-insensitively", () => {
    expect(filterStations(stations, "siam").map((s) => s.name_en)).toEqual(["Siam"]);
    expect(filterStations(stations, "SIAM").map((s) => s.name_en)).toEqual(["Siam"]);
  });

  it("matches Thai names", () => {
    expect(filterStations(stations, "อโศก").map((s) => s.name_en)).toEqual(["Asok"]);
  });

  it("matches substrings, not just prefixes", () => {
    expect(filterStations(stations, "chit").map((s) => s.name_en)).toEqual(["Mo Chit"]);
  });

  it("caps results at 8, ordered by English name", () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      makeStation({ station_idx: i, name_en: `Station ${String(i).padStart(2, "0")}` }),
    );
    const result = filterStations(many, "station");
    expect(result).toHaveLength(8);
    expect(result[0].name_en).toBe("Station 00");
    expect(result[7].name_en).toBe("Station 07");
  });
});

describe("countMatches", () => {
  it("returns the TRUE match count, uncapped by MAX_RESULTS (Low #6)", () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      makeStation({ station_idx: i, name_en: `Station ${String(i).padStart(2, "0")}` }),
    );
    // filterStations caps this same query at 8; countMatches must not.
    expect(filterStations(many, "station")).toHaveLength(8);
    expect(countMatches(many, "station")).toBe(12);
  });

  it("returns the full station count for an empty query", () => {
    const stations = [makeStation({ name_en: "Siam" }), makeStation({ name_en: "Asok" })];
    expect(countMatches(stations, "")).toBe(2);
    expect(countMatches(stations, "   ")).toBe(2);
  });

  it("agrees with filterStations when under the cap", () => {
    const stations = [
      makeStation({ station_idx: 0, name_en: "Siam" }),
      makeStation({ station_idx: 1, name_en: "Asok" }),
      makeStation({ station_idx: 2, name_en: "Mo Chit" }),
    ];
    expect(countMatches(stations, "si")).toBe(filterStations(stations, "si").length);
  });
});

describe("nearestStation", () => {
  const stations = [
    makeStation({ station_idx: 0, name_en: "Near", x: 10, y: 0 }),
    makeStation({ station_idx: 1, name_en: "Far", x: 1000, y: 0 }),
  ];

  it("picks the closest station by Euclidean distance in the local ENU frame", () => {
    const result = nearestStation([0, 0], stations);
    expect(result?.station.name_en).toBe("Near");
    expect(result?.distanceM).toBeCloseTo(10, 5);
  });

  it("returns null for an empty station list", () => {
    expect(nearestStation([0, 0], [])).toBeNull();
  });
});

const s = (routeIdx: number, stationIdx: number, nameEn: string, arcM: number): StationInfo => ({
  route_idx: routeIdx,
  station_idx: stationIdx,
  code: "",
  name_en: nameEn,
  name_th: "",
  arc_m: arcM,
  x: 0,
  y: 0,
  z: 0,
  interchanges: [],
});

describe("stationOptions", () => {
  const stations = [s(1, 0, "Bang Wa", 0), s(0, 1, "Asok", 100), s(0, 0, "Siam", 0)];

  it("returns EVERY station for an empty query — the field must be browsable", () => {
    expect(stationOptions(stations, "")).toHaveLength(3);
    expect(stationOptions(stations, "   ")).toHaveLength(3);
  });

  it("orders an empty query by route, then along the line", () => {
    expect(stationOptions(stations, "").map((x) => x.name_en)).toEqual(["Siam", "Asok", "Bang Wa"]);
  });

  it("does not cap the browse list", () => {
    const many = Array.from({ length: 50 }, (_, i) => s(0, i, `S${i}`, i));
    expect(stationOptions(many, "")).toHaveLength(50);
  });

  it("falls through to filterStations for a real query", () => {
    expect(stationOptions(stations, "sia").map((x) => x.name_en)).toEqual(["Siam"]);
  });

  it("honours the limit only for a real query", () => {
    const many = Array.from({ length: 50 }, (_, i) => s(0, i, `Station ${i}`, i));
    expect(stationOptions(many, "Station", 5)).toHaveLength(5);
  });

  // Minor #12 regression: `stationOptions`'s non-empty-query branch used to
  // do `filterStations(stations, query).slice(0, limit)` — but
  // `filterStations` ALWAYS internally capped to its own MAX_RESULTS (8)
  // first, so a `limit` greater than 8 was silently ignored (double-slice:
  // the outer .slice(0, 20) on an array already capped at 8 can never
  // return more than 8). No production caller passed a custom `limit` at
  // the time this was found, so it was dormant, not user-visible — this
  // proves it's fixed for the next caller that does. Must FAIL against the
  // pre-fix code (result capped at 8) and PASS after (`filterStations`'s
  // own `limit` param now threads through instead of a hardcoded internal
  // cap).
  it("respects a limit greater than filterStations' own internal default cap", () => {
    const many = Array.from({ length: 50 }, (_, i) => s(0, i, `Station ${i}`, i));
    expect(stationOptions(many, "Station", 15)).toHaveLength(15);
  });
});

describe("groupByRoute", () => {
  it("groups in first-appearance order, preserving order within a group", () => {
    const grouped = groupByRoute([s(0, 0, "Siam", 0), s(1, 0, "Bang Wa", 0), s(0, 1, "Asok", 100)]);
    expect(grouped).toEqual([
      {
        routeIdx: 0,
        stations: [expect.objectContaining({ name_en: "Siam" }), expect.objectContaining({ name_en: "Asok" })],
      },
      { routeIdx: 1, stations: [expect.objectContaining({ name_en: "Bang Wa" })] },
    ]);
  });

  it("returns nothing for an empty list", () => {
    expect(groupByRoute([])).toEqual([]);
  });
});

describe("geoErrorMessage and formatDistance", () => {
  it("formats geolocation error codes accurately", () => {
    expect(geoErrorMessage({ code: 1 })).toBe("Location permission denied.");
    expect(geoErrorMessage({ code: 2 })).toBe("Location unavailable.");
    expect(geoErrorMessage({ code: 3 })).toBe("Location request timed out.");
    expect(geoErrorMessage({ code: 99 })).toBe("Could not determine your location.");
  });

  it("formats distances in meters or kilometers", () => {
    expect(formatDistance(350)).toBe("350 m");
    expect(formatDistance(999.4)).toBe("999 m");
    expect(formatDistance(1000)).toBe("1.0 km");
    expect(formatDistance(2450)).toBe("2.5 km");
  });
});


