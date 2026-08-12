import { useEffect, useMemo, useState } from "react";
import type { RunDetail, StationInfo } from "../sim/protocol";
import { activeSimClient } from "../sim/SimClient";
import { formatCountdown, formatServiceSec } from "../sim/time";
import { useAppStore } from "../stores/useAppStore";
import { ESTIMATED_RUN_TIMES_NOTE, SYNTHETIC_SCHEDULE_NOTE } from "../types";

/** `${route_idx}:${station_idx}` — the natural key for cross-route station lookup. */
function stationKey(routeIdx: number, stationIdx: number): string {
  return `${routeIdx}:${stationIdx}`;
}

/**
 * Train inspector card (F4.2) — route, headsign, origin/destination, next-stop
 * ETA and the full scheduled call list for the selected run.
 *
 * Detail is pulled from the engine at 1 Hz, NOT per frame: the pose comes from
 * the vehicle buffer, but everything readable here is cache-derived and only
 * changes when the train reaches a stop (§3A.2, §3A.7).
 */

/** How often to refresh detail while a train is selected. */
const POLL_MS = 1000;

export function TrainInspector() {
  const selectedRunIdx = useAppStore((s) => s.selectedRunIdx);
  const following = useAppStore((s) => s.following);
  const selectRun = useAppStore((s) => s.selectRun);
  const setFollowing = useAppStore((s) => s.setFollowing);
  const routes = useAppStore((s) => s.routes);
  const stations = useAppStore((s) => s.stations);
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [ended, setEnded] = useState(false);

  // The schedule list is up to ~47 stops for a full-line run; a plain
  // stations.find() per stop was an O(stops * stations) scan every render.
  const stationByKey = useMemo(() => {
    const map = new Map<string, StationInfo>();
    for (const s of stations) map.set(stationKey(s.route_idx, s.station_idx), s);
    return map;
  }, [stations]);

  useEffect(() => {
    if (selectedRunIdx === null) {
      setDetail(null);
      setEnded(false);
      return;
    }
    let cancelled = false;
    const poll = async () => {
      const client = activeSimClient.current;
      if (!client) return;
      try {
        const d = await client.getRunDetail(selectedRunIdx, client.getSimNow());
        if (cancelled) return;
        setDetail(d);
        // null = the run is no longer live (finished, or the clock moved off
        // its service window) — exactly when it leaves the vehicle buffer.
        setEnded(d === null);
      } catch {
        // Worker torn down mid-flight; the next selection re-queries.
      }
    };
    void poll();
    const id = setInterval(() => void poll(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [selectedRunIdx]);

  if (selectedRunIdx === null) return null;

  const color = detail ? `#${detail.color_rgb.toString(16).padStart(6, "0")}` : "#94a3b8";

  return (
    <div
      data-testid="train-inspector"
      className="pointer-events-auto flex max-h-[50dvh] w-full flex-col overflow-hidden rounded-t-2xl border border-white/40 bg-white/70 shadow-xl shadow-slate-900/10 backdrop-blur-md ring-1 ring-slate-900/5 md:absolute md:right-4 md:top-4 md:max-h-[calc(100dvh-2rem)] md:w-72 md:rounded-xl"
    >
      <div className="flex items-start gap-2 border-b border-slate-200 px-4 py-3">
        <span
          className="mt-1 inline-block h-3 w-3 shrink-0 rounded-full"
          style={{ background: color }}
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-slate-900">
            {detail ? detail.headsign : "Train"}
          </p>
          <p className="truncate text-xs text-slate-600">
            {detail ? `${detail.route_name} · run ${detail.run_idx}` : `run ${selectedRunIdx}`}
          </p>
          {/* Not truncated, unlike the two lines above: this one is a caveat
           * about the times shown below, and a clipped caveat is worse than
           * none (see SYNTHETIC_SCHEDULE_NOTE). */}
          {detail && routes[detail.route_idx]?.syntheticSchedule != null && (
            <p
              data-testid="synthetic-schedule-note"
              className="mt-1 rounded bg-sky-50 px-1.5 py-1 text-[10px] leading-snug text-sky-800"
            >
              {SYNTHETIC_SCHEDULE_NOTE}
            </p>
          )}
          {detail && routes[detail.route_idx]?.estimatedRunTimes != null && (
            <p className="px-3 pb-2 text-[11px] leading-snug text-white/60">
              {ESTIMATED_RUN_TIMES_NOTE}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => selectRun(null)}
          aria-label="Close inspector"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-sm leading-none text-slate-500 hover:bg-slate-200 hover:text-slate-700 md:h-auto md:w-auto md:px-1.5 md:py-0.5"
        >
          ×
        </button>
      </div>

      {ended ? (
        <p className="px-4 py-3 text-xs text-slate-600">
          This run has finished its journey. Pick another train.
        </p>
      ) : !detail ? (
        <p className="px-4 py-3 text-xs text-slate-600">Loading…</p>
      ) : (
        <>
          <div className="space-y-2 px-4 py-3">
            <p className="text-xs text-slate-600">
              {detail.origin} → {detail.destination}
            </p>
            <div className="rounded-lg bg-slate-100 px-3 py-2">
              {detail.state === 0 ? (
                <p className="text-xs text-slate-700">
                  Dwelling at{" "}
                  <span className="font-semibold text-slate-900">{detail.at_station}</span>
                </p>
              ) : (
                <p className="text-xs text-slate-700">
                  Departed{" "}
                  <span className="font-medium text-slate-900">{detail.prev_station}</span>
                </p>
              )}
              {detail.next_station !== null && detail.next_arrival_in_s !== null ? (
                <p className="mt-1 text-xs text-slate-700">
                  Next: <span className="font-semibold text-slate-900">{detail.next_station}</span>{" "}
                  in{" "}
                  <span className="font-mono tabular-nums">
                    {formatCountdown(detail.next_arrival_in_s)}
                  </span>
                </p>
              ) : (
                <p className="mt-1 text-xs text-slate-600">Terminus — end of run.</p>
              )}
            </div>
            <button
              type="button"
              onClick={() => setFollowing(!following)}
              className={`w-full rounded-md px-4 py-3 text-sm font-medium transition-colors md:px-2 md:py-1.5 md:text-xs ${
                following
                  ? "bg-slate-900 text-white hover:bg-slate-700"
                  : "bg-slate-200/80 text-slate-700 hover:bg-slate-300"
              }`}
            >
              {following ? "Following — click to release" : "Follow this train"}
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto border-t border-slate-200 px-4 py-2">
            <p className="pb-1 text-[10px] uppercase tracking-wide text-slate-500">Schedule</p>
            <ol className="space-y-0.5">
              {detail.stops.map((stop, i) => {
                const isNext = detail.next_stop_ordinal === i;
                // The stop being dwelt at is neither "next" nor "passed" — the
                // engine names it outright so this doesn't grey out the very
                // station the panel above says the train is sitting at.
                const isCurrent = detail.current_stop_ordinal === i;
                const passed =
                  !isCurrent &&
                  (detail.next_stop_ordinal === null || i < detail.next_stop_ordinal);
                const stationInfo = stationByKey.get(stationKey(detail.route_idx, stop.station_idx));
                return (
                  <li
                    key={`${stop.station_idx}-${i}`}
                    className={`flex items-baseline justify-between gap-2 rounded px-1 py-0.5 text-xs ${
                      isNext
                        ? "bg-slate-900 text-white"
                        : isCurrent
                          ? "bg-slate-200 font-medium text-slate-900"
                          : passed
                            ? "text-slate-400"
                            : "text-slate-700"
                    }`}
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {stop.code ? `${stop.code} · ` : ""}
                      {stop.name_en}
                      {stationInfo && stationInfo.interchanges.length > 0 && (
                        <span className="ml-1 inline-flex flex-wrap items-center gap-1">
                          {stationInfo.interchanges.map((ix) => (
                            <span
                              key={`${ix.route_idx}-${ix.station_idx}`}
                              className="rounded-full px-1 py-0 text-[9px] font-medium text-white"
                              style={{ background: routes[ix.route_idx]?.color ?? "#64748b" }}
                            >
                              {routes[ix.route_idx]?.name ?? `Route ${ix.route_idx}`}
                            </span>
                          ))}
                        </span>
                      )}
                    </span>
                    <span className="font-mono tabular-nums">
                      {formatServiceSec(stop.arrival_sec)}
                    </span>
                  </li>
                );
              })}
            </ol>
          </div>
        </>
      )}
    </div>
  );
}
