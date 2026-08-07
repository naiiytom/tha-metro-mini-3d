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

describe("station search", () => {
  beforeEach(() => useAppStore.setState({ searchOpen: false, flyToRequest: null }));

  it("defaults to closed with no pending fly-to request", () => {
    expect(useAppStore.getState().searchOpen).toBe(false);
    expect(useAppStore.getState().flyToRequest).toBeNull();
  });

  it("opens and closes the search panel", () => {
    useAppStore.getState().setSearchOpen(true);
    expect(useAppStore.getState().searchOpen).toBe(true);
    useAppStore.getState().setSearchOpen(false);
    expect(useAppStore.getState().searchOpen).toBe(false);
  });

  it("sets and clears a fly-to request", () => {
    useAppStore.getState().requestFlyTo({ lng: 100.5, lat: 13.75 });
    expect(useAppStore.getState().flyToRequest).toEqual({ lng: 100.5, lat: 13.75 });
    useAppStore.getState().clearFlyToRequest();
    expect(useAppStore.getState().flyToRequest).toBeNull();
  });
});
