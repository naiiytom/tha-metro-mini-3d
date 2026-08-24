// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
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
    rollingStock: null, relationId: 1, osmName: "test", track: [], stations: [],
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
      planAlternatives: vi.fn().mockResolvedValue([PLAN]),
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

  it("picking From and To, then submitting, calls planAlternatives with the picked indices and the sim clock", async () => {
    render(<RoutePlanner />);
    fireEvent.change(screen.getByLabelText("From station"), { target: { value: "alpha" } });
    fireEvent.click(screen.getByText("Alpha"));
    fireEvent.change(screen.getByLabelText("To station"), { target: { value: "bravo" } });
    fireEvent.click(screen.getByText("Bravo"));
    fireEvent.click(screen.getByRole("button", { name: "Find route" }));

    const client = activeSimClient.current!;
    expect(client.planAlternatives).toHaveBeenCalledWith(0, 0, 0, 1, 1_800_000_000_000);
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
    (activeSimClient.current!.planAlternatives as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        ...PLAN,
        unreachable: true,
        legs: [],
      },
    ]);
    render(<RoutePlanner />);
    fireEvent.change(screen.getByLabelText("From station"), { target: { value: "alpha" } });
    fireEvent.click(screen.getByText("Alpha"));
    fireEvent.change(screen.getByLabelText("To station"), { target: { value: "bravo" } });
    fireEvent.click(screen.getByText("Bravo"));
    fireEvent.click(screen.getByRole("button", { name: "Find route" }));
    expect(await screen.findByText(/No route found within/)).toBeTruthy();
    expect(screen.queryByTestId("route-plan-summary")).toBeNull();
  });

  it("shows a distinct message for an empty (rejected-request) result", async () => {
    (activeSimClient.current!.planAlternatives as ReturnType<typeof vi.fn>).mockResolvedValue([]);
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

  it("lets a picked station be changed by editing the field again, not permanently pinning it", async () => {
    render(<RoutePlanner />);
    fireEvent.change(screen.getByLabelText("From station"), { target: { value: "alpha" } });
    fireEvent.click(screen.getByText("Alpha"));

    // Regression guard: the picked value used to permanently override the
    // input's `value` prop, so typing again had no visible effect and the
    // dropdown could never reopen. Typing here must re-filter and re-open it.
    fireEvent.change(screen.getByLabelText("From station"), { target: { value: "bravo" } });
    expect(screen.getByLabelText("From station")).toHaveValue("bravo");
    fireEvent.click(screen.getByText("Bravo"));

    fireEvent.change(screen.getByLabelText("To station"), { target: { value: "alpha" } });
    fireEvent.click(screen.getByText("Alpha"));
    fireEvent.click(screen.getByRole("button", { name: "Find route" }));

    // Confirms the SECOND pick (Bravo) genuinely replaced the first (Alpha)
    // as "From" — a stuck picker would still submit Alpha's indices here.
    const client = activeSimClient.current!;
    expect(client.planAlternatives).toHaveBeenCalledWith(0, 1, 0, 0, 1_800_000_000_000);
  });

  it("resets to a fresh state when the panel is closed and reopened", async () => {
    (activeSimClient.current!.planAlternatives as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    render(<RoutePlanner />);
    fireEvent.change(screen.getByLabelText("From station"), { target: { value: "alpha" } });
    fireEvent.click(screen.getByText("Alpha"));
    fireEvent.change(screen.getByLabelText("To station"), { target: { value: "bravo" } });
    fireEvent.click(screen.getByText("Bravo"));
    fireEvent.click(screen.getByRole("button", { name: "Find route" }));
    expect(await screen.findByText(/Couldn't plan a route/)).toBeTruthy();

    // Close, then reopen — same store transition a real close (via the
    // panel's own × button, which only calls setRoutePlannerOpen) then a
    // later reopen (e.g. from LineSelector) would produce. Each transition is
    // wrapped in its own `act` so React actually commits and runs the reset
    // effect at `open: false` before flipping back — two bare setState calls
    // in a row get batched into a single commit that never visits `false`,
    // which would make this test pass for the wrong reason (no reset ever
    // exercised).
    act(() => {
      useAppStore.setState({ routePlannerOpen: false });
    });
    act(() => {
      useAppStore.setState({ routePlannerOpen: true });
    });

    expect(screen.queryByText(/Couldn't plan a route/)).toBeNull();
    expect(screen.getByLabelText("From station")).toHaveValue("");
    expect(screen.getByLabelText("To station")).toHaveValue("");
  });

  it("renders alternative itinerary cards when multiple plans are returned and switching updates selected plan", async () => {
    const plan2: RoutePlan = {
      ...PLAN,
      transfers: 1,
      durationS: 700,
    };
    (activeSimClient.current!.planAlternatives as ReturnType<typeof vi.fn>).mockResolvedValue([
      PLAN,
      plan2,
    ]);
    render(<RoutePlanner />);
    fireEvent.change(screen.getByLabelText("From station"), { target: { value: "alpha" } });
    fireEvent.click(screen.getByText("Alpha"));
    fireEvent.change(screen.getByLabelText("To station"), { target: { value: "bravo" } });
    fireEvent.click(screen.getByText("Bravo"));
    fireEvent.click(screen.getByRole("button", { name: "Find route" }));

    expect(await screen.findByTestId("route-plan-alternatives")).toBeTruthy();
    expect(useAppStore.getState().routePlan).toEqual(PLAN);

    const cards = screen.getAllByRole("button").filter((b) => b.textContent?.includes("transfer"));
    expect(cards.length).toBe(2);

    fireEvent.click(cards[1]);
    expect(useAppStore.getState().routePlan).toEqual(plan2);
  });
});
