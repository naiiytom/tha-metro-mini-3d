import { useEffect, useState } from "react";

// Mirrors Tailwind's default `md:` breakpoint (768px) — anything gated by
// this hook must match the `md:` class variants used throughout the mobile
// layout, or the JSX-structural branch and the CSS breakpoint disagree.
const QUERY = "(max-width: 767px)";

export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(() => window.matchMedia(QUERY).matches);

  useEffect(() => {
    const mql = window.matchMedia(QUERY);
    const onChange = () => setIsMobile(mql.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return isMobile;
}
