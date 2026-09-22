// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StationBoard } from "../StationBoard";
import { useAppStore } from "../../stores/useAppStore";
import { activeSimClient, SimClient } from "../../sim/SimClient";
import type { StationBoard as StationBoardData } from "../../sim/protocol";
import type { StationInfo } from "../../sim/protocol";
import type { LineGeometry } from "../../types";

// Minimal LineGeometry fixture — same shape convention as
// LineSelector.test.tsx's local makeLine() and trackGeometry.test.ts's
// line() helper; each test file keeps its own rather than sharing one.
function makeLine(overrides: Partial<LineGeometry> = {}): LineGeometry {
  return {
    key: "test-line",
    name: "Test Line",
    nameTh: "สายทดสอบ",
    color: "#ff0000",
    structure: "elevated",
    vehicleType: "heavy",
    gtfsRouteId: "1",
    preRevenue: false,
    syntheticSchedule: null,
    estimatedRunTimes: null,
    rollingStock: null,
    relationId: 1,
    osmName: "test",
    track: [],
    stations: [],
    ...overrides,
  };
}

const EMPTY_BOARD: StationBoardData = {
  route_idx: 0,
  station_idx: 0,
  code: "T1",
  name_en: "Test Station",
  name_th: "สถานีทดสอบ",
  entries: [],
};

describe("StationBoard estimated-run-times note", () => {
  afterEach(() => {
    cleanup();
    activeSimClient.current = null;
  });

  beforeEach(() => {
    activeSimClient.current = {
      getStationBoard: vi.fn().mockResolvedValue(EMPTY_BOARD),
      getSimNow: vi.fn().mockReturnValue(0),
    } as unknown as SimClient;

    useAppStore.setState({
      selectedStation: { routeIdx: 0, stationIdx: 0 },
      selectedRunIdx: null,
      following: false,
      stations: [],
    });
  });

  it("shows the note for a line with estimatedRunTimes set", async () => {
    useAppStore.setState({
      routes: [makeLine({ key: "pink", estimatedRunTimes: { basisLine: "yellow" } })],
    });
    render(<StationBoard />);
    expect(await screen.findByTestId("estimated-run-times-note")).toBeTruthy();
  });

  it("does not show the note for a line without estimatedRunTimes", async () => {
    useAppStore.setState({
      routes: [makeLine({ key: "yellow", estimatedRunTimes: null })],
    });
    render(<StationBoard />);
    // Wait for the async board poll to settle, so this isn't just a
    // still-loading render that would trivially lack the note either way.
    await screen.findByText(/Test Station/);
    expect(screen.queryByTestId("estimated-run-times-note")).toBeNull();
  });
});

describe("StationBoard station hubs", () => {
  afterEach(() => {
    cleanup();
    activeSimClient.current = null;
  });

  it("loads and combines departures for every stop in the selected hub", async () => {
    const stops: StationInfo[] = [
      { route_idx: 0, station_idx: 4, code: "E4", name_en: "Asok", name_th: "อโศก", arc_m: 0, x: 0, y: 0, z: 0, interchanges: [{ route_idx: 1, station_idx: 8 }] },
      { route_idx: 1, station_idx: 8, code: "BL22", name_en: "Sukhumvit", name_th: "สุขุมวิท", arc_m: 0, x: 1, y: 0, z: 0, interchanges: [{ route_idx: 0, station_idx: 4 }] },
    ];
    const getStationBoard = vi.fn().mockImplementation((routeIdx: number) => Promise.resolve({
      ...EMPTY_BOARD,
      route_idx: routeIdx,
      entries: [{ run_idx: routeIdx + 1, route_idx: routeIdx, headsign: routeIdx ? "To Lak Song" : "To Kheha", headsign_th: "", destination: "", direction: 0, arrival_sec: 100 + routeIdx, departure_sec: 100 + routeIdx, in_s: 60 }],
    }));
    activeSimClient.current = { getStationBoard, getSimNow: vi.fn().mockReturnValue(0) } as unknown as SimClient;
    useAppStore.setState({
      selectedStation: { routeIdx: 0, stationIdx: 4 }, selectedRunIdx: null, following: false,
      stations: stops, routes: [makeLine(), makeLine({ key: "blue", color: "#0000ff" })],
    });

    render(<StationBoard />);
    expect(await screen.findByText("Asok / Sukhumvit")).toBeTruthy();
    expect(await screen.findByText("To Kheha")).toBeTruthy();
    expect(await screen.findByText("To Lak Song")).toBeTruthy();
    expect(getStationBoard).toHaveBeenCalledTimes(2);
  });
});
