// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StationCombobox } from "../StationCombobox";
import type { StationInfo } from "../../sim/protocol";
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

// Two routes so the rendered list has real group headers (per-route <ul>s),
// the exact structure Minor #4's ARIA fix targets.
const STATIONS: StationInfo[] = [
  station({ route_idx: 0, station_idx: 0, code: "A1", name_en: "Alpha", name_th: "แอลฟา" }),
  station({ route_idx: 0, station_idx: 1, code: "A2", name_en: "Bravo", name_th: "บราโว่" }),
  station({ route_idx: 1, station_idx: 0, code: "B1", name_en: "Charlie", name_th: "ชาร์ลี" }),
];
const ROUTES: LineGeometry[] = [makeLine({ key: "one" }), makeLine({ key: "two" })];

describe("StationCombobox ARIA structure (Minor #4)", () => {
  afterEach(() => cleanup());

  // Per the WAI-ARIA listbox pattern, everything between the `role="listbox"`
  // element and each `role="option"` element must not introduce an
  // unexpected role. Plain <li>/<ul> carry implicit listitem/list roles that
  // are NOT part of listbox -> [group] -> option, and testing-library's
  // getByRole/queryAllByRole compute the ARIA role (respecting an explicit
  // `role="presentation"` override), so this is a direct structural
  // assertion rather than a hand-rolled DOM walk.
  it("has no intervening list/listitem role between the listbox and its options", () => {
    render(
      <StationCombobox
        label="Test"
        stations={STATIONS}
        routes={ROUTES}
        onPick={vi.fn()}
        autoFocus
      />,
    );

    const listbox = screen.getByRole("listbox");
    expect(within(listbox).queryAllByRole("list")).toHaveLength(0);
    expect(within(listbox).queryAllByRole("listitem")).toHaveLength(0);

    // The only intervening role allowed by the pattern (the per-route
    // grouping) is present, and every leaf is a real option.
    const groups = within(listbox).getAllByRole("group");
    expect(groups).toHaveLength(2);
    const options = within(listbox).getAllByRole("option");
    expect(options).toHaveLength(STATIONS.length);
  });
});
