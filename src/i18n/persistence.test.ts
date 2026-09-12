import { describe, expect, it } from "vitest";
import {
  PRIMARY_LANG_KEY,
  detectBrowserLanguage,
  loadPrimaryLang,
  parsePrimaryLang,
  resolveInitialLanguage,
  savePrimaryLang,
  type ReadableStorage,
  type WritableStorage,
} from "./persistence";

describe("persistence helpers (Seam C)", () => {
  it("parses only known primary languages", () => {
    expect(parsePrimaryLang("en")).toBe("en");
    expect(parsePrimaryLang("th")).toBe("th");
    expect(parsePrimaryLang("ja")).toBeNull();
    expect(parsePrimaryLang("")).toBeNull();
    expect(parsePrimaryLang(null)).toBeNull();
  });

  it("detects browser language with Thai bias", () => {
    expect(detectBrowserLanguage({ language: "th" })).toBe("th");
    expect(detectBrowserLanguage({ language: "th-TH" })).toBe("th");
    expect(detectBrowserLanguage({ language: "TH" })).toBe("th");
    expect(detectBrowserLanguage({ language: "en-US" })).toBe("en");
    expect(detectBrowserLanguage({ language: "ja-JP" })).toBe("en");
    expect(detectBrowserLanguage(undefined)).toBe("en");
  });

  it("persisted choice beats browser auto-detection", () => {
    const storeTh: Record<string, string> = { [PRIMARY_LANG_KEY]: "th" };
    const storageTh: ReadableStorage = { getItem: (k) => storeTh[k] ?? null };
    expect(resolveInitialLanguage(storageTh, { language: "en-US" })).toBe("th");

    const storeEn: Record<string, string> = { [PRIMARY_LANG_KEY]: "en" };
    const storageEn: ReadableStorage = { getItem: (k) => storeEn[k] ?? null };
    expect(resolveInitialLanguage(storageEn, { language: "th-TH" })).toBe("en");
  });

  it("falls back to browser auto-detection when no valid choice is stored", () => {
    const emptyStorage: ReadableStorage = { getItem: () => null };
    expect(resolveInitialLanguage(emptyStorage, { language: "th-TH" })).toBe("th");
    expect(resolveInitialLanguage(emptyStorage, { language: "en-GB" })).toBe("en");

    const invalidStorage: ReadableStorage = { getItem: () => "invalid-lang" };
    expect(resolveInitialLanguage(invalidStorage, { language: "th-TH" })).toBe("th");
  });

  it("guards against throwing storage", () => {
    const throwingStorage: ReadableStorage & WritableStorage = {
      getItem: () => {
        throw new Error("SecurityError: Access is denied");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };

    expect(loadPrimaryLang(throwingStorage)).toBeNull();
    expect(() => savePrimaryLang("th", throwingStorage)).not.toThrow();
    expect(resolveInitialLanguage(throwingStorage, { language: "th" })).toBe("th");
  });

  it("saves primary language under tmm3d.lang key", () => {
    const store: Record<string, string> = {};
    const storage: WritableStorage & ReadableStorage = {
      getItem: (k) => store[k] ?? null,
      setItem: (k, v) => {
        store[k] = v;
      },
    };

    savePrimaryLang("th", storage);
    expect(store[PRIMARY_LANG_KEY]).toBe("th");
    expect(loadPrimaryLang(storage)).toBe("th");

    savePrimaryLang(storage, "en");
    expect(store[PRIMARY_LANG_KEY]).toBe("en");
    expect(loadPrimaryLang(storage)).toBe("en");
  });
});
