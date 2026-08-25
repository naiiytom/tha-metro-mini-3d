// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StationCombobox } from "../StationCombobox";
import type { StationInfo } from "../../sim/protocol";
import type { LineGeometry } from "../../types";

// jsdom doesn't implement scrollIntoView; the component calls it whenever
// `activeIndex` moves to a real row (the keyboard-navigation effect below).
// Not related to any fix under test — a bare environment gap.
Element.prototype.scrollIntoView = vi.fn();

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

describe("StationCombobox keyboard highlight vs Enter selection (High #1)", () => {
  afterEach(() => cleanup());

  // Reproduces the exact repro from the review finding: 3 stations across 2
  // routes whose alphabetical order interleaves routes. `filterStations`
  // returns them alphabetically — [Asok, Bang Wa, Charlie a] — but
  // `groupByRoute` regroups by route_idx in first-seen order, producing
  // rendered (grouped) order [Asok, Charlie a, Bang Wa]. Two ArrowDowns move
  // `activeIndex` to 1, which the UI highlights on the row rendered at
  // grouped position 1 — Charlie a — not `visible[1]`, which is Bang Wa.
  // Enter must pick whatever is actually highlighted.
  const INTERLEAVED_STATIONS: StationInfo[] = [
    station({ route_idx: 0, station_idx: 0, code: "A1", name_en: "Asok", name_th: "อโศก" }),
    station({ route_idx: 1, station_idx: 0, code: "B1", name_en: "Bang Wa", name_th: "บางหว้า" }),
    station({ route_idx: 0, station_idx: 1, code: "A2", name_en: "Charlie a", name_th: "ชาร์ลี เอ" }),
  ];
  const INTERLEAVED_ROUTES: LineGeometry[] = [makeLine({ key: "route-a" }), makeLine({ key: "route-b" })];

  it("Enter selects the visually highlighted station, not visible[activeIndex]", () => {
    const onPick = vi.fn();
    render(
      <StationCombobox
        label="Test"
        stations={INTERLEAVED_STATIONS}
        routes={INTERLEAVED_ROUTES}
        onPick={onPick}
        autoFocus
      />,
    );

    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "a" } });

    // Sanity-check the grouped render order actually diverges from the flat
    // alphabetical order, or this test would pass regardless of the bug.
    const listbox = screen.getByRole("listbox");
    const options = within(listbox).getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual([
      expect.stringContaining("Asok"),
      expect.stringContaining("Charlie a"),
      expect.stringContaining("Bang Wa"),
    ]);

    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" });

    // activeIndex is now 1 in grouped order — the highlighted row is
    // "Charlie a", confirmed via aria-selected.
    expect(options[1]).toHaveAttribute("aria-selected", "true");
    expect(options[1].textContent).toContain("Charlie a");

    fireEvent.keyDown(input, { key: "Enter" });

    // onPick(null) also fired once on the earlier `change` event (clearing
    // any prior selection while the user types) — assert the LAST call,
    // which is Enter's.
    expect(onPick).toHaveBeenLastCalledWith(expect.objectContaining({ name_en: "Charlie a" }));
  });
});
