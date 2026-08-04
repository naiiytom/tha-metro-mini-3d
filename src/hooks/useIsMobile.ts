import { useEffect, useState } from "react";

// Mirrors Tailwind's default `md:` breakpoint (768px) — anything gated by
// this hook must match the `md:` class variants used throughout the mobile
// layout, or the JSX-structural branch and the CSS breakpoint disagree.
// Exported (only) so a test can pin it against that 768px number without
// needing a DOM — the hook body itself isn't unit tested, since exercising
// `window.matchMedia` / re-render-on-change needs a DOM test environment
// (jsdom + a hook-testing utility) this repo doesn't have; every other test
// here runs in vitest's default node environment against pure functions.
export const MOBILE_BREAKPOINT_QUERY = "(max-width: 767px)";

export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(() => window.matchMedia(MOBILE_BREAKPOINT_QUERY).matches);

  useEffect(() => {
    const mql = window.matchMedia(MOBILE_BREAKPOINT_QUERY);
    const onChange = () => setIsMobile(mql.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return isMobile;
}
