import { useAppStore } from "../../stores/useAppStore";
import { ESTIMATED_RUN_TIMES_NOTE, type LineGeometry, SYNTHETIC_SCHEDULE_NOTE } from "../../types";
import { ViewControls } from "../ViewControls";

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
          <span
            data-testid="pre-revenue-badge"
            className="ml-auto shrink-0 rounded bg-amber-100 px-1 text-[9px] uppercase text-amber-700"
          >
            pre-revenue
          </span>
        ) : line.syntheticSchedule !== null ? (
          <span
            className="ml-auto shrink-0 rounded bg-note-bg px-1 text-[9px] uppercase text-note-ink"
            title={SYNTHETIC_SCHEDULE_NOTE}
            data-testid="synthetic-schedule-badge"
          >
            estimated
          </span>
        ) : line.estimatedRunTimes != null ? (
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

export function LinesTab() {
  const routes = useAppStore((s) => s.routes);

  return (
    <div data-testid="lines-tab" className="px-1 py-1">
      <ul className="space-y-0.5">
        {routes.map((line, idx) => (
          <LineRow key={line.key || idx} line={line} routeIdx={idx} />
        ))}
      </ul>
      <ViewControls />
    </div>
  );
}
