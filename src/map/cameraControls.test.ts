import type { Map as MapLibreMap } from "maplibre-gl";
import { describe, expect, it, vi } from "vitest";
import { installCameraControls } from "./cameraControls";

function createMockMap() {
  const listeners: Record<string, ((e: Event) => void)[]> = {};
  const canvas = {
    addEventListener: (type: string, fn: (e: Event) => void) => {
      listeners[type] = listeners[type] || [];
      listeners[type].push(fn);
    },
    removeEventListener: (type: string, fn: (e: Event) => void) => {
      if (listeners[type]) {
        listeners[type] = listeners[type].filter((l) => l !== fn);
      }
    },
    setPointerCapture: vi.fn(),
    releasePointerCapture: vi.fn(),
    hasPointerCapture: vi.fn().mockReturnValue(true),
  };

  let pitch = 50;
  let bearing = 100;
  const jumps: { pitch?: number; bearing?: number }[] = [];

  const map = {
    getCanvas: () => canvas,
    dragRotate: { disable: vi.fn() },
    getPitch: () => pitch,
    getMaxPitch: () => 80,
    getMinPitch: () => 0,
    getBearing: () => bearing,
    jumpTo: (opts: { pitch?: number; bearing?: number }) => {
      jumps.push(opts);
      if (opts.pitch !== undefined) pitch = opts.pitch;
      if (opts.bearing !== undefined) bearing = opts.bearing;
    },
  } as unknown as MapLibreMap;

  const emit = (type: string, event: Partial<PointerEvent | MouseEvent>) => {
    const list = listeners[type] || [];
    for (const fn of list) {
      fn(event as Event);
    }
  };

  return { map, canvas, jumps, emit, listeners };
}

describe("installCameraControls", () => {
  it("disables default dragRotate on initialization", () => {
    const { map } = createMockMap();
    installCameraControls(map);
    expect(map.dragRotate.disable).toHaveBeenCalled();
  });

  it("updates pitch and bearing on unclaimed orbit drag", () => {
    const { map, emit, jumps } = createMockMap();
    const controls = installCameraControls(map);

    expect(controls.isOrbiting()).toBe(false);

    // Orbit drag using middle button (button 1)
    emit("pointerdown", { button: 1, pointerId: 10, clientX: 100, clientY: 100, preventDefault: vi.fn() });
    expect(controls.isOrbiting()).toBe(true);

    // Drag right (dx = 10), drag down (dy = 10)
    // pitchDelta = -0.5 * 10 = -5 -> pitch 50 - 5 = 45
    // bearingDelta = 0.8 * 10 = 8 -> bearing 100 + 8 = 108
    emit("pointermove", { pointerId: 10, clientX: 110, clientY: 110 });

    expect(jumps).toHaveLength(1);
    expect(jumps[0]).toEqual({ pitch: 45, bearing: 108 });

    emit("pointerup", { pointerId: 10 });
    expect(controls.isOrbiting()).toBe(false);
  });

  it("routes bearing delta to onOrbit callback when claimed", () => {
    const { map, emit, jumps } = createMockMap();
    const onOrbit = vi.fn().mockReturnValue(true);
    const controls = installCameraControls(map, { onOrbit });

    emit("pointerdown", { button: 2, pointerId: 5, clientX: 50, clientY: 50, preventDefault: vi.fn() });
    emit("pointermove", { pointerId: 5, clientX: 60, clientY: 40 });

    // dx = 10 -> bearingDelta = 8
    // dy = -10 -> pitchDelta = 5
    expect(onOrbit).toHaveBeenCalledWith(8, 5);

    expect(jumps).toHaveLength(1);
    // bearing should NOT be in jumpTo options when claimed
    expect(jumps[0]).toEqual({ pitch: 55 });

    controls.dispose();
  });

  it("updates bearing on jumpTo when onOrbit returns false", () => {
    const { map, emit, jumps } = createMockMap();
    const onOrbit = vi.fn().mockReturnValue(false);
    installCameraControls(map, { onOrbit });

    emit("pointerdown", { button: 2, pointerId: 5, clientX: 50, clientY: 50, preventDefault: vi.fn() });
    emit("pointermove", { pointerId: 5, clientX: 60, clientY: 40 });

    expect(onOrbit).toHaveBeenCalledWith(8, 5);
    expect(jumps[0]).toEqual({ pitch: 55, bearing: 108 });
  });

  it("removes event listeners on dispose", () => {
    const { map, listeners } = createMockMap();
    const controls = installCameraControls(map);

    expect(listeners["pointerdown"].length).toBeGreaterThan(0);
    controls.dispose();
    expect(listeners["pointerdown"].length).toBe(0);
  });
});
