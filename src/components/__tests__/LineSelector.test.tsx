// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LineSelector } from "../LineSelector";
import { useAppStore } from "../../stores/useAppStore";
import {
  ESTIMATED_RUN_TIMES_NOTE,
  SYNTHETIC_SCHEDULE_NOTE,
  type LineGeometry,
} from "../../types";

describe("LineSelector search button", () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    // Mock matchMedia for useIsMobile hook
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation((query) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });

    useAppStore.setState({ searchOpen: false, routes: [], mapReady: true, uiHidden: false });
  });

  it("opens the search panel on click", () => {
    render(<LineSelector />);
    fireEvent.click(screen.getByRole("button", { name: /search stations/i }));
    expect(useAppStore.getState().searchOpen).toBe(true);
  });

  it("closes the search panel when clicked again", () => {
    render(<LineSelector />);
    const button = screen.getByRole("button", { name: /search stations/i });
    fireEvent.click(button);
    fireEvent.click(screen.getByRole("button", { name: /close station search/i }));
    expect(useAppStore.getState().searchOpen).toBe(false);
  });

  it("hides the search button while uiHidden is true", () => {
    useAppStore.setState({ uiHidden: true });
    render(<LineSelector />);
    expect(screen.queryByRole("button", { name: /search stations/i })).toBeNull();
  });
});

// A minimal LineGeometry fixture — same shape as trackGeometry.test.ts's
// `line()` helper, but local to this file since that one hardcodes fields
// (e.g. gtfsRouteId: null) this suite needs to vary per test.
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

describe("estimated run times disclosure", () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation((query) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  });

  it("its note is distinct from the synthetic-timetable note", () => {
    // Pink's departure TIMES are real; only travel time between stations is
    // estimated. Reusing the APM's wording would overstate what is invented.
    expect(ESTIMATED_RUN_TIMES_NOTE).not.toBe(SYNTHETIC_SCHEDULE_NOTE);
    expect(ESTIMATED_RUN_TIMES_NOTE.toLowerCase()).toContain("estimated");
  });

  it("a line with estimatedRunTimes shows the badge", () => {
    useAppStore.setState({
      searchOpen: false,
      mapReady: true,
      uiHidden: false,
      routes: [makeLine({ key: "pink", estimatedRunTimes: { basisLine: "yellow" } })],
    });
    render(<LineSelector />);
    expect(screen.getByTestId("estimated-run-times-badge")).toBeTruthy();
  });

  it("a line without estimatedRunTimes does not show the badge", () => {
    useAppStore.setState({
      searchOpen: false,
      mapReady: true,
      uiHidden: false,
      routes: [makeLine({ key: "yellow", estimatedRunTimes: null })],
    });
    render(<LineSelector />);
    expect(screen.queryByTestId("estimated-run-times-badge")).toBeNull();
  });

  it("does not disturb the synthetic-schedule badge (ordering regression)", () => {
    useAppStore.setState({
      searchOpen: false,
      mapReady: true,
      uiHidden: false,
      routes: [
        makeLine({
          key: "apm",
          gtfsRouteId: null,
          syntheticSchedule: {
            headwaySec: 600,
            runtimeSec: 180,
            dwellSec: 30,
            startSec: 0,
            endSec: 86400,
          },
          estimatedRunTimes: null,
        }),
      ],
    });
    render(<LineSelector />);
    expect(screen.getByTestId("synthetic-schedule-badge")).toBeTruthy();
    expect(screen.queryByTestId("estimated-run-times-badge")).toBeNull();
  });
});
