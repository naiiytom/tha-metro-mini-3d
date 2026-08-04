import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { assertRegistryValid, LINES, STRUCTURE_ALTITUDE_M, structureOfWay } from "./lines.config.mjs";

describe("line registry", () => {
  it("is internally consistent", () => {
    expect(() => assertRegistryValid()).not.toThrow();
  });

  it("still starts with Sukhumvit then Silom", () => {
    // route_idx 0/1 are baked into the committed cache and every screenshot.
    expect(LINES[0].key).toBe("sukhumvit");
    expect(LINES[1].key).toBe("silom");
  });

  it("rejects a duplicate GTFS route id", () => {
    const dup = [LINES[0], { ...LINES[1], gtfsRouteId: LINES[0].gtfsRouteId }];
    expect(() => assertRegistryValid(dup)).toThrow(/duplicate gtfsRouteId/);
  });

  it("rejects an unknown structure", () => {
    const bad = [{ ...LINES[0], structure: "floating" }];
    expect(() => assertRegistryValid(bad)).toThrow(/unknown structure/);
  });

  it("matches the committed src/data/network.json line order", () => {
    // This is the invariant the whole registry-driven pipeline rests on
    // (route_idx == network.json lines[i] == LINES[i]) — a preprocessor rebuild
    // is the only thing that otherwise catches a stale committed data file,
    // and it isn't run in CI. A duplicate-gtfsRouteId regression like the one
    // this PR review caught would silently desync the two without this check.
    const doc = JSON.parse(readFileSync(new URL("../src/data/network.json", import.meta.url)));
    expect(doc.lines.map((l) => l.key)).toEqual(LINES.map((l) => l.key));
  });

  it("prices every structure the SRS defines", () => {
    expect(STRUCTURE_ALTITUDE_M.elevated).toBeGreaterThanOrEqual(12);
    expect(STRUCTURE_ALTITUDE_M.elevated).toBeLessThanOrEqual(22);
    expect(STRUCTURE_ALTITUDE_M.atGrade).toBeGreaterThan(0);
    expect(STRUCTURE_ALTITUDE_M.underground).toBeLessThanOrEqual(-12);
  });

  it("classifies OSM ways the same way the TS copy does", () => {
    // structureOfWay is duplicated (node can't import the .ts). If these two
    // ever drift, the fetcher stamps one structure and the renderer expects
    // another.
    expect(structureOfWay({ tunnel: "yes" })).toBe("underground");
    expect(structureOfWay({ bridge: "yes" })).toBe("elevated");
    expect(structureOfWay({ layer: "-2" })).toBe("underground");
    expect(structureOfWay({}, "atGrade")).toBe("atGrade");
  });

  it("refuses to simulate a pre-revenue line", () => {
    const bad = [{ ...LINES[0], preRevenue: true }];
    expect(() => assertRegistryValid(bad)).toThrow(/must have gtfsRouteId: null/);
  });

  it("rejects a non-array snapWarnExemptStopIds", () => {
    const bad = [{ ...LINES[0], snapWarnExemptStopIds: "13627" }];
    expect(() => assertRegistryValid(bad)).toThrow(/snapWarnExemptStopIds/);
  });

  it("treats tunnel=building_passage as covered, not underground", () => {
    // Real Bangkok data: SRT Dark/Light Red are tagged tunnel=building_passage
    // + layer=1 (positive) where they pass through Bang Sue Grand Station —
    // an elevated line passing through a station building, not a bored
    // tunnel. See the matching comment on the TS copy in src/map/structure.ts.
    expect(structureOfWay({ tunnel: "building_passage", layer: "1" })).toBe("elevated");
    expect(structureOfWay({ tunnel: "building_passage" })).toBe("elevated");
  });
});
