import { useEffect, useMemo, useState } from "react";
import type { StationBoard as StationBoardData } from "../sim/protocol";
import { activeSimClient } from "../sim/SimClient";
import { findStationHub } from "../stations/stationHubs";
import { formatCountdown, formatServiceSec } from "../sim/time";
import { useAppStore } from "../stores/useAppStore";
import { formatBilingualHub, formatBilingualStation, resolveLineName } from "../utils/stationTypography";
import { useT } from "../i18n";

/** `${route_idx}:${station_idx}` — the natural key for cross-route station lookup. */
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
  const primaryLang = useAppStore((s) => s.primaryLang);
  const t = useT();
  const [boards, setBoards] = useState<StationBoardData[] | null>(null);

  const hub = useMemo(
    () => (selectedStation ? findStationHub(stations, selectedStation.routeIdx, selectedStation.stationIdx) : null),
    [stations, selectedStation],
  );
  const boardStops = useMemo(
    () => hub?.stops ?? (selectedStation ? [{ routeIdx: selectedStation.routeIdx, stationIdx: selectedStation.stationIdx }] : []),
    [hub, selectedStation],
  );

  useEffect(() => {
    if (boardStops.length === 0) {
      setBoards(null);
      return;
    }
    let cancelled = false;
    const poll = async () => {
      const client = activeSimClient.current;
      if (!client) return;
      try {
        const result = await Promise.all(boardStops.map((stop) =>
          client.getStationBoard(stop.routeIdx, stop.stationIdx, client.getSimNow(), LIMIT),
        ));
        if (!cancelled) setBoards(result.filter((board): board is StationBoardData => board !== null));
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
  }, [boardStops]);

  if (!selectedStation) return null;

  const entries = boards?.flatMap((board) => board.entries).sort((a, b) => a.departure_sec - b.departure_sec) ?? [];
  const hubRoutes = hub?.routeIndices ?? (selectedStation ? [selectedStation.routeIdx] : []);
  const hasSyntheticSchedule = hubRoutes.some((routeIdx) => routes[routeIdx]?.syntheticSchedule != null);
  const hasEstimatedRunTimes = hubRoutes.some((routeIdx) => routes[routeIdx]?.estimatedRunTimes != null);

  const { primaryName, subtitle } = hub
    ? formatBilingualHub(hub, primaryLang)
    : boards?.[0]
    ? formatBilingualStation(boards[0], primaryLang)
    : { primaryName: t("board.stationFallback"), subtitle: "" };

  return (
    <div className="panel-glass pointer-events-auto flex max-h-[50dvh] w-full flex-col overflow-hidden rounded-t-[28px] border-t border-edge border-x-0 border-b-0 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-xl shadow-ink/10 backdrop-blur-md md:absolute md:right-4 md:top-4 md:max-h-[calc(100dvh-2rem)] md:w-72 md:rounded-xl md:border md:pb-0">
      <div className="flex items-start gap-2 border-b border-edge px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-ink">
            {primaryName}
          </p>
          {subtitle && (
            <p className="truncate text-xs text-ink-muted">{subtitle}</p>
          )}
        </div>
        <button
          type="button"
          onClick={() => selectStation(null)}
          aria-label={t("board.closeBoard")}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-sm leading-none text-ink-muted hover:bg-surface-sunken hover:text-ink md:h-auto md:w-auto md:px-1.5 md:py-0.5"
        >
          ×
        </button>
      </div>

      {hub && hub.stops.length > 1 && (
        <div className="flex flex-wrap items-center gap-1 px-4 pb-2">
          <span className="text-[10px] uppercase tracking-wide text-ink-muted">{t("board.interchange")}</span>
          {hub.routeIndices.map((routeIdx) => (
            <span
              key={routeIdx}
              className="rounded-full px-1.5 py-0.5 text-[10px] font-medium text-white"
              style={{ background: routes[routeIdx]?.color ?? "#64748b" }}
            >
              {resolveLineName(
                routes[routeIdx],
                primaryLang,
                t("board.routeFallback", { index: routeIdx }),
              )}
            </span>
          ))}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        <p className="px-2 pb-1 text-[10px] uppercase tracking-wide text-ink-muted">
          {t("board.nextDepartures")}
        </p>
        {/* Every departure below is synthesized, not published — say so
         * before the user reads a single time (see SYNTHETIC_SCHEDULE_NOTE). */}
        {hasSyntheticSchedule && (
          <p
            data-testid="synthetic-schedule-note"
            className="mx-2 mb-1 rounded bg-note-bg px-2 py-1 text-[10px] leading-snug text-note-ink"
          >
            {t("notes.syntheticSchedule")}
          </p>
        )}
        {/* Same box as the syntheticSchedule note directly above — this card
         * sits on the translucent panel-glass surface, so this note needs the
         * same dark-on-light treatment, not the white-on-white this
         * originally shipped with. */}
        {hasEstimatedRunTimes && (
          <p
            data-testid="estimated-run-times-note"
            className="mx-2 mb-1 rounded bg-note-bg px-2 py-1 text-[10px] leading-snug text-note-ink"
          >
            {t("notes.estimatedRunTimes")}
          </p>
        )}
        {!boards ? (
          <p className="px-2 py-2 text-xs text-ink-muted">{t("board.loading")}</p>
        ) : entries.length === 0 ? (
          <p className="px-2 py-2 text-xs text-ink-muted">
            {t("board.noFurtherServices")}
          </p>
        ) : (
          <ul className="space-y-0.5">
            {entries.map((e) => (
              <li key={`${e.run_idx}-${e.arrival_sec}`}>
                <button
                  type="button"
                  onClick={() => selectRun(e.run_idx)}
                  className="flex w-full items-baseline justify-between gap-2 rounded-md px-3 py-2.5 text-left text-sm text-ink-muted transition-colors hover:bg-surface-sunken md:px-2 md:py-1.5 md:text-xs"
                >
                  <span className="min-w-0 flex-1 truncate">
                    <span
                      className="mr-1 inline-block h-2 w-2 rounded-full"
                      aria-label={resolveLineName(routes[e.route_idx], primaryLang, t("board.routeFallback", { index: e.route_idx }))}
                      style={{ background: routes[e.route_idx]?.color ?? "#64748b" }}
                    />
                    <span className="font-medium text-ink">
                      {primaryLang === "th" && e.headsign_th ? e.headsign_th : (e.headsign || e.destination)}
                    </span>
                    <span className="ml-1 text-ink-muted">
                      {formatServiceSec(e.departure_sec)}
                    </span>
                  </span>
                  <span
                    className={`shrink-0 font-mono tabular-nums ${
                      e.in_s <= 0 ? "font-semibold text-ink" : ""
                    }`}
                  >
                    {formatCountdown(e.in_s, primaryLang)}
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
