import { describe, expect, it } from "vitest";
import { BASEMAP_STYLES, styleUrl } from "./basemapStyles";

describe("BASEMAP_STYLES", () => {
  it("offers more than one style", () => {
    expect(BASEMAP_STYLES.length).toBeGreaterThan(1);
  });

  it("is entirely key-free — no api_key, access_token or key query parameter", () => {
    // Standing project constraint: OpenFreeMap was chosen precisely because
    // it needs no key, and a keyed source would break every deploy target.
    for (const s of BASEMAP_STYLES) {
      const url = new URL(s.url);
      expect(url.protocol).toBe("https:");
      expect([...url.searchParams.keys()]).toEqual([]);
      expect(s.url).not.toMatch(/api[-_]?key|access[-_]?token|[?&]key=/i);
    }
  });

  it("serves every style from openfreemap.org", () => {
    for (const s of BASEMAP_STYLES) {
      expect(new URL(s.url).hostname).toBe("tiles.openfreemap.org");
    }
  });

  it("has unique keys and non-empty labels", () => {
    const keys = BASEMAP_STYLES.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const s of BASEMAP_STYLES) expect(s.label.length).toBeGreaterThan(0);
  });

  it("resolves a url for every key and falls back for an unknown one", () => {
    for (const s of BASEMAP_STYLES) expect(styleUrl(s.key)).toBe(s.url);
    expect(styleUrl("nope" as never)).toBe(BASEMAP_STYLES[0].url);
  });

  it("keeps liberty first so the default style is unchanged from MVP 6", () => {
    expect(BASEMAP_STYLES[0].key).toBe("liberty");
  });
});
