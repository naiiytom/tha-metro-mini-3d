// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NavigationPanel } from "../NavigationPanel";
import { ViewControls } from "../ViewControls";
import { LinesTab } from "../tabs/LinesTab";
import { StationBoard } from "../StationBoard";
import { useAppStore } from "../../stores/useAppStore";
import { activeSimClient, SimClient } from "../../sim/SimClient";
import type { LineGeometry } from "../../types";
import type { StationBoard as StationBoardData, StationInfo } from "../../sim/protocol";

function makeLine(overrides: Partial<LineGeometry> = {}): LineGeometry {
  return {
    key: "test-line",
    name: "Sukhumvit Line",
    nameTh: "สายสุขุมวิท",
    color: "#70BA38",
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

const TEST_STATION: StationInfo = {
  route_idx: 0,
  station_idx: 0,
  code: "CEN",
  name_en: "Siam",
  name_th: "สยาม",
  arc_m: 0,
  x: 100.53,
  y: 13.74,
  z: 15,
  interchanges: [],
};

const TEST_BOARD: StationBoardData = {
  route_idx: 0,
  station_idx: 0,
  code: "CEN",
  name_en: "Siam",
  name_th: "สยาม",
  entries: [
    {
      run_idx: 1,
      route_idx: 0,
      direction: 0,
      destination: "Kheha",
      headsign: "To Kheha",
      headsign_th: "ไปเคหะฯ",
      arrival_sec: 36000,
      departure_sec: 36030,
      in_s: 0,
    },
  ],
};

describe("Seam B: i18n component rendering (Thai & English)", () => {
  afterEach(() => {
    cleanup();
    activeSimClient.current = null;
  });

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

    activeSimClient.current = {
      getStationBoard: vi.fn().mockResolvedValue(TEST_BOARD),
      getSimNow: vi.fn().mockReturnValue(0),
    } as unknown as SimClient;

    useAppStore.setState({
      primaryLang: "en",
      activeTab: "lines",
      routes: [makeLine()],
      stations: [TEST_STATION],
      selectedStation: null,
      selectedRunIdx: null,
      following: false,
      hiddenRoutes: [],
      undergroundMode: false,
      map3D: true,
      shadowsEnabled: false,
      themeMode: "auto",
      basemapStyle: "liberty",
      ecoMode: false,
      trainScale: 1,
    });
  });

  it("renders NavigationPanel tab chrome in Thai when primaryLang is 'th'", () => {
    useAppStore.setState({ primaryLang: "th" });
    render(<NavigationPanel />);

    expect(screen.getByRole("tab", { name: "เส้นทาง" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "สถานี" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "เส้นทางเดินทาง" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "เกี่ยวกับ" })).toBeTruthy();
  });

  it("dynamically switches NavigationPanel tab labels when language is toggled", () => {
    render(<NavigationPanel />);
    expect(screen.getByRole("tab", { name: "Lines" })).toBeTruthy();

    const langBtn = screen.getByRole("button", { name: /Switch language/i });
    fireEvent.click(langBtn);

    expect(useAppStore.getState().primaryLang).toBe("th");
    expect(screen.getByRole("tab", { name: "เส้นทาง" })).toBeTruthy();
  });

  it("renders ViewControls in Thai when primaryLang is 'th'", () => {
    useAppStore.setState({ primaryLang: "th" });
    render(<ViewControls />);

    expect(screen.getByRole("button", { name: /มุมมอง 3 มิติ/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /มุมมองใต้ดิน/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /เงา/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /โหมดประหยัดพลังงาน/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /เต็มจอ/i })).toBeTruthy();
    expect(screen.getByText("ธีม")).toBeTruthy();
    expect(screen.getByText("แผนที่ฐาน")).toBeTruthy();
    expect(screen.getByText("ขนาดรถไฟ")).toBeTruthy();
  });

  it("renders data names (Line nameTh and network stats) in Thai on LinesTab", () => {
    useAppStore.setState({
      primaryLang: "th",
      routes: [makeLine({ name: "Sukhumvit Line", nameTh: "สายสุขุมวิท" })],
    });
    render(<LinesTab />);

    // Thai line name rendered
    expect(screen.getByText("สายสุขุมวิท")).toBeTruthy();
    // Network stats rendered in Thai: 1 สาย (1 จำลองเดินรถ)
    expect(screen.getByText(/1 สาย \(1 จำลองเดินรถ\)/i)).toBeTruthy();
  });

  it("renders StationBoard with Thai station name, headsign_th, and countdown", async () => {
    useAppStore.setState({
      primaryLang: "th",
      selectedStation: { routeIdx: 0, stationIdx: 0 },
      routes: [
        makeLine({
          key: "pink",
          syntheticSchedule: { headwaySec: 300, runtimeSec: 120, dwellSec: 30, startSec: 21600, endSec: 86400 },
          estimatedRunTimes: { basisLine: "yellow" },
        }),
      ],
    });
    render(<StationBoard />);

    // Primary station name is Thai when primaryLang is "th"
    expect(await screen.findByText("สยาม")).toBeTruthy();
    // Thai headsign rendered
    expect(await screen.findByText("ไปเคหะฯ")).toBeTruthy();
    // Countdown for in_s=0 in Thai is "ถึงแล้ว"
    expect(await screen.findByText("ถึงแล้ว")).toBeTruthy();

    // Thai disclosure notes rendered
    const synthNote = await screen.findByTestId("synthetic-schedule-note");
    expect(synthNote.textContent).toContain("ตารางเวลาประมาณการ");

    const estNote = await screen.findByTestId("estimated-run-times-note");
    expect(estNote.textContent).toContain("เวลาเดินทางระหว่างสถานีเป็นค่าประมาณการ");
  });
});
