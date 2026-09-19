// @vitest-environment jsdom
import type { Map as MapLibreMap } from "maplibre-gl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../stores/useAppStore";
import { FollowCamera } from "./followCamera";
import { installFlyoverControls, type FlyoverControls } from "./flyoverControls";
import { installCameraControls, type CameraControls } from "./cameraControls";
import { ORIGIN_LNG_LAT, lngLatToLocal } from "./coordinates";

function createMockMap(initial: {
  bearing?: number;
  pitch?: number;
  zoom?: number;
  center?: { lng: number; lat: number };
} = {}) {
  let bearing = initial.bearing ?? 0;
  let pitch = initial.pitch ?? 0;
  let zoom = initial.zoom ?? 16;
  let center = initial.center ?? { lng: ORIGIN_LNG_LAT[0], lat: ORIGIN_LNG_LAT[1] };

  const canvas = document.createElement("canvas");
  canvas.setPointerCapture = vi.fn();
  canvas.releasePointerCapture = vi.fn();
  canvas.hasPointerCapture = vi.fn().mockReturnValue(true);
  const eventListeners: Record<string, ((...args: unknown[]) => void)[]> = {};

  const map = {
    getCanvas: () => canvas,
    dragRotate: {
      disable: vi.fn(),
      enable: vi.fn(),
    },
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
    getMinPitch: () => 0,
    getMaxPitch: () => 60,
    setMinPitch: vi.fn(),
    setMaxPitch: vi.fn(),
    setPitch: vi.fn((p: number) => {
      pitch = Math.max(0, Math.min(60, p));
    }),
    setZoom: vi.fn((z: number) => {
      zoom = Math.max(10, Math.min(19, z));
    }),
    setBearing: vi.fn((b: number) => {
      bearing = b;
    }),
    jumpTo: vi.fn((opts: { center?: [number, number]; bearing?: number; pitch?: number; zoom?: number }) => {
      if (opts.bearing !== undefined) bearing = opts.bearing;
      if (opts.pitch !== undefined) pitch = opts.pitch;
      if (opts.zoom !== undefined) zoom = opts.zoom;
      if (opts.center !== undefined) center = { lng: opts.center[0], lat: opts.center[1] };
    }),
  } as unknown as MapLibreMap & { emitMapEvent: (event: string, ...args: unknown[]) => void };

  return { map, canvas, getBearing: () => bearing, getPitch: () => pitch, getZoom: () => zoom, getCenter: () => center };
}

describe("FlyoverControls & MapContainer Integration Loop", () => {
  let flyover: FlyoverControls | null = null;
  let cameraControls: CameraControls | null = null;

  beforeEach(() => {
    useAppStore.setState({
      following: false,
      selectedRunIdx: null,
      selectedStation: null,
      map3D: false,
    });
  });

  afterEach(() => {
    flyover?.dispose();
    cameraControls?.dispose();
    flyover = null;
    cameraControls = null;
    document.querySelectorAll("input, textarea").forEach((el) => el.remove());
  });

  it("breaks out of follow mode on WASD keypress, resetting bearing and starting flight from rest", () => {
    const { map, getCenter } = createMockMap({ bearing: 0, zoom: 16 });
    const follow = new FollowCamera();

    // Set following to true
    useAppStore.setState({ following: true, selectedRunIdx: 1 });
    expect(useAppStore.getState().following).toBe(true);

    // Wire flyover exactly as MapContainer does
    flyover = installFlyoverControls(map, {
      baseSpeedMps: 100,
      accelTimeSec: 0,
      isFollowing: () => useAppStore.getState().following,
      onFollowRelease: () => {
        const store = useAppStore.getState();
        if (store.following) {
          store.setFollowing(false);
          follow.resetBearing();
        }
      },
    });

    // Press W: breaks follow mode immediately
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "w", bubbles: true }));
    expect(useAppStore.getState().following).toBe(false);

    // Initial tick advances camera center
    flyover.tick(100);
    const center = getCenter();
    const [x, y] = lngLatToLocal(center.lng, center.lat);
    expect(x).toBeCloseTo(0, 1);
    expect(y).toBeCloseTo(10, 1); // 100 m/s * 0.1s = 10m
  });

  it("routes Q and E yaw rotation to followCamera.addYawOffset without breaking follow mode", () => {
    const { map } = createMockMap({ bearing: 45, zoom: 16 });
    const follow = new FollowCamera();
    const addYawOffsetSpy = vi.spyOn(follow, "addYawOffset");

    useAppStore.setState({ following: true, selectedRunIdx: 1 });

    flyover = installFlyoverControls(map, {
      turnRateDegPerSec: 90,
      isFollowing: () => useAppStore.getState().following,
      onFollowRelease: () => {
        useAppStore.getState().setFollowing(false);
      },
      onYawOffset: (deltaDeg) => {
        if (!useAppStore.getState().following) return false;
        follow.addYawOffset(deltaDeg);
        return true;
      },
    });

    // Press Q (yaw left)
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "q", bubbles: true }));
    flyover.tick(500); // 500ms * 90 deg/s = 45 deg

    // Follow mode must remain locked
    expect(useAppStore.getState().following).toBe(true);
    expect(addYawOffsetSpy).toHaveBeenCalledWith(-45);

    // Press E (yaw right)
    window.dispatchEvent(new KeyboardEvent("keyup", { key: "q", bubbles: true }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "e", bubbles: true }));
    flyover.tick(500);
    expect(useAppStore.getState().following).toBe(true);
    expect(addYawOffsetSpy).toHaveBeenCalledWith(45);
  });

  it("smoothly transitions W -> W+D -> W without zeroing flight velocity", () => {
    const { map, getCenter } = createMockMap({ bearing: 0, zoom: 16 });
    flyover = installFlyoverControls(map, { baseSpeedMps: 100, accelTimeSec: 0 });

    // 1. Holding W
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "w", bubbles: true }));
    flyover.tick(100);
    const [x1, y1] = lngLatToLocal(getCenter().lng, getCenter().lat);
    expect(x1).toBeCloseTo(0, 1);
    expect(y1).toBeCloseTo(10, 1);

    // 2. Press D while holding W
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "d", bubbles: true }));
    flyover.tick(100);
    const [x2, y2] = lngLatToLocal(getCenter().lng, getCenter().lat);
    expect(x2 - x1).toBeCloseTo(10 / Math.SQRT2, 1);
    expect(y2 - y1).toBeCloseTo(10 / Math.SQRT2, 1);

    // 3. Release D while holding W
    window.dispatchEvent(new KeyboardEvent("keyup", { key: "d", bubbles: true }));
    flyover.tick(100);
    const [x3, y3] = lngLatToLocal(getCenter().lng, getCenter().lat);
    expect(x3 - x2).toBeCloseTo(0, 1);
    expect(y3 - y2).toBeCloseTo(10, 1);
  });

  it("halts flyover when user initiates mouse drag (pointerdown on canvas or onOrbitStart)", () => {
    const { map, canvas, getCenter } = createMockMap({ bearing: 0, zoom: 16 });

    flyover = installFlyoverControls(map, { baseSpeedMps: 100, accelTimeSec: 0 });
    cameraControls = installCameraControls(map, {
      onOrbitStart: () => {
        flyover?.stop();
      },
    });

    // Start flying
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "w", bubbles: true }));
    flyover.tick(100);
    expect(flyover.isFlying()).toBe(true);
    const centerBefore = getCenter();

    // Mouse pointer down on canvas halts flyover immediately
    canvas.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    expect(flyover.isFlying()).toBe(false);

    // Subsequent tick does not move camera
    flyover.tick(100);
    expect(getCenter()).toEqual(centerBefore);

    // Fly again, then orbit start halts flyover
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "w", bubbles: true }));
    flyover.tick(100);
    expect(flyover.isFlying()).toBe(true);

    // Right-click drag orbit
    canvas.dispatchEvent(new PointerEvent("pointerdown", { button: 2, pointerId: 1, bubbles: true, clientX: 100, clientY: 100 }));
    expect(flyover.isFlying()).toBe(false);
  });

  it("syncs store map3D when pitch keys (R, F) cross the 10° threshold", () => {
    const { map, getPitch } = createMockMap({ pitch: 5, zoom: 16 });
    useAppStore.setState({ map3D: false });

    flyover = installFlyoverControls(map, {
      pitchRateDegPerSec: 45,
      onPitchChange: (pitchDeg) => {
        const is3D = pitchDeg >= 10;
        if (useAppStore.getState().map3D !== is3D) {
          useAppStore.getState().setMap3D(is3D);
        }
      },
    });

    // Pitch up with R from 5°: 500ms * 45 deg/s = 22.5° -> total 27.5°
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "r", bubbles: true }));
    flyover.tick(500);
    expect(getPitch()).toBeCloseTo(27.5, 1);
    expect(useAppStore.getState().map3D).toBe(true);

    // Pitch down with F to 0°: crosses below 10° -> map3D becomes false
    window.dispatchEvent(new KeyboardEvent("keyup", { key: "r", bubbles: true }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "f", bubbles: true }));
    flyover.tick(1000); // 45 deg down -> clamps to minPitch (0)
    expect(getPitch()).toBe(0);
    expect(useAppStore.getState().map3D).toBe(false);
  });

  it("completely suppresses flight when typing in an input element", () => {
    const { map, getCenter } = createMockMap({ bearing: 0, zoom: 16 });
    flyover = installFlyoverControls(map, { baseSpeedMps: 100, accelTimeSec: 0 });

    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();

    const centerBefore = getCenter();
    // User types "wasd" into search input
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "w", bubbles: true }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));
    flyover.tick(200);

    // Center must not have changed at all
    expect(getCenter()).toEqual(centerBefore);
    expect(flyover.isFlying()).toBe(false);
  });
});
