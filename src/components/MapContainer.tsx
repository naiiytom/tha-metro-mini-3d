import { useEffect, useRef } from "react";
// maplibre-gl v6 ships named exports only — there is no default export.
import { Map as MapLibreMap, NavigationControl, setWorkerUrl, type MapMouseEvent } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
// v6 locates its tile worker with `new URL(\`./${name}\`, import.meta.url)` —
// a dynamic specifier no bundler can rewrite, so after bundling it points at a
// nonexistent /assets/maplibre-gl-worker.mjs and every vector-tile source
// silently stalls (blank base map). Hand it a URL Vite actually emits; the
// `?worker&url` suffix bundles the worker together with its shared chunk.
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { NetworkLayer } from "../map/ThreeLayer";
import { decideAutoUnderground, initialAutoState } from "../map/autoUnderground";
import { styleUrl } from "../map/basemapStyles";
import { installCameraControls } from "../map/cameraControls";
import { FollowCamera } from "../map/followCamera";
import { pickAt } from "../map/selection";
import { highlightSpans } from "../map/routeHighlight";
import { skyPalette, sunDirection } from "../map/sun";
import { bindStyle, type StyleBinding } from "../map/styleBinding";
import { TrainTooltip } from "../map/trainTooltip";
import { effectiveElevationDeg } from "../map/themeMode";
import { effectiveTheme } from "../map/effectiveTheme";
import { resolveStock, type StockSpec } from "../map/rollingStock";
import { loadStockGeometry } from "../map/glbStock";
import { VehicleManager } from "../map/VehicleManager";
import { lngLatToLocal, localToLngLat, ORIGIN_LNG_LAT } from "../map/coordinates";
import { SimClient, activeSimClient } from "../sim/SimClient";
import { DEFAULT_TICK_MS, ECO_TICK_MS, LANE_RUN_IDX, LANE_Z, VEHICLE_STRIDE } from "../sim/protocol";
import { formatCountdown } from "../sim/time";
import { useAppStore } from "../stores/useAppStore";
import network from "../data/network.json";
import type { NetworkData } from "../types";

setWorkerUrl(maplibreWorkerUrl);

export function MapContainer() {
  const containerRef = useRef<HTMLDivElement>(null);
  const setMapReady = useAppStore((s) => s.setMapReady);

  useEffect(() => {
    const map = new MapLibreMap({
      container: containerRef.current!,
      style: "https://tiles.openfreemap.org/styles/liberty",
      center: ORIGIN_LNG_LAT,
      zoom: 12.5,
      pitch: 55,
      bearing: -15,
      maxPitch: 80,
      // Default is 3px; ordinary mouse clicks routinely move a few px between
      // pointerdown/up, which MapLibre's dragPan handler then reclassifies as
      // a pan (firing dragstart instead of click). Combined with onDragStart
      // below (which drops `following` on any real pan), that made the very
      // next click after starting to follow a train cancel it — "follow only
      // works once." A few extra px absorbs normal click jitter without
      // affecting genuine drag gestures.
      clickTolerance: 6,
      // Uncapped devicePixelRatio (commonly 2-3 on phones) multiplies the
      // shared MapLibre/Three canvas's fragment cost up to ~9x at dpr=3 vs
      // dpr=1 — this is Three's own drawing buffer too, since it renders
      // into MapLibre's canvas (§3A "MapLibre↔Three bridge"). 2 is the
      // standard mobile-safe ceiling. Gated on a coarse (touch-primary)
      // pointer rather than applied unconditionally: a 3x desktop retina
      // display has a real, visible sharpness regression from this cap, and
      // that hardware is never the fragment-cost problem this exists for —
      // only a fine-pointer device with room for a large uncapped canvas
      // gets to skip it. ThreeLayer.ts needs no matching change: its
      // render() already reads back the actual drawing-buffer size every
      // frame.
      pixelRatio: window.matchMedia("(pointer: coarse)").matches
        ? Math.min(window.devicePixelRatio || 1, 2)
        : window.devicePixelRatio || 1,
      // v5+ moved GL context flags out of MapOptions into this bag.
      canvasContextAttributes: { antialias: true },
      attributionControl: {
        customAttribution:
          "Track © OpenStreetMap contributors (ODbL) · Stations: Namtang / OTP open data (CC-BY 4.0)",
      },
    });
    map.addControl(new NavigationControl({ visualizePitch: true }), "top-right");
    let sim: SimClient | null = null;
    let unsubscribeTooltipSelection: (() => void) | null = null;
    let tooltipTimer: ReturnType<typeof setInterval> | null = null;
    let rafId = 0;
    // style.load fires asynchronously; if effect cleanup runs first (a React
    // StrictMode double-invoke, or a fast unmount before tiles finish
    // loading), sim/rafId below are created after cleanup already ran with
    // them still null, so nothing would ever tear them down. Guarded at the
    // end of the style.load handler.
    let disposed = false;
    const follow = new FollowCamera();
    const controls = installCameraControls(map, {
      onOrbit: (bearingDelta) => {
        if (!useAppStore.getState().following) return false;
        follow.addYawOffset(bearingDelta);
        return true;
      },
    });
    // On-map label tracking whichever train is selected — see its own doc
    // comment for why this exists as a class rather than a React component.
    const trainTooltip = new TrainTooltip(containerRef.current!);
    // Latest interpolated poses, kept for click hit-testing. Owned by the
    // render path — never copied into React state (§3A.7).
    let lastVehicles: Float32Array<ArrayBufferLike> = new Float32Array(0);
    let lastCount = 0;
    // Followed train's altitude, captured on the frame path (below) and acted
    // on in the rAF loop — see decideAutoUnderground's own doc comment for
    // why this decides on altitude rather than the track's structure tag.
    let followedAltitudeM: number | null = null;
    let autoUnderground = initialAutoState();
    const net = network as unknown as NetworkData;

    // Everything below is RE-CREATED on every style.load (map.setStyle()
    // destroys every custom layer). SimClient/FollowCamera/TrainTooltip and
    // the rAF loop are per-MAP, not per-style — see styleBinding.ts's own
    // doc comment for why re-creating SimClient on a style swap would leak a
    // second worker holding a second copy of the timetable cache.
    let layer: NetworkLayer | null = null;
    let vehicleManager: VehicleManager | null = null;
    let binding: StyleBinding | null = null;
    // True after the first style.load. A style SWAP must rebuild the Three
    // layer and re-capture the paint snapshots, but must NOT create a second
    // SimClient — that would spawn a second worker holding a second copy of
    // the timetable cache, and the rAF loop/click handlers/tooltip are all
    // per-map, not per-style.
    let simInitialised = false;

    /**
     * Resolve any line that declares a `.glb` override and swap the loaded
     * model in over the procedural geometry `VehicleManager` already built.
     *
     * No registry line declares `glbUrl` today, and glbStock.ts explains why
     * that is the expected steady state — but the seam still has to be
     * CONNECTED. Left unwired (as it was until code review 2026-08-23), adding
     * `glbUrl` to the registry would pass `assertRegistryValid`, flow through
     * `resolveStock` into the `StockSpec`, and then silently do nothing with no
     * warning anywhere: the same "every gate reports success while the change
     * has no effect" footgun this project already hit with INTERCHANGE_OVERRIDES.
     *
     * Deliberately not awaited. A model must never delay first paint, and
     * `loadStockGeometry` already falls back to procedural on every failure
     * path, so the worst case is simply the geometry that is on screen already.
     */
    const attachStockOverrides = (manager: VehicleManager, stocks: StockSpec[]) => {
      stocks.forEach((stock, routeIdx) => {
        if (stock.glbUrl === undefined) return;
        loadStockGeometry(stock)
          .then((geometry) => {
            // The load is async, so an unmount — or a style swap, which builds
            // an entirely new VehicleManager — may have landed while it was in
            // flight. Swapping into a manager the scene no longer owns would
            // leak the geometry and write to a mesh that is already disposed.
            if (disposed || manager !== vehicleManager) {
              geometry.dispose();
              return;
            }
            manager.setRouteGeometry(routeIdx, geometry);
            map.triggerRepaint();
          })
          .catch((error) => {
            console.warn(`[rolling stock] override failed for route ${routeIdx}:`, error);
          });
      });
    };

    // Per-frame path: interpolate + pose instances inside the layer's
    // render(), entirely outside React. Declared once, re-attached to each
    // new NetworkLayer instance on every style swap (see style.load below).
    const beforeRender = () => {
      const client = activeSimClient.current;
      if (!client) return;
      const { vehicles, count } = client.getInterpolated(performance.now());
      const { selectedRunIdx, following } = useAppStore.getState();
      vehicleManager?.update(vehicles, count, selectedRunIdx);
      // Read the follow target here (the buffer is already in hand) but move
      // the camera in the rAF loop — jumpTo() inside render() re-enters
      // MapLibre's render path.
      follow.capture(vehicles, count, following ? selectedRunIdx : null);
      // Unlike follow.capture above, this is NOT gated on `following` — the
      // tooltip tracks whichever train is selected regardless of camera lock.
      trainTooltip.capture(vehicles, count, selectedRunIdx);
      // Followed train's altitude, for the auto-underground decision made in
      // the rAF loop below. Reading it here is free (the buffer is in hand);
      // acting on it here is not — setUndergroundMode goes through Zustand,
      // which must never be written from the render path (§3A.7).
      followedAltitudeM = null;
      if (following && selectedRunIdx !== null) {
        for (let i = 0; i < count; i++) {
          if (vehicles[i * VEHICLE_STRIDE + LANE_RUN_IDX] === selectedRunIdx) {
            followedAltitudeM = vehicles[i * VEHICLE_STRIDE + LANE_Z];
            break;
          }
        }
      }
      lastVehicles = vehicles;
      lastCount = count;
    };

    // Visibility/underground/shadows/theme/basemap are all UI state, so they
    // drive the scene through a subscription rather than the per-frame path.
    // Registered ONCE per map mount — NOT inside style.load, or a style swap
    // would register a second copy of this on every swap.
    const unsubscribeVisibility = useAppStore.subscribe((state, prev) => {
      if (state.hiddenRoutes !== prev.hiddenRoutes) {
        for (let i = 0; i < net.lines.length; i++) {
          const visible = !state.hiddenRoutes.includes(i);
          layer?.setLineVisible(i, visible);
          vehicleManager?.setRouteVisible(i, visible);
        }
        // A route highlight is drawn per LEG, on track this loop may have
        // just hidden — so it has to be rebuilt here too, or hiding a line
        // after planning leaves that leg's white span stranded over track
        // that is no longer there (and unhiding never brings it back).
        layer?.setRouteHighlight(highlightSpans(state.routePlan, state.hiddenRoutes));
        map.triggerRepaint();
      }
      if (state.undergroundMode !== prev.undergroundMode) {
        binding?.applyUnderground(state.undergroundMode);
      }
      if (state.shadowsEnabled !== prev.shadowsEnabled) {
        layer?.setShadowsEnabled(state.shadowsEnabled);
        map.triggerRepaint();
      }
      if (state.themeMode !== prev.themeMode) {
        const client = activeSimClient.current;
        if (client && layer) {
          const dir = sunDirection(client.getSimNow());
          const eff = effectiveElevationDeg(state.themeMode, dir.elevationDeg);
          layer.setSun(dir, skyPalette(eff), eff);
          layer.setSkyElevation(eff);
          document.documentElement.dataset.theme = effectiveTheme(state.themeMode, dir.elevationDeg);
        }
        // Force the next tick to recompute: `lastApplied` still holds the
        // previous mode's blended values, so without this the redundant-
        // write skip would keep them.
        binding?.resetThemeCache();
        map.triggerRepaint();
      }
      if (state.basemapStyle !== prev.basemapStyle) {
        // setStyle's default diffing (`options.diff !== false`) can never see
        // our custom layer: Style.serialize() explicitly excludes `type:
        // "custom"` layers (CustomStyleLayer.serialize() even throws if
        // called), so the diff between old and new style JSON never emits a
        // removeLayer for it — the OLD NetworkLayer instance survives the
        // swap untouched, and the style.load handler below's map.addLayer()
        // then throws "Layer ... already exists on this map." (verified live
        // against a real dev server while implementing this). `{diff:
        // false}` avoids that collision but is worse: it tears the whole
        // Style object down without ever calling removeLayer() per layer, so
        // NetworkLayer.onRemove() — which disposes Three.js geometry,
        // materials and the WebGLRenderer wrapper — never fires, leaking
        // real GPU resources on every swap. Removing the layer ourselves
        // first runs the genuine removeLayer path (same one an unmount
        // already exercises), so disposal is real either way.
        if (layer && map.getLayer(layer.id)) {
          map.removeLayer(layer.id);
        }
        map.setStyle(styleUrl(state.basemapStyle));
      }
      if (state.ecoMode !== prev.ecoMode) {
        activeSimClient.current?.setTickMs(state.ecoMode ? ECO_TICK_MS : DEFAULT_TICK_MS);
        map.triggerRepaint(); // repaint once immediately on exit
      }
      if (state.routePlan !== prev.routePlan) {
        layer?.setRouteHighlight(highlightSpans(state.routePlan, state.hiddenRoutes));
        map.triggerRepaint();
      }
    });

    map.on("style.load", () => {
      const store = useAppStore.getState();
      const stocks = net.lines.map((l) => resolveStock(l));
      vehicleManager = new VehicleManager(
        net.lines.map((l, i) => ({ color: l.color, stock: stocks[i] })),
      );
      // Re-run on every style.load, not just the first: a swap rebuilds the
      // VehicleManager from scratch, so an override resolved for the previous
      // one is gone with it.
      attachStockOverrides(vehicleManager, stocks);
      layer = new NetworkLayer(net, vehicleManager);
      map.addLayer(layer);
      setMapReady(true);
      store.setRoutes(net.lines);
      binding = bindStyle(map, layer);
      binding.applyUnderground(useAppStore.getState().undergroundMode);
      layer.setShadowsEnabled(useAppStore.getState().shadowsEnabled);
      // Seed line visibility from any hiddenRoutes already in the store at
      // mount — the subscription above only reacts to CHANGES, so without
      // this a remount (or a style swap) with pre-existing hidden routes (a
      // React StrictMode double-invoke, or future persistence) would render
      // every line visible until the next toggle (finding 6c).
      {
        const initialHidden = useAppStore.getState().hiddenRoutes;
        for (let i = 0; i < net.lines.length; i++) {
          const visible = !initialHidden.includes(i);
          layer.setLineVisible(i, visible);
          vehicleManager.setRouteVisible(i, visible);
        }
      }
      // Re-attach the per-frame hook to the NEW layer instance.
      layer.beforeRender = beforeRender;
      // A style swap rebuilds the Three layer from scratch; the plan lives in
      // the store, which survives it.
      {
        const s = useAppStore.getState();
        layer.setRouteHighlight(highlightSpans(s.routePlan, s.hiddenRoutes));
      }

      if (simInitialised) {
        // Style swap: the Three layer and paint snapshots are rebuilt above;
        // everything else (SimClient, tooltip, follow, rAF, handlers,
        // subscriptions) survived and still points at the right objects
        // through the hoisted layer/vehicleManager/binding variables.
        map.triggerRepaint();
        return;
      }
      simInitialised = true;

      store.setEngineStatus("loading");
      let lastCountUpdate = 0;
      sim = new SimClient({
        onReady: (validation) => {
          const s = useAppStore.getState();
          s.setValidation(validation);
          s.setEngineStatus("ready");
          // Static station list, fetched once — powers click hit-testing and
          // the station board's indices (contract §7).
          void sim
            ?.getStations()
            .then((stations) => useAppStore.getState().setStations(stations))
            .catch(() => undefined);
        },
        onError: (message) => useAppStore.getState().setEngineStatus("error", message),
        onClock: (params) => useAppStore.getState().setClock(params),
        onFrame: (_simEpochMs, count) => {
          // 10 Hz worker frames -> 1 Hz UI updates (§3A.7).
          const now = performance.now();
          if (now - lastCountUpdate >= 1000) {
            lastCountUpdate = now;
            useAppStore.getState().setVehicleCount(count);
          }
        },
      });
      activeSimClient.current = sim;

      // Tooltip content (headsign/next-stop) is UI-rate, not per-frame, so a
      // plain 1 Hz poll is fine — the same query and cadence TrainInspector.tsx
      // already runs when its own panel is open. Deliberately duplicated
      // rather than shared: a small, independent poll matches the existing
      // TrainInspector/StationBoard precedent and avoids new cross-component
      // cache plumbing for one short string.
      //
      // The placeholder ("Train {idx}") is only ever written on a selection
      // change, not on every poll tick — mirroring TrainInspector.tsx, whose
      // placeholder reset lives in the `selectedRunIdx === null` branch of its
      // effect, outside the poll body. Writing it unconditionally here too
      // used to flash the resolved label back to the placeholder once a
      // second, since every poll's `await` momentarily left the tooltip
      // showing the reset text before the real detail came back.
      const refreshTooltipContent = async (showPlaceholder: boolean) => {
        const selectedRunIdx = useAppStore.getState().selectedRunIdx;
        const client = activeSimClient.current;
        if (selectedRunIdx === null || !client) return;
        if (showPlaceholder) trainTooltip.setContent("#94a3b8", `Train ${selectedRunIdx}`);
        try {
          const detail = await client.getRunDetail(selectedRunIdx, client.getSimNow());
          // Bail on a stale response after the user re-selected mid-flight —
          // same guard TrainInspector.tsx's own poll uses.
          if (useAppStore.getState().selectedRunIdx !== selectedRunIdx) return;
          if (!detail) {
            trainTooltip.setContent("#94a3b8", "Trip ended");
            return;
          }
          const color = `#${detail.color_rgb.toString(16).padStart(6, "0")}`;
          const next =
            detail.next_station !== null && detail.next_arrival_in_s !== null
              ? ` · ${detail.next_station} in ${formatCountdown(detail.next_arrival_in_s)}`
              : "";
          trainTooltip.setContent(color, `${detail.headsign}${next}`);
        } catch {
          // Worker torn down mid-flight; the next poll or selection re-queries.
        }
      };
      tooltipTimer = setInterval(() => void refreshTooltipContent(false), 1000);
      unsubscribeTooltipSelection = useAppStore.subscribe((state, prev) => {
        if (state.selectedRunIdx !== prev.selectedRunIdx) void refreshTooltipContent(true);
      });

      // Day/night follows the SIM clock, not wall time (F3.3) — scrubbing to
      // 22:00 must actually look like 22:00. Updated at ~2 Hz: at 60× warp
      // that is still under 0.25° of solar motion per step, well below what
      // is visible, and it keeps trigonometry off the frame path.
      let lastSunUpdate = 0;
      const updateSun = (now: number) => {
        if (now - lastSunUpdate < 500) return;
        lastSunUpdate = now;
        const client = activeSimClient.current;
        if (!client) return;
        const dir = sunDirection(client.getSimNow());
        const mode = useAppStore.getState().themeMode;
        // Direction stays REAL in every mode (verify:mvp6 check 5 reads the
        // light position); only the palette and the basemap blend use the
        // mode-effective elevation.
        const eff = effectiveElevationDeg(mode, dir.elevationDeg);
        layer?.setSun(dir, skyPalette(eff), eff);
        layer?.setSkyElevation(eff);
        binding?.applyThemeElevation(eff);
        document.documentElement.dataset.theme = effectiveTheme(mode, dir.elevationDeg);
      };

      // MapLibre only repaints on demand — keep frames coming while the
      // engine is running.
      let lastEcoFrame = 0;
      const loop = () => {
        const s = useAppStore.getState();
        if (s.engineStatus === "ready") {
          const now = performance.now();
          // Eco mode still runs the rAF callback every frame (that is how it
          // stays alive to notice being switched off) but only does the
          // actual paint work at ECO_TICK_MS — the roadmap-item-2 power save.
          const paint = !s.ecoMode || now - lastEcoFrame >= ECO_TICK_MS;
          if (paint) {
            lastEcoFrame = now;
            updateSun(now);
            follow.apply(map);
            {
              const c = map.getCenter();
              const [e, n] = lngLatToLocal(c.lng, c.lat);
              layer?.setSkyCenter(e, n);
            }
            {
              const d = decideAutoUnderground(autoUnderground, {
                following: s.following,
                altitudeM: followedAltitudeM,
                undergroundMode: s.undergroundMode,
              });
              autoUnderground = d.next;
              if (d.setUndergroundTo !== null) s.setUndergroundMode(d.setUndergroundTo);
            }
            trainTooltip.apply(map, s.uiHidden);
            map.triggerRepaint();
          }
        }
        rafId = requestAnimationFrame(loop);
      };
      rafId = requestAnimationFrame(loop);

      if (disposed) {
        // Cleanup already ran before this fired — tear down what it missed
        // instead of leaking a running rAF loop, worker and subscription.
        // (unsubscribeVisibility is registered synchronously above, outside
        // style.load, so effect cleanup already unsubscribed it — nothing to
        // do for it here.)
        cancelAnimationFrame(rafId);
        if (tooltipTimer !== null) clearInterval(tooltipTimer);
        unsubscribeTooltipSelection?.();
        sim?.dispose();
        if (activeSimClient.current === sim) activeSimClient.current = null;
      }
    });

    // Click to select a train or station. Uses the most recent interpolated
    // buffer — the same poses that are on screen.
    const onMapClick = (e: { point: { x: number; y: number } }) => {
      const { stations, selectRun, selectStation, hiddenRoutes } = useAppStore.getState();
      const view = layer?.viewProjection();
      if (!view) return;
      const hit = pickAt(view, lastVehicles, lastCount, stations, e.point, hiddenRoutes, map.getZoom());
      if (!hit) {
        // Clicking empty map clears the selection, like clicking away from
        // anything else.
        selectRun(null);
        selectStation(null);
        return;
      }
      if (hit.type === "vehicle") {
        selectRun(hit.runIdx);
      } else {
        selectStation({ routeIdx: hit.routeIdx, stationIdx: hit.stationIdx });
      }
    };
    map.on("click", onMapClick);

    // Hover affordance: without it a user cannot tell a missed click from a
    // click on nothing, which is most of why #25 read as "hard to click"
    // rather than "offset by 23px".
    let hoverQueued = false;
    let hoverRafId = 0;
    let lastHoverPoint: { x: number; y: number } | null = null;
    const onMouseMove = (e: MapMouseEvent) => {
      lastHoverPoint = { x: e.point.x, y: e.point.y };
      if (hoverQueued) return;
      hoverQueued = true;
      hoverRafId = requestAnimationFrame(() => {
        hoverQueued = false;
        const point = lastHoverPoint;
        const view = layer?.viewProjection();
        if (!point || !view) return;
        const { stations, hiddenRoutes } = useAppStore.getState();
        const hit = pickAt(view, lastVehicles, lastCount, stations, point, hiddenRoutes, map.getZoom());
        map.getCanvas().style.cursor = hit ? "pointer" : "";
      });
    };
    map.on("mousemove", onMouseMove);

    // Panning while following would fight the per-frame jumpTo, so the first
    // user drag hands control back (Mini Tokyo 3D does the same).
    //
    // `controls.isOrbiting()` is mouse-gesture-only (see cameraControls.ts's
    // `isOrbitDrag` for the full explanation) — a touch device has no orbit
    // gesture at all, so `isOrbiting()` is always false there and EVERY drag
    // while following (there being no other kind, on touch) cancels follow.
    // Disclosed limitation (Minor #11): issue #31's yaw-offset fix helps
    // mouse orbit only; a touch user following a train still loses follow
    // mode on the very next drag, same as before that fix.
    const onDragStart = () => {
      if (controls.isOrbiting()) return;
      if (useAppStore.getState().following) useAppStore.getState().setFollowing(false);
    };
    map.on("dragstart", onDragStart);

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const store = useAppStore.getState();
      store.selectRun(null);
      store.selectStation(null);
    };
    window.addEventListener("keydown", onKeyDown);

    // Releasing follow must also clear the smoothed bearing, or the next
    // follow starts from a stale heading. Switching the followed train while
    // still following (clicking train B while locked onto train A —
    // selectRun() intentionally preserves `following`) needs the same
    // treatment for bearing alone: the pose snaps instantly via capture(),
    // but bearing eases, so leaving it set carries A's heading into B's shot.
    const unsubscribeFollow = useAppStore.subscribe((state, prev) => {
      if (prev.following && !state.following) {
        follow.reset();
      } else if (state.following && state.selectedRunIdx !== prev.selectedRunIdx) {
        follow.resetBearing();
      }
    });

    // Station search / nearest-station selection requests a one-shot camera
    // jump (see useAppStore's flyToRequest doc comment). Not per-frame —
    // §3A.7 doesn't apply — a UI action fired at most once per selection,
    // cleared immediately after MapLibre picks it up.
    const unsubscribeFlyTo = useAppStore.subscribe((state, prev) => {
      if (state.flyToRequest && state.flyToRequest !== prev.flyToRequest) {
        const { lng, lat } = state.flyToRequest;
        map.easeTo({ center: [lng, lat], zoom: 16, duration: 800 });
        useAppStore.getState().clearFlyToRequest();
      }
    });

    // Dev builds always expose these; a production build exposes them too, but
    // only when opted in via `?debug=1`, so ordinary production visitors never
    // get debug globals on `window`. The `?debug=1` path was added for the NF1
    // perf harness (deleted 2026-08-09), which had to measure a real prod
    // bundle — dev-mode React and unminified Three would have made the numbers
    // meaningless. Kept: it is still the only way to inspect a prod build.
    const debugRequested =
      typeof window !== "undefined" && new URLSearchParams(window.location.search).get("debug") === "1";
    if (import.meta.env.DEV || debugRequested) {
      // dev/debug-only handles for tools/screenshot.mjs (and previously the
      // browser acceptance harnesses, removed 2026-08-09)
      const dev = window as unknown as {
        __map?: MapLibreMap;
        __sim?: typeof activeSimClient;
        __store?: typeof useAppStore;
        __localToLngLat?: typeof localToLngLat;
      };
      dev.__map = map;
      dev.__sim = activeSimClient;
      // verify-mvp4.mjs needs these to drive selection and to convert engine
      // ENU positions into screen pixels for a real click.
      dev.__store = useAppStore;
      dev.__localToLngLat = localToLngLat;
    }
    return () => {
      disposed = true;
      cancelAnimationFrame(rafId);
      cancelAnimationFrame(hoverRafId);
      controls.dispose();
      unsubscribeFollow();
      unsubscribeFlyTo();
      unsubscribeVisibility();
      if (tooltipTimer !== null) clearInterval(tooltipTimer);
      unsubscribeTooltipSelection?.();
      trainTooltip.dispose();
      map.off("click", onMapClick);
      map.off("mousemove", onMouseMove);
      map.getCanvas().style.cursor = "";
      map.off("dragstart", onDragStart);
      window.removeEventListener("keydown", onKeyDown);
      activeSimClient.current = null;
      sim?.dispose();
      map.remove();
      // The sun/theme tick above (and the style.load handler) stamp
      // `data-theme` on <html> as a GLOBAL DOM side effect — it outlives this
      // component's own React tree. Remove it here rather than leaving the
      // last-applied value stuck forever if MapContainer is ever unmounted
      // while the document persists (a future route change, a test mounting
      // multiple instances in one jsdom environment, React Strict Mode's
      // mount-unmount-remount cycle). No explicit "no preference" value
      // exists to restore instead: `:root` in index.css IS the light-mode
      // default with no `data-theme` attribute present, so removing the
      // attribute is the correct reset, not just an approximation of one.
      delete document.documentElement.dataset.theme;
      const store = useAppStore.getState();
      store.setEngineStatus("off");
      store.setValidation(null);
      store.setVehicleCount(0);
      store.selectRun(null);
      store.selectStation(null);
      store.setStations([]);
      setMapReady(false);
    };
  }, [setMapReady]);

  // NB: MapLibre's stylesheet forces `.maplibregl-map { position: relative }`,
  // so size with h-full/w-full rather than absolute inset positioning.
  return <div ref={containerRef} className="h-full w-full" />;
}
