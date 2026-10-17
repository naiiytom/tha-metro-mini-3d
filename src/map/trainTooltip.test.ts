// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import type { Map as MapLibreMap } from "maplibre-gl";
import { LANE_RUN_IDX, LANE_X, LANE_Y, LANE_Z, VEHICLE_STRIDE } from "../sim/protocol";
import { MERC_PER_METER, ORIGIN_MERC } from "./coordinates";
import type { ViewProjection } from "./screenProject";
import { findVehiclePosition, isOffScreen, TrainTooltip } from "./trainTooltip";

function testMatrix(): number[] {
  const s = 0.002 / MERC_PER_METER;
  const m = new Array(16).fill(0);
  m[0] = s;
  m[5] = s;
  m[9] = s;
  m[12] = -s * ORIGIN_MERC.x;
  m[13] = -s * ORIGIN_MERC.y;
  m[15] = 1;
  return m;
}

function vehicleAt(runIdx: number, x: number, y: number, z = 0): Float32Array {
  const v = new Float32Array(VEHICLE_STRIDE);
  v[LANE_X] = x;
  v[LANE_Y] = y;
  v[LANE_Z] = z;
  v[LANE_RUN_IDX] = runIdx;
  return v;
}

describe("findVehiclePosition", () => {
  it("returns the matching run's position including z", () => {
    const vehicles = vehicleAt(7, 12.5, -3.25, 15);
    expect(findVehiclePosition(vehicles, 1, 7)).toEqual({ x: 12.5, y: -3.25, z: 15 });
  });

  it("scans past non-matching runs to find the target", () => {
    const vehicles = new Float32Array(VEHICLE_STRIDE * 3);
    vehicles.set(vehicleAt(1, 0, 0, 0), 0);
    vehicles.set(vehicleAt(2, 0, 0, 0), VEHICLE_STRIDE);
    vehicles.set(vehicleAt(3, 42, 99, -18), VEHICLE_STRIDE * 2);
    expect(findVehiclePosition(vehicles, 3, 3)).toEqual({ x: 42, y: 99, z: -18 });
  });

  it("returns null when the run isn't in the active buffer", () => {
    const vehicles = vehicleAt(1, 0, 0, 0);
    expect(findVehiclePosition(vehicles, 1, 999)).toBeNull();
  });

  it("only scans the first `count` records, not the whole buffer", () => {
    const vehicles = new Float32Array(VEHICLE_STRIDE * 2);
    vehicles.set(vehicleAt(5, 1, 1, 10), VEHICLE_STRIDE); // run 5 lives past `count`
    expect(findVehiclePosition(vehicles, 1, 5)).toBeNull();
  });
});

describe("isOffScreen", () => {
  const W = 800;
  const H = 600;
  const MARGIN = 80;

  it("is false for a point inside the canvas", () => {
    expect(isOffScreen(400, 300, W, H, MARGIN)).toBe(false);
  });

  it("is false within the margin just past each edge", () => {
    expect(isOffScreen(-MARGIN, 300, W, H, MARGIN)).toBe(false);
    expect(isOffScreen(W + MARGIN, 300, W, H, MARGIN)).toBe(false);
    expect(isOffScreen(400, -MARGIN, W, H, MARGIN)).toBe(false);
    expect(isOffScreen(400, H + MARGIN, W, H, MARGIN)).toBe(false);
  });

  it("is true once a point clears the margin on any side", () => {
    expect(isOffScreen(-MARGIN - 1, 300, W, H, MARGIN)).toBe(true);
    expect(isOffScreen(W + MARGIN + 1, 300, W, H, MARGIN)).toBe(true);
    expect(isOffScreen(400, -MARGIN - 1, W, H, MARGIN)).toBe(true);
    expect(isOffScreen(400, H + MARGIN + 1, W, H, MARGIN)).toBe(true);
  });
});

describe("TrainTooltip", () => {
  const view: ViewProjection = { matrix: testMatrix(), widthPx: 1000, heightPx: 1000 };
  const mockMap = {
    project: vi.fn().mockReturnValue({ x: 500, y: 500 }),
    getCanvas: () => ({ clientWidth: 1000, clientHeight: 1000 }),
  } as unknown as MapLibreMap;

  it("captures z altitude and projects via projectLocal in 3D when view is provided", () => {
    const container = document.createElement("div");
    const tooltip = new TrainTooltip(container);
    const vehicles = vehicleAt(42, 0, 0, 15);

    tooltip.capture(vehicles, 1, 42);
    tooltip.apply(mockMap, false, view);

    const el = container.querySelector('[data-testid="train-tooltip"]') as HTMLDivElement;
    expect(el).not.toBeNull();
    expect(el.classList.contains("hidden")).toBe(false);
    // At z=15, projected y is 485px instead of ground-level 500px
    const match = /translate\(([\d.]+)px,\s*([\d.]+)px\)/.exec(el.style.transform);
    expect(match).not.toBeNull();
    expect(parseFloat(match![1])).toBeCloseTo(500, 3);
    expect(parseFloat(match![2])).toBeCloseTo(485, 3);
  });

  it("falls back to map.project when view is null", () => {
    const container = document.createElement("div");
    const tooltip = new TrainTooltip(container);
    const vehicles = vehicleAt(42, 0, 0, 15);

    tooltip.capture(vehicles, 1, 42);
    tooltip.apply(mockMap, false, null);

    const el = container.querySelector('[data-testid="train-tooltip"]') as HTMLDivElement;
    expect(el).not.toBeNull();
    expect(mockMap.project).toHaveBeenCalled();
    expect(el.style.transform).toContain("translate(500px, 500px)");
  });

  it("supports passing prefoundPos to capture to avoid rescanning", () => {
    const container = document.createElement("div");
    const tooltip = new TrainTooltip(container);
    const vehicles = new Float32Array(0);

    tooltip.capture(vehicles, 0, 42, { x: 100, y: 0, z: 15 });
    tooltip.apply(mockMap, false, view);

    const el = container.querySelector('[data-testid="train-tooltip"]') as HTMLDivElement;
    expect(el).not.toBeNull();
    expect(el.classList.contains("hidden")).toBe(false);
    const match = /translate\(([\d.]+)px,\s*([\d.]+)px\)/.exec(el.style.transform);
    expect(match).not.toBeNull();
    expect(parseFloat(match![1])).toBeCloseTo(600, 3);
    expect(parseFloat(match![2])).toBeCloseTo(485, 3);
  });
});
