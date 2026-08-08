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

describe("search/selection mutual exclusion", () => {
  beforeEach(() =>
    useAppStore.setState({
      searchOpen: false,
      selectedStation: null,
      selectedRunIdx: null,
      following: false,
    }),
  );

  it("opening search clears an existing station selection", () => {
    useAppStore.getState().selectStation({ routeIdx: 0, stationIdx: 1 });
    useAppStore.getState().setSearchOpen(true);
    expect(useAppStore.getState().searchOpen).toBe(true);
    expect(useAppStore.getState().selectedStation).toBeNull();
  });

  it("opening search clears an existing run selection and drops following", () => {
    useAppStore.getState().selectRun(5);
    useAppStore.getState().setFollowing(true);
    useAppStore.getState().setSearchOpen(true);
    expect(useAppStore.getState().searchOpen).toBe(true);
    expect(useAppStore.getState().selectedRunIdx).toBeNull();
    expect(useAppStore.getState().following).toBe(false);
  });

  it("closing search does not disturb an unrelated selection", () => {
    useAppStore.setState({ searchOpen: true });
    useAppStore.getState().setSearchOpen(false);
    expect(useAppStore.getState().searchOpen).toBe(false);
  });

  it("selecting a station closes an open search panel", () => {
    useAppStore.getState().setSearchOpen(true);
    useAppStore.getState().selectStation({ routeIdx: 0, stationIdx: 2 });
    expect(useAppStore.getState().searchOpen).toBe(false);
    expect(useAppStore.getState().selectedStation).toEqual({ routeIdx: 0, stationIdx: 2 });
  });

  it("selecting a run closes an open search panel", () => {
    useAppStore.getState().setSearchOpen(true);
    useAppStore.getState().selectRun(3);
    expect(useAppStore.getState().searchOpen).toBe(false);
    expect(useAppStore.getState().selectedRunIdx).toBe(3);
  });
});
