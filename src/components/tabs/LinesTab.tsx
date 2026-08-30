import { useAppStore } from "../../stores/useAppStore";
import { LineRow } from "../LineRow";
import { ViewControls } from "../ViewControls";

export function LinesTab() {
  const routes = useAppStore((s) => s.routes);
  const stations = useAppStore((s) => s.stations);

  const simulatedCount = routes.filter(
    (r) => r.gtfsRouteId !== null || r.syntheticSchedule !== null,
  ).length;
  const stationCount = stations.length > 0 ? stations.length : 198;

  return (
    <div data-testid="lines-tab" className="px-1 py-1">
      {/* Network Stats Summary */}
      <div
        data-testid="network-stats"
        className="mb-2 flex items-center justify-between rounded-md bg-surface-sunken/80 px-2.5 py-1.5 text-[11px] text-ink-muted"
      >
        <span>
          <strong className="text-ink">{routes.length}</strong> lines (
          {simulatedCount} simulated)
        </span>
        <span>
          <strong className="text-ink">{stationCount}</strong> stations
        </span>
      </div>

      <ul className="space-y-0.5">
        {routes.map((line, idx) => (
          <LineRow key={line.key || idx} line={line} routeIdx={idx} />
        ))}
      </ul>
      <ViewControls />
    </div>
  );
}

