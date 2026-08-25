import { describe, expect, it } from "vitest";
import { MERC_PER_METER, ORIGIN_MERC } from "./coordinates";
import { pickAt, pickRadiusPx } from "./selection";
import type { ViewProjection } from "./screenProject";
import { LANE_ROUTE_IDX, LANE_RUN_IDX, LANE_X, LANE_Y, LANE_Z, VEHICLE_STRIDE } from "../sim/protocol";
import type { StationInfo } from "../sim/protocol";

function pitchedView(): ViewProjection {
  const s = 0.002 / MERC_PER_METER;
  const m = new Array(16).fill(0);
  m[0] = s;
  m[5] = s;
  m[9] = s; // altitude shears up the screen (lower canvas y)
  m[12] = -s * ORIGIN_MERC.x;
  m[13] = -s * ORIGIN_MERC.y;
  m[15] = 1;
  return { matrix: m, widthPx: 1000, heightPx: 1000 };
}

function vehicleBuffer(x: number, y: number, z: number, runIdx: number, routeIdx: number) {
  const buf = new Float32Array(VEHICLE_STRIDE);
  buf[LANE_X] = x;
  buf[LANE_Y] = y;
  buf[LANE_Z] = z;
  buf[LANE_RUN_IDX] = runIdx;
  buf[LANE_ROUTE_IDX] = routeIdx;
  return buf;
}

function station(over: Partial<StationInfo> = {}): StationInfo {
  return {
    route_idx: 0, station_idx: 0, code: "N1", name_en: "Test", name_th: "ทดสอบ",
    arc_m: 0, x: 0, y: 0, z: 0, interchanges: [], ...over,
  };
}

// Ground point (local ENU 0,0,0) under `pitchedView()` projects to the exact
// canvas center (500, 500) with a 1000x1000 canvas — verified algebraically:
// mx/my cancel against the matrix's translation terms and mz is 0, so ndc is
// (0, 0). Used below so the "visibility" tests (which don't care about
// altitude) still exercise the real projection instead of a stub.
describe("pickAt visibility", () => {
  const view = pitchedView();

  it("picks a train on a visible route", () => {
    const hit = pickAt(view, vehicleBuffer(0, 0, 0, 42, 1), 1, [], { x: 500, y: 500 }, []);
    expect(hit).toEqual({ type: "vehicle", runIdx: 42 });
  });

  it("ignores a train on a hidden route", () => {
    // Clicking where a hidden line's train would be must fall through to the
    // map, not select something the user cannot see.
    const hit = pickAt(view, vehicleBuffer(0, 0, 0, 42, 1), 1, [], { x: 500, y: 500 }, [1]);
    expect(hit).toBeNull();
  });

  it("ignores a station on a hidden route", () => {
    // z: 15 projects to canvas y 485 (see the altitude test below for the
    // derivation); hiddenRoutes filtering must reject it regardless.
    const stations = [station({ route_idx: 1, z: 15 })];
    const hit = pickAt(view, new Float32Array(0), 0, stations, { x: 500, y: 485 }, [1]);
    expect(hit).toBeNull();
  });
});

describe("pickAt with altitude", () => {
  const view = pitchedView();

  it("hits a train clicked where it is DRAWN, not where it would sit on the ground", () => {
    // +15 m elevated draws 15 px above its ground point: canvas y 485, not 500.
    const vehicles = vehicleBuffer(0, 0, 15, 7, 0);
    const drawn = { x: 500, y: 485 };
    expect(pickAt(view, vehicles, 1, [], drawn, [], 18)).toEqual({ type: "vehicle", runIdx: 7 });
  });

  it("does NOT hit the same train at its ground projection", () => {
    // z: 30 (not 15, unlike the sibling tests above) is deliberate: at this
    // matrix's exact 1px/meter altitude shear, a 15 m train draws only 15 px
    // from its ground point — INSIDE the unchanged 22 px pick radius, so a
    // ground click would still (correctly, coincidentally) register as a
    // hit and this test would not actually exercise anything. 30 m draws
    // 30 px away, outside the radius, so a hit here can only happen if the
    // implementation is still comparing against the ground position. Use
    // zoom=15 (REFERENCE_ZOOM) to keep the radius at 22 px.
    const vehicles = vehicleBuffer(0, 0, 30, 7, 0);
    expect(pickAt(view, vehicles, 1, [], { x: 500, y: 500 }, [], 15)).toBeNull();
  });

  it("still respects hidden routes", () => {
    const vehicles = vehicleBuffer(0, 0, 15, 7, 3);
    expect(pickAt(view, vehicles, 1, [], { x: 500, y: 515 }, [3], 18)).toBeNull();
  });

  it("picks an underground station at its drawn position", () => {
    const s = station({ z: -18, station_idx: 4 });
    expect(pickAt(view, new Float32Array(0), 0, [s], { x: 500, y: 518 }, [], 18)).toEqual({
      type: "station", routeIdx: 0, stationIdx: 4,
    });
  });

  it("prefers a train over a station when both are in range", () => {
    const vehicles = vehicleBuffer(0, 0, 0, 9, 0);
    const s = station({ station_idx: 2 });
    expect(pickAt(view, vehicles, 1, [s], { x: 500, y: 500 }, [], 18)).toEqual({
      type: "vehicle", runIdx: 9,
    });
  });
});

describe("pickRadiusPx", () => {
  it("returns the base radius at the reference zoom", () => {
    expect(pickRadiusPx(22, 15)).toBeCloseTo(22, 6);
  });

  it("never shrinks below the base radius when zoomed out", () => {
    expect(pickRadiusPx(22, 10)).toBe(22);
    expect(pickRadiusPx(22, 3)).toBe(22);
  });

  it("grows as the target renders larger", () => {
    expect(pickRadiusPx(22, 19)).toBeGreaterThan(22);
    expect(pickRadiusPx(22, 19)).toBeGreaterThan(pickRadiusPx(22, 17));
  });

  it("caps at 3x so a click never claims half the screen", () => {
    expect(pickRadiusPx(22, 24)).toBeCloseTo(66, 6);
  });
});
