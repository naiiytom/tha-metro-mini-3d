import { useEffect, useMemo, useRef, useState } from "react";
import { lngLatToLocal, localToLngLat } from "../map/coordinates";
import { filterStations, nearestStation } from "../search/stationSearch";
import { useAppStore } from "../stores/useAppStore";

type GeoState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; userLocal: [number, number] }
  | { status: "error"; message: string };

function geoErrorMessage(err: GeolocationPositionError | { code: number }): string {
  switch (err.code) {
    case 1: // PERMISSION_DENIED
      return "Location permission denied.";
    case 2: // POSITION_UNAVAILABLE
      return "Location unavailable.";
    case 3: // TIMEOUT
      return "Location request timed out.";
    default:
      return "Could not determine your location.";
  }
}

function formatDistance(distanceM: number): string {
  return distanceM >= 1000 ? `${(distanceM / 1000).toFixed(1)} km` : `${Math.round(distanceM)} m`;
}

/**
 * Station search + nearest-station panel (roadmap item 3). Triggered by a
 * button in LineSelector's header; positions itself as a desktop dropdown
 * near LineSelector or a mobile bottom sheet, matching StationBoard's own
 * responsive treatment.
 *
 * Geolocation is requested once per mount, the moment the panel first opens
 * — not on every reopen (`requestedRef` guards this) and never via
 * `watchPosition`, since nothing needs the distance to live-update while the
 * panel sits open.
 */
export function StationSearch() {
  const searchOpen = useAppStore((s) => s.searchOpen);
  const setSearchOpen = useAppStore((s) => s.setSearchOpen);
  const stations = useAppStore((s) => s.stations);
  const routes = useAppStore((s) => s.routes);
  const selectStation = useAppStore((s) => s.selectStation);
  const requestFlyTo = useAppStore((s) => s.requestFlyTo);

  const [query, setQuery] = useState("");
  const [geo, setGeo] = useState<GeoState>({ status: "idle" });
  const requestedRef = useRef(false);

  useEffect(() => {
    if (!searchOpen || requestedRef.current) return;
    requestedRef.current = true;
    if (!("geolocation" in navigator)) {
      setGeo({ status: "error", message: "Location is not supported by this browser." });
      return;
    }
    setGeo({ status: "loading" });
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGeo({
          status: "ready",
          userLocal: lngLatToLocal(pos.coords.longitude, pos.coords.latitude),
        });
      },
      (err) => setGeo({ status: "error", message: geoErrorMessage(err) }),
    );
  }, [searchOpen]);

  const results = useMemo(() => filterStations(stations, query), [stations, query]);
  const nearest = useMemo(
    () => (geo.status === "ready" ? nearestStation(geo.userLocal, stations) : null),
    [geo, stations],
  );

  if (!searchOpen) return null;

  const goToStation = (routeIdx: number, stationIdx: number, x: number, y: number) => {
    selectStation({ routeIdx, stationIdx });
    requestFlyTo(localToLngLat(x, y));
    setSearchOpen(false);
    setQuery("");
  };

  return (
    <div
      data-testid="station-search"
      className="pointer-events-auto flex max-h-[50dvh] w-full flex-col overflow-hidden rounded-t-2xl border border-white/40 bg-white/70 shadow-xl shadow-slate-900/10 backdrop-blur-md ring-1 ring-slate-900/5 md:absolute md:left-[17rem] md:top-4 md:max-h-[calc(100dvh-2rem)] md:w-72 md:rounded-xl"
    >
      <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3">
        <input
          type="text"
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search stations…"
          aria-label="Search stations"
          className="min-w-0 flex-1 rounded-md border border-slate-200 bg-white/80 px-2 py-1.5 text-sm text-slate-800 outline-none focus:ring-2 focus:ring-emerald-500"
        />
        <button
          type="button"
          onClick={() => setSearchOpen(false)}
          aria-label="Close search"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-sm leading-none text-slate-500 hover:bg-slate-200 hover:text-slate-700 md:h-auto md:w-auto md:px-1.5 md:py-0.5"
        >
          ×
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        <p className="px-2 pb-1 text-[10px] uppercase tracking-wide text-slate-500">
          Nearest station
        </p>
        {geo.status === "loading" && (
          <p className="px-2 py-2 text-xs text-slate-600">Finding your location…</p>
        )}
        {geo.status === "error" && <p className="px-2 py-2 text-xs text-slate-600">{geo.message}</p>}
        {geo.status === "ready" && !nearest && (
          <p className="px-2 py-2 text-xs text-slate-600">No stations available yet.</p>
        )}
        {geo.status === "ready" && nearest && (
          <button
            type="button"
            onClick={() =>
              goToStation(
                nearest.station.route_idx,
                nearest.station.station_idx,
                nearest.station.x,
                nearest.station.y,
              )
            }
            className="mb-2 flex w-full items-center gap-2 rounded-md px-3 py-2.5 text-left text-sm text-slate-700 transition-colors hover:bg-slate-200 md:px-2 md:py-1.5 md:text-xs"
          >
            <span
              className="inline-block h-2 w-4 shrink-0 rounded-sm"
              style={{ background: routes[nearest.station.route_idx]?.color ?? "#64748b" }}
            />
            <span className="min-w-0 flex-1 truncate">
              <span className="font-medium text-slate-900">{nearest.station.name_en}</span>
              <span className="ml-1 text-slate-500">{nearest.station.name_th}</span>
            </span>
            <span className="shrink-0 text-slate-500">{formatDistance(nearest.distanceM)}</span>
          </button>
        )}

        <p className="px-2 pb-1 text-[10px] uppercase tracking-wide text-slate-500">Results</p>
        {query.trim() === "" ? null : results.length === 0 ? (
          <p className="px-2 py-2 text-xs text-slate-600">No stations match.</p>
        ) : (
          <ul className="space-y-0.5">
            {results.map((s) => (
              <li key={`${s.route_idx}-${s.station_idx}`}>
                <button
                  type="button"
                  onClick={() => goToStation(s.route_idx, s.station_idx, s.x, s.y)}
                  className="flex w-full items-center gap-2 rounded-md px-3 py-2.5 text-left text-sm text-slate-700 transition-colors hover:bg-slate-200 md:px-2 md:py-1.5 md:text-xs"
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
    </div>
  );
}
