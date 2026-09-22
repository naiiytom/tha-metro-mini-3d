import { describe, expect, it } from "vitest";
import type { StationInfo } from "../sim/protocol";
import { buildStationHubs } from "./stationHubs";

function station(overrides: Partial<StationInfo>): StationInfo {
  return { route_idx: 0, station_idx: 0, code: "", name_en: "", name_th: "", arc_m: 0, x: 0, y: 0, z: 0, interchanges: [], ...overrides };
}

describe("buildStationHubs", () => {
  it("joins interchange-connected stops, using a compound name when operators differ", () => {
    const hubs = buildStationHubs([
      station({ route_idx: 0, station_idx: 4, code: "E4", name_en: "Asok", name_th: "อโศก", x: 10, interchanges: [{ route_idx: 1, station_idx: 8 }] }),
      station({ route_idx: 1, station_idx: 8, code: "BL22", name_en: "Sukhumvit", name_th: "สุขุมวิท", x: 14, interchanges: [{ route_idx: 0, station_idx: 4 }] }),
    ], []);

    expect(hubs).toHaveLength(1);
    expect(hubs[0]).toMatchObject({ id: "hub:asok-sukhumvit", nameEn: "Asok / Sukhumvit", nameTh: "อโศก / สุขุมวิท", routeIndices: [0, 1], x: 12 });
    expect(hubs[0].stops).toHaveLength(2);
  });

  it("joins identical normalized names even without an explicit interchange edge", () => {
    const hubs = buildStationHubs([
      station({ route_idx: 0, station_idx: 1, name_en: "Siam", name_th: "สยาม" }),
      station({ route_idx: 2, station_idx: 3, name_en: " SIAM ", name_th: "สยาม" }),
    ], []);

    expect(hubs).toHaveLength(1);
    expect(hubs[0].nameEn).toBe("Siam");
  });
});
