import { describe, expect, it } from "vitest";
import {
  applyRubberBand,
  calcTargetDetent,
  getDetentY,
} from "./useBottomSheet";

describe("useBottomSheet detent calculations", () => {
  const frameH = 1000;
  // fullRatio = 0.85 -> sheetH = 850
  // halfRatio = 0.40 -> visible = 400 -> Y = 850 - 400 = 450
  // peekHeight = 72 -> visible = 72 -> Y = 850 - 72 = 778

  it("calculates exact translateY for all three detents", () => {
    expect(getDetentY("full", frameH)).toBe(0);
    expect(getDetentY("half", frameH)).toBe(450);
    expect(getDetentY("peek", frameH)).toBe(778);
  });

  it("applies rubber banding when pulling beyond bounds", () => {
    const minY = 0;
    const maxY = 778;

    // Inside bounds: unchanged
    expect(applyRubberBand(200, minY, maxY)).toBe(200);

    // Pulling up past full (< 0): negative with dampening
    const pastTop = applyRubberBand(-50, minY, maxY);
    expect(pastTop).toBeLessThan(0);
    expect(pastTop).toBeGreaterThan(-50);

    // Pulling down past peek (> 778): exceeds 778 with dampening
    const pastBottom = applyRubberBand(828, minY, maxY);
    expect(pastBottom).toBeGreaterThan(778);
    expect(pastBottom).toBeLessThan(828);
  });

  it("snaps to nearest detent on low-velocity release", () => {
    // Current at 440 (closest to half 450)
    expect(calcTargetDetent(440, 0, frameH)).toBe("half");

    // Current at 50 (closest to full 0)
    expect(calcTargetDetent(50, 0.1, frameH)).toBe("full");

    // Current at 750 (closest to peek 778)
    expect(calcTargetDetent(750, -0.1, frameH)).toBe("peek");
  });

  it("honors directional velocity flicks (|v| > 0.45 px/ms)", () => {
    // Flick downwards from 200 (between full and half): snaps to half
    expect(calcTargetDetent(200, 0.6, frameH)).toBe("half");

    // Flick upwards from 600 (between peek and half): snaps to half
    expect(calcTargetDetent(600, -0.6, frameH)).toBe("half");

    // Flick upwards from 300 (between half and full): snaps to full
    expect(calcTargetDetent(300, -0.6, frameH)).toBe("full");

    // Flick downwards from 500 (between half and peek): snaps to peek
    expect(calcTargetDetent(500, 0.6, frameH)).toBe("peek");
  });
});
