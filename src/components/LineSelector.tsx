import { useEffect, useState } from "react";
import { useIsMobile } from "../hooks/useIsMobile";
import { useAppStore } from "../stores/useAppStore";
import { LineRow } from "./LineRow";
import { browserStorage, hasStoredPreference, loadCollapsed, saveCollapsed } from "./panelCollapse";
import { ViewControls } from "./ViewControls";


/**
 * Line visibility toggles (F4.1). Doubles as the map legend — it is the only
 * place the user learns which colour is which line.
 *
 * Hiding a line hides its track, stations and trains but does NOT stop the
 * engine evaluating it: the sim is a pure function of time, and skipping runs
 * would make the vehicle count and the station boards disagree with the clock.
 *
 * This card is collapsible at every width (issue #29) — not just below
 * `md:` as it originally shipped, where a 14-line list plus the whole
 * `ViewControls` block sat permanently over the map it controls on desktop.
 * The collapsed/expanded choice persists (`panelCollapse.ts`) and, once the
 * user has stated one, wins at both widths; until then it still defaults
 * collapsed on mobile / expanded on desktop. Below `md:` the header also
 * carries the "hide UI" toggle — deliberately kept here rather than as a
 * separate floating button, since this corner is the only one on the map
 * MapLibre's own `NavigationControl` (top-right) doesn't already occupy.
 */
export function LineSelector() {
  const routes = useAppStore((s) => s.routes);
  const mapReady = useAppStore((s) => s.mapReady);
  const uiHidden = useAppStore((s) => s.uiHidden);
  const setUiHidden = useAppStore((s) => s.setUiHidden);
  const searchOpen = useAppStore((s) => s.searchOpen);
  const setSearchOpen = useAppStore((s) => s.setSearchOpen);
  const routePlannerOpen = useAppStore((s) => s.routePlannerOpen);
  const setRoutePlannerOpen = useAppStore((s) => s.setRoutePlannerOpen);
  const isMobile = useIsMobile();
  // `browserStorage()` (not the bare `localStorage` global) at every call
  // site — see its doc comment in panelCollapse.ts: merely referencing
  // `localStorage` can throw in some real configurations, and this call runs
  // inside a useState initializer during render, with no Error Boundary
  // above it, so that throw would white-screen the whole app.
  const [expanded, setExpanded] = useState(() => !loadCollapsed(browserStorage(), isMobile));

  // Follows the breakpoint ONLY until the user states a preference; after
  // that their choice wins at both widths, which is the point of #29.
  useEffect(() => {
    if (!hasStoredPreference(browserStorage())) setExpanded(!isMobile);
  }, [isMobile]);

  const toggleExpanded = () => {
    // Compute the new value and perform the persistence side effect OUTSIDE
    // any setState updater: an updater function must stay pure, since Strict
    // Mode / concurrent rendering may invoke it more than once per state
    // change, which would otherwise call saveCollapsed that many times for
    // one user toggle. This is a plain click handler with `expanded` already
    // in scope, so there is no need for the functional-updater form at all.
    const next = !expanded;
    // `collapsed` is the inverse of `expanded` (loadCollapsed's own
    // convention: `"true"` means collapsed) — persist the state the panel is
    // moving TO, not the one it's leaving.
    saveCollapsed(browserStorage(), !next);
    setExpanded(next);
  };

  // The isMobile gate is gone: the panel collapses at every width now.
  const bodyVisible = expanded && !uiHidden;

  return (
    <div
      data-testid="line-selector"
      // The left offset accounts for the safe-area-inset-left env variable,
      // not just a flat 16px, since on a landscape notched device
      // `viewport-fit=cover` (index.html) exposes a left inset a fixed
      // offset doesn't, and this card can end up rendered partly under the
      // cutout otherwise (finding 7).
      className="panel-glass pointer-events-auto absolute left-[max(1rem,env(safe-area-inset-left))] top-4 max-h-[calc(100dvh-16rem)] w-[min(15rem,calc(100vw-6rem))] overflow-y-auto rounded-xl border px-4 py-3 shadow-xl shadow-ink/10 backdrop-blur-md md:left-4 md:max-h-[calc(100dvh-2rem)] md:w-60"
    >
      <div className="flex items-start gap-1">
        <div className="min-w-0 flex-1">
          <h1 className="text-sm font-semibold text-ink">Greater Bangkok Metro Mini 3D</h1>
          <p className="text-xs text-ink-muted">
            {mapReady ? "Click a train or station to inspect it." : "Loading map…"}
          </p>
        </div>
        {/* Hidden rather than merely disabled while uiHidden, matching the ▲
         * button below: the panel itself is already hidden by its
         * CSS-ancestor while uiHidden, so a tappable button here would
         * silently flip searchOpen/aria-pressed/its own label with no
         * visible effect — a dead-looking control. */}
        {!uiHidden && (
          <button
            type="button"
            onClick={() => setSearchOpen(!searchOpen)}
            aria-pressed={searchOpen}
            aria-label={searchOpen ? "Close station search" : "Search stations"}
            title={searchOpen ? "Close station search" : "Search stations"}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-base leading-none text-ink-muted hover:bg-surface-sunken md:h-8 md:w-8 md:text-sm"
          >
            🔍
          </button>
        )}
        {/* Hidden rather than disabled while uiHidden, for the same reason as
         * the search button directly above: the panel it opens is already
         * collapsed by a CSS ancestor. */}
        {!uiHidden && (
          <button
            type="button"
            onClick={() => setRoutePlannerOpen(!routePlannerOpen)}
            aria-pressed={routePlannerOpen}
            aria-label={routePlannerOpen ? "Close route planner" : "Plan a route"}
            title={routePlannerOpen ? "Close route planner" : "Plan a route"}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-base leading-none text-ink-muted hover:bg-surface-sunken md:h-8 md:w-8 md:text-sm"
          >
            🧭
          </button>
        )}
        <button
          type="button"
          onClick={() => setUiHidden(!uiHidden)}
          aria-pressed={uiHidden}
          aria-label={uiHidden ? "Show map controls" : "Hide map controls"}
          title={uiHidden ? "Show map controls" : "Hide map controls"}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-base leading-none text-ink-muted hover:bg-surface-sunken md:hidden"
        >
          {uiHidden ? "☰" : "✕"}
        </button>
        {/* Hidden rather than merely disabled while uiHidden: it would
         * otherwise toggle `expanded` with no visible effect (bodyVisible
         * stays false either way) and desync aria-expanded from its own
         * label — the ☰ button above is the only expand/collapse control
         * that does anything while every overlay is collapsed. */}
        {!uiHidden && (
          <button
            type="button"
            onClick={toggleExpanded}
            aria-expanded={bodyVisible}
            aria-label={expanded ? "Collapse line list" : "Expand line list"}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-ink-muted hover:bg-surface-sunken"
          >
            {expanded ? "▲" : "▼"}
          </button>
        )}
      </div>
      {bodyVisible && (
        <>
          {routes.length > 0 && (
            <ul className="mt-2 space-y-0.5">
              {routes.map((line, routeIdx) => (
                <LineRow key={line.key} line={line} routeIdx={routeIdx} />
              ))}
            </ul>
          )}
          <ViewControls />
        </>
      )}
    </div>
  );
}
