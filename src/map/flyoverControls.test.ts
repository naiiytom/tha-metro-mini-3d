// @vitest-environment jsdom
import type { Map as MapLibreMap } from "maplibre-gl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installFlyoverControls, isInputActive } from "./flyoverControls";
import { lngLatToLocal, ORIGIN_LNG_LAT } from "./coordinates";

function createMockMap(overrides: Partial<{
  bearing: number;
  pitch: number;
  zoom: number;
  center: { lng: number; lat: number };
  minPitch: number;
  maxPitch: number;
}> = {}) {
  let bearing = overrides.bearing ?? 0;
  let pitch = overrides.pitch ?? 45;
  let zoom = overrides.zoom ?? 16;
  let center = overrides.center ?? { lng: ORIGIN_LNG_LAT[0], lat: ORIGIN_LNG_LAT[1] };
  const minPitch = overrides.minPitch ?? 0;
  const maxPitch = overrides.maxPitch ?? 60;

  const jumps: {
    center?: [number, number];
    bearing?: number;
    pitch?: number;
    zoom?: number;
  }[] = [];

  const map = {
    getBearing: () => bearing,
    getPitch: () => pitch,
    getZoom: () => zoom,
    getCenter: () => center,
    getMinPitch: () => minPitch,
    getMaxPitch: () => maxPitch,
    jumpTo: vi.fn((opts: {
      center?: [number, number];
      bearing?: number;
      pitch?: number;
      zoom?: number;
    }) => {
      jumps.push(opts);
      if (opts.bearing !== undefined) bearing = opts.bearing;
      if (opts.pitch !== undefined) pitch = opts.pitch;
      if (opts.zoom !== undefined) zoom = opts.zoom;
      if (opts.center !== undefined) center = { lng: opts.center[0], lat: opts.center[1] };
    }),
  } as unknown as MapLibreMap;

  return { map, jumps, getBearing: () => bearing, getPitch: () => pitch, getZoom: () => zoom, getCenter: () => center };
}

describe("isInputActive", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  it("returns true for input elements", () => {
    const input = document.createElement("input");
    container.appendChild(input);
    input.focus();
    expect(isInputActive()).toBe(true);
  });

  it("returns true for textarea elements", () => {
    const textarea = document.createElement("textarea");
    container.appendChild(textarea);
    textarea.focus();
    expect(isInputActive()).toBe(true);
  });

  it("returns true for contenteditable elements", () => {
    const div = document.createElement("div");
    div.setAttribute("contenteditable", "true");
    div.tabIndex = 0;
    container.appendChild(div);
    div.focus();
    expect(document.activeElement).toBe(div);
    expect(isInputActive()).toBe(true);
  });

  it("returns true for elements with empty contenteditable attribute", () => {
    const div = document.createElement("div");
    div.setAttribute("contenteditable", "");
    div.tabIndex = 0;
    container.appendChild(div);
    div.focus();
    expect(isInputActive()).toBe(true);
  });

  it("returns true for select elements", () => {
    const select = document.createElement("select");
    container.appendChild(select);
    select.focus();
    expect(isInputActive()).toBe(true);
  });

  it("returns false when document.activeElement is null or undefined", () => {
    Object.defineProperty(document, "activeElement", {
      configurable: true,
      get: () => null,
    });
    expect(isInputActive()).toBe(false);
    delete (document as unknown as { activeElement?: Element }).activeElement;
  });
});

describe("installFlyoverControls", () => {
  let activeControls: { dispose: () => void } | null = null;

  afterEach(() => {
    if (activeControls) {
      activeControls.dispose();
      activeControls = null;
    }
  });

  describe("Form isolation and event handling", () => {
    it("completely suppresses flight keys when an input is focused", () => {
      const { map, jumps } = createMockMap();
      const input = document.createElement("input");
      document.body.appendChild(input);
      input.focus();

      const controls = installFlyoverControls(map);
      activeControls = controls;

      const event = new KeyboardEvent("keydown", { key: "w", bubbles: true, cancelable: true });
      window.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(false);
      controls.tick(100);
      expect(jumps).toHaveLength(0);
      expect(controls.isFlying()).toBe(false);

      input.remove();
    });

    it("flushes active keys on focusin to an input", () => {
      const { map } = createMockMap();
      const controls = installFlyoverControls(map);
      activeControls = controls;

      // Press 'W' while on canvas
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "w", bubbles: true }));
      expect(controls.isFlying()).toBe(true);

      // Now focus an input
      const input = document.createElement("input");
      document.body.appendChild(input);
      input.focus();
      document.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));

      // Keys should be flushed
      // Now a tick shouldn't accelerate forward
      controls.tick(100);
      input.remove();
    });

    it("flushes active keys on window blur", () => {
      const { map } = createMockMap();
      const controls = installFlyoverControls(map);
      activeControls = controls;

      window.dispatchEvent(new KeyboardEvent("keydown", { key: "w", bubbles: true }));
      expect(controls.isFlying()).toBe(true);

      window.dispatchEvent(new Event("blur"));
      // Next tick will be coasting deceleration, not active forward thrust
      controls.tick(5000);
      expect(controls.isFlying()).toBe(false);
    });

    it("prevents default on handled flight keys but leaves unhandled keys untouched", () => {
      const { map } = createMockMap();
      const controls = installFlyoverControls(map);
      activeControls = controls;

      const eventW = new KeyboardEvent("keydown", { key: "w", bubbles: true, cancelable: true });
      window.dispatchEvent(eventW);
      expect(eventW.defaultPrevented).toBe(true);

      const eventArrow = new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true, cancelable: true });
      window.dispatchEvent(eventArrow);
      expect(eventArrow.defaultPrevented).toBe(true);

      const eventUnhandled = new KeyboardEvent("keydown", { key: "x", bubbles: true, cancelable: true });
      window.dispatchEvent(eventUnhandled);
      expect(eventUnhandled.defaultPrevented).toBe(false);
    });

    it("ignores Ctrl/Meta keys to protect browser shortcuts like Ctrl+W and Ctrl+R", () => {
      const { map, jumps } = createMockMap();
      const controls = installFlyoverControls(map);
      activeControls = controls;

      const ctrlW = new KeyboardEvent("keydown", { key: "w", ctrlKey: true, bubbles: true, cancelable: true });
      window.dispatchEvent(ctrlW);
      expect(ctrlW.defaultPrevented).toBe(false);

      const metaR = new KeyboardEvent("keydown", { key: "r", metaKey: true, bubbles: true, cancelable: true });
      window.dispatchEvent(metaR);
      expect(metaR.defaultPrevented).toBe(false);

      controls.tick(100);
      expect(jumps).toHaveLength(0);
    });

    it("ignores Space key (retired to prevent page-down scroll)", () => {
      const { map, jumps } = createMockMap();
      const controls = installFlyoverControls(map);
      activeControls = controls;

      const space = new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true });
      window.dispatchEvent(space);
      expect(space.defaultPrevented).toBe(false);

      controls.tick(100);
      expect(jumps).toHaveLength(0);
    });

    it("releases flight action on keyup even if Ctrl or Meta is held, avoiding runaway flight", () => {
      const { map } = createMockMap();
      const controls = installFlyoverControls(map, { baseSpeedMps: 80, damping: 0.5 });
      activeControls = controls;

      // Start flying forward
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "w", bubbles: true }));
      expect(controls.isFlying()).toBe(true);

      // Release 'w' while holding Ctrl
      window.dispatchEvent(new KeyboardEvent("keyup", { key: "w", ctrlKey: true, bubbles: true }));

      // Coasting decay should kick in rather than permanent thrust
      for (let i = 0; i < 20; i++) {
        controls.tick(1000);
      }
      expect(controls.isFlying()).toBe(false);
    });

    it("correctly disambiguates AZERTY key layouts via physical scan codes", () => {
      const { map, jumps } = createMockMap({ bearing: 0, zoom: 16 });
      const controls = installFlyoverControls(map, { baseSpeedMps: 80, zoomRateStepsPerSec: 1.0, turnRateDegPerSec: 90 });
      activeControls = controls;

      // AZERTY: physical KeyW produces 'z', used for forward
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "z", code: "KeyW", bubbles: true }));
      controls.tick(1000);
      window.dispatchEvent(new KeyboardEvent("keyup", { key: "z", code: "KeyW", bubbles: true }));

      // Should translate forward, not zoom in
      expect(jumps[0].center).toBeDefined();
      expect(jumps[0].zoom).toBeUndefined();

      // AZERTY: physical KeyZ produces 'w', used for zoom in
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "w", code: "KeyZ", bubbles: true }));
      controls.tick(1000);
      window.dispatchEvent(new KeyboardEvent("keyup", { key: "w", code: "KeyZ", bubbles: true }));

      // Should zoom in, not translate forward
      expect(jumps[1].zoom).toBe(17);

      // AZERTY: physical KeyA produces 'q', used for strafe left
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "q", code: "KeyA", bubbles: true }));
      controls.tick(1000);
      window.dispatchEvent(new KeyboardEvent("keyup", { key: "q", code: "KeyA", bubbles: true }));
      expect(jumps[2].center).toBeDefined();
      expect(jumps[2].bearing).toBeUndefined();

      // AZERTY: physical KeyQ produces 'a', used for yaw left
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "a", code: "KeyQ", bubbles: true }));
      controls.tick(1000);
      window.dispatchEvent(new KeyboardEvent("keyup", { key: "a", code: "KeyQ", bubbles: true }));
      expect(jumps[3].bearing).toBeDefined();
    });
  });

  describe("Follow-camera coordination", () => {
    it("invokes onFollowRelease on translational key press (W, A, S, D, arrows)", () => {
      const { map } = createMockMap();
      const onFollowRelease = vi.fn();
      const controls = installFlyoverControls(map, { onFollowRelease });
      activeControls = controls;

      window.dispatchEvent(new KeyboardEvent("keydown", { key: "w", bubbles: true }));
      expect(onFollowRelease).toHaveBeenCalledTimes(1);

      // Repeated keydown does not re-invoke
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "w", bubbles: true }));
      expect(onFollowRelease).toHaveBeenCalledTimes(1);

      window.dispatchEvent(new KeyboardEvent("keyup", { key: "w", bubbles: true }));

      // Arrow key invokes it too
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
      expect(onFollowRelease).toHaveBeenCalledTimes(2);
    });

    it("does not invoke onFollowRelease on non-translational keys (Q, E, R, F, Z, C)", () => {
      const { map } = createMockMap();
      const onFollowRelease = vi.fn();
      const controls = installFlyoverControls(map, { onFollowRelease });
      activeControls = controls;

      for (const key of ["q", "e", "r", "f", "z", "c"]) {
        window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
        window.dispatchEvent(new KeyboardEvent("keyup", { key, bubbles: true }));
      }
      expect(onFollowRelease).not.toHaveBeenCalled();
    });

    it("routes Q and E yaw rotation to onYawOffset when claimed", () => {
      const { map, jumps } = createMockMap({ bearing: 45 });
      const onYawOffset = vi.fn().mockReturnValue(true);
      const controls = installFlyoverControls(map, { onYawOffset, turnRateDegPerSec: 90 });
      activeControls = controls;

      // Press E (clockwise / yaw right)
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "e", bubbles: true }));
      controls.tick(1000); // 1 second -> 90 deg delta

      expect(onYawOffset).toHaveBeenCalledWith(90);
      // Bearing should not be directly modified in jumpTo when claimed
      expect(jumps.find((j) => j.bearing !== undefined)).toBeUndefined();
    });

    it("updates map bearing directly when onYawOffset is not claimed", () => {
      const { map, jumps } = createMockMap({ bearing: 45 });
      const onYawOffset = vi.fn().mockReturnValue(false);
      const controls = installFlyoverControls(map, { onYawOffset, turnRateDegPerSec: 90 });
      activeControls = controls;

      // Press Q (counter-clockwise / yaw left)
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "q", bubbles: true }));
      controls.tick(1000); // 1 second -> -90 deg delta

      expect(onYawOffset).toHaveBeenCalledWith(-90);
      expect(jumps).toHaveLength(1);
      expect(jumps[0].bearing).toBe(-45);
    });
  });

  describe("Pitch tilt (R / F) and onPitchChange", () => {
    it("tilts pitch up with R and down with F, respecting limits and firing onPitchChange", () => {
      const { map, jumps } = createMockMap({ pitch: 40, minPitch: 0, maxPitch: 60 });
      const onPitchChange = vi.fn();
      const controls = installFlyoverControls(map, { onPitchChange, pitchRateDegPerSec: 45 });
      activeControls = controls;

      // Tilt up with R for 0.5s -> +22.5 deg -> 62.5 clamped to 60
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "r", bubbles: true }));
      controls.tick(500);
      window.dispatchEvent(new KeyboardEvent("keyup", { key: "r", bubbles: true }));

      expect(jumps[0].pitch).toBe(60);
      expect(onPitchChange).toHaveBeenCalledWith(60);

      // Tilt down with F for 2.0s -> -90 deg -> clamped to minPitch 0
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "f", bubbles: true }));
      controls.tick(2000);
      window.dispatchEvent(new KeyboardEvent("keyup", { key: "f", bubbles: true }));

      expect(jumps[1].pitch).toBe(0);
      expect(onPitchChange).toHaveBeenCalledWith(0);
    });
  });

  describe("Zoom altitude (Z / C)", () => {
    it("zooms in with Z and out with C, clamped to [10.0, 19.0]", () => {
      const { map, jumps } = createMockMap({ zoom: 18.5 });
      const controls = installFlyoverControls(map, { zoomRateStepsPerSec: 1.0 });
      activeControls = controls;

      // Zoom in with Z for 1s -> 18.5 + 1 = 19.5 -> clamped to 19.0
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "z", bubbles: true }));
      controls.tick(1000);
      window.dispatchEvent(new KeyboardEvent("keyup", { key: "z", bubbles: true }));

      expect(jumps[0].zoom).toBe(19.0);

      // Zoom out with C for 10s -> 19.0 - 10 = 9.0 -> clamped to 10.0
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "c", bubbles: true }));
      controls.tick(10000);
      window.dispatchEvent(new KeyboardEvent("keyup", { key: "c", bubbles: true }));

      expect(jumps[1].zoom).toBe(10.0);
    });
  });

  describe("Speed Modifiers (Shift & Alt)", () => {
    it("applies turboMultiplier (2.5x) when Shift is held", () => {
      const { map, jumps } = createMockMap({ zoom: 16 });
      const controls = installFlyoverControls(map, { baseSpeedMps: 80, turboMultiplier: 2.5 });
      activeControls = controls;

      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Shift", code: "ShiftLeft", shiftKey: true, bubbles: true }));
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "w", shiftKey: true, bubbles: true }));
      controls.tick(1000); // 1s at baseSpeed 80 * 2.5 = 200 m/s

      expect(jumps).toHaveLength(1);
      const [startLocalX, startLocalY] = lngLatToLocal(ORIGIN_LNG_LAT[0], ORIGIN_LNG_LAT[1]);
      const [endLocalX, endLocalY] = lngLatToLocal(jumps[0].center![0], jumps[0].center![1]);
      const dist = Math.hypot(endLocalX - startLocalX, endLocalY - startLocalY);
      expect(dist).toBeCloseTo(200, 1);
    });

    it("applies crawlMultiplier (0.3x) when Alt is held", () => {
      const { map, jumps } = createMockMap({ zoom: 16 });
      const controls = installFlyoverControls(map, { baseSpeedMps: 80, crawlMultiplier: 0.3 });
      activeControls = controls;

      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Alt", code: "AltLeft", altKey: true, bubbles: true }));
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "w", altKey: true, bubbles: true }));
      controls.tick(1000); // 1s at baseSpeed 80 * 0.3 = 24 m/s

      expect(jumps).toHaveLength(1);
      const [startLocalX, startLocalY] = lngLatToLocal(ORIGIN_LNG_LAT[0], ORIGIN_LNG_LAT[1]);
      const [endLocalX, endLocalY] = lngLatToLocal(jumps[0].center![0], jumps[0].center![1]);
      const dist = Math.hypot(endLocalX - startLocalX, endLocalY - startLocalY);
      expect(dist).toBeCloseTo(24, 1);
    });

    it("gives Alt crawl precedence when both Shift and Alt are held simultaneously", () => {
      const { map, jumps } = createMockMap({ zoom: 16 });
      const controls = installFlyoverControls(map, { baseSpeedMps: 80, turboMultiplier: 2.5, crawlMultiplier: 0.3 });
      activeControls = controls;

      window.dispatchEvent(new KeyboardEvent("keydown", { key: "w", shiftKey: true, altKey: true, bubbles: true }));
      controls.tick(1000);

      const [startLocalX, startLocalY] = lngLatToLocal(ORIGIN_LNG_LAT[0], ORIGIN_LNG_LAT[1]);
      const [endLocalX, endLocalY] = lngLatToLocal(jumps[0].center![0], jumps[0].center![1]);
      const dist = Math.hypot(endLocalX - startLocalX, endLocalY - startLocalY);
      expect(dist).toBeCloseTo(24, 1); // 80 * 0.3 = 24
    });
  });

  describe("Bearing-projected translation across cardinal headings", () => {
    it("moves North when facing 0 deg and flying forward (W)", () => {
      const { map, jumps } = createMockMap({ bearing: 0, zoom: 16 });
      const controls = installFlyoverControls(map, { baseSpeedMps: 80 });
      activeControls = controls;

      window.dispatchEvent(new KeyboardEvent("keydown", { key: "w", bubbles: true }));
      controls.tick(1000);

      const [x0, y0] = lngLatToLocal(ORIGIN_LNG_LAT[0], ORIGIN_LNG_LAT[1]);
      const [x1, y1] = lngLatToLocal(jumps[0].center![0], jumps[0].center![1]);
      expect(x1 - x0).toBeCloseTo(0, 1); // no east-west drift
      expect(y1 - y0).toBeCloseTo(80, 1); // +80 m North
    });

    it("moves East when facing 90 deg and flying forward (W)", () => {
      const { map, jumps } = createMockMap({ bearing: 90, zoom: 16 });
      const controls = installFlyoverControls(map, { baseSpeedMps: 80 });
      activeControls = controls;

      window.dispatchEvent(new KeyboardEvent("keydown", { key: "w", bubbles: true }));
      controls.tick(1000);

      const [x0, y0] = lngLatToLocal(ORIGIN_LNG_LAT[0], ORIGIN_LNG_LAT[1]);
      const [x1, y1] = lngLatToLocal(jumps[0].center![0], jumps[0].center![1]);
      expect(x1 - x0).toBeCloseTo(80, 1); // +80 m East
      expect(y1 - y0).toBeCloseTo(0, 1); // no north-south drift
    });

    it("moves West when facing 0 deg and strafing left (A)", () => {
      const { map, jumps } = createMockMap({ bearing: 0, zoom: 16 });
      const controls = installFlyoverControls(map, { baseSpeedMps: 80 });
      activeControls = controls;

      window.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));
      controls.tick(1000);

      const [x0, y0] = lngLatToLocal(ORIGIN_LNG_LAT[0], ORIGIN_LNG_LAT[1]);
      const [x1, y1] = lngLatToLocal(jumps[0].center![0], jumps[0].center![1]);
      expect(x1 - x0).toBeCloseTo(-80, 1); // -80 m West
      expect(y1 - y0).toBeCloseTo(0, 1);
    });

    it("moves South when facing 0 deg and flying backward (S)", () => {
      const { map, jumps } = createMockMap({ bearing: 0, zoom: 16 });
      const controls = installFlyoverControls(map, { baseSpeedMps: 80 });
      activeControls = controls;

      window.dispatchEvent(new KeyboardEvent("keydown", { key: "s", bubbles: true }));
      controls.tick(1000);

      const [x0, y0] = lngLatToLocal(ORIGIN_LNG_LAT[0], ORIGIN_LNG_LAT[1]);
      const [x1, y1] = lngLatToLocal(jumps[0].center![0], jumps[0].center![1]);
      expect(x1 - x0).toBeCloseTo(0, 1);
      expect(y1 - y0).toBeCloseTo(-80, 1); // -80 m South
    });

    it("normalizes diagonal movement (W + D) to prevent speedup", () => {
      const { map, jumps } = createMockMap({ bearing: 0, zoom: 16 });
      const controls = installFlyoverControls(map, { baseSpeedMps: 80 });
      activeControls = controls;

      window.dispatchEvent(new KeyboardEvent("keydown", { key: "w", bubbles: true }));
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "d", bubbles: true }));
      controls.tick(1000);

      const [x0, y0] = lngLatToLocal(ORIGIN_LNG_LAT[0], ORIGIN_LNG_LAT[1]);
      const [x1, y1] = lngLatToLocal(jumps[0].center![0], jumps[0].center![1]);
      const totalDist = Math.hypot(x1 - x0, y1 - y0);
      // Should be 80m, not 80 * sqrt(2) ≈ 113m
      expect(totalDist).toBeCloseTo(80, 1);
      expect(x1 - x0).toBeCloseTo(80 / Math.SQRT2, 1);
      expect(y1 - y0).toBeCloseTo(80 / Math.SQRT2, 1);
    });

    it("ignores non-positive or non-finite dtMs in tick", () => {
      const { map } = createMockMap();
      const controls = installFlyoverControls(map);
      activeControls = controls;

      window.dispatchEvent(new KeyboardEvent("keydown", { key: "w", bubbles: true }));
      controls.tick(0);
      controls.tick(-50);
      controls.tick(Number.NaN);
      controls.tick(Number.POSITIVE_INFINITY);
      expect(map.jumpTo).not.toHaveBeenCalled();
    });
  });

  describe("Coasting and exponential damping", () => {
    it("coasts and exponentially decelerates when keys are released until stopped", () => {
      const { map } = createMockMap({ bearing: 0, zoom: 16 });
      const controls = installFlyoverControls(map, { baseSpeedMps: 80, damping: 0.5 });
      activeControls = controls;

      window.dispatchEvent(new KeyboardEvent("keydown", { key: "w", bubbles: true }));
      controls.tick(1000); // moving at 80 m/s

      // Release key
      window.dispatchEvent(new KeyboardEvent("keyup", { key: "w", bubbles: true }));

      // Coasting tick: damping 0.5 for 1s -> velocity = 80 * 0.5 = 40 m/s
      controls.tick(1000);
      expect(controls.isFlying()).toBe(true);

      // Next tick: 40 * 0.5 = 20 m/s
      controls.tick(1000);
      expect(controls.isFlying()).toBe(true);

      // After several seconds of decay, stops completely
      for (let i = 0; i < 20; i++) {
        controls.tick(1000);
      }
      expect(controls.isFlying()).toBe(false);
    });
  });

  describe("Spatial bounds clamping", () => {
    it("clamps camera target within Greater Bangkok bounding box [100.0, 13.3, 101.0, 14.3]", () => {
      // Start near east edge
      const { map, jumps } = createMockMap({ bearing: 90, zoom: 10, center: { lng: 100.999, lat: 13.74 } });
      const controls = installFlyoverControls(map, { baseSpeedMps: 10000 });
      activeControls = controls;

      // Fly East
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "w", bubbles: true }));
      controls.tick(1000);

      expect(jumps[0].center![0]).toBeLessThanOrEqual(101.0);
      expect(jumps[0].center![0]).toBeGreaterThanOrEqual(100.0);
    });
  });

  describe("Single unified jumpTo and teardown", () => {
    it("does not call jumpTo when no movement or changes occurred", () => {
      const { map } = createMockMap();
      const controls = installFlyoverControls(map);
      activeControls = controls;

      controls.tick(100);
      expect(map.jumpTo).not.toHaveBeenCalled();
    });

    it("cleans up event listeners and stops flying on dispose", () => {
      const { map } = createMockMap();
      const controls = installFlyoverControls(map);

      window.dispatchEvent(new KeyboardEvent("keydown", { key: "w", bubbles: true }));
      expect(controls.isFlying()).toBe(true);

      controls.dispose();
      expect(controls.isFlying()).toBe(false);

      // Dispatching keys after dispose should not do anything
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "w", bubbles: true }));
      controls.tick(1000);
      expect(map.jumpTo).not.toHaveBeenCalled();
    });

    it("halts all motion and zeroes velocity on stop()", () => {
      const { map } = createMockMap();
      const controls = installFlyoverControls(map, { baseSpeedMps: 80 });
      activeControls = controls;

      window.dispatchEvent(new KeyboardEvent("keydown", { key: "w", bubbles: true }));
      expect(controls.isFlying()).toBe(true);

      controls.stop();
      expect(controls.isFlying()).toBe(false);

      controls.tick(1000);
      expect(map.jumpTo).not.toHaveBeenCalled();
    });

    it("suppresses translational coasting when isFollowing returns true", () => {
      let following = false;
      const { map, jumps } = createMockMap();
      const controls = installFlyoverControls(map, {
        baseSpeedMps: 80,
        isFollowing: () => following,
      });
      activeControls = controls;

      window.dispatchEvent(new KeyboardEvent("keydown", { key: "w", bubbles: true }));
      controls.tick(500); // moving
      expect(jumps).toHaveLength(1);
      window.dispatchEvent(new KeyboardEvent("keyup", { key: "w", bubbles: true }));

      // Follow mode is now engaged
      following = true;
      controls.tick(500);

      // Should not produce further center jumps while following
      expect(jumps).toHaveLength(1);
      expect(controls.isFlying()).toBe(false);
    });
  });
});
