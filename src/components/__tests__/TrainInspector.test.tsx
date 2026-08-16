// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TrainInspector } from "../TrainInspector";
import { useAppStore } from "../../stores/useAppStore";
import { activeSimClient, SimClient } from "../../sim/SimClient";
import type { RunDetail } from "../../sim/protocol";
import type { LineGeometry } from "../../types";

// Minimal LineGeometry fixture — same convention as StationBoard.test.tsx's
// and LineSelector.test.tsx's own local makeLine() helpers.
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
    relationId: 1,
    osmName: "test",
    track: [],
    stations: [],
    ...overrides,
  };
}

const DETAIL: RunDetail = {
  run_idx: 0,
  route_idx: 0,
  route_name: "Test Line",
  color_rgb: 0xff0000,
  headsign: "Test Headsign",
  direction: 0,
  origin: "A",
  destination: "B",
  state: 0,
  at_station: "A",
  prev_station: null,
  next_station: "B",
  next_arrival_in_s: 60,
  next_stop_ordinal: 1,
  current_stop_ordinal: 0,
  stops: [],
};

describe("TrainInspector estimated-run-times note", () => {
  afterEach(() => {
    cleanup();
    activeSimClient.current = null;
  });

  beforeEach(() => {
    activeSimClient.current = {
      getRunDetail: vi.fn().mockResolvedValue(DETAIL),
      getSimNow: vi.fn().mockReturnValue(0),
    } as unknown as SimClient;

    useAppStore.setState({
      selectedRunIdx: 0,
      selectedStation: null,
      following: false,
      stations: [],
    });
  });

  it("shows the note for a line with estimatedRunTimes set", async () => {
    useAppStore.setState({
      routes: [makeLine({ key: "pink", estimatedRunTimes: { basisLine: "yellow" } })],
    });
    render(<TrainInspector />);
    expect(await screen.findByTestId("estimated-run-times-note")).toBeTruthy();
  });

  it("does not show the note for a line without estimatedRunTimes", async () => {
    useAppStore.setState({
      routes: [makeLine({ key: "yellow", estimatedRunTimes: null })],
    });
    render(<TrainInspector />);
    // Wait for the async detail poll to settle, so this isn't just a
    // still-loading render that would trivially lack the note either way.
    await screen.findByText("Test Headsign");
    expect(screen.queryByTestId("estimated-run-times-note")).toBeNull();
  });
});
