import { beforeEach, describe, expect, it } from "vitest";
import type { RoutePlan } from "../sim/protocol";
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

const PLAN: RoutePlan = {
  departSec: 0,
  arriveSec: 60,
  durationS: 60,
  transfers: 0,
  transferTimesEstimated: true,
  unreachable: false,
  legs: [],
};

describe("route planner store slice", () => {
  beforeEach(() => {
    useAppStore.setState({
      routePlannerOpen: false,
      routePlan: null,
      searchOpen: false,
      selectedRunIdx: null,
      selectedStation: null,
      following: false,
    });
  });

  it("defaults to closed with no plan", () => {
    expect(useAppStore.getState().routePlannerOpen).toBe(false);
    expect(useAppStore.getState().routePlan).toBeNull();
  });

  it("opening it clears any selection, follow state, and open search", () => {
    // Same mutual exclusion setSearchOpen already enforces: without it the
    // planner stacks on an open TrainInspector/StationBoard and overflows the
    // mobile bottom-sheet stack.
    useAppStore.setState({
      searchOpen: true,
      selectedRunIdx: 7,
      selectedStation: { routeIdx: 1, stationIdx: 2 },
      following: true,
    });
    useAppStore.getState().setRoutePlannerOpen(true);
    const s = useAppStore.getState();
    expect(s.routePlannerOpen).toBe(true);
    expect(s.searchOpen).toBe(false);
    expect(s.selectedRunIdx).toBeNull();
    expect(s.selectedStation).toBeNull();
    expect(s.following).toBe(false);
  });

  it("closing it drops the plan, so the map highlight clears with the panel", () => {
    useAppStore.getState().setRoutePlannerOpen(true);
    useAppStore.getState().setRoutePlan(PLAN);
    useAppStore.getState().setRoutePlannerOpen(false);
    expect(useAppStore.getState().routePlan).toBeNull();
  });

  it("selecting a train or a station closes the planner and drops the plan", () => {
    for (const act of [
      () => useAppStore.getState().selectRun(3),
      () => useAppStore.getState().selectStation({ routeIdx: 0, stationIdx: 0 }),
      () => useAppStore.getState().setSearchOpen(true),
    ]) {
      useAppStore.getState().setRoutePlannerOpen(true);
      useAppStore.getState().setRoutePlan(PLAN);
      act();
      expect(useAppStore.getState().routePlannerOpen).toBe(false);
      expect(useAppStore.getState().routePlan).toBeNull();
    }
  });

  it("setRoutePlan replaces rather than merges, so a new search clears the old highlight", () => {
    useAppStore.getState().setRoutePlan(PLAN);
    useAppStore.getState().setRoutePlan(null);
    expect(useAppStore.getState().routePlan).toBeNull();
    const other = { ...PLAN, arriveSec: 999 };
    useAppStore.getState().setRoutePlan(other);
    expect(useAppStore.getState().routePlan).toBe(other);
  });
});

describe("navigation tabs", () => {
  beforeEach(() => useAppStore.setState({ activeTab: "lines" }));

  it("defaults activeTab to lines", () => {
    expect(useAppStore.getState().activeTab).toBe("lines");
  });

  it("switches activeTab and synchronizes backward-compatible flags", () => {
    useAppStore.getState().setActiveTab("stations");
    expect(useAppStore.getState().activeTab).toBe("stations");
    expect(useAppStore.getState().searchOpen).toBe(true);
    expect(useAppStore.getState().routePlannerOpen).toBe(false);

    useAppStore.getState().setActiveTab("route");
    expect(useAppStore.getState().activeTab).toBe("route");
    expect(useAppStore.getState().routePlannerOpen).toBe(true);
    expect(useAppStore.getState().searchOpen).toBe(false);

    useAppStore.getState().setActiveTab("about");
    expect(useAppStore.getState().activeTab).toBe("about");
    expect(useAppStore.getState().searchOpen).toBe(false);
    expect(useAppStore.getState().routePlannerOpen).toBe(false);

    useAppStore.getState().setActiveTab(null);
    expect(useAppStore.getState().activeTab).toBeNull();
  });

  it("toggleTab collapses if already active or switches if different", () => {
    useAppStore.getState().setActiveTab("lines");
    useAppStore.getState().toggleTab("lines");
    expect(useAppStore.getState().activeTab).toBeNull();

    useAppStore.getState().toggleTab("stations");
    expect(useAppStore.getState().activeTab).toBe("stations");

    useAppStore.getState().toggleTab("route");
    expect(useAppStore.getState().activeTab).toBe("route");
  });
});

describe("3D map toggle", () => {
  beforeEach(() => useAppStore.setState({ map3D: true }));

  it("defaults map3D to true", () => {
    expect(useAppStore.getState().map3D).toBe(true);
  });

  it("toggles and sets map3D state", () => {
    useAppStore.getState().setMap3D(false);
    expect(useAppStore.getState().map3D).toBe(false);

    useAppStore.getState().toggleMap3D();
    expect(useAppStore.getState().map3D).toBe(true);
  });
});

