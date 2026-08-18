// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RoutePlanner } from "../RoutePlanner";
import { useAppStore } from "../../stores/useAppStore";
import { activeSimClient, SimClient } from "../../sim/SimClient";
import type { RoutePlan, StationInfo } from "../../sim/protocol";
import type { LineGeometry } from "../../types";

function makeLine(overrides: Partial<LineGeometry> = {}): LineGeometry {
  return {
    key: "test-line", name: "Test Line", nameTh: "สายทดสอบ", color: "#65B724",
    structure: "elevated", vehicleType: "heavy", gtfsRouteId: "1",
    preRevenue: false, syntheticSchedule: null, estimatedRunTimes: null,
    relationId: 1, osmName: "test", track: [], stations: [],
    ...overrides,
  };
}

function station(overrides: Partial<StationInfo> = {}): StationInfo {
  return {
    route_idx: 0, station_idx: 0, code: "T1", name_en: "Alpha", name_th: "แอลฟา",
    arc_m: 0, x: 0, y: 0, z: 0, interchanges: [],
    ...overrides,
  };
}

const STATIONS: StationInfo[] = [
  station({ route_idx: 0, station_idx: 0, code: "A1", name_en: "Alpha", name_th: "แอลฟา" }),
  station({ route_idx: 0, station_idx: 1, code: "A2", name_en: "Bravo", name_th: "บราโว่" }),
];

const PLAN: RoutePlan = {
  departSec: 36030,
  arriveSec: 36600,
  durationS: 570,
  transfers: 0,
  transferTimesEstimated: true,
  unreachable: false,
  legs: [
    {
      kind: "ride", routeIdx: 0, routeName: "Test Line", colorRgb: "#65B724",
      headsign: "Bravo-bound", direction: 0, runIdx: 5,
      boardStationIdx: 0, boardName: "Alpha", boardSec: 36030, boardArcM: 0,
      alightStationIdx: 1, alightName: "Bravo", alightSec: 36600, alightArcM: 1000,
      intermediateStops: [],
    },
  ],
};

describe("RoutePlanner", () => {
  afterEach(() => {
    cleanup();
    activeSimClient.current = null;
  });

  beforeEach(() => {
    activeSimClient.current = {
      getRoutePlan: vi.fn().mockResolvedValue(PLAN),
      getSimNow: vi.fn().mockReturnValue(1_800_000_000_000),
    } as unknown as SimClient;

    useAppStore.setState({
      routePlannerOpen: true,
      routePlan: null,
      stations: STATIONS,
      routes: [makeLine()],
      hiddenRoutes: [],
    });
  });

  it("renders nothing while closed", () => {
    useAppStore.setState({ routePlannerOpen: false });
    render(<RoutePlanner />);
    expect(screen.queryByTestId("route-planner")).toBeNull();
  });

  it("shows both station pickers while open", () => {
    render(<RoutePlanner />);
    expect(screen.getByLabelText("From station")).toBeTruthy();
    expect(screen.getByLabelText("To station")).toBeTruthy();
  });

  it("picking From and To, then submitting, calls getRoutePlan with the picked indices and the sim clock", async () => {
    render(<RoutePlanner />);
    fireEvent.change(screen.getByLabelText("From station"), { target: { value: "alpha" } });
    fireEvent.click(screen.getByText("Alpha"));
    fireEvent.change(screen.getByLabelText("To station"), { target: { value: "bravo" } });
    fireEvent.click(screen.getByText("Bravo"));
    fireEvent.click(screen.getByRole("button", { name: "Find route" }));

    const client = activeSimClient.current!;
    expect(client.getRoutePlan).toHaveBeenCalledWith(0, 0, 0, 1, 1_800_000_000_000);
    expect(await screen.findByTestId("route-plan-summary")).toBeTruthy();
  });

  it("shows a leg's headsign and times once a plan resolves", async () => {
    render(<RoutePlanner />);
    fireEvent.change(screen.getByLabelText("From station"), { target: { value: "alpha" } });
    fireEvent.click(screen.getByText("Alpha"));
    fireEvent.change(screen.getByLabelText("To station"), { target: { value: "bravo" } });
    fireEvent.click(screen.getByText("Bravo"));
    fireEvent.click(screen.getByRole("button", { name: "Find route" }));
    expect(await screen.findByText("Bravo-bound")).toBeTruthy();
    // formatServiceSec(36600) renders as "10:10" in both the plan summary
    // (arriveSec) and the leg row (alightSec) — this fixture has boardSec ===
    // departSec and alightSec === arriveSec for its single leg, so the same
    // formatted time legitimately appears twice; getAllByText tolerates that
    // instead of getByText's single-match assumption.
    expect(screen.getAllByText(/10:10/).length).toBeGreaterThan(0);
  });

  it("shows a distinct message for an unreachable plan, not a failure", async () => {
    (activeSimClient.current!.getRoutePlan as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...PLAN,
      unreachable: true,
      legs: [],
    });
    render(<RoutePlanner />);
    fireEvent.change(screen.getByLabelText("From station"), { target: { value: "alpha" } });
    fireEvent.click(screen.getByText("Alpha"));
    fireEvent.change(screen.getByLabelText("To station"), { target: { value: "bravo" } });
    fireEvent.click(screen.getByText("Bravo"));
    fireEvent.click(screen.getByRole("button", { name: "Find route" }));
    expect(await screen.findByText(/No route found within/)).toBeTruthy();
    expect(screen.queryByTestId("route-plan-summary")).toBeNull();
  });

  it("shows a distinct message for a null (rejected-request) result", async () => {
    (activeSimClient.current!.getRoutePlan as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    render(<RoutePlanner />);
    fireEvent.change(screen.getByLabelText("From station"), { target: { value: "alpha" } });
    fireEvent.click(screen.getByText("Alpha"));
    fireEvent.change(screen.getByLabelText("To station"), { target: { value: "bravo" } });
    fireEvent.click(screen.getByText("Bravo"));
    fireEvent.click(screen.getByRole("button", { name: "Find route" }));
    expect(await screen.findByText(/Couldn't plan a route/)).toBeTruthy();
  });

  it("shows the transfer-times note only when the plan actually has a transfer", async () => {
    render(<RoutePlanner />);
    fireEvent.change(screen.getByLabelText("From station"), { target: { value: "alpha" } });
    fireEvent.click(screen.getByText("Alpha"));
    fireEvent.change(screen.getByLabelText("To station"), { target: { value: "bravo" } });
    fireEvent.click(screen.getByText("Bravo"));
    fireEvent.click(screen.getByRole("button", { name: "Find route" }));
    await screen.findByTestId("route-plan-summary");
    expect(screen.queryByTestId("transfer-times-note")).toBeNull();
  });
});
