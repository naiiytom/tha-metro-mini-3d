import { describe, expect, it } from "vitest";
import type { PlanLeg, RoutePlan } from "../sim/protocol";
import {
  ESTIMATED_RUN_TIMES_NOTE,
  SYNTHETIC_SCHEDULE_NOTE,
  TRANSFER_TIMES_ESTIMATED_NOTE,
  type LineGeometry,
} from "../types";
import { planDisclosures } from "./routePlanDisclosures";

function line(overrides: Partial<LineGeometry> = {}): LineGeometry {
  return {
    key: "test",
    name: "Test",
    nameTh: "",
    color: "#ff0000",
    structure: "elevated",
    vehicleType: "heavy",
    gtfsRouteId: "1",
    preRevenue: false,
    syntheticSchedule: null,
    estimatedRunTimes: null,
    rollingStock: null,
    relationId: null,
    osmName: "",
    track: [],
    stations: [],
    ...overrides,
  };
}

const ROUTES: LineGeometry[] = [
  line({ key: "sukhumvit" }),
  line({ key: "pink", estimatedRunTimes: { basisLine: "yellow" } }),
  line({
    key: "apm",
    gtfsRouteId: null,
    syntheticSchedule: { headwaySec: 600, runtimeSec: 180, dwellSec: 30, startSec: 0, endSec: 86400 },
  }),
];

function ride(routeIdx: number): PlanLeg {
  return {
    kind: "ride",
    routeIdx,
    routeName: "R",
    colorRgb: "#ff0000",
    headsign: "H",
    direction: 0,
    runIdx: 0,
    boardStationIdx: 0,
    boardName: "a",
    boardSec: 0,
    boardArcM: 0,
    alightStationIdx: 1,
    alightName: "b",
    alightSec: 60,
    alightArcM: 100,
    intermediateStops: [],
  };
}

const TRANSFER: PlanLeg = {
  kind: "transfer",
  fromRouteIdx: 0,
  fromStationIdx: 1,
  toRouteIdx: 1,
  toStationIdx: 0,
  walkM: 40,
  transferS: 180,
  waitS: 60,
};

function plan(legs: PlanLeg[], overrides: Partial<RoutePlan> = {}): RoutePlan {
  return {
    departSec: 0,
    arriveSec: 600,
    durationS: 600,
    transfers: legs.filter((l) => l.kind === "transfer").length,
    transferTimesEstimated: true,
    unreachable: false,
    legs,
    ...overrides,
  };
}

describe("planDisclosures", () => {
  it("discloses nothing for a plain single-line plan", () => {
    expect(planDisclosures(plan([ride(0)]), ROUTES)).toEqual({
      synthetic: false,
      estimated: false,
      transfers: false,
    });
  });

  it("discloses an estimated-run-times leg (Pink)", () => {
    const d = planDisclosures(plan([ride(1)]), ROUTES);
    expect(d.estimated).toBe(true);
    expect(d.synthetic).toBe(false);
  });

  it("discloses a synthetic-timetable leg (the APM)", () => {
    const d = planDisclosures(plan([ride(2)]), ROUTES);
    expect(d.synthetic).toBe(true);
    expect(d.estimated).toBe(false);
  });

  it("discloses all three at once for a Pink + APM plan with a transfer", () => {
    const d = planDisclosures(plan([ride(1), TRANSFER, ride(2)]), ROUTES);
    expect(d).toEqual({ synthetic: true, estimated: true, transfers: true });
  });

  it("does not raise the transfer note on a plan that has no transfer", () => {
    // The engine flag is unconditionally true — it is a property of the model
    // — but a note about transfer times on a plan with no transfer is noise.
    const p = plan([ride(0)]);
    expect(p.transferTimesEstimated).toBe(true);
    expect(planDisclosures(p, ROUTES).transfers).toBe(false);
  });

  it("discloses nothing for a null or unreachable plan", () => {
    const none = { synthetic: false, estimated: false, transfers: false };
    expect(planDisclosures(null, ROUTES)).toEqual(none);
    expect(planDisclosures(plan([], { unreachable: true }), ROUTES)).toEqual(none);
  });

  it("tolerates a leg whose route is missing from the line table", () => {
    // routes comes from network.json; a plan built against a newer cache must
    // degrade to "no claim", never crash the panel.
    expect(() => planDisclosures(plan([ride(99)]), ROUTES)).not.toThrow();
    expect(planDisclosures(plan([ride(99)]), ROUTES).synthetic).toBe(false);
  });

  it("uses a distinct note from the two that already exist", () => {
    expect(TRANSFER_TIMES_ESTIMATED_NOTE).not.toBe(SYNTHETIC_SCHEDULE_NOTE);
    expect(TRANSFER_TIMES_ESTIMATED_NOTE).not.toBe(ESTIMATED_RUN_TIMES_NOTE);
    expect(TRANSFER_TIMES_ESTIMATED_NOTE.toLowerCase()).toContain("transfer");
  });
});
