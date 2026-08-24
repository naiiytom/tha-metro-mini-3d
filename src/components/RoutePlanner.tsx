import { useEffect, useMemo, useState } from "react";
import { activeSimClient } from "../sim/SimClient";
import type { PlanLeg, RoutePlan, StationInfo } from "../sim/protocol";
import { DEFAULT_MAX_WAIT_S } from "../sim/protocol";
import { formatCountdown, formatServiceSec } from "../sim/time";
import { useAppStore } from "../stores/useAppStore";
import { planDisclosures } from "../route/routePlanDisclosures";
import { StationCombobox } from "./StationCombobox";
import {
  ESTIMATED_RUN_TIMES_NOTE,
  SYNTHETIC_SCHEDULE_NOTE,
  TRANSFER_TIMES_ESTIMATED_NOTE,
  type LineGeometry,
} from "../types";

/** Same box every other disclosure note in this app already uses
 *  (StationBoard/TrainInspector) — a new colour here would read as a
 *  different kind of caveat when it is the same kind. */
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
    // A transfer leg is no longer always BETWEEN two rides. The engine gates
    // interchange-complex expansion on real walking distance, so an
    // INTERCHANGE_OVERRIDES-class link (300-555 m — genuinely separate
    // stations) now surfaces as a leading walk to the first train, a trailing
    // walk to the picked destination, or, between two such stations, the
    // whole plan. Saying "Change trains" in those cases would describe a
    // train change that does not happen.
    //
    // No station NAMES here on purpose: `routes` is network.json geometry,
    // whose station indices are NOT the cache's, so resolving
    // `toStationIdx` against it would print the wrong station.
    const label = rideBefore
      ? rideAfter
        ? "Change trains"
        : "Walk to your destination"
      : rideAfter
        ? "Walk to your first train"
        : "Walk to your destination";
    return (
      <li className="flex items-start gap-2 px-4 py-2 text-xs text-ink-muted">
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
  void routes; // reserved for a future per-line accent beyond the chip already in colorRgb
  return (
    <li className="flex items-start gap-2 px-4 py-2">
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

/**
 * Route search panel (roadmap item 8). Two station pickers plus a submit
 * action call `SimClient.getRoutePlan` against the app's own scrubbed clock
 * (`getSimNow()`, not `Date.now()`), so a plan made while scrubbed to 23:50
 * is the plan FOR 23:50 — the same rule every other live view in this app
 * already follows.
 *
 * `null` (a rejected request) and `unreachable: true` (a well-formed request
 * nothing connects) are deliberately different copy — an unreachable plan is
 * an ANSWER, not a failure.
 */
export function RoutePlanner() {
  const open = useAppStore((s) => s.routePlannerOpen);
  const setOpen = useAppStore((s) => s.setRoutePlannerOpen);
  const plan = useAppStore((s) => s.routePlan);
  const setPlan = useAppStore((s) => s.setRoutePlan);
  const stations = useAppStore((s) => s.stations);
  const routes = useAppStore((s) => s.routes);
  const hiddenRoutes = useAppStore((s) => s.hiddenRoutes);

  const [from, setFrom] = useState<StationInfo | null>(null);
  const [to, setTo] = useState<StationInfo | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [plans, setPlans] = useState<RoutePlan[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number>(0);

  // Mirrors StationSearch's own hiddenRoutes skip: a station on a hidden line
  // has no visible track to highlight a leg on.
  const visibleStations = useMemo(
    () => stations.filter((s) => !hiddenRoutes.includes(s.route_idx)),
    [stations, hiddenRoutes],
  );

  const currentPlan = plans[selectedIndex] ?? plan;
  const disclosures = useMemo(() => planDisclosures(currentPlan, routes), [currentPlan, routes]);

  // The panel only gates its OWN render on `open` (below) — it stays mounted
  // the whole page lifetime, so its local from/to/status state would
  // otherwise survive a close/reopen cycle and show a stale prior search
  // immediately on reopen. Runs before the early return since hooks must run
  // unconditionally on every render.
  useEffect(() => {
    if (!open) {
      setFrom(null);
      setTo(null);
      setStatus({ kind: "idle" });
      setPlans([]);
      setSelectedIndex(0);
    }
  }, [open]);

  if (!open) return null;

  const submit = async () => {
    const client = activeSimClient.current;
    if (!client || !from || !to) return;
    // A new search replaces the previous plan (and its map highlight) before
    // the query is even in flight — a stale highlight next to a spinner reads
    // as the new answer.
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
      // The panel may have been closed while this query was in flight —
      // `setRoutePlannerOpen(false)` already cleared `routePlan`, and a
      // stale resolve must not silently resurrect it (and its map
      // highlight) behind a panel that is no longer open.
      if (!useAppStore.getState().routePlannerOpen) return;
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
    <div
      data-testid="route-planner"
      className="panel-glass pointer-events-auto flex max-h-[50dvh] w-full flex-col overflow-hidden rounded-t-2xl border shadow-xl shadow-ink/10 backdrop-blur-md md:absolute md:left-[17rem] md:top-4 md:max-h-[calc(100dvh-2rem)] md:w-80 md:rounded-xl"
    >
      <div className="flex items-center gap-2 border-b border-edge px-4 py-3">
        <p className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">Plan a route</p>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Close route planner"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-sm leading-none text-ink-muted hover:bg-surface-sunken hover:text-ink md:h-auto md:w-auto md:px-1.5 md:py-0.5"
        >
          ×
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto py-2">
        <StationCombobox label="From" stations={visibleStations} routes={routes} onPick={setFrom} />
        <StationCombobox label="To" stations={visibleStations} routes={routes} onPick={setTo} />

        <div className="px-4 py-2">
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!from || !to || status.kind === "loading"}
            className="w-full rounded-md bg-accent px-3 py-2 text-sm font-medium text-accent-ink transition-colors hover:opacity-90 disabled:bg-edge disabled:text-ink-muted"
          >
            Find route
          </button>
        </div>

        {status.kind === "loading" && (
          <p className="px-4 py-2 text-xs text-ink-muted">Searching the timetable…</p>
        )}
        {status.kind === "failed" && (
          <p className="px-4 py-2 text-xs text-ink-muted">
            Couldn&apos;t plan a route — the engine rejected that request.
          </p>
        )}
        {currentPlan?.unreachable && (
          <p className="px-4 py-2 text-xs text-ink-muted">
            No route found within {Math.round(DEFAULT_MAX_WAIT_S / 60)} minutes of this departure
            time. Try a different time of day.
          </p>
        )}

        {currentPlan && !currentPlan.unreachable && (
          <>
            {plans.length > 1 && (
              <div className="flex gap-2 px-4 pb-2" data-testid="route-plan-alternatives">
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
                      className={`flex-1 rounded-md border p-2 text-left transition-colors ${
                        active
                          ? "border-accent bg-surface-sunken"
                          : "border-edge hover:bg-surface-sunken/50"
                      }`}
                    >
                      <p className="text-xs font-semibold text-ink">
                        {formatCountdown(p.durationS)}
                      </p>
                      <p className="text-[10px] text-ink-muted">
                        {p.transfers} transfer{p.transfers === 1 ? "" : "s"}
                      </p>
                    </button>
                  );
                })}
              </div>
            )}
            <p data-testid="route-plan-summary" className="px-4 pb-1 text-sm text-ink">
              <span className="font-semibold">
                {formatServiceSec(currentPlan.departSec)} → {formatServiceSec(currentPlan.arriveSec)}
              </span>
              <span className="ml-2 text-xs text-ink-muted">
                {formatCountdown(currentPlan.durationS)} · {currentPlan.transfers} transfer
                {currentPlan.transfers === 1 ? "" : "s"}
              </span>
            </p>
            {/* Every caveat renders BEFORE the times it qualifies — a clipped
             * or trailing caveat is worse than none. */}
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
            <ul className="divide-y divide-edge">
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
          </>
        )}
      </div>
    </div>
  );
}
