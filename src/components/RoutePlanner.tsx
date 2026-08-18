import { useMemo, useState } from "react";
import { filterStations } from "../search/stationSearch";
import { activeSimClient } from "../sim/SimClient";
import type { PlanLeg, StationInfo } from "../sim/protocol";
import { DEFAULT_MAX_WAIT_S } from "../sim/protocol";
import { formatCountdown, formatServiceSec } from "../sim/time";
import { useAppStore } from "../stores/useAppStore";
import { planDisclosures } from "../route/routePlanDisclosures";
import {
  ESTIMATED_RUN_TIMES_NOTE,
  SYNTHETIC_SCHEDULE_NOTE,
  TRANSFER_TIMES_ESTIMATED_NOTE,
  type LineGeometry,
} from "../types";

/** Same box every other disclosure note in this app already uses
 *  (StationBoard/TrainInspector) — a new colour here would read as a
 *  different kind of caveat when it is the same kind. */
const NOTE_CLASS = "mx-2 mb-1 rounded bg-sky-50 px-2 py-1 text-[10px] leading-snug text-sky-800";

type Status = { kind: "idle" } | { kind: "loading" } | { kind: "done" } | { kind: "failed" };

/**
 * One station picker: a text input filtered through the same `filterStations`
 * station search already uses, closing its own result list on pick. Kept
 * local to this file rather than promoted to `src/search/` — unlike
 * `filterStations` itself, there is no pure logic here worth testing in
 * isolation from the DOM it renders.
 */
function StationPicker({
  label,
  value,
  onPick,
  stations,
  routes,
}: {
  label: "From" | "To";
  value: StationInfo | null;
  onPick: (s: StationInfo) => void;
  stations: StationInfo[];
  routes: LineGeometry[];
}) {
  const [query, setQuery] = useState("");
  const results = useMemo(() => (query.trim() === "" ? [] : filterStations(stations, query)), [
    query,
    stations,
  ]);

  return (
    <div className="px-4 py-2">
      <label className="mb-1 block text-[10px] uppercase tracking-wide text-slate-500">
        {label}
        <input
          type="text"
          aria-label={`${label} station`}
          value={value ? value.name_en : query}
          onChange={(e) => {
            setQuery(e.target.value);
          }}
          onFocus={() => setQuery(value ? value.name_en : query)}
          placeholder="Search stations…"
          className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-900"
        />
      </label>
      {query.trim() !== "" && (
        <ul className="mt-1 max-h-40 space-y-0.5 overflow-y-auto">
          {results.map((s) => (
            <li key={`${s.route_idx}-${s.station_idx}`}>
              <button
                type="button"
                onClick={() => {
                  onPick(s);
                  setQuery("");
                }}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-200"
              >
                <span
                  className="inline-block h-2 w-4 shrink-0 rounded-sm"
                  style={{ background: routes[s.route_idx]?.color ?? "#64748b" }}
                />
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-medium text-slate-900">{s.name_en}</span>
                  <span className="ml-1 text-slate-500">{s.name_th}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function LegRow({ leg, routes }: { leg: PlanLeg; routes: LineGeometry[] }) {
  if (leg.kind === "transfer") {
    return (
      <li className="flex items-start gap-2 px-4 py-2 text-xs text-slate-600">
        <span className="mt-0.5 inline-block h-2 w-4 shrink-0" aria-hidden />
        <span>
          Change trains — {formatCountdown(leg.transferS)} allowed, then wait{" "}
          {formatCountdown(leg.waitS)} (≈{Math.round(leg.walkM)} m)
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
      <div className="min-w-0 flex-1 text-xs text-slate-700">
        <p className="truncate">
          <span className="font-medium text-slate-900">{leg.headsign}</span>
          <span className="ml-1 text-slate-500">{leg.routeName}</span>
        </p>
        <p className="truncate">
          {formatServiceSec(leg.boardSec)} {leg.boardName} → {formatServiceSec(leg.alightSec)}{" "}
          {leg.alightName}
        </p>
        {leg.intermediateStops.length > 0 && (
          <p className="truncate text-slate-500">
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

  // Mirrors StationSearch's own hiddenRoutes skip: a station on a hidden line
  // has no visible track to highlight a leg on.
  const visibleStations = useMemo(
    () => stations.filter((s) => !hiddenRoutes.includes(s.route_idx)),
    [stations, hiddenRoutes],
  );

  const disclosures = useMemo(() => planDisclosures(plan, routes), [plan, routes]);

  if (!open) return null;

  const submit = async () => {
    const client = activeSimClient.current;
    if (!client || !from || !to) return;
    // A new search replaces the previous plan (and its map highlight) before
    // the query is even in flight — a stale highlight next to a spinner reads
    // as the new answer.
    setPlan(null);
    setStatus({ kind: "loading" });
    try {
      const result = await client.getRoutePlan(
        from.route_idx,
        from.station_idx,
        to.route_idx,
        to.station_idx,
        client.getSimNow(),
      );
      if (result === null) {
        setStatus({ kind: "failed" });
        return;
      }
      setPlan(result);
      setStatus({ kind: "done" });
    } catch {
      setStatus({ kind: "failed" });
    }
  };

  return (
    <div
      data-testid="route-planner"
      className="pointer-events-auto flex max-h-[50dvh] w-full flex-col overflow-hidden rounded-t-2xl border border-white/40 bg-white/70 shadow-xl shadow-slate-900/10 backdrop-blur-md ring-1 ring-slate-900/5 md:absolute md:left-[17rem] md:top-4 md:max-h-[calc(100dvh-2rem)] md:w-80 md:rounded-xl"
    >
      <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3">
        <p className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-900">Plan a route</p>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Close route planner"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-sm leading-none text-slate-500 hover:bg-slate-200 hover:text-slate-700 md:h-auto md:w-auto md:px-1.5 md:py-0.5"
        >
          ×
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto py-2">
        <StationPicker label="From" value={from} onPick={setFrom} stations={visibleStations} routes={routes} />
        <StationPicker label="To" value={to} onPick={setTo} stations={visibleStations} routes={routes} />

        <div className="px-4 py-2">
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!from || !to || status.kind === "loading"}
            className="w-full rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:bg-slate-300 disabled:text-slate-500"
          >
            Find route
          </button>
        </div>

        {status.kind === "loading" && (
          <p className="px-4 py-2 text-xs text-slate-600">Searching the timetable…</p>
        )}
        {status.kind === "failed" && (
          <p className="px-4 py-2 text-xs text-slate-600">
            Couldn&apos;t plan a route — the engine rejected that request.
          </p>
        )}
        {plan?.unreachable && (
          <p className="px-4 py-2 text-xs text-slate-600">
            No route found within {Math.round(DEFAULT_MAX_WAIT_S / 60)} minutes of this departure
            time. Try a different time of day.
          </p>
        )}

        {plan && !plan.unreachable && (
          <>
            <p data-testid="route-plan-summary" className="px-4 pb-1 text-sm text-slate-800">
              <span className="font-semibold">
                {formatServiceSec(plan.departSec)} → {formatServiceSec(plan.arriveSec)}
              </span>
              <span className="ml-2 text-xs text-slate-600">
                {formatCountdown(plan.durationS)} · {plan.transfers} transfer
                {plan.transfers === 1 ? "" : "s"}
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
            <ul className="divide-y divide-slate-200/70">
              {plan.legs.map((leg, i) => (
                <LegRow key={`${leg.kind}-${i}`} leg={leg} routes={routes} />
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
