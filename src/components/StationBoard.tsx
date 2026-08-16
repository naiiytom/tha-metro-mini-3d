import { useEffect, useMemo, useState } from "react";
import type { StationBoard as StationBoardData, StationInfo } from "../sim/protocol";
import { activeSimClient } from "../sim/SimClient";
import { formatCountdown, formatServiceSec } from "../sim/time";
import { useAppStore } from "../stores/useAppStore";
import { ESTIMATED_RUN_TIMES_NOTE, SYNTHETIC_SCHEDULE_NOTE } from "../types";

/** `${route_idx}:${station_idx}` — the natural key for cross-route station lookup. */
function stationKey(routeIdx: number, stationIdx: number): string {
  return `${routeIdx}:${stationIdx}`;
}

/**
 * Live timetable drawer for the selected station (F4.3): the next scheduled
 * calls, soonest first, straight from the engine's own schedule so it can
 * never drift from the trains on screen.
 *
 * Polled at 1 Hz — cache-derived data, never on the frame path (§3A.7).
 * Clicking a row selects that train, handing off to the inspector.
 */

const POLL_MS = 1000;
const LIMIT = 10;

export function StationBoard() {
  const selectedStation = useAppStore((s) => s.selectedStation);
  const selectStation = useAppStore((s) => s.selectStation);
  const selectRun = useAppStore((s) => s.selectRun);
  const routes = useAppStore((s) => s.routes);
  const stations = useAppStore((s) => s.stations);
  const [board, setBoard] = useState<StationBoardData | null>(null);

  const routeIdx = selectedStation?.routeIdx;
  const stationIdx = selectedStation?.stationIdx;

  useEffect(() => {
    if (routeIdx === undefined || stationIdx === undefined) {
      setBoard(null);
      return;
    }
    let cancelled = false;
    const poll = async () => {
      const client = activeSimClient.current;
      if (!client) return;
      try {
        const b = await client.getStationBoard(
          routeIdx,
          stationIdx,
          client.getSimNow(),
          LIMIT,
        );
        if (!cancelled) setBoard(b);
      } catch {
        // Worker torn down mid-flight; re-queried on the next selection.
      }
    };
    void poll();
    const id = setInterval(() => void poll(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [routeIdx, stationIdx]);

  const stationByKey = useMemo(() => {
    const map = new Map<string, StationInfo>();
    for (const s of stations) map.set(stationKey(s.route_idx, s.station_idx), s);
    return map;
  }, [stations]);

  if (!selectedStation) return null;

  const info = stationByKey.get(stationKey(selectedStation.routeIdx, selectedStation.stationIdx));

  return (
    <div className="pointer-events-auto flex max-h-[50dvh] w-full flex-col overflow-hidden rounded-t-2xl border border-white/40 bg-white/70 shadow-xl shadow-slate-900/10 backdrop-blur-md ring-1 ring-slate-900/5 md:absolute md:right-4 md:top-4 md:max-h-[calc(100dvh-2rem)] md:w-72 md:rounded-xl">
      <div className="flex items-start gap-2 border-b border-slate-200 px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-slate-900">
            {board ? `${board.code ? `${board.code} · ` : ""}${board.name_en}` : "Station"}
          </p>
          <p className="truncate text-xs text-slate-600">{board?.name_th ?? ""}</p>
        </div>
        <button
          type="button"
          onClick={() => selectStation(null)}
          aria-label="Close station board"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-sm leading-none text-slate-500 hover:bg-slate-200 hover:text-slate-700 md:h-auto md:w-auto md:px-1.5 md:py-0.5"
        >
          ×
        </button>
      </div>

      {info && info.interchanges.length > 0 && (
        <div className="flex flex-wrap items-center gap-1 px-4 pb-2">
          <span className="text-[10px] uppercase tracking-wide text-slate-500">Interchange</span>
          {info.interchanges.map((ix) => (
            <span
              key={`${ix.route_idx}-${ix.station_idx}`}
              className="rounded-full px-1.5 py-0.5 text-[10px] font-medium text-white"
              style={{ background: routes[ix.route_idx]?.color ?? "#64748b" }}
            >
              {routes[ix.route_idx]?.name ?? `Route ${ix.route_idx}`}
            </span>
          ))}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        <p className="px-2 pb-1 text-[10px] uppercase tracking-wide text-slate-500">
          Next departures
        </p>
        {/* Every departure below is synthesized, not published — say so
         * before the user reads a single time (see SYNTHETIC_SCHEDULE_NOTE). */}
        {routes[selectedStation.routeIdx]?.syntheticSchedule != null && (
          <p
            data-testid="synthetic-schedule-note"
            className="mx-2 mb-1 rounded bg-sky-50 px-2 py-1 text-[10px] leading-snug text-sky-800"
          >
            {SYNTHETIC_SCHEDULE_NOTE}
          </p>
        )}
        {/* Same box as the syntheticSchedule note directly above — this card
         * is light (bg-white/70), so this note needs the same dark-on-light
         * treatment, not the white-on-white this originally shipped with. */}
        {routes[selectedStation.routeIdx]?.estimatedRunTimes != null && (
          <p
            data-testid="estimated-run-times-note"
            className="mx-2 mb-1 rounded bg-sky-50 px-2 py-1 text-[10px] leading-snug text-sky-800"
          >
            {ESTIMATED_RUN_TIMES_NOTE}
          </p>
        )}
        {!board ? (
          <p className="px-2 py-2 text-xs text-slate-600">Loading…</p>
        ) : board.entries.length === 0 ? (
          <p className="px-2 py-2 text-xs text-slate-600">
            No further services scheduled today.
          </p>
        ) : (
          <ul className="space-y-0.5">
            {board.entries.map((e) => (
              <li key={`${e.run_idx}-${e.arrival_sec}`}>
                <button
                  type="button"
                  onClick={() => selectRun(e.run_idx)}
                  className="flex w-full items-baseline justify-between gap-2 rounded-md px-3 py-2.5 text-left text-sm text-slate-700 transition-colors hover:bg-slate-200 md:px-2 md:py-1.5 md:text-xs"
                >
                  <span className="min-w-0 flex-1 truncate">
                    <span className="font-medium text-slate-900">{e.destination}</span>
                    <span className="ml-1 text-slate-500">
                      {formatServiceSec(e.departure_sec)}
                    </span>
                  </span>
                  <span
                    className={`shrink-0 font-mono tabular-nums ${
                      e.in_s <= 0 ? "font-semibold text-slate-900" : ""
                    }`}
                  >
                    {formatCountdown(e.in_s)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
