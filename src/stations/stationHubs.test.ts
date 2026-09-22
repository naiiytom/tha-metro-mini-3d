import { describe, expect, it } from "vitest";
import type { StationInfo } from "../sim/protocol";
import { buildStationHubs, findStationHub, normalizedName } from "./stationHubs";

function station(overrides: Partial<StationInfo>): StationInfo {
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

describe("normalizedName", () => {
  it("trims and normalizes whitespace and punctuation", () => {
    expect(normalizedName("  Asok - Sukhumvit!  ")).toBe("asok sukhumvit");
  });

  it("preserves Thai vowels and tone marks", () => {
    expect(normalizedName(" สุขุมวิท ")).toBe("สุขุมวิท");
    expect(normalizedName("อโศก")).toBe("อโศก");
  });

  it("does not conflate distinct Thai words that differ by vowel marks", () => {
    expect(normalizedName("ชิด")).not.toBe(normalizedName("ชุด"));
  });
});

describe("buildStationHubs", () => {
  it("joins interchange-connected stops, using a compound name when operators differ", () => {
    const hubs = buildStationHubs([
      station({ route_idx: 0, station_idx: 4, code: "E4", name_en: "Asok", name_th: "อโศก", x: 10, y: 20, z: 12, interchanges: [{ route_idx: 1, station_idx: 8 }] }),
      station({ route_idx: 1, station_idx: 8, code: "BL22", name_en: "Sukhumvit", name_th: "สุขุมวิท", x: 14, y: 24, z: -10, interchanges: [{ route_idx: 0, station_idx: 4 }] }),
    ]);

    expect(hubs).toHaveLength(1);
    expect(hubs[0]).toMatchObject({
      id: "hub:asok-sukhumvit",
      nameEn: "Asok / Sukhumvit",
      nameTh: "อโศก / สุขุมวิท",
      routeIndices: [0, 1],
      x: 12,
      y: 22,
      z: 1,
    });
    expect(hubs[0].stops).toHaveLength(2);
  });

  it("joins identical normalized names even without an explicit interchange edge", () => {
    const hubs = buildStationHubs([
      station({ route_idx: 0, station_idx: 1, name_en: "Siam", name_th: "สยาม" }),
      station({ route_idx: 2, station_idx: 3, name_en: " SIAM ", name_th: "สยาม" }),
    ]);

    expect(hubs).toHaveLength(1);
    expect(hubs[0].nameEn).toBe("Siam");
    expect(hubs[0].nameTh).toBe("สยาม");
    expect(hubs[0].routeIndices).toEqual([0, 2]);
  });

  it("joins identical normalized Thai names", () => {
    const hubs = buildStationHubs([
      station({ route_idx: 0, station_idx: 5, name_en: "Mo Chit", name_th: "หมอชิต" }),
      station({ route_idx: 1, station_idx: 12, name_en: "Chatuchak Park", name_th: "หมอชิต" }),
    ]);

    expect(hubs).toHaveLength(1);
    expect(hubs[0].nameTh).toBe("หมอชิต");
    expect(hubs[0].nameEn).toBe("Mo Chit / Chatuchak Park");
  });

  it("computes accurate centroid coordinates across multiple member stops", () => {
    const hubs = buildStationHubs([
      station({ route_idx: 0, station_idx: 0, name_en: "HubA", x: 0, y: 10, z: 20 }),
      station({ route_idx: 1, station_idx: 0, name_en: "HubA", x: 30, y: 40, z: 50 }),
      station({ route_idx: 2, station_idx: 0, name_en: "HubA", x: 60, y: 70, z: 80 }),
    ]);

    expect(hubs).toHaveLength(1);
    expect(hubs[0].x).toBeCloseTo(30);
    expect(hubs[0].y).toBeCloseTo(40);
    expect(hubs[0].z).toBeCloseTo(50);
  });
});

describe("findStationHub", () => {
  const stations = [
    station({ route_idx: 0, station_idx: 4, name_en: "Asok", interchanges: [{ route_idx: 1, station_idx: 8 }] }),
    station({ route_idx: 1, station_idx: 8, name_en: "Sukhumvit", interchanges: [{ route_idx: 0, station_idx: 4 }] }),
    station({ route_idx: 3, station_idx: 1, name_en: "Solo" }),
  ];

  it("finds the hub containing the specified stop", () => {
    const hub = findStationHub(stations, 1, 8);
    expect(hub).not.toBeNull();
    expect(hub?.id).toBe("hub:asok-sukhumvit");
  });

  it("returns null when stop does not exist in any hub", () => {
    const hub = findStationHub(stations, 99, 99);
    expect(hub).toBeNull();
  });
});
