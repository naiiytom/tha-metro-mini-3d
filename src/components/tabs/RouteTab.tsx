import { useMemo, useState } from "react";
import { activeSimClient } from "../../sim/SimClient";
import type { PlanLeg, RoutePlan, StationInfo } from "../../sim/protocol";
import { DEFAULT_MAX_WAIT_S } from "../../sim/protocol";
import { formatCountdown, formatServiceSec } from "../../sim/time";
import { useAppStore } from "../../stores/useAppStore";
import { planDisclosures } from "../../route/routePlanDisclosures";
import { StationCombobox } from "../StationCombobox";
import {
  ESTIMATED_RUN_TIMES_NOTE,
  SYNTHETIC_SCHEDULE_NOTE,
  TRANSFER_TIMES_ESTIMATED_NOTE,
  type LineGeometry,
} from "../../types";

const NOTE_CLASS = "mx-2 mb-1 rounded bg-note-bg px-2 py-1 text-[10px] leading-snug text-note-ink";

type Status = { kind: "idle" } | { kind: "loading" } | { kind: "done" } | { kind: "failed" };

function LegRow({
  leg,
  routes,
  rideBefore,
  rideAfter,
}: {
  leg: PlanLeg;
  routes: LineGeometry[];
  rideBefore: boolean;
  rideAfter: boolean;
}) {
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

export function RouteTab() {
  const stations = useAppStore((s) => s.stations);
  const routes = useAppStore((s) => s.routes);
  const currentPlan = useAppStore((s) => s.routePlan);
  const setPlan = useAppStore((s) => s.setRoutePlan);

  const [from, setFrom] = useState<StationInfo | null>(null);
  const [to, setTo] = useState<StationInfo | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [plans, setPlans] = useState<RoutePlan[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const visibleStations = useMemo(() => {
    return stations.filter((s) => {
      if (s.x === 0 && s.y === 0) return false;
      const line = routes[s.route_idx];
      return !line || line.gtfsRouteId !== null || line.syntheticSchedule !== null;
    });
  }, [stations, routes]);

  const disclosures = useMemo(() => {
    if (!currentPlan || currentPlan.unreachable) {
      return { synthetic: false, estimated: false, transfers: false };
    }
    return planDisclosures(currentPlan, routes);
  }, [currentPlan, routes]);

  const submit = async () => {
    const client = activeSimClient.current;
    if (!client || !from || !to) return;
    setPlan(null);
    setPlans([]);
    setSelectedIndex(0);
    setStatus({ kind: "loading" });
    try {
      const results = await client.planAlternatives(
        from.route_idx,
        from.station_idx,
        to.route_idx,
        to.station_idx,
        client.getSimNow(),
      );
      if (!results || results.length === 0) {
        setStatus({ kind: "failed" });
        return;
      }
      setPlans(results);
      setSelectedIndex(0);
      setPlan(results[0]);
      setStatus({ kind: "done" });
    } catch {
      setStatus({ kind: "failed" });
    }
  };

  return (
    <div data-testid="route-tab" className="space-y-3 px-2 py-1">
      <StationCombobox label="From" stations={visibleStations} routes={routes} onPick={setFrom} />
      <StationCombobox label="To" stations={visibleStations} routes={routes} onPick={setTo} />

      <button
        type="button"
        onClick={() => void submit()}
        disabled={!from || !to || status.kind === "loading"}
        className="w-full rounded-md bg-accent px-3 py-2 text-sm font-medium text-accent-ink transition-opacity hover:opacity-90 disabled:bg-edge disabled:text-ink-muted"
      >
        {status.kind === "loading" ? "Searching…" : "Find Route"}
      </button>

      {status.kind === "failed" && (
        <p className="px-2 text-xs text-ink-muted">
          Couldn&apos;t plan a route — the engine rejected that request.
        </p>
      )}

      {currentPlan?.unreachable && (
        <p className="px-2 text-xs text-ink-muted">
          No route found within {Math.round(DEFAULT_MAX_WAIT_S / 60)} minutes of this departure time.
          Try a different time of day.
        </p>
      )}

      {currentPlan && !currentPlan.unreachable && (
        <div className="space-y-2 pt-1">
          {plans.length > 1 && (
            <div className="flex gap-1.5" data-testid="route-plan-alternatives">
              {plans.map((p, idx) => {
                const active = idx === selectedIndex;
                return (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => {
                      setSelectedIndex(idx);
                      setPlan(p);
                    }}
                    className={`flex-1 rounded-md border p-1.5 text-left transition-colors ${
                      active
                        ? "border-accent bg-surface-sunken"
                        : "border-edge hover:bg-surface-sunken/50"
                    }`}
                  >
                    <p className="text-xs font-semibold text-ink">{formatCountdown(p.durationS)}</p>
                    <p className="text-[10px] text-ink-muted">
                      {p.transfers} transfer{p.transfers === 1 ? "" : "s"}
                    </p>
                  </button>
                );
              })}
            </div>
          )}

          <div data-testid="route-plan-summary" className="px-1 text-xs text-ink">
            <span className="font-semibold">
              {formatServiceSec(currentPlan.departSec)} → {formatServiceSec(currentPlan.arriveSec)}
            </span>
            <span className="ml-2 text-ink-muted">
              {formatCountdown(currentPlan.durationS)} · {currentPlan.transfers} transfer
              {currentPlan.transfers === 1 ? "" : "s"}
            </span>
          </div>

          {disclosures.synthetic && (
            <p data-testid="synthetic-schedule-note" className={NOTE_CLASS}>
              {SYNTHETIC_SCHEDULE_NOTE}
            </p>
          )}
          {disclosures.estimated && (
            <p data-testid="estimated-run-times-note" className={NOTE_CLASS}>
              {ESTIMATED_RUN_TIMES_NOTE}
            </p>
          )}
          {disclosures.transfers && (
            <p data-testid="transfer-times-note" className={NOTE_CLASS}>
              {TRANSFER_TIMES_ESTIMATED_NOTE}
            </p>
          )}

          <ul className="divide-y divide-edge rounded-md bg-surface-sunken/50">
            {currentPlan.legs.map((leg, i) => (
              <LegRow
                key={`${leg.kind}-${i}`}
                leg={leg}
                routes={routes}
                rideBefore={currentPlan.legs.slice(0, i).some((l) => l.kind === "ride")}
                rideAfter={currentPlan.legs.slice(i + 1).some((l) => l.kind === "ride")}
              />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
