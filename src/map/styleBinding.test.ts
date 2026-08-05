import { describe, expect, it, vi } from "vitest";
import { NIGHT_THEME } from "./basemapTheme";
import { bindStyle } from "./styleBinding";

/** Minimal stand-in for the parts of a MapLibre map bindStyle touches. */
function fakeMap(layers: { id: string; type: string; paint?: Record<string, unknown> }[]) {
  const paint = new Map<string, unknown>();
  for (const l of layers) {
    for (const [k, v] of Object.entries(l.paint ?? {})) paint.set(`${l.id}::${k}`, v);
  }
  return {
    getStyle: () => ({ layers }),
    getPaintProperty: (id: string, prop: string) => paint.get(`${id}::${prop}`),
    setPaintProperty: vi.fn((id: string, prop: string, value: unknown) =>
      paint.set(`${id}::${prop}`, value),
    ),
    triggerRepaint: vi.fn(),
    _read: (id: string, prop: string) => paint.get(`${id}::${prop}`),
  };
}

const fakeLayer = () => ({ setUndergroundMode: vi.fn() });

describe("bindStyle", () => {
  it("dims fill and fill-extrusion opacity into the F3.2 band when underground is on", () => {
    const map = fakeMap([
      { id: "landuse", type: "fill", paint: { "fill-opacity": 1 } },
      { id: "building", type: "fill-extrusion", paint: { "fill-extrusion-opacity": 0.9 } },
    ]);
    const layer = fakeLayer();
    const b = bindStyle(map as never, layer as never);

    b.applyUnderground(true);
    expect(layer.setUndergroundMode).toHaveBeenCalledWith(true);
    // SRS F3.2 specifies 0.1-0.4; the project uses 0.25.
    expect(map._read("landuse", "fill-opacity")).toBeGreaterThanOrEqual(0.1);
    expect(map._read("landuse", "fill-opacity")).toBeLessThanOrEqual(0.4);
    expect(map._read("building", "fill-extrusion-opacity")).toBeLessThanOrEqual(0.4);
  });

  it("restores each layer's own original opacity when underground goes off", () => {
    const map = fakeMap([
      { id: "building", type: "fill-extrusion", paint: { "fill-extrusion-opacity": 0.9 } },
    ]);
    const b = bindStyle(map as never, fakeLayer() as never);
    b.applyUnderground(true);
    b.applyUnderground(false);
    expect(map._read("building", "fill-extrusion-opacity")).toBe(0.9);
  });

  it("never writes a colour property from applyUnderground", () => {
    const map = fakeMap([{ id: "landuse", type: "fill", paint: { "fill-color": "#cccccc", "fill-opacity": 1 } }]);
    const b = bindStyle(map as never, fakeLayer() as never);
    b.applyUnderground(true);
    const colourWrites = map.setPaintProperty.mock.calls.filter(([, prop]) =>
      String(prop).endsWith("-color"),
    );
    expect(colourWrites).toEqual([]);
  });

  it("never writes an opacity property from applyThemeElevation", () => {
    const map = fakeMap([{ id: "landuse", type: "fill", paint: { "fill-color": "#cccccc", "fill-opacity": 1 } }]);
    const b = bindStyle(map as never, fakeLayer() as never);
    b.applyThemeElevation(-40);
    const opacityWrites = map.setPaintProperty.mock.calls.filter(([, prop]) =>
      String(prop).endsWith("-opacity"),
    );
    expect(opacityWrites).toEqual([]);
  });

  it("blends from the captured original every time, never from the live value", () => {
    // The compounding bug: blending from the live value drives the map to
    // black within seconds at ~2 Hz. Applying full night twice must land on
    // exactly the same colour as applying it once.
    const map = fakeMap([{ id: "bg", type: "background", paint: { "background-color": "#f8f4f0" } }]);
    const b = bindStyle(map as never, fakeLayer() as never);
    b.applyThemeElevation(-40);
    const once = map._read("bg", "background-color");
    b.resetThemeCache();
    b.applyThemeElevation(-40);
    expect(map._read("bg", "background-color")).toBe(once);
    expect(String(once).toLowerCase()).toBe(NIGHT_THEME.background.toLowerCase());
  });

  it("returns each layer to its original colour at full day", () => {
    const map = fakeMap([{ id: "bg", type: "background", paint: { "background-color": "#f8f4f0" } }]);
    const b = bindStyle(map as never, fakeLayer() as never);
    b.applyThemeElevation(-40);
    b.applyThemeElevation(90);
    expect(String(map._read("bg", "background-color")).toLowerCase()).toBe("#f8f4f0");
  });

  it("skips layers whose colour is an expression rather than throwing", () => {
    const map = fakeMap([
      { id: "expr", type: "fill", paint: { "fill-color": ["interpolate", ["linear"], ["zoom"], 0, "#fff"] } },
      { id: "plain", type: "fill", paint: { "fill-color": "#cccccc" } },
    ]);
    const b = bindStyle(map as never, fakeLayer() as never);
    expect(b.skippedCount).toBe(1);
    expect(b.themeableCount).toBe(1);
    expect(() => b.applyThemeElevation(-40)).not.toThrow();
  });

  it("skips layers whose fill-opacity is an expression rather than passing NaN through", () => {
    const map = fakeMap([
      {
        id: "landcover-expr",
        type: "fill",
        paint: { "fill-opacity": ["interpolate", ["linear"], ["zoom"], 0, 0, 10, 1] },
      },
      { id: "landuse-plain", type: "fill", paint: { "fill-opacity": 1 } },
    ]);
    const b = bindStyle(map as never, fakeLayer() as never);
    expect(() => b.applyUnderground(true)).not.toThrow();
    // The expression-valued layer must never receive a NaN write...
    const nanWrites = map.setPaintProperty.mock.calls.filter(([, , value]) => Number.isNaN(value));
    expect(nanWrites).toEqual([]);
    expect(map.setPaintProperty.mock.calls.some(([id]) => id === "landcover-expr")).toBe(false);
    // ...while a plain-number layer alongside it still dims normally.
    expect(map._read("landuse-plain", "fill-opacity")).toBeLessThanOrEqual(0.4);
  });

  it("captures a fresh snapshot per binding, so a style swap does not reuse stale ids", () => {
    const first = fakeMap([{ id: "old-bg", type: "background", paint: { "background-color": "#ffffff" } }]);
    const second = fakeMap([{ id: "new-bg", type: "background", paint: { "background-color": "#111111" } }]);
    bindStyle(first as never, fakeLayer() as never);
    const b2 = bindStyle(second as never, fakeLayer() as never);
    b2.applyThemeElevation(90);
    expect(second._read("new-bg", "background-color")).toBe("#111111");
    expect(second.setPaintProperty.mock.calls.every(([id]) => id === "new-bg")).toBe(true);
  });
});
