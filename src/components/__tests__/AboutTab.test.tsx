// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AboutTab } from "../tabs/AboutTab";
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

describe("AboutTab", () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    useAppStore.setState({
      routes: [
        makeLine({ name: "Sukhumvit Line", gtfsRouteId: "1" }),
        makeLine({ name: "Orange Line", gtfsRouteId: null, preRevenue: true }),
      ],
      stations: [
        {
          route_idx: 0,
          station_idx: 0,
          code: "N1",
          name_en: "Siam",
          name_th: "สยาม",
          arc_m: 0,
          x: 100.53,
          y: 13.74,
          z: 15,
          interchanges: [],
        },
      ],
    });
  });

  it("renders project description and network metrics", () => {
    render(<AboutTab />);
    expect(screen.getByRole("heading", { level: 2, name: /Greater Bangkok Metro Mini 3D/i })).toBeTruthy();
    expect(screen.getByText(/Simulated Lines:/i)).toBeTruthy();
    expect(screen.getAllByText("1").length).toBeGreaterThanOrEqual(1);
  });

  it("renders attribution and privacy disclosure", () => {
    render(<AboutTab />);
    expect(screen.getByText(/OpenStreetMap/i)).toBeTruthy();
    expect(screen.getByText(/Namtang \/ OTP/i)).toBeTruthy();
    expect(screen.getByText(/Privacy & Security Guarantee/i)).toBeTruthy();
  });

  it("renders GitHub Sponsors link", () => {
    render(<AboutTab />);
    const sponsorLink = screen.getByRole("link", { name: /sponsor on github/i });
    expect(sponsorLink).toHaveAttribute("href", "https://github.com/sponsors/naiiytom");
  });
});
