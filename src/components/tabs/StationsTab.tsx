import { useEffect, useMemo, useRef, useState } from "react";
import { lngLatToLocal } from "../../map/coordinates";
import { formatDistance, geoErrorMessage, nearestStation } from "../../search/stationSearch";
import { useAppStore } from "../../stores/useAppStore";
import { StationCombobox } from "../StationCombobox";
import type { StationInfo } from "../../sim/protocol";

type GeoState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; userLocal: [number, number] }
  | { status: "error"; message: string };

export function StationsTab() {
  const stations = useAppStore((s) => s.stations);
  const routes = useAppStore((s) => s.routes);
  const selectStation = useAppStore((s) => s.selectStation);
  const requestFlyTo = useAppStore((s) => s.requestFlyTo);

  const [geo, setGeo] = useState<GeoState>({ status: "idle" });
  const requestedRef = useRef(false);

  useEffect(() => {
    if (requestedRef.current) return;
    requestedRef.current = true;
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
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
      { timeout: 8000, maximumAge: 300_000 },
    );
  }, []);

  const visibleStations = useMemo(() => {
    const list: StationInfo[] = [];
    for (const s of stations) {
      if (s.x === 0 && s.y === 0) continue;
      const line = routes[s.route_idx];
      if (line && line.gtfsRouteId === null && line.syntheticSchedule === null) continue;
      list.push(s);
    }
    return list;
  }, [stations, routes]);

  const nearest = useMemo(() => {
    if (geo.status !== "ready") return null;
    return nearestStation(geo.userLocal, visibleStations);
  }, [geo, visibleStations]);

  const goToStation = (routeIdx: number, stationIdx: number, lng: number, lat: number) => {
    selectStation({ routeIdx, stationIdx });
    requestFlyTo({ lng, lat });
  };

  return (
    <div data-testid="stations-tab" className="space-y-3 px-2 py-1">
      <StationCombobox
        label="Find a station"
        stations={visibleStations}
        routes={routes}
        onPick={(s) => {
          if (!s) return;
          goToStation(s.route_idx, s.station_idx, s.x, s.y);
        }}
        autoFocus
      />

      <div className="rounded-lg bg-surface-sunken p-2.5">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-muted">
          Nearest Station
        </p>
        {geo.status === "loading" && (
          <p className="mt-1 text-xs text-ink-muted">Finding your location…</p>
        )}
        {geo.status === "error" && (
          <p className="mt-1 text-xs text-ink-muted">{geo.message}</p>
        )}
        {geo.status === "ready" && !nearest && (
          <p className="mt-1 text-xs text-ink-muted">No stations available nearby.</p>
        )}
        {geo.status === "ready" && nearest && (
          <button
            type="button"
            data-testid="nearest-station"
            onClick={() =>
              goToStation(
                nearest.station.route_idx,
                nearest.station.station_idx,
                nearest.station.x,
                nearest.station.y,
              )
            }
            className="mt-1.5 flex w-full items-center justify-between rounded-md bg-surface p-2 text-left shadow-sm transition-colors hover:bg-surface/80"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-semibold text-ink">
                {nearest.station.name_en}
                {nearest.station.name_th ? ` · ${nearest.station.name_th}` : ""}
              </p>
              <p className="text-[10px] text-ink-muted">
                {routes[nearest.station.route_idx]?.name || "Transit Line"}
              </p>
            </div>
            <span className="ml-2 shrink-0 rounded bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium text-accent">
              {formatDistance(nearest.distanceM)}
            </span>
          </button>
        )}
      </div>
    </div>
  );
}

