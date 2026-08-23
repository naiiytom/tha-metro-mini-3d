import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  assertRegistryValid,
  INTERCHANGE_OVERRIDES,
  LINES,
  NETWORK_LINE_FIELD_ORDER,
  NOSE_PROFILES,
  ROOF_KITS,
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
    // rollingStock is cleared to isolate the gtfsRouteId check under test:
    // Task 3 gave every revenue line (including LINES[0]) a rollingStock
    // block, and its own "preRevenue must not declare rollingStock" check
    // sits earlier in the per-line loop and would otherwise fire first.
    const bad = [{ ...LINES[0], preRevenue: true, rollingStock: undefined }];
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

describe("extraStationNodeIds", () => {
  /** The mechanism only pays off if the node it names actually survives into
   *  network.json. Nothing else can see that: network.registry.test.ts checks
   *  line order/colour/structure/gtfsRouteId, and the preprocessor's snap
   *  gates only ever measure a station that IS there — a MISSING one is
   *  structurally invisible to them. That is exactly how Mo Chit was dropped
   *  by a re-fetch (333b799) with every gate still green. Same guard shape as
   *  the interchange-override sync test above. */
  it("every declared node is present in that line's network.json stations", () => {
    const network = JSON.parse(
      readFileSync(new URL("../src/data/network.json", import.meta.url), "utf8"),
    );
    const declared = LINES.filter((l) => l.osm?.extraStationNodeIds?.length);
    // Guard the guard: if the registry ever stops using the mechanism this
    // test would pass vacuously and nobody would notice.
    expect(declared.length).toBeGreaterThan(0);
    for (const line of declared) {
      const stations = network.lines.find((l) => l.key === line.key)?.stations;
      expect(stations, `${line.key} missing from network.json`).toBeDefined();
      const ids = new Set(stations.map((s) => s.id));
      for (const node of line.osm.extraStationNodeIds) {
        expect(ids.has(node.id), `${line.key}: node ${node.id} is not in network.json`).toBe(true);
      }
    }
  });
});

describe("rollingStock", () => {
  const base = () => structuredClone(LINES[0]);

  it("is declared on every revenue line and on no pre-revenue line", () => {
    for (const line of LINES) {
      if (line.preRevenue) {
        expect(line.rollingStock ?? null, `${line.key}`).toBeNull();
      } else {
        expect(line.rollingStock, `${line.key}`).toBeTruthy();
      }
    }
  });

  it("gives BTS 4-car sets, the MRT/ARL 3-car sets and the people movers 2 cars", () => {
    const cars = Object.fromEntries(
      LINES.filter((l) => l.rollingStock).map((l) => [l.key, l.rollingStock.cars]),
    );
    expect(cars.sukhumvit).toBe(4);
    expect(cars.silom).toBe(4);
    expect(cars.blue).toBe(3);
    expect(cars.purple).toBe(3);
    expect(cars.arl).toBe(3);
    expect(cars.gold).toBe(2);
    expect(cars.apm).toBe(2);
  });

  it("gives a pantograph only to the overhead-line stock", () => {
    const overhead = LINES.filter((l) => l.rollingStock?.roof === "pantograph").map((l) => l.key);
    expect(overhead.sort()).toEqual(["arl", "red-dark", "red-light"]);
  });

  it("rejects a pre-revenue line that declares rolling stock", () => {
    const line = { ...base(), key: "ghost", preRevenue: true, gtfsRouteId: null };
    expect(() => assertRegistryValid([line])).toThrow(/preRevenue.*rollingStock/);
  });

  it("rejects a cab longer than the car it is the front of", () => {
    const line = base();
    line.rollingStock = { ...line.rollingStock, cabLengthM: line.rollingStock.carLengthM };
    expect(() => assertRegistryValid([line])).toThrow(/cabLengthM/);
  });

  it("rejects a band that hangs off the shell", () => {
    const line = base();
    line.rollingStock = {
      ...line.rollingStock,
      bands: [{ zM: line.rollingStock.heightM, heightM: 1, tint: "route" }],
    };
    expect(() => assertRegistryValid([line])).toThrow(/outside the car shell/);
  });

  it("rejects an unknown nose profile and an unknown roof kit", () => {
    const nosed = base();
    nosed.rollingStock = { ...nosed.rollingStock, nose: "wedge" };
    expect(() => assertRegistryValid([nosed])).toThrow(/nose/);
    const roofed = base();
    roofed.rollingStock = { ...roofed.rollingStock, roof: "trolleypole" };
    expect(() => assertRegistryValid([roofed])).toThrow(/roof/);
  });

  it("rejects a shell declared as the route sentinel", () => {
    const line = base();
    line.rollingStock = { ...line.rollingStock, shell: "route" };
    expect(() => assertRegistryValid([line])).toThrow(/shell/);
  });

  it("rejects a fractional car count", () => {
    const line = base();
    line.rollingStock = { ...line.rollingStock, cars: 3.5 };
    expect(() => assertRegistryValid([line])).toThrow(/cars/);
  });

  it("puts the identity band first on every line, so the nose takes the route colour", () => {
    for (const line of LINES) {
      if (!line.rollingStock) continue;
      expect(line.rollingStock.bands[0].tint, `${line.key}`).toBe("route");
    }
  });

  it("enumerates every nose profile and roof kit the renderer knows", () => {
    // Copy before sorting — sort() mutates in place, and these are the
    // exported arrays the validator itself reads.
    expect([...NOSE_PROFILES].sort()).toEqual(["blunt", "raked", "rounded"]);
    expect([...ROOF_KITS].sort()).toEqual(["none", "pantograph"]);
  });
});

describe("rollingStock sync", () => {
  const network = JSON.parse(
    readFileSync(new URL("../src/data/network.json", import.meta.url), "utf8"),
  );

  it("is byte-for-byte in sync with network.json's own copy", () => {
    // Same footgun INTERCHANGE_OVERRIDES and extraStationNodeIds already
    // guard: the frontend reads network.json, NOT the registry, so editing
    // the registry alone changes nothing on screen while every step still
    // reports success.
    expect(network.lines.length).toBe(LINES.length);
    for (let i = 0; i < LINES.length; i++) {
      expect(network.lines[i].key).toBe(LINES[i].key);
      expect(network.lines[i].rollingStock ?? null, LINES[i].key).toEqual(
        LINES[i].rollingStock ?? null,
      );
    }
  });

  it("records the hand patch, since network.json was patched and not re-fetched", () => {
    expect(network.handPatches?.some((p) => p.note.includes("rollingStock"))).toBe(true);
  });
});

describe("network.json field order", () => {
  const network = JSON.parse(
    readFileSync(new URL("../src/data/network.json", import.meta.url), "utf8"),
  );

  // The whole point of patching network.json instead of re-fetching is that a
  // future real `data:fetch` lands as a no-op diff, so any line that DOES move
  // is upstream OSM drift and nothing else. A hand patch that appends its new
  // field rather than slotting it into fetch-network.mjs's own order silently
  // destroys that: the next fetch re-serializes all 14 lines and the diff is
  // the whole file. `estimatedRunTimes` and `rollingStock` were both in that
  // state until code review 2026-08-23, with every other gate green.
  it("matches the order fetch-network.mjs writes, so a real fetch is a no-op diff", () => {
    for (const line of network.lines) {
      const leading = Object.keys(line).slice(0, NETWORK_LINE_FIELD_ORDER.length);
      expect(leading, line.key).toEqual(NETWORK_LINE_FIELD_ORDER);
    }
  });

  it("puts every geometry key after the fixed fields, never interleaved", () => {
    // fetch-network.mjs spreads `...geom` last, so anything beyond the fixed
    // prefix is geometry — but nothing from the prefix may reappear there.
    for (const line of network.lines) {
      const trailing = Object.keys(line).slice(NETWORK_LINE_FIELD_ORDER.length);
      for (const key of trailing) {
        expect(NETWORK_LINE_FIELD_ORDER, `${line.key}.${key}`).not.toContain(key);
      }
    }
  });
});
