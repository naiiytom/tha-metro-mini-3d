import { describe, expect, it } from "vitest";
import { filterStations, nearestStation } from "./stationSearch";
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
