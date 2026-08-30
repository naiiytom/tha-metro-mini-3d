// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NavigationPanel } from "../NavigationPanel";
import { useAppStore } from "../../stores/useAppStore";
import type { LineGeometry } from "../../types";

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

describe("NavigationPanel tab switching", () => {
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

    useAppStore.setState({
      activeTab: "lines",
      routes: [
        makeLine({ key: "sukhumvit", name: "Sukhumvit Line", color: "#7CB342" }),
        makeLine({ key: "orange", name: "Orange Line", preRevenue: true, gtfsRouteId: null, color: "#FF9800" }),
      ],
      stations: [],
      mapReady: true,
      uiHidden: false,
    });
  });

  it("renders tablist and all 4 tabs with proper ARIA tabpanel attributes", () => {
    render(<NavigationPanel />);
    expect(screen.getByRole("tablist", { name: /navigation sections/i })).toBeTruthy();
    const linesTab = screen.getByRole("tab", { name: /lines/i });
    expect(linesTab).toBeTruthy();
    expect(linesTab).toHaveAttribute("aria-controls", "tabpanel-lines");
    expect(screen.getByRole("tab", { name: /stations/i })).toHaveAttribute("aria-controls", "tabpanel-stations");
    expect(screen.getByRole("tab", { name: /route/i })).toHaveAttribute("aria-controls", "tabpanel-route");
    expect(screen.getByRole("tab", { name: /about/i })).toHaveAttribute("aria-controls", "tabpanel-about");

    const panel = screen.getByRole("tabpanel");
    expect(panel).toHaveAttribute("id", "tabpanel-lines");
    expect(panel).toHaveAttribute("aria-labelledby", "tab-lines");
  });

  it("displays Lines tab by default and switches to Stations on tab click", () => {
    render(<NavigationPanel />);
    expect(screen.getByTestId("lines-tab")).toBeTruthy();
    expect(screen.getByTestId("network-stats")).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: /stations/i }));
    expect(useAppStore.getState().activeTab).toBe("stations");
    expect(screen.getByTestId("stations-tab")).toBeTruthy();
    expect(screen.queryByTestId("lines-tab")).toBeNull();
  });

  it("switches to Route tab and About tab on click", () => {
    render(<NavigationPanel />);

    fireEvent.click(screen.getByRole("tab", { name: /route/i }));
    expect(useAppStore.getState().activeTab).toBe("route");
    expect(screen.getByTestId("route-tab")).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: /about/i }));
    expect(useAppStore.getState().activeTab).toBe("about");
    expect(screen.getByTestId("about-tab")).toBeTruthy();
  });

  it("navigates tabs using keyboard arrow keys", () => {
    render(<NavigationPanel />);
    const tablist = screen.getByRole("tablist");

    fireEvent.keyDown(tablist, { key: "ArrowRight" });
    expect(useAppStore.getState().activeTab).toBe("stations");

    fireEvent.keyDown(tablist, { key: "ArrowRight" });
    expect(useAppStore.getState().activeTab).toBe("route");

    fireEvent.keyDown(tablist, { key: "ArrowLeft" });
    expect(useAppStore.getState().activeTab).toBe("stations");

    fireEvent.keyDown(tablist, { key: "Home" });
    expect(useAppStore.getState().activeTab).toBe("lines");

    fireEvent.keyDown(tablist, { key: "End" });
    expect(useAppStore.getState().activeTab).toBe("about");
  });

  it("collapses panel on toggle click and synchronizes activeTab with store", () => {
    render(<NavigationPanel />);
    expect(screen.getByTestId("lines-tab")).toBeTruthy();
    expect(useAppStore.getState().activeTab).toBe("lines");

    const collapseButton = screen.getByRole("button", { name: /collapse navigation panel/i });
    fireEvent.click(collapseButton);
    expect(screen.queryByTestId("lines-tab")).toBeNull();
    expect(useAppStore.getState().activeTab).toBeNull();

    const expandButton = screen.getByRole("button", { name: /expand navigation panel/i });
    fireEvent.click(expandButton);
    expect(screen.getByTestId("lines-tab")).toBeTruthy();
    expect(useAppStore.getState().activeTab).toBe("lines");
  });

  it("shows pre-revenue badge on pre-revenue lines in Lines tab", () => {
    render(<NavigationPanel />);
    expect(screen.getByTestId("pre-revenue-badge")).toBeTruthy();
    expect(screen.getByText("Orange Line")).toBeTruthy();
  });
});

