import { describe, expect, it } from "vitest";
import { LANE_RUN_IDX, LANE_X, LANE_Y, VEHICLE_STRIDE } from "../sim/protocol";
import { findVehiclePosition, isOffScreen } from "./trainTooltip";

/**
 * Both functions were extracted from TrainTooltip's capture()/apply() so
 * they're testable without a DOM or a MapLibre map instance — same rationale
 * as followCamera.test.ts's yawToBearing/lerpBearing coverage.
 */

function vehicleAt(runIdx: number, x: number, y: number): Float32Array {
  const v = new Float32Array(VEHICLE_STRIDE);
  v[LANE_X] = x;
  v[LANE_Y] = y;
  v[LANE_RUN_IDX] = runIdx;
  return v;
}

describe("findVehiclePosition", () => {
  it("returns the matching run's position", () => {
    const vehicles = vehicleAt(7, 12.5, -3.25);
    expect(findVehiclePosition(vehicles, 1, 7)).toEqual({ x: 12.5, y: -3.25 });
  });

  it("scans past non-matching runs to find the target", () => {
    const vehicles = new Float32Array(VEHICLE_STRIDE * 3);
    vehicles.set(vehicleAt(1, 0, 0), 0);
    vehicles.set(vehicleAt(2, 0, 0), VEHICLE_STRIDE);
    vehicles.set(vehicleAt(3, 42, 99), VEHICLE_STRIDE * 2);
    expect(findVehiclePosition(vehicles, 3, 3)).toEqual({ x: 42, y: 99 });
  });

  it("returns null when the run isn't in the active buffer", () => {
    const vehicles = vehicleAt(1, 0, 0);
    expect(findVehiclePosition(vehicles, 1, 999)).toBeNull();
  });

  it("only scans the first `count` records, not the whole buffer", () => {
    const vehicles = new Float32Array(VEHICLE_STRIDE * 2);
    vehicles.set(vehicleAt(5, 1, 1), VEHICLE_STRIDE); // run 5 lives past `count`
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
