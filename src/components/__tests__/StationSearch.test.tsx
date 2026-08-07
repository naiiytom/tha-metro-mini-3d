// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { StationSearch } from "../StationSearch";
import { useAppStore } from "../../stores/useAppStore";
import type { StationInfo } from "../../sim/protocol";

function makeStation(overrides: Partial<StationInfo>): StationInfo {
  return {
    route_idx: 0,
    station_idx: 0,
    code: "",
    name_en: "",
    name_th: "",
    arc_m: 0,
    x: 0,
    y: 0,
    z: 0,
    interchanges: [],
    ...overrides,
  };
}

const STATIONS = [
  makeStation({ station_idx: 0, name_en: "Siam", name_th: "สยาม", x: 0, y: 0 }),
  makeStation({ station_idx: 1, name_en: "Asok", name_th: "อโศก", x: 2000, y: 0 }),
];

describe("StationSearch", () => {
  afterEach(() => {
    cleanup();
    delete (navigator as unknown as { geolocation?: unknown }).geolocation;
  });

  beforeEach(() => {
    useAppStore.setState({
      searchOpen: false,
      stations: STATIONS,
      routes: [],
      selectedStation: null,
      selectedRunIdx: null,
      following: false,
      flyToRequest: null,
    });
  });

  it("renders nothing while closed", () => {
    render(<StationSearch />);
    expect(screen.queryByTestId("station-search")).toBeNull();
  });

  it("filters results as the user types", () => {
    act(() => useAppStore.getState().setSearchOpen(true));
    render(<StationSearch />);
    fireEvent.change(screen.getByLabelText("Search stations"), { target: { value: "asok" } });
    expect(screen.getByText("Asok")).toBeTruthy();
    expect(screen.queryByText("Siam")).toBeNull();
  });

  it("selecting a result selects the station, requests a fly-to, and closes the panel", () => {
    act(() => useAppStore.getState().setSearchOpen(true));
    render(<StationSearch />);
    fireEvent.change(screen.getByLabelText("Search stations"), { target: { value: "siam" } });
    fireEvent.click(screen.getByText("Siam"));

    expect(useAppStore.getState().selectedStation).toEqual({ routeIdx: 0, stationIdx: 0 });
    expect(useAppStore.getState().flyToRequest).not.toBeNull();
    expect(useAppStore.getState().searchOpen).toBe(false);
  });

  it("shows an inline message when geolocation is denied", async () => {
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: {
        getCurrentPosition: (
          _success: PositionCallback,
          error: (err: { code: number; message: string }) => void,
        ) => error({ code: 1, message: "denied" }),
      },
    });

    act(() => useAppStore.getState().setSearchOpen(true));
    render(<StationSearch />);

    expect(await screen.findByText(/location permission denied/i)).toBeTruthy();
  });

  it("shows an inline message when geolocation is unsupported", async () => {
    act(() => useAppStore.getState().setSearchOpen(true));
    render(<StationSearch />);

    expect(await screen.findByText(/not supported/i)).toBeTruthy();
  });
});
