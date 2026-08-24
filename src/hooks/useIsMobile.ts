import { useEffect, useState } from "react";

// Mirrors Tailwind's default `md:` breakpoint (768px) — anything gated by
// this hook must match the `md:` class variants used throughout the mobile
// layout, or the JSX-structural branch and the CSS breakpoint disagree.
// Exported so tests can verify the exact breakpoint query matches Tailwind's md: breakpoint.
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
