import { describe, expect, it } from "vitest";
import {
  classifyStationTier,
  isStationVisibleAtZoom,
  checkAABBCollision,
  declutterBillboards,
  type BillboardCandidate,
} from "./StationBillboardManager";
import type { StationInfo } from "../sim/protocol";

function mockStation(overrides: Partial<StationInfo> = {}): StationInfo {
  return {
    route_idx: 0,
    station_idx: 1,
    code: "N1",
    name_en: "Siam",
    name_th: "สยาม",
    arc_m: 1000,
    x: 0,
    y: 0,
    z: 15,
    interchanges: [],
    ...overrides,
  };
}

describe("StationBillboardManager LOD & Decluttering", () => {
  describe("classifyStationTier", () => {
    it("classifies multi-line interchange stations as Tier 1", () => {
      const interchange = mockStation({
        interchanges: [{ route_idx: 1, station_idx: 0 }],
      });
      expect(classifyStationTier(interchange, false)).toBe(1);
    });

    it("classifies line terminus stations as Tier 2", () => {
      const terminus = mockStation({ interchanges: [] });
      expect(classifyStationTier(terminus, true)).toBe(2);
    });

    it("classifies standard intermediate stations as Tier 3", () => {
      const normal = mockStation({ interchanges: [] });
      expect(classifyStationTier(normal, false)).toBe(3);
    });
  });

  describe("isStationVisibleAtZoom", () => {
    it("always shows selected station regardless of zoom", () => {
      expect(isStationVisibleAtZoom(3, 10.0, true)).toBe(true);
      expect(isStationVisibleAtZoom(3, 11.5, true)).toBe(true);
    });

    it("hides unselected stations below zoom 12", () => {
      expect(isStationVisibleAtZoom(1, 11.9, false)).toBe(false);
      expect(isStationVisibleAtZoom(2, 11.9, false)).toBe(false);
      expect(isStationVisibleAtZoom(3, 11.9, false)).toBe(false);
    });

    it("shows only Tier 1 interchanges at zoom 12.0 - 13.4", () => {
      expect(isStationVisibleAtZoom(1, 12.5, false)).toBe(true);
      expect(isStationVisibleAtZoom(2, 12.5, false)).toBe(false);
      expect(isStationVisibleAtZoom(3, 12.5, false)).toBe(false);
    });

    it("shows Tier 1 and Tier 2 at zoom 13.5 - 14.7", () => {
      expect(isStationVisibleAtZoom(1, 14.0, false)).toBe(true);
      expect(isStationVisibleAtZoom(2, 14.0, false)).toBe(true);
      expect(isStationVisibleAtZoom(3, 14.0, false)).toBe(false);
    });

    it("shows all tiers at zoom >= 14.8", () => {
      expect(isStationVisibleAtZoom(1, 15.0, false)).toBe(true);
      expect(isStationVisibleAtZoom(2, 15.0, false)).toBe(true);
      expect(isStationVisibleAtZoom(3, 15.0, false)).toBe(true);
    });
  });

  describe("checkAABBCollision", () => {
    it("detects overlapping boxes correctly", () => {
      // box: [x, y, width, height]
      const b1: [number, number, number, number] = [100, 100, 60, 24];
      const b2: [number, number, number, number] = [120, 110, 60, 24];
      expect(checkAABBCollision(b1, b2)).toBe(true);
    });

    it("returns false for non-overlapping boxes", () => {
      const b1: [number, number, number, number] = [100, 100, 60, 24];
      const b2: [number, number, number, number] = [200, 200, 60, 24];
      expect(checkAABBCollision(b1, b2)).toBe(false);
    });
  });

  describe("declutterBillboards", () => {
    it("retains higher-priority candidate on collision", () => {
      const c1: BillboardCandidate = {
        station: mockStation({ name_en: "Siam" }),
        screenX: 100,
        screenY: 100,
        tier: 1,
        isSelected: false,
        width: 80,
        height: 24,
      };

      // Collides with c1
      const c2: BillboardCandidate = {
        station: mockStation({ name_en: "Chit Lom" }),
        screenX: 110,
        screenY: 105,
        tier: 3,
        isSelected: false,
        width: 80,
        height: 24,
      };

      // Disjoint from c1 and c2
      const c3: BillboardCandidate = {
        station: mockStation({ name_en: "Mo Chit" }),
        screenX: 300,
        screenY: 300,
        tier: 2,
        isSelected: false,
        width: 80,
        height: 24,
      };

      const result = declutterBillboards([c2, c1, c3]);
      expect(result).toHaveLength(2);
      expect(result.map((c) => c.station.name_en)).toContain("Siam");
      expect(result.map((c) => c.station.name_en)).toContain("Mo Chit");
      expect(result.map((c) => c.station.name_en)).not.toContain("Chit Lom");
    });

    it("always keeps selected station in collision", () => {
      const c1: BillboardCandidate = {
        station: mockStation({ name_en: "Siam" }),
        screenX: 100,
        screenY: 100,
        tier: 1,
        isSelected: false,
        width: 80,
        height: 24,
      };

      const c2Selected: BillboardCandidate = {
        station: mockStation({ name_en: "Chit Lom" }),
        screenX: 105,
        screenY: 102,
        tier: 3,
        isSelected: true,
        width: 80,
        height: 24,
      };

      const result = declutterBillboards([c1, c2Selected]);
      expect(result).toHaveLength(1);
      expect(result[0].station.name_en).toBe("Chit Lom");
    });
  });
});
