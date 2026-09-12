import type { PlanLeg } from "../sim/protocol";
import { formatCountdown, formatServiceSec } from "../sim/time";
import type { LineGeometry } from "../types";
import { useAppStore } from "../stores/useAppStore";
import { useT } from "../i18n";

/**
 * Standard disclosure note styling across StationBoard/TrainInspector/RoutePlanner.
 */
export const NOTE_CLASS =
  "mx-2 mb-1 rounded bg-note-bg px-2 py-1 text-[10px] leading-snug text-note-ink";

export interface LegRowProps {
  leg: PlanLeg;
  routes: LineGeometry[];
  rideBefore: boolean;
  rideAfter: boolean;
}

export function LegRow({ leg, routes, rideBefore, rideAfter }: LegRowProps) {
  const primaryLang = useAppStore((s) => s.primaryLang);
  const t = useT();

  if (leg.kind === "transfer") {
    const label = rideBefore
      ? rideAfter
        ? t("route.changeTrains")
        : t("route.walkToDestination")
      : rideAfter
        ? t("route.walkToFirstTrain")
        : t("route.walkToDestination");
    return (
      <li className="flex items-start gap-2 px-3 py-1.5 text-xs text-ink-muted">
        <span className="mt-0.5 inline-block h-2 w-4 shrink-0" aria-hidden />
        <span>
          {label}
          {leg.transferS > 0 ? t("route.transferAllowed", { time: formatCountdown(leg.transferS, primaryLang) }) : null}
          {rideAfter ? t("route.thenWait", { time: formatCountdown(leg.waitS, primaryLang) }) : null}{" "}
          {t("route.approxMeters", { meters: Math.round(leg.walkM) })}
        </span>
      </li>
    );
  }

  const resolvedHeadsign = primaryLang === "th" && leg.headsignTh ? leg.headsignTh : leg.headsign;
  const resolvedRouteName = primaryLang === "th" && routes[leg.routeIdx]?.nameTh
    ? routes[leg.routeIdx]?.nameTh
    : leg.routeName;

  return (
    <li className="flex items-start gap-2 px-3 py-1.5">
      <span
        className="mt-1 inline-block h-2 w-4 shrink-0 rounded-sm"
        style={{ background: leg.colorRgb }}
      />
      <div className="min-w-0 flex-1 text-xs text-ink-muted">
        <p className="truncate">
          <span className="font-medium text-ink">{resolvedHeadsign}</span>
          <span className="ml-1 text-ink-muted">{resolvedRouteName}</span>
        </p>
        <p className="truncate">
          {formatServiceSec(leg.boardSec)} {leg.boardName} → {formatServiceSec(leg.alightSec)}{" "}
          {leg.alightName}
        </p>
        {leg.intermediateStops.length > 0 && (
          <p className="truncate text-ink-muted">
            {leg.intermediateStops.length === 1
              ? t("route.stopsOne", { count: 1, stops: leg.intermediateStops.join(", ") })
              : t("route.stopsOther", { count: leg.intermediateStops.length, stops: leg.intermediateStops.join(", ") })}
          </p>
        )}
      </div>
    </li>
  );
}
