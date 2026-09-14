import { describe, expect, it } from "vitest";
import { en } from "./locales/en";
import { th } from "./locales/th";
import { interpolate, translate } from "./index";

function extractSlots(template: string): string[] {
  const matches = template.matchAll(/\{([a-zA-Z0-9_]+)\}/g);
  return Array.from(matches, (m) => m[1]).sort();
}

describe("dictionary parity (Seam A)", () => {
  const enKeys = Object.keys(en).sort();
  const thKeys = Object.keys(th).sort();

  it("has exact key parity between English and Thai dictionaries", () => {
    expect(thKeys).toEqual(enKeys);
  });

  it("has identical interpolation slot token sets per key", () => {
    for (const key of enKeys as (keyof typeof en)[]) {
      const enSlots = extractSlots(en[key]);
      const thSlots = extractSlots(th[key]);
      expect(
        thSlots,
        `Slot mismatch for key "${key}": EN has [${enSlots.join(",")}], TH has [${thSlots.join(",")}]`,
      ).toEqual(enSlots);
    }
  });

  it("interpolates slots correctly", () => {
    const template = "Showing {count} of {total} matches";
    expect(interpolate(template, { count: 5, total: 10 })).toBe("Showing 5 of 10 matches");
    expect(interpolate(template)).toBe(template);
    expect(interpolate("{a} and {b}", { a: "X" })).toBe("X and {b}");
  });

  it("translates strings with language selection and fallbacks", () => {
    expect(translate("en", "nav.title")).toBe("Greater Bangkok Metro Mini 3D");
    expect(translate("th", "nav.tabLines")).toBe("เส้นทาง");
    expect(translate("th", "lines.networkStats", { total: 14, simulated: 12 })).toBe(
      "14 สาย (12 จำลองเดินรถ)",
    );
  });
});
