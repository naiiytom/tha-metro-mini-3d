import { describe, expect, it } from "vitest";
import { arcSpanPositions, highlightSpans } from "./routeHighlight";
import { lngLatAltToLocal } from "./coordinates";
import type { RoutePlan } from "../sim/protocol";
import type { LineGeometry, TrackPoint } from "../types";

/** ~3 km of straight track due east of the app origin, at +15 m. */
const TRACK: TrackPoint[] = [
  [100.5332, 13.7456, 15, "elevated"],
  [100.5602, 13.7456, 15, "elevated"],
];

function line(): LineGeometry {
  return {
    key: "a",
    name: "A",
    nameTh: "",
    color: "#65B724",
    structure: "elevated",
    vehicleType: "heavy",
    gtfsRouteId: "1",
    preRevenue: false,
    syntheticSchedule: null,
    estimatedRunTimes: null,
    rollingStock: null,
    relationId: null,
    osmName: "",
    track: TRACK,
    stations: [],
  };
}

describe("arcSpanPositions", () => {
  it("returns a polyline whose ends sit at the requested arc offsets", () => {
    const [x0] = lngLatAltToLocal([TRACK[0][0], TRACK[0][1], TRACK[0][2]]);
    const flat = arcSpanPositions(line(), 500, 1500);
    expect(flat.length).toBeGreaterThanOrEqual(6);
    expect(flat.length % 3).toBe(0);
    const startX = flat[0];
    const endX = flat[flat.length - 3];
    // A straight east-west track makes arc length and local x interchangeable
    // to within the curve's own sampling error.
    expect(startX - x0).toBeGreaterThan(480);
    expect(startX - x0).toBeLessThan(520);
    expect(endX - x0).toBeGreaterThan(1480);
    expect(endX - x0).toBeLessThan(1520);
  });

  it("draws the same span for a leg travelling in reverse", () => {
    const forward = arcSpanPositions(line(), 500, 1500);
    const reverse = arcSpanPositions(line(), 1500, 500);
    expect(reverse.length).toBe(forward.length);
    expect(reverse[0]).toBeCloseTo(forward[0], 3);
    expect(reverse[reverse.length - 3]).toBeCloseTo(forward[forward.length - 3], 3);
  });

  it("clamps a span that runs past either end of the track", () => {
    const clamped = arcSpanPositions(line(), -500, 999_999);
    expect(clamped.length).toBeGreaterThanOrEqual(6);
    expect(Number.isFinite(clamped[0])).toBe(true);
    expect(Number.isFinite(clamped[clamped.length - 1])).toBe(true);
  });

  it("returns nothing for a degenerate span", () => {
    expect(arcSpanPositions(line(), 700, 700)).toEqual([]);
    expect(arcSpanPositions({ ...line(), track: [] }, 0, 100)).toEqual([]);
  });
});

describe("highlightSpans", () => {
  const plan: RoutePlan = {
    departSec: 0,
    arriveSec: 100,
    durationS: 100,
    transfers: 1,
    transferTimesEstimated: true,
    unreachable: false,
    legs: [
      {
        kind: "ride",
        routeIdx: 0,
        routeName: "A",
        colorRgb: "#65B724",
        headsign: "H",
        direction: 0,
        runIdx: 1,
        boardStationIdx: 0,
        boardName: "a",
        boardSec: 0,
        boardArcM: 500,
        alightStationIdx: 1,
        alightName: "b",
        alightSec: 60,
        alightArcM: 1500,
        intermediateStops: [],
      },
      {
        kind: "transfer",
        fromRouteIdx: 0,
        fromStationIdx: 1,
        toRouteIdx: 1,
        toStationIdx: 0,
        walkM: 40,
        transferS: 180,
        waitS: 60,
      },
      {
        kind: "ride",
        routeIdx: 1,
        routeName: "B",
        colorRgb: "#1964B7",
        headsign: "H",
        direction: 0,
        runIdx: 2,
        boardStationIdx: 0,
        boardName: "b",
        boardSec: 240,
        boardArcM: 0,
        alightStationIdx: 2,
        alightName: "c",
        alightSec: 300,
        alightArcM: 900,
        intermediateStops: [],
      },
    ],
  };

  it("spans the ride legs only — a walk has no track to draw on", () => {
    expect(highlightSpans(plan)).toEqual([
      { routeIdx: 0, fromArcM: 500, toArcM: 1500 },
      { routeIdx: 1, fromArcM: 0, toArcM: 900 },
    ]);
  });

  it("is empty for a null or unreachable plan", () => {
    expect(highlightSpans(null)).toEqual([]);
    expect(highlightSpans({ ...plan, legs: [], unreachable: true })).toEqual([]);
  });

  it("draws no span for a leg on a hidden route", () => {
    // The plan itself stays factual — only the OVERLAY respects visibility,
    // so a leg whose track is hidden must not leave a white highlight
    // floating over nothing.
    expect(highlightSpans(plan, [1])).toEqual([
      { routeIdx: 0, fromArcM: 500, toArcM: 1500 },
    ]);
    expect(highlightSpans(plan, [0])).toEqual([
      { routeIdx: 1, fromArcM: 0, toArcM: 900 },
    ]);
    expect(highlightSpans(plan, [0, 1])).toEqual([]);
  });

  it("draws everything when nothing is hidden", () => {
    // The default argument and an explicit empty list must agree, so the
    // existing call sites keep their behaviour exactly.
    expect(highlightSpans(plan, [])).toEqual(highlightSpans(plan));
    expect(highlightSpans(plan, [7])).toEqual(highlightSpans(plan));
  });
});
