import { describe, expect, it } from "vitest";
import { MERC_PER_METER, ORIGIN_MERC } from "./coordinates";
import { projectLocal, type ViewProjection } from "./screenProject";

/**
 * A synthetic mercator->clip matrix, column-major like MapLibre's own
 * `mainMatrix`: element (row r, col c) is m[c * 4 + r].
 *
 * It puts the local origin at screen centre, scales 1 metre to 0.002 NDC,
 * and SHEARS z into clip-y so altitude moves a point up the screen — which
 * is what a pitched camera does, and the whole point of the test.
 */
function testMatrix(): number[] {
  const s = 0.002 / MERC_PER_METER; // NDC per mercator unit
  const m = new Array(16).fill(0);
  m[0] = s; // x -> clip.x
  m[5] = s; // y -> clip.y
  m[9] = s; // z -> clip.y: +NDC y is UP, so altitude raises the point,
  //           which lowers its canvas y. 15 m -> 0.03 NDC -> 15 px up.
  m[12] = -s * ORIGIN_MERC.x;
  m[13] = -s * ORIGIN_MERC.y;
  m[15] = 1; // w = 1
  return m;
}

const view: ViewProjection = { matrix: testMatrix(), widthPx: 1000, heightPx: 1000 };

describe("projectLocal", () => {
  it("puts the local origin at the centre of the viewport", () => {
    const p = projectLocal(view, 0, 0, 0);
    expect(p).not.toBeNull();
    expect(p!.x).toBeCloseTo(500, 6);
    expect(p!.y).toBeCloseTo(500, 6);
  });

  it("moves east by the expected pixel count", () => {
    // 100 m * 0.002 NDC/m = 0.2 NDC -> 0.1 of half-width -> +100 px
    const p = projectLocal(view, 100, 0, 0);
    expect(p!.x).toBeCloseTo(600, 6);
  });

  it("accounts for altitude — this is the #25 defect", () => {
    // Elevated track at +15 m draws 15 px HIGHER, i.e. lower canvas y.
    // Ground-level projection would have given 500 for both.
    const ground = projectLocal(view, 0, 0, 0)!;
    const elevated = projectLocal(view, 0, 0, 15)!;
    expect(ground.y).toBeCloseTo(500, 6);
    expect(elevated.y).toBeCloseTo(485, 6);
    // The offset the old map.project() path silently discarded:
    expect(Math.abs(elevated.y - ground.y)).toBeGreaterThan(10);
  });

  it("moves underground track the other way", () => {
    // MRT Blue at -18 m draws BELOW its ground projection.
    const p = projectLocal(view, 0, 0, -18);
    expect(p!.y).toBeCloseTo(518, 6);
  });

  it("rejects a point behind the camera instead of wrapping it on screen", () => {
    const behind = testMatrix();
    behind[15] = -1; // w < 0
    const p = projectLocal({ ...view, matrix: behind }, 0, 0, 0);
    expect(p).toBeNull();
  });
});
