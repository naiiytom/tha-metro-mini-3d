import { describe, expect, it } from "vitest";
import type { RollingStock } from "../types";
import {
  DEFAULT_STOCK,
  GLAZING_HEX,
  SKIRT_HEX,
  detailColors,
  liveryColors,
  resolveStock,
  stockLengthM,
} from "./rollingStock";

const GREEN = "#7CB342";

describe("stockLengthM", () => {
  it("keeps the MVP 3 heavy-rail train at 65 m over 4 cars", () => {
    expect(DEFAULT_STOCK.heavy.cars).toBe(4);
    expect(stockLengthM(DEFAULT_STOCK.heavy)).toBeCloseTo(65, 1);
  });

  it("counts gaps between cars, not after the last one", () => {
    expect(stockLengthM({ cars: 3, carLengthM: 10, gapM: 1 })).toBe(32);
    expect(stockLengthM({ cars: 1, carLengthM: 10, gapM: 1 })).toBe(10);
  });
});

describe("resolveStock", () => {
  it("falls back to the vehicleType default when a line declares no stock", () => {
    const spec = resolveStock({ color: GREEN, vehicleType: "monorail", rollingStock: null });
    expect(spec.cars).toBe(DEFAULT_STOCK.monorail.cars);
    expect(spec.nose).toBe(DEFAULT_STOCK.monorail.nose);
  });

  it("resolves the \"route\" sentinel to the line's own colour", () => {
    const spec = resolveStock({ color: GREEN, vehicleType: "heavy", rollingStock: null });
    // bands[0] is the identity band, declared as tint "route".
    expect(spec.bands[0].hex).toBe(0x7cb342);
  });

  it("leaves an explicit hex tint alone", () => {
    const spec = resolveStock({ color: GREEN, vehicleType: "heavy", rollingStock: null });
    expect(spec.glazing.hex).toBe(GLAZING_HEX);
    expect(spec.bands.some((b) => b.hex === SKIRT_HEX)).toBe(true);
  });

  it("prefers a line's own declared stock over the type default", () => {
    const stock: RollingStock = {
      ...DEFAULT_STOCK.heavy,
      cars: 3,
      shell: "#D7DBDF",
    };
    const spec = resolveStock({ color: GREEN, vehicleType: "heavy", rollingStock: stock });
    expect(spec.cars).toBe(3);
    expect(spec.shellHex).toBe(0xd7dbdf);
  });

  it("carries glbUrl through only when one is declared", () => {
    const plain = resolveStock({ color: GREEN, vehicleType: "heavy", rollingStock: null });
    expect(plain.glbUrl).toBeUndefined();
    const withGlb = resolveStock({
      color: GREEN,
      vehicleType: "heavy",
      rollingStock: { ...DEFAULT_STOCK.heavy, glbUrl: "/stock/test.glb" },
    });
    expect(withGlb.glbUrl).toBe("/stock/test.glb");
  });
});

describe("colour partitioning for the WCAG gate", () => {
  it("splits large-area roles from detail roles with no overlap", () => {
    const spec = resolveStock({ color: GREEN, vehicleType: "heavy", rollingStock: null });
    const large = liveryColors(spec);
    const detail = detailColors(spec);
    expect(large).toContain(spec.shellHex);
    expect(large).toContain(0x7cb342);
    expect(detail).toContain(GLAZING_HEX);
    expect(detail).toContain(SKIRT_HEX);
    expect(large.filter((c) => detail.includes(c))).toEqual([]);
  });

  it("gives monorails and people movers no skirt", () => {
    for (const type of ["monorail", "apm"] as const) {
      const spec = resolveStock({ color: GREEN, vehicleType: type, rollingStock: null });
      expect(detailColors(spec)).not.toContain(SKIRT_HEX);
    }
  });
});
