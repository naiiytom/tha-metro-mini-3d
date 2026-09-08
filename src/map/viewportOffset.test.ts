import { describe, expect, it } from "vitest";
import { offsetCenterForSheet, type OffsetMapLike } from "./viewportOffset";

describe("offsetCenterForSheet", () => {
  const createMockMap = (height = 800, width = 400): OffsetMapLike => {
    return {
      getContainer: () => ({ clientHeight: height, clientWidth: width }),
      project: ([lng, lat]: [number, number]) => ({
        x: lng * 10,
        y: (100 - lat) * 10,
      }),
      unproject: ([x, y]: [number, number]) => ({
        lng: x / 10,
        lat: 100 - y / 10,
      }),
    };
  };

  it("returns original coordinates when sheetRatio is 0", () => {
    const map = createMockMap();
    const result = offsetCenterForSheet([100.5, 13.7], map, 0);
    expect(result).toEqual([100.5, 13.7]);
  });

  it("shifts camera center southwards (lower latitude) to center point in upper visible canvas", () => {
    const map = createMockMap(800);
    // For 800px height with sheetRatio = 0.4 (40vh):
    // deltaY = (800 * 0.4) / 2 = 160px.
    // In mock unproject: lat = 100 - (y + 160) / 10, which reduces latitude (moves south).
    const result = offsetCenterForSheet([100.5, 13.7], map, 0.4);

    expect(result[0]).toBeCloseTo(100.5, 4);
    // deltaY is +160px, in mock projection scale this is -16 units in latitude
    expect(result[1]).toBeLessThan(13.7);
    expect(result[1]).toBeCloseTo(13.7 - 16, 4);
  });

  it("handles boundary sheetRatio and missing height gracefully", () => {
    const map = createMockMap(0);
    expect(offsetCenterForSheet([100.5, 13.7], map, 0.4)).toEqual([100.5, 13.7]);

    const normalMap = createMockMap(800);
    expect(offsetCenterForSheet([100.5, 13.7], normalMap, -0.1)).toEqual([100.5, 13.7]);
    expect(offsetCenterForSheet([100.5, 13.7], normalMap, 1.2)).toEqual([100.5, 13.7]);
  });
});
