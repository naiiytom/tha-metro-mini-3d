import { describe, expect, it } from "vitest";
import { LINES } from "../../tools/lines.config.mjs";
import network from "./network.json";

describe("committed network.json matches the registry", () => {
  it("has the same lines in the same order", () => {
    // This is THE invariant: registry index == network.json lines[i] ==
    // cache routes[i] == vehicle-buffer route_idx. A stale committed
    // network.json (someone edited the registry without re-running
    // data:fetch) silently desyncs route_idx across the whole stack.
    const registryKeys = LINES.map((l) => l.key);
    const dataKeys = (network as { lines: { key: string }[] }).lines.map((l) => l.key);
    expect(dataKeys).toEqual(registryKeys);
  });

  it("agrees with the registry on colour, structure and simulated-ness", () => {
    const data = network as {
      lines: { key: string; color: string; structure: string; gtfsRouteId: string | null }[];
    };
    for (const [i, line] of LINES.entries()) {
      expect(data.lines[i].color, `${line.key} colour`).toBe(line.color);
      // The line's own top-level `structure` is the *default* a per-point
      // untagged track vertex falls back to (see structure.ts) — not
      // necessarily what every point on the line actually is, but it's
      // still real committed data the registry drives, and the test's own
      // name already promised to check it (review finding, PR #8: it
      // didn't, until now).
      expect(data.lines[i].structure, `${line.key} structure`).toBe(line.structure);
      // "simulated-ness": whether the line has a real GTFS route id is what
      // the preprocessor keys `RouteDoc.simulated` off (see the track-only
      // route note in CLAUDE.md) — gtfsRouteId agreement IS the
      // simulated-ness check.
      expect(data.lines[i].gtfsRouteId, `${line.key} gtfsRouteId`).toBe(line.gtfsRouteId);
    }
  });
});
