import type { Map as MapLibreMap, MapMouseEvent } from "maplibre-gl";
import { useAppStore } from "../stores/useAppStore";
import { localToLngLat } from "./coordinates";
import type { ViewProjection } from "./screenProject";
import { pickAt, type Picked } from "./selection";
import { easeToLngLat } from "./viewportOffset";

/**
 * Pointer selection on the map: click selects a train or station (empty map
 * clears), hover shows a pointer cursor over anything clickable, Escape
 * clears. Picks against the most recent interpolated vehicle buffer — the
 * same poses that are on screen. Returns a dispose function.
 */
export function installMapPicking(
  map: MapLibreMap,
  getView: () => ViewProjection | null,
  getVehicles: () => { data: Float32Array; count: number },
): () => void {
  const pick = (point: { x: number; y: number }, view: ViewProjection): Picked | null => {
    const { stations, hiddenRoutes, map3D, trainScale } = useAppStore.getState();
    const { data, count } = getVehicles();
    return pickAt(view, data, count, stations, point, hiddenRoutes, map.getZoom(), map3D, trainScale);
  };

  const onClick = (e: { point: { x: number; y: number } }) => {
    const view = getView();
    if (!view) return;
    const hit = pick(e.point, view);
    const { stations, selectRun, selectStation, map3D } = useAppStore.getState();
    if (!hit) {
      // Clicking empty map clears the selection, like clicking away from
      // anything else.
      selectRun(null);
      selectStation(null);
      return;
    }
    if (hit.type === "vehicle") {
      selectRun(hit.runIdx);
      return;
    }
    selectStation({ routeIdx: hit.routeIdx, stationIdx: hit.stationIdx });
    const s = stations.find(
      (st) => st.route_idx === hit.routeIdx && st.station_idx === hit.stationIdx,
    );
    if (!s) return;
    const pos = localToLngLat(s.x, s.y);
    easeToLngLat(map, [pos.lng, pos.lat], map3D);
  };

  // Hover affordance: without it a user cannot tell a missed click from a
  // click on nothing, which is most of why #25 read as "hard to click"
  // rather than "offset by 23px". Throttled to one pick per frame.
  let hoverQueued = false;
  let hoverRafId = 0;
  let lastHoverPoint: { x: number; y: number } | null = null;
  const onMouseMove = (e: MapMouseEvent) => {
    lastHoverPoint = { x: e.point.x, y: e.point.y };
    if (hoverQueued) return;
    hoverQueued = true;
    hoverRafId = requestAnimationFrame(() => {
      hoverQueued = false;
      const view = getView();
      if (!lastHoverPoint || !view) return;
      // Skip mid-drag: an inline canvas cursor would override MapLibre's own
      // grab/grabbing cursor for the whole drag.
      if (map.dragPan.isActive()) return;
      map.getCanvas().style.cursor = pick(lastHoverPoint, view) ? "pointer" : "";
    });
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    const store = useAppStore.getState();
    store.selectRun(null);
    store.selectStation(null);
  };

  map.on("click", onClick);
  map.on("mousemove", onMouseMove);
  window.addEventListener("keydown", onKeyDown);
  return () => {
    map.off("click", onClick);
    map.off("mousemove", onMouseMove);
    cancelAnimationFrame(hoverRafId);
    map.getCanvas().style.cursor = "";
    window.removeEventListener("keydown", onKeyDown);
  };
}
