import { useMemo, useState } from "react";
import { activeSimClient } from "../../sim/SimClient";
import type { RoutePlan, StationInfo } from "../../sim/protocol";
import { DEFAULT_MAX_WAIT_S } from "../../sim/protocol";
import { formatCountdown, formatServiceSec } from "../../sim/time";
import { useAppStore } from "../../stores/useAppStore";
import { planDisclosures } from "../../route/routePlanDisclosures";
import { StationCombobox } from "../StationCombobox";
import { LegRow, NOTE_CLASS } from "../LegRow";
import { useT } from "../../i18n";

type Status = { kind: "idle" } | { kind: "loading" } | { kind: "done" } | { kind: "failed" };


export function RouteTab() {
  const stations = useAppStore((s) => s.stations);
  const routes = useAppStore((s) => s.routes);
  const currentPlan = useAppStore((s) => s.routePlan);
  const setPlan = useAppStore((s) => s.setRoutePlan);
  const primaryLang = useAppStore((s) => s.primaryLang);
  const t = useT();

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
      <StationCombobox label={t("route.from")} stations={visibleStations} routes={routes} onPick={setFrom} />
      <StationCombobox label={t("route.to")} stations={visibleStations} routes={routes} onPick={setTo} />

      <button
        type="button"
        onClick={() => void submit()}
        disabled={!from || !to || status.kind === "loading"}
        className="w-full rounded-md bg-accent px-3 py-2 text-sm font-medium text-accent-ink transition-opacity hover:opacity-90 disabled:bg-edge disabled:text-ink-muted"
      >
        {status.kind === "loading" ? t("route.searching") : t("route.findRoute")}
      </button>

      {status.kind === "failed" && (
        <p className="px-2 text-xs text-ink-muted">
          {t("route.planningFailed")}
        </p>
      )}

      {currentPlan?.unreachable && (
        <p className="px-2 text-xs text-ink-muted">
          {t("route.unreachable", { minutes: Math.round(DEFAULT_MAX_WAIT_S / 60) })}
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
                    <p className="text-xs font-semibold text-ink">{formatCountdown(p.durationS, primaryLang)}</p>
                    <p className="text-[10px] text-ink-muted">
                      {p.transfers === 1
                        ? t("route.transfersOne", { count: 1 })
                        : t("route.transfersOther", { count: p.transfers })}
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
              {formatCountdown(currentPlan.durationS, primaryLang)} ·{" "}
              {currentPlan.transfers === 1
                ? t("route.transfersOne", { count: 1 })
                : t("route.transfersOther", { count: currentPlan.transfers })}
            </span>
          </div>

          {disclosures.synthetic && (
            <p data-testid="synthetic-schedule-note" className={NOTE_CLASS}>
              {t("notes.syntheticSchedule")}
            </p>
          )}
          {disclosures.estimated && (
            <p data-testid="estimated-run-times-note" className={NOTE_CLASS}>
              {t("notes.estimatedRunTimes")}
            </p>
          )}
          {disclosures.transfers && (
            <p data-testid="transfer-times-note" className={NOTE_CLASS}>
              {t("notes.transferTimesEstimated")}
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
