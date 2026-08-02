import { useAppStore } from "../stores/useAppStore";
import type { LineGeometry } from "../types";
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
        className={`flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-xs transition-colors hover:bg-slate-200/60 ${
          visible ? "text-slate-800" : "text-slate-400"
        }`}
      >
        <span
          className="inline-block h-2 w-4 shrink-0 rounded-sm"
          style={{ background: line.color, opacity: visible ? 1 : 0.3 }}
        />
        <span className="truncate">{line.name}</span>
        {line.preRevenue ? (
          <span className="ml-auto shrink-0 rounded bg-amber-100 px-1 text-[9px] uppercase text-amber-700">
            pre-revenue
          </span>
        ) : line.gtfsRouteId === null ? (
          <span className="ml-auto shrink-0 text-[9px] uppercase text-slate-500">
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
 */
export function LineSelector() {
  const routes = useAppStore((s) => s.routes);
  const mapReady = useAppStore((s) => s.mapReady);

  return (
    <div className="pointer-events-auto absolute left-4 top-4 max-h-[calc(100dvh-2rem)] w-60 overflow-y-auto rounded-xl border border-white/40 bg-white/70 px-4 py-3 shadow-xl shadow-slate-900/10 backdrop-blur-md ring-1 ring-slate-900/5">
      <h1 className="text-sm font-semibold text-slate-900">Greater Bangkok Metro Mini 3D</h1>
      <p className="mb-2 text-xs text-slate-600">
        {mapReady ? "Click a train or station to inspect it." : "Loading map…"}
      </p>
      {routes.length > 0 && (
        <ul className="space-y-0.5">
          {routes.map((line, routeIdx) => (
            <LineRow key={line.key} line={line} routeIdx={routeIdx} />
          ))}
        </ul>
      )}
      <ViewControls />
    </div>
  );
}
