import { useEffect, useState } from "react";
import { useIsMobile } from "../hooks/useIsMobile";
import { useAppStore } from "../stores/useAppStore";
import { ESTIMATED_RUN_TIMES_NOTE, type LineGeometry, SYNTHETIC_SCHEDULE_NOTE } from "../types";
import { browserStorage, hasStoredPreference, loadCollapsed, saveCollapsed } from "./panelCollapse";
import { ViewControls } from "./ViewControls";

/** One toggleable row — its own component so it can call the store's
 * `isRouteVisible` selector directly (the canonical, tested "is this route
 * hidden" check) instead of `LineSelector` re-deriving it with a raw
 * `hiddenRoutes.includes()` per row, which a hook can't do from inside a
 * `.map()` callback. */
function LineRow({ line, routeIdx }: { line: LineGeometry; routeIdx: number }) {
  const visible = useAppStore((s) => s.isRouteVisible(routeIdx));
  const toggleRoute = useAppStore((s) => s.toggleRoute);
  return (
    <li>
      <button
        type="button"
        aria-pressed={visible}
        onClick={() => toggleRoute(routeIdx)}
        className={`flex w-full items-center gap-2 rounded-md px-3 py-2.5 text-left text-sm transition-colors hover:bg-surface-sunken md:px-1.5 md:py-1 md:text-xs ${
          visible ? "text-ink" : "text-ink-subtle"
        }`}
      >
        <span
          className="inline-block h-2 w-4 shrink-0 rounded-sm"
          style={{ background: line.color, opacity: visible ? 1 : 0.3 }}
        />
        <span className="truncate">{line.name}</span>
        {line.preRevenue ? (
          // Deliberately NOT the note-bg/note-ink token its two siblings
          // below use: this badge is a caution ("not open, no trains ever")
          // where the other two are purely informational ("open, but times
          // are estimated") — different semantics, so a different fixed
          // amber palette rather than the shared token is intentional, not
          // an oversight. (Minor #8, a real dedicated danger/warning token,
          // is parked/out of scope for this fix.)
          <span
            data-testid="pre-revenue-badge"
            className="ml-auto shrink-0 rounded bg-amber-100 px-1 text-[9px] uppercase text-amber-700"
          >
            pre-revenue
          </span>
        ) : line.syntheticSchedule !== null ? (
          // Checked before the track-only branch below: a synthetic-schedule
          // line also has gtfsRouteId === null, but it is emphatically NOT
          // track only — it runs trains, just on estimated times.
          <span
            className="ml-auto shrink-0 rounded bg-note-bg px-1 text-[9px] uppercase text-note-ink"
            title={SYNTHETIC_SCHEDULE_NOTE}
            data-testid="synthetic-schedule-badge"
          >
            estimated
          </span>
        ) : line.estimatedRunTimes != null ? (
          // Also checked before the track-only branch: MRT Pink has a real
          // gtfsRouteId, so it can't collide with that branch either way —
          // but keeping this ahead of it matches the syntheticSchedule
          // precedent and keeps every "runs trains on non-standard times"
          // case together, ahead of "doesn't run trains at all." Same
          // classes as the syntheticSchedule badge just above (this card sits
          // on the translucent panel-glass surface, which darkens in dark
          // mode — so the badge stays a fixed, self-contained light chip with
          // a dark-on-light palette regardless of theme, not the
          // white-on-white this originally shipped with).
          //
          // `!= null`, not `!== null`: StationBoard/TrainInspector both use
          // `!= null` for this same field, and network.json is routinely
          // hand-edited in this repo without a re-fetch — a line added or
          // patched by hand that omits the field entirely is `undefined`,
          // not `null`. `!== null` would have shown this badge for such a
          // line (a false "estimated" claim) while the two detail panels
          // correctly showed nothing. Found in code review.
          <span
            data-testid="estimated-run-times-badge"
            className="ml-auto shrink-0 rounded bg-note-bg px-1 text-[9px] uppercase text-note-ink"
            title={ESTIMATED_RUN_TIMES_NOTE}
          >
            Est. times
          </span>
        ) : line.gtfsRouteId === null ? (
          <span className="ml-auto shrink-0 text-[9px] uppercase text-ink-muted">
            track only
          </span>
        ) : null}
      </button>
    </li>
  );
}

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
