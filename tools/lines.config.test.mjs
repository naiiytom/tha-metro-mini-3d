import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  assertRegistryValid,
  INTERCHANGE_OVERRIDES,
  LINES,
  STRUCTURE_ALTITUDE_M,
  structureOfWay,
} from "./lines.config.mjs";

describe("line registry", () => {
  it("is internally consistent", () => {
    expect(() => assertRegistryValid()).not.toThrow();
  });

  it("still starts with Sukhumvit then Silom", () => {
    // route_idx 0/1 are baked into the committed cache and every screenshot.
    expect(LINES[0].key).toBe("sukhumvit");
    expect(LINES[1].key).toBe("silom");
  });

  it("rejects two default claimants of one GTFS route id", () => {
    // Two lines owning one route with nothing to tell their trips apart.
    const dup = [LINES[0], { ...LINES[1], gtfsRouteId: LINES[0].gtfsRouteId }];
    expect(() => assertRegistryValid(dup)).toThrow(/duplicate gtfsRouteId/);
  });

  it("allows two lines to share a route id when one claims specific stops", () => {
    // The real MRT Pink shape (issue #15): trunk is the default claimant, the
    // IMPACT Link spur claims its own stops.
    // Appended to the real registry rather than run as a 2-line subset, so
    // INTERCHANGE_OVERRIDES still resolves (it names lines by key).
    const split = [
      ...LINES,
      { ...LINES[1], key: "extra-spur", gtfsRouteId: LINES[1].gtfsRouteId, claimGtfsStopIds: ["zz"] },
    ];
    expect(() => assertRegistryValid(split)).not.toThrow();
  });

  it("rejects two claimants of one route both claiming the same stop", () => {
    const overlap = [
      LINES[0],
      { ...LINES[1], key: "a", gtfsRouteId: LINES[0].gtfsRouteId, claimGtfsStopIds: ["X"] },
      { ...LINES[2], key: "b", gtfsRouteId: LINES[0].gtfsRouteId, claimGtfsStopIds: ["X"] },
    ];
    expect(() => assertRegistryValid(overlap)).toThrow(/both claim stop 'X'/);
  });

  it("rejects claimGtfsStopIds on a line with no route id to claim from", () => {
    const orphan = [{ ...LINES[0], gtfsRouteId: null, claimGtfsStopIds: ["X"] }];
    expect(() => assertRegistryValid(orphan)).toThrow(/needs a gtfsRouteId/);
  });

  it("rejects a route whose only claimant declares claimGtfsStopIds", () => {
    // No default claimant means the route's other trips land nowhere. Caught
    // here rather than at preprocess time, which would be after data:fetch has
    // already overwritten network.json.
    const orphan = [{ ...LINES[0], claimGtfsStopIds: ["zz"] }];
    expect(() => assertRegistryValid(orphan)).toThrow(/no line takes the route's remaining trips/);
  });

  it("rejects an empty claimGtfsStopIds array", () => {
    // An empty array would silently read as "default claimant" and quietly
    // create a second default for the route.
    const empty = [{ ...LINES[0], claimGtfsStopIds: [] }];
    expect(() => assertRegistryValid(empty)).toThrow(/non-empty array/);
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

  /** The real registry with one line patched — keeps INTERCHANGE_OVERRIDES resolvable. */
  const patched = (key, patch) => LINES.map((l) => (l.key === key ? { ...l, ...patch } : l));

  it("rejects an estimatedRunTimes basis that is not a registry line", () => {
    const bad = patched("pink", { estimatedRunTimes: { basisLine: "nope" } });
    expect(() => assertRegistryValid(bad)).toThrow(/basisLine 'nope' is not a registry line/);
  });

  it("rejects an estimatedRunTimes basis that is not GTFS-simulated", () => {
    // `orange` is track-only (gtfsRouteId null), so it has no real feed rows
    // for a calibration to be derived from.
    const bad = patched("pink", { estimatedRunTimes: { basisLine: "orange" } });
    expect(() => assertRegistryValid(bad)).toThrow(/must have a gtfsRouteId/);
  });

  it("rejects an estimatedRunTimes basis that is itself estimated", () => {
    // Calibrating an estimate from an estimate compounds it.
    const bad = patched("yellow", { estimatedRunTimes: { basisLine: "silom" } });
    expect(() => assertRegistryValid(bad)).toThrow(/cannot itself have estimatedRunTimes/);
  });

  it("rejects a line that is its own estimatedRunTimes basis", () => {
    const bad = patched("pink", { estimatedRunTimes: { basisLine: "pink" } });
    expect(() => assertRegistryValid(bad)).toThrow(/points at itself/);
  });

  it("rejects estimatedRunTimes on a line with no gtfsRouteId", () => {
    const bad = patched("orange", { estimatedRunTimes: { basisLine: "yellow" } });
    expect(() => assertRegistryValid(bad)).toThrow(/only means something for a GTFS line/);
  });

  it("declares Yellow as the basis on both Pink entries", () => {
    const pink = LINES.filter((l) => l.key === "pink" || l.key === "pink-spur");
    expect(pink.length).toBe(2);
    for (const l of pink) expect(l.estimatedRunTimes?.basisLine).toBe("yellow");
  });
});

describe("interchange overrides", () => {
  /** The preprocessor reads overrides from network.json's own copy, NOT from
   *  the registry — editing only the registry silently no-ops with every step
   *  still reporting success. This is that footgun, made into a gate. */
  it("are byte-for-byte in sync with network.json's own copy", () => {
    const network = JSON.parse(
      readFileSync(new URL("../src/data/network.json", import.meta.url), "utf8"),
    );
    expect(network.interchangeOverrides).toEqual(INTERCHANGE_OVERRIDES);
  });

  it("links the Suvarnabhumi APM to the Airport Rail Link", () => {
    // Without this the APM is a permanently disconnected component of the
    // routing graph and every plan to or from its two stations reports "no
    // route". The APM has no GTFS route, so its stations carry their OSM node
    // ids as stop ids — hence the very different-looking b-side value.
    expect(INTERCHANGE_OVERRIDES).toContainEqual({
      aLine: "arl",
      aStop: "326",
      bLine: "apm",
      bStop: "13373875189",
    });
  });
});
