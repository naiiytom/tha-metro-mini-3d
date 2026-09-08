import { describe, expect, it } from "vitest";
import { formatBilingualStation } from "./stationTypography";

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
