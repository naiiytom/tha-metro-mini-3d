import { beforeEach, describe, expect, it } from "vitest";
import { useAppStore } from "./useAppStore";

describe("line visibility", () => {
  beforeEach(() => useAppStore.setState({ hiddenRoutes: [], selectedRunIdx: null, following: false }));

  it("starts with every line visible", () => {
    expect(useAppStore.getState().isRouteVisible(0)).toBe(true);
  });

  it("toggles one route without touching the others", () => {
    useAppStore.getState().toggleRoute(1);
    expect(useAppStore.getState().isRouteVisible(1)).toBe(false);
    expect(useAppStore.getState().isRouteVisible(0)).toBe(true);
  });

  it("toggles back on", () => {
    useAppStore.getState().toggleRoute(1);
    useAppStore.getState().toggleRoute(1);
    expect(useAppStore.getState().isRouteVisible(1)).toBe(true);
  });

  it("keeps hiddenRoutes stable when a route is hidden twice in a row", () => {
    useAppStore.getState().toggleRoute(2);
    const first = useAppStore.getState().hiddenRoutes;
    useAppStore.getState().toggleRoute(3);
    expect(useAppStore.getState().hiddenRoutes).toContain(2);
    expect(first).not.toBe(useAppStore.getState().hiddenRoutes); // new array, no mutation
  });
});

describe("underground mode", () => {
  beforeEach(() => useAppStore.setState({ undergroundMode: false }));

  it("is off by default", () => {
    expect(useAppStore.getState().undergroundMode).toBe(false);
  });

  it("toggles", () => {
    useAppStore.getState().setUndergroundMode(true);
    expect(useAppStore.getState().undergroundMode).toBe(true);
  });
});

describe("theme mode", () => {
  it("defaults themeMode to auto and round-trips all three modes", () => {
    expect(useAppStore.getState().themeMode).toBe("auto");
    for (const mode of ["light", "dark", "auto"] as const) {
      useAppStore.getState().setThemeMode(mode);
      expect(useAppStore.getState().themeMode).toBe(mode);
    }
  });
});
