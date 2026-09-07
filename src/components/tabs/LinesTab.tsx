import { useAppStore } from "../../stores/useAppStore";
import { groupLinesByOperator } from "../../data/operators";
import { LineRow } from "../LineRow";
import { ViewControls } from "../ViewControls";

export function LinesTab() {
  const routes = useAppStore((s) => s.routes);
  const stations = useAppStore((s) => s.stations);
  const primaryLang = useAppStore((s) => s.primaryLang);

  const simulatedCount = routes.filter(
    (r) => r.gtfsRouteId !== null || r.syntheticSchedule !== null,
  ).length;
  const stationCount = stations.length > 0 ? stations.length : 198;

  const operatorGroups = groupLinesByOperator(routes);

  return (
    <div data-testid="lines-tab" className="px-1 py-1">
      {/* Network Stats Summary */}
      <div
        data-testid="network-stats"
        className="mb-2 flex items-center justify-between rounded-md bg-surface-sunken/80 px-2.5 py-1.5 text-[11px] text-ink-muted"
      >
        <span>
          <strong className="text-ink">{routes.length}</strong> {primaryLang === "th" ? "สาย" : "lines"} (
          {simulatedCount} {primaryLang === "th" ? "จำลองเดินรถ" : "simulated"})
        </span>
        <span>
          <strong className="text-ink">{stationCount}</strong> {primaryLang === "th" ? "สถานี" : "stations"}
        </span>
      </div>

      {operatorGroups.length > 0 ? (
        <div className="space-y-3">
          {operatorGroups.map((group) => (
            <div key={group.operator.id} data-testid={`operator-group-${group.operator.id}`} className="space-y-1">
              <div className="flex items-center gap-2 px-1 pt-1">
                <span
                  className="h-3 w-1 shrink-0 rounded-full"
                  style={{ backgroundColor: group.operator.brandColor }}
                  aria-hidden="true"
                />
                <span className="text-xs font-semibold text-ink">
                  {primaryLang === "th" ? group.operator.nameTh : group.operator.nameEn}
                </span>
                <span className="ml-auto text-[10px] font-medium text-ink-subtle">
                  {group.activeLines.length + group.preRevenueLines.length} {primaryLang === "th" ? "สาย" : "lines"}
                </span>
              </div>

              {group.activeLines.length > 0 && (
                <ul className="space-y-0.5">
                  {group.activeLines.map(({ line, routeIdx }) => (
                    <LineRow key={line.key || routeIdx} line={line} routeIdx={routeIdx} />
                  ))}
                </ul>
              )}

              {group.preRevenueLines.length > 0 && (
                <div className="mt-1 ml-2 pl-2 border-l-2 border-amber-500/30">
                  <div className="text-[10px] font-medium text-amber-700 dark:text-amber-400 uppercase tracking-wider py-0.5">
                    {primaryLang === "th" ? "โครงการส่วนต่อขยาย" : "Pre-Revenue / Future"}
                  </div>
                  <ul className="space-y-0.5">
                    {group.preRevenueLines.map(({ line, routeIdx }) => (
                      <LineRow key={line.key || routeIdx} line={line} routeIdx={routeIdx} />
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <ul className="space-y-0.5">
          {routes.map((line, idx) => (
            <LineRow key={line.key || idx} line={line} routeIdx={idx} />
          ))}
        </ul>
      )}

      <ViewControls />
    </div>
  );
}
