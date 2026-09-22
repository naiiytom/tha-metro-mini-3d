import { describe, expect, it } from "vitest";
import { formatBilingualHub, formatBilingualStation, resolveLineName } from "./stationTypography";

describe("formatBilingualHub", () => {
  const hub = { nameEn: "Asok / Sukhumvit", nameTh: "อโศก / สุขุมวิท" };

  it("formats compound English as primary and compound Thai as subtitle in 'en' mode", () => {
    const res = formatBilingualHub(hub, "en");
    expect(res.primaryName).toBe("Asok / Sukhumvit");
    expect(res.secondaryName).toBe("อโศก / สุขุมวิท");
    expect(res.subtitle).toBe("อโศก / สุขุมวิท");
  });

  it("formats compound Thai as primary and compound English as subtitle in 'th' mode", () => {
    const res = formatBilingualHub(hub, "th");
    expect(res.primaryName).toBe("อโศก / สุขุมวิท");
    expect(res.secondaryName).toBe("Asok / Sukhumvit");
    expect(res.subtitle).toBe("Asok / Sukhumvit");
  });
});

describe("formatBilingualStation", () => {
  it("formats English as primary and Thai + code as subtitle when primaryLang is 'en'", () => {
    const res = formatBilingualStation(
      { name_en: "Siam", name_th: "สยาม", code: "CEN" },
      "en",
    );
    expect(res.primaryName).toBe("Siam");
    expect(res.secondaryName).toBe("สยาม");
    expect(res.subtitle).toBe("สยาม • CEN");
  });

  it("formats Thai as primary and English + code as subtitle when primaryLang is 'th'", () => {
    const res = formatBilingualStation(
      { name_en: "Siam", name_th: "สยาม", code: "CEN" },
      "th",
    );
    expect(res.primaryName).toBe("สยาม");
    expect(res.secondaryName).toBe("Siam");
    expect(res.subtitle).toBe("Siam • CEN");
  });

  it("handles stations without official code", () => {
    const res = formatBilingualStation(
      { name_en: "Wat Mangkon", name_th: "วัดมังกร", code: "" },
      "en",
    );
    expect(res.primaryName).toBe("Wat Mangkon");
    expect(res.secondaryName).toBe("วัดมังกร");
    expect(res.subtitle).toBe("วัดมังกร");
  });

  it("supports camelCase property names (name, nameTh)", () => {
    const res = formatBilingualStation(
      { name: "Asok", nameTh: "อโศก", code: "E4" },
      "en",
    );
    expect(res.primaryName).toBe("Asok");
    expect(res.secondaryName).toBe("อโศก");
    expect(res.subtitle).toBe("อโศก • E4");
  });
});

describe("resolveLineName", () => {
  const line = { name: "Sukhumvit Line", nameTh: "สายสุขุมวิท" };

  it("returns English name when primaryLang is 'en'", () => {
    expect(resolveLineName(line, "en")).toBe("Sukhumvit Line");
  });

  it("returns Thai name when primaryLang is 'th'", () => {
    expect(resolveLineName(line, "th")).toBe("สายสุขุมวิท");
  });

  it("falls back to English when Thai name is empty in 'th' mode", () => {
    expect(resolveLineName({ name: "Custom Line", nameTh: "" }, "th")).toBe("Custom Line");
  });

  it("returns fallback string when route is null/undefined", () => {
    expect(resolveLineName(null, "th", "Default")).toBe("Default");
  });
});

