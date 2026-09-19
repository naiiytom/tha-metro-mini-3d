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

  const canvas = document.createElement("canvas");
  const eventListeners: Record<string, ((...args: unknown[]) => void)[]> = {};

  const jumps: {
    center?: [number, number];
    bearing?: number;
    pitch?: number;
    zoom?: number;
  }[] = [];

  const map = {
    getCanvas: () => canvas,
    on: vi.fn((event: string, fn: (...args: unknown[]) => void) => {
      eventListeners[event] = eventListeners[event] || [];
      eventListeners[event].push(fn);
    }),
    off: vi.fn((event: string, fn: (...args: unknown[]) => void) => {
      if (eventListeners[event]) {
        eventListeners[event] = eventListeners[event].filter((l) => l !== fn);
      }
    }),
    emitMapEvent: (event: string, ...args: unknown[]) => {
      for (const fn of eventListeners[event] || []) {
        fn(...args);
      }
    },
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
  } as unknown as MapLibreMap & { emitMapEvent: (event: string, ...args: unknown[]) => void };

  return { map, canvas, jumps, getBearing: () => bearing, getPitch: () => pitch, getZoom: () => zoom, getCenter: () => center };
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

    it("halts translational velocity and suppresses movement when focusing an input after moving", () => {
      const { map } = createMockMap();
      const controls = installFlyoverControls(map);
      activeControls = controls;

      // Press 'W' and move for at least one tick
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "w", bubbles: true }));
      controls.tick(100);
      expect(controls.isFlying()).toBe(true);
      const centerAfterMove = map.getCenter();

      // Now focus an input
      const input = document.createElement("input");
      document.body.appendChild(input);
      input.focus();
      document.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));

      // Flight should be completely halted
      expect(controls.isFlying()).toBe(false);

      // Subsequent ticks produce no further center movement
      controls.tick(100);
      expect(map.getCenter()).toEqual(centerAfterMove);
      expect(controls.isFlying()).toBe(false);

      input.remove();
    });

    it("halts translational velocity and suppresses movement on window blur after moving", () => {
      const { map } = createMockMap();
      const controls = installFlyoverControls(map);
      activeControls = controls;

      // Press 'W' and move for at least one tick
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "w", bubbles: true }));
      controls.tick(100);
      expect(controls.isFlying()).toBe(true);
      const centerAfterMove = map.getCenter();

      // Window blur
      window.dispatchEvent(new Event("blur"));
      expect(controls.isFlying()).toBe(false);

      // Subsequent ticks produce no further center movement
      controls.tick(100);
      expect(map.getCenter()).toEqual(centerAfterMove);
      expect(controls.isFlying()).toBe(false);
    });

    it("halts translational velocity and flushes active keys when pointerdown on canvas (mouse drag start)", () => {
      const { map, canvas } = createMockMap();
      const controls = installFlyoverControls(map);
      activeControls = controls;

      window.dispatchEvent(new KeyboardEvent("keydown", { key: "w", bubbles: true }));
      controls.tick(100);
      expect(controls.isFlying()).toBe(true);
      const centerAfterMove = map.getCenter();

      // Mouse press on canvas to begin dragging
      canvas.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      expect(controls.isFlying()).toBe(false);

      // Subsequent ticks produce no further center movement
      controls.tick(100);
      expect(map.getCenter()).toEqual(centerAfterMove);
      expect(controls.isFlying()).toBe(false);
    });

    it("halts translational velocity and flushes active keys on map dragstart", () => {
      const { map } = createMockMap();
      const controls = installFlyoverControls(map);
      activeControls = controls;

      window.dispatchEvent(new KeyboardEvent("keydown", { key: "w", bubbles: true }));
      controls.tick(100);
      expect(controls.isFlying()).toBe(true);
      const centerAfterMove = map.getCenter();

      // MapLibre fires dragstart when drag starts
      map.emitMapEvent("dragstart");
      expect(controls.isFlying()).toBe(false);

      controls.tick(100);
      expect(map.getCenter()).toEqual(centerAfterMove);
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

    it("preserves flight velocity when transitioning W -> W+D -> W without braking to zero", () => {
      const { map } = createMockMap({ bearing: 0, zoom: 16 });
      const controls = installFlyoverControls(map, { baseSpeedMps: 100, accelTimeSec: 0 });
      activeControls = controls;

      // 1. Fly forward (W)
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "w", bubbles: true }));
      controls.tick(100);
      const c1 = map.getCenter();
      const [x1, y1] = lngLatToLocal(c1.lng, c1.lat);
      expect(x1).toBeCloseTo(0, 1);
      expect(y1).toBeCloseTo(10, 1); // 100 m/s * 0.1s = 10m North

      // 2. Add right strafe (D) while W is still held (W -> W+D transition)
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "d", bubbles: true }));
      controls.tick(100);
      const c2 = map.getCenter();
      const [x2, y2] = lngLatToLocal(c2.lng, c2.lat);
      const dx1 = x2 - x1;
      const dy1 = y2 - y1;
      // Velocity must NOT have reset to 0; continues smoothly along diagonal
      expect(dx1).toBeCloseTo(10 / Math.SQRT2, 1);
      expect(dy1).toBeCloseTo(10 / Math.SQRT2, 1);

      // 3. Release right strafe (D) while W remains held (W+D -> W transition)
      window.dispatchEvent(new KeyboardEvent("keyup", { key: "d", bubbles: true }));
      controls.tick(100);
      const c3 = map.getCenter();
      const [x3, y3] = lngLatToLocal(c3.lng, c3.lat);
      const dx2 = x3 - x2;
      const dy2 = y3 - y2;
      // Returns smoothly to pure North translation
      expect(dx2).toBeCloseTo(0, 1);
      expect(dy2).toBeCloseTo(10, 1);
    });

    it("resets velocity to zero on translational keypress when breaking out of follow mode", () => {
      const { map } = createMockMap({ bearing: 0, zoom: 16 });
      let following = true;
      const onFollowRelease = vi.fn(() => {
        following = false;
      });
      const controls = installFlyoverControls(map, {
        baseSpeedMps: 100,
        accelTimeSec: 0,
        isFollowing: () => following,
        onFollowRelease,
      });
      activeControls = controls;

      // Pressing W breaks follow mode and starts flight from rest (0 m/s) at current position
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "w", bubbles: true }));
      expect(onFollowRelease).toHaveBeenCalledTimes(1);

      // Initial tick moves forward from 0
      controls.tick(100);
      const c1 = map.getCenter();
      const [x1, y1] = lngLatToLocal(c1.lng, c1.lat);
      expect(x1).toBeCloseTo(0, 1);
      expect(y1).toBeCloseTo(10, 1);
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

    it("decelerates and halts using default coast half-life without overriding damping", () => {
      const { map } = createMockMap({ bearing: 0, zoom: 16 });
      // Exercises default options: coastHalfLifeSec = 0.3s and stopThreshold = 0.05 m/s
      const controls = installFlyoverControls(map, { baseSpeedMps: 80 });
      activeControls = controls;

      window.dispatchEvent(new KeyboardEvent("keydown", { key: "w", bubbles: true }));
      controls.tick(1000); // reaches full speed 80 m/s

      // Release key
      window.dispatchEvent(new KeyboardEvent("keyup", { key: "w", bubbles: true }));

      // Coasting tick: decays with default coast half-life (0.5s)
      controls.tick(300);
      expect(controls.isFlying()).toBe(true);

      // Decays to a complete stop over ~5 seconds
      controls.tick(6000);
      expect(controls.isFlying()).toBe(false);
    });
  });

  describe("Acceleration kinematics", () => {
    it("ramps velocity up over multiple ticks rather than instantly reaching target speed", () => {
      const { map } = createMockMap({ bearing: 0, zoom: 16 });
      const controls = installFlyoverControls(map, { baseSpeedMps: 80, accelTimeSec: 0.5 });
      activeControls = controls;

      window.dispatchEvent(new KeyboardEvent("keydown", { key: "w", bubbles: true }));

      // At t = 0.1s (100ms), velocity ramps to ~1/5 of target speed (16 m/s)
      // Moving at 16 m/s for 100ms advances ~1.6m (far less than the unaccelerated 8m)
      controls.tick(100);
      const [x0, y0] = lngLatToLocal(ORIGIN_LNG_LAT[0], ORIGIN_LNG_LAT[1]);
      const center1 = map.getCenter();
      const [x1, y1] = lngLatToLocal(center1.lng, center1.lat);
      const dist1 = Math.hypot(x1 - x0, y1 - y0);
      expect(dist1).toBeCloseTo(1.6, 1);

      // Next 100ms: velocity ramps to 32 m/s, delta distance moves ~3.2m
      controls.tick(100);
      const center2 = map.getCenter();
      const [x2, y2] = lngLatToLocal(center2.lng, center2.lat);
      const dist2 = Math.hypot(x2 - x1, y2 - y1);
      expect(dist2).toBeCloseTo(3.2, 1);
      expect(dist2).toBeGreaterThan(dist1);

      // Subsequent ticks continue to accelerate until target speed is reached
      controls.tick(300); // reaches full 80 m/s
      const center3 = map.getCenter();
      const [x3, y3] = lngLatToLocal(center3.lng, center3.lat);
      const dist3 = Math.hypot(x3 - x2, y3 - y2);
      expect(dist3).toBeGreaterThan(dist2);
    });

    it("respects accelTimeSec = 0 for instantaneous velocity response", () => {
      const { map } = createMockMap({ bearing: 0, zoom: 16 });
      const controls = installFlyoverControls(map, { baseSpeedMps: 80, accelTimeSec: 0 });
      activeControls = controls;

      window.dispatchEvent(new KeyboardEvent("keydown", { key: "w", bubbles: true }));
      controls.tick(100);

      const [x0, y0] = lngLatToLocal(ORIGIN_LNG_LAT[0], ORIGIN_LNG_LAT[1]);
      const center1 = map.getCenter();
      const [x1, y1] = lngLatToLocal(center1.lng, center1.lat);
      const dist = Math.hypot(x1 - x0, y1 - y0);
      // At 80 m/s * 0.1s = 8m instantaneous response
      expect(dist).toBeCloseTo(8, 1);
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
