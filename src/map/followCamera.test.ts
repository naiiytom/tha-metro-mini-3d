import type { Map as MapLibreMap } from "maplibre-gl";
import { describe, expect, it } from "vitest";
import { FollowCamera, lerpBearing, normalizeBearing, yawToBearing } from "./followCamera";
import { LANE_RUN_IDX, LANE_X, LANE_Y, LANE_YAW, VEHICLE_STRIDE } from "../sim/protocol";

function frame(runIdx: number, yaw: number): Float32Array {
  const b = new Float32Array(VEHICLE_STRIDE);
  b[LANE_X] = 0;
  b[LANE_Y] = 0;
  b[LANE_YAW] = yaw;
  b[LANE_RUN_IDX] = runIdx;
  return b;
}

/**
 * Records the last jumpTo, standing in for a real MapLibre map. `apply()`
 * only ever calls jumpTo, so this is the whole surface it needs.
 */
function fakeMap() {
  const calls: { center: unknown; bearing: number }[] = [];
  const map = { jumpTo: (o: { center: unknown; bearing: number }) => void calls.push(o) };
  return { map: map as unknown as MapLibreMap, calls };
}

/**
 * These two encode conventions that fail silently: a wrong sign or offset just
 * points the follow camera the wrong way, which nothing but a human eye
 * catches.
 */

describe("yawToBearing", () => {
  it("maps engine yaw (CCW from east) to map bearing (CW from north)", () => {
    expect(yawToBearing(0)).toBe(90); // heading east -> bearing 90
    expect(yawToBearing(Math.PI / 2)).toBe(0); // heading north -> bearing 0
    expect(yawToBearing(Math.PI)).toBe(-90); // heading west
    expect(yawToBearing(-Math.PI / 2)).toBe(180); // heading south
  });

  it("is monotonic in the opposite rotational sense", () => {
    // Yaw increases counter-clockwise, bearing increases clockwise.
    expect(yawToBearing(0.5)).toBeLessThan(yawToBearing(0));
  });
});

describe("lerpBearing", () => {
  it("interpolates the direct way when no wrap is involved", () => {
    expect(lerpBearing(0, 100, 0.5)).toBeCloseTo(50);
    expect(lerpBearing(20, 40, 0.25)).toBeCloseTo(25);
  });

  it("takes the short way across the 0/360 seam", () => {
    // 350 -> 10 is +20, not -340.
    expect(lerpBearing(350, 10, 0.5)).toBeCloseTo(360);
    // 10 -> 350 is -20, not +340.
    expect(lerpBearing(10, 350, 0.5)).toBeCloseTo(0);
  });

  it("handles the 180 boundary without oscillating", () => {
    const step = lerpBearing(0, 180, 0.5);
    expect(Math.abs(step)).toBeCloseTo(90);
  });

  it("returns the endpoints at t=0 and t=1", () => {
    expect(lerpBearing(30, 200, 0)).toBeCloseTo(30);
    expect(lerpBearing(30, 200, 1)).toBeCloseTo(200);
  });

  it("converges toward the target under repeated easing", () => {
    let b = 0;
    for (let i = 0; i < 200; i++) b = lerpBearing(b, 90, 0.08);
    expect(b).toBeCloseTo(90, 1);
  });
});

describe("FollowCamera.resetBearing", () => {
  it("makes the next apply() jump straight to the target instead of easing", () => {
    const cam = new FollowCamera();
    const vehicleAt = (yaw: number) => {
      const v = new Float32Array(8);
      v[0] = 0; // x
      v[1] = 0; // y
      v[3] = yaw;
      v[5] = 7; // run_idx
      return v;
    };
    let lastBearing = NaN;
    const mapStub = {
      jumpTo: (opts: { bearing: number }) => {
        lastBearing = opts.bearing;
      },
    } as unknown as Parameters<FollowCamera["apply"]>[0];

    // Settle heading east (bearing 90) over several frames of easing.
    cam.capture(vehicleAt(0), 1, 7);
    for (let i = 0; i < 200; i++) cam.apply(mapStub);
    expect(lastBearing).toBeCloseTo(90, 1);

    // Switching to a train heading north (bearing 0) without resetBearing()
    // would ease from the stale 90; resetBearing() forces an instant jump.
    cam.capture(vehicleAt(Math.PI / 2), 1, 7);
    cam.resetBearing();
    cam.apply(mapStub);
    // bearing is now always wrapped into [0, 360) (normalizeBearing, added
    // for the yaw offset below), so a target of exactly 0 can come back as
    // a value just under 360 (float rounding in yawToBearing) rather than
    // just over 0 — same angle, opposite side of the wrap seam. Compare the
    // shortest angular distance to 0, not the raw value.
    const wrapped = lastBearing > 180 ? lastBearing - 360 : lastBearing;
    expect(wrapped).toBeCloseTo(0, 1);
  });
});

describe("normalizeBearing", () => {
  it("wraps into [0, 360)", () => {
    expect(normalizeBearing(0)).toBe(0);
    expect(normalizeBearing(370)).toBe(10);
    expect(normalizeBearing(-10)).toBe(350);
    expect(normalizeBearing(-370)).toBe(350);
  });
});

describe("FollowCamera yaw offset", () => {
  it("adds the user's offset on top of the train's heading", () => {
    const cam = new FollowCamera();
    const { map, calls } = fakeMap();
    // yaw 0 (heading east) -> bearing 90 with no offset. The first apply()
    // seeds the smoothed bearing directly, so there is no lerp to wait out.
    cam.capture(frame(1, 0), 1, 1);
    cam.apply(map);
    expect(calls.at(-1)!.bearing).toBeCloseTo(90, 6);

    cam.addYawOffset(45);
    cam.apply(map);
    expect(calls.at(-1)!.bearing).toBeCloseTo(135, 6);
  });

  it("accumulates successive orbit deltas", () => {
    const cam = new FollowCamera();
    cam.addYawOffset(30);
    cam.addYawOffset(30);
    expect(cam.yawOffset).toBeCloseTo(60, 6);
  });

  it("keeps the offset when only the bearing smoothing is reset", () => {
    // Switching followed train A -> B must not throw away the angle the
    // user chose to watch from.
    const cam = new FollowCamera();
    cam.addYawOffset(90);
    cam.resetBearing();
    expect(cam.yawOffset).toBeCloseTo(90, 6);
  });

  it("clears the offset on a full reset", () => {
    const cam = new FollowCamera();
    cam.addYawOffset(90);
    cam.reset();
    expect(cam.yawOffset).toBe(0);
  });
});
