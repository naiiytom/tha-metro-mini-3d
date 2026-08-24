import { describe, expect, it } from "vitest";
import { FollowCamera, lerpBearing, yawToBearing } from "./followCamera";

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

  it("maps intercardinal / diagonal directions correctly", () => {
    expect(yawToBearing(Math.PI / 4)).toBeCloseTo(45); // heading northeast -> bearing 45°
    expect(yawToBearing((3 * Math.PI) / 4)).toBeCloseTo(-45); // heading northwest -> bearing -45°
    expect(yawToBearing(-Math.PI / 4)).toBeCloseTo(135); // heading southeast -> bearing 135°
    expect(yawToBearing((-3 * Math.PI) / 4)).toBeCloseTo(225); // heading southwest -> bearing 225°
  });

  it("handles multi-turn rotations and unwrapped angles gracefully", () => {
    expect(yawToBearing(2 * Math.PI)).toBeCloseTo(-270); // 360° CCW -> -270° bearing (equivalent to 90°)
    expect(yawToBearing(-2 * Math.PI)).toBeCloseTo(450); // -360° CCW -> 450° bearing (equivalent to 90°)
  });

  it("is monotonic in the opposite rotational sense", () => {
    // Yaw increases counter-clockwise, bearing increases clockwise.
    expect(yawToBearing(0.5)).toBeLessThan(yawToBearing(0));
  });

  it("maintains strict 1:1 angular scaling", () => {
    const deltaYaw = 0.1;
    const deltaBearing = yawToBearing(deltaYaw) - yawToBearing(0);
    // 0.1 rad is ~5.72957795° decrease in bearing
    expect(deltaBearing).toBeCloseTo(-0.1 * (180 / Math.PI));
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
    expect(lastBearing).toBeCloseTo(0, 1);
  });
});
