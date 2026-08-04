import { describe, expect, it } from "vitest";
import { MOBILE_BREAKPOINT_QUERY } from "./useIsMobile";

/**
 * Only the breakpoint constant is covered here, not the hook body — exercising
 * `window.matchMedia`/re-render-on-change needs a DOM test environment (jsdom
 * + a hook-testing utility) that isn't part of this repo's test setup (every
 * other test runs in vitest's default node environment against pure
 * functions). This still catches the failure mode that matters most: the
 * number silently drifting from Tailwind's `md:` breakpoint (768px) that
 * every mobile/desktop class split in the app assumes it matches.
 */
describe("MOBILE_BREAKPOINT_QUERY", () => {
  it("matches Tailwind's default md: breakpoint (768px)", () => {
    expect(MOBILE_BREAKPOINT_QUERY).toBe("(max-width: 767px)");
  });
});
