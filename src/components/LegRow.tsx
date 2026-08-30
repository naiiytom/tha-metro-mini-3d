import type { PlanLeg } from "../sim/protocol";
import { formatCountdown, formatServiceSec } from "../sim/time";
import type { LineGeometry } from "../types";

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
  if (leg.kind === "transfer") {
    const label = rideBefore
      ? rideAfter
        ? "Change trains"
        : "Walk to your destination"
      : rideAfter
        ? "Walk to your first train"
        : "Walk to your destination";
    return (
      <li className="flex items-start gap-2 px-3 py-1.5 text-xs text-ink-muted">
        <span className="mt-0.5 inline-block h-2 w-4 shrink-0" aria-hidden />
        <span>
          {label}
          {leg.transferS > 0 ? <> — {formatCountdown(leg.transferS)} allowed</> : null}
          {rideAfter ? <>, then wait {formatCountdown(leg.waitS)}</> : null} (≈
          {Math.round(leg.walkM)} m)
        </span>
      </li>
    );
  }
  void routes;
  return (
    <li className="flex items-start gap-2 px-3 py-1.5">
      <span
        className="mt-1 inline-block h-2 w-4 shrink-0 rounded-sm"
        style={{ background: leg.colorRgb }}
      />
      <div className="min-w-0 flex-1 text-xs text-ink-muted">
        <p className="truncate">
          <span className="font-medium text-ink">{leg.headsign}</span>
          <span className="ml-1 text-ink-muted">{leg.routeName}</span>
        </p>
        <p className="truncate">
          {formatServiceSec(leg.boardSec)} {leg.boardName} → {formatServiceSec(leg.alightSec)}{" "}
          {leg.alightName}
        </p>
        {leg.intermediateStops.length > 0 && (
          <p className="truncate text-ink-muted">
            {leg.intermediateStops.length} stop
            {leg.intermediateStops.length === 1 ? "" : "s"} · {leg.intermediateStops.join(", ")}
          </p>
        )}
      </div>
    </li>
  );
}
