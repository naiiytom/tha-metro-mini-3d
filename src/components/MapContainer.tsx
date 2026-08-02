import { useEffect, useRef } from "react";
// maplibre-gl v6 ships named exports only — there is no default export.
import { Map as MapLibreMap, NavigationControl, setWorkerUrl } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
// v6 locates its tile worker with `new URL(\`./${name}\`, import.meta.url)` —
// a dynamic specifier no bundler can rewrite, so after bundling it points at a
// nonexistent /assets/maplibre-gl-worker.mjs and every vector-tile source
// silently stalls (blank base map). Hand it a URL Vite actually emits; the
// `?worker&url` suffix bundles the worker together with its shared chunk.
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { NetworkLayer } from "../map/ThreeLayer";
import { installCameraControls } from "../map/cameraControls";
import { FollowCamera } from "../map/followCamera";
import { pickAt } from "../map/selection";
import { skyPalette, sunDirection } from "../map/sun";
import {
  NIGHT_THEME,
  mixColor,
  nightFactor,
  parseColor,
  type BasemapTheme,
} from "../map/basemapTheme";
import { VehicleManager } from "../map/VehicleManager";
import { localToLngLat, ORIGIN_LNG_LAT } from "../map/coordinates";
import { SimClient, activeSimClient } from "../sim/SimClient";
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
      // v5+ moved GL context flags out of MapOptions into this bag.
      canvasContextAttributes: { antialias: true },
      attributionControl: {
        customAttribution:
          "Track © OpenStreetMap contributors (ODbL) · Stations: Namtang / OTP open data (CC-BY 4.0)",
      },
    });
    map.addControl(new NavigationControl({ visualizePitch: true }), "top-right");
    const removeCameraControls = installCameraControls(map);

    let sim: SimClient | null = null;
    let unsubscribeVisibility: (() => void) | null = null;
    let rafId = 0;
    // style.load fires asynchronously; if effect cleanup runs first (a React
    // StrictMode double-invoke, or a fast unmount before tiles finish
    // loading), sim/unsubscribeVisibility/rafId below are created after
    // cleanup already ran with them still null, so nothing would ever tear
    // them down. Guarded at the end of the style.load handler.
    let disposed = false;
    const follow = new FollowCamera();
    // Latest interpolated poses, kept for click hit-testing. Owned by the
    // render path — never copied into React state (§3A.7).
    let lastVehicles: Float32Array<ArrayBufferLike> = new Float32Array(0);
    let lastCount = 0;

    map.on("style.load", () => {
      const store = useAppStore.getState();
      const net = network as unknown as NetworkData;
      const vehicleManager = new VehicleManager(
        net.lines.map((l) => ({ color: l.color, vehicleType: l.vehicleType })),
      );
      const layer = new NetworkLayer(net, vehicleManager);
      map.addLayer(layer);
      setMapReady(true);
      store.setRoutes(net.lines);
      // MapLibre side of the underground mode. Layer IDs are discovered from
      // the loaded style rather than hardcoded: this is OpenFreeMap's Liberty
      // style today, and hardcoded ids would break silently if it changes or
      // is swapped. `fill-extrusion` is the 3D buildings; `fill` is landuse
      // and water. SRS §F3.2 specifies the 0.1–0.4 opacity band.
      const UNDERGROUND_BASEMAP_OPACITY = 0.25;
      const dimmable = map
        .getStyle()
        .layers.filter((l) => l.type === "fill-extrusion" || l.type === "fill")
        .map((l) => {
          const prop = (
            l.type === "fill-extrusion" ? "fill-extrusion-opacity" : "fill-opacity"
          ) as "fill-extrusion-opacity" | "fill-opacity";
          return {
            id: l.id,
            prop,
            original: (map.getPaintProperty(l.id, prop) as number | undefined) ?? 1,
          };
        });

      const applyUnderground = (on: boolean) => {
        layer.setUndergroundMode(on);
        for (const d of dimmable) {
          map.setPaintProperty(
            d.id,
            d.prop,
            on ? Math.min(d.original, UNDERGROUND_BASEMAP_OPACITY) : d.original,
          );
        }
        map.triggerRepaint();
      };
      applyUnderground(useAppStore.getState().undergroundMode);
      layer.setShadowsEnabled(useAppStore.getState().shadowsEnabled);
      // Seed line visibility from any hiddenRoutes already in the store at
      // mount — the subscription below only reacts to CHANGES, so without
      // this a remount with pre-existing hidden routes (a React StrictMode
      // double-invoke, or future persistence) would render every line
      // visible until the next toggle (finding 6c).
      {
        const initialHidden = useAppStore.getState().hiddenRoutes;
        for (let i = 0; i < net.lines.length; i++) {
          const visible = !initialHidden.includes(i);
          layer.setLineVisible(i, visible);
          vehicleManager.setRouteVisible(i, visible);
        }
      }

      // Basemap day/night theming (Task 10b, human-added scope beyond
      // SRS F3.3): `skyPalette` already re-lights the Three.js layer from
      // the sim clock, but the MapLibre basemap itself kept its daytime
      // colours at 02:00. This snapshots each themeable layer's *original*
      // colour once — same discipline as `dimmable` above — and every
      // later tick blends from that original toward the night target, never
      // from the layer's current (already-blended) value, or the blend
      // would compound every tick and drift the whole map to black.
      // Colours only: this never touches a `*-opacity` paint property —
      // that stays `dimmable`'s and `applyUnderground`'s alone.
      type ThemeRole = keyof BasemapTheme;
      type ColorProp =
        | "background-color"
        | "fill-color"
        | "fill-extrusion-color"
        | "line-color"
        | "text-color"
        | "text-halo-color";
      // `lastApplied` tracks the most recent value actually written to this
      // layer (starts at `original`, i.e. nothing written yet) so a tick
      // whose blended colour hasn't actually changed since the last write
      // can skip the setPaintProperty call entirely — near full day/night
      // the blend saturates for many layers well before `t` itself stops
      // moving, and Liberty has 100+ themeable layers, so at up to 2 Hz
      // (more at high time-warp, where the bucket can change nearly every
      // tick) that redundant-write elimination cuts most of the property
      // writes (perf note on finding 7).
      const themeable: { id: string; prop: ColorProp; role: ThemeRole; original: string; lastApplied: string }[] =
        [];
      let skippedExpressionLayers = 0;
      const captureThemeable = (id: string, prop: ColorProp, role: ThemeRole) => {
        const raw = map.getPaintProperty(id, prop);
        if (raw === undefined) return; // no override on this layer; nothing to theme
        if (typeof raw !== "string" || parseColor(raw) === null) {
          // MapLibre expression (array) or stop-function (object), or a CSS
          // colour syntax outside what parseColor supports (e.g. a named
          // colour) — cannot be interpolated this way, so leave it alone.
          skippedExpressionLayers++;
          return;
        }
        themeable.push({ id, prop, role, original: raw, lastApplied: raw });
      };
      for (const l of map.getStyle().layers) {
        if (l.type === "background") captureThemeable(l.id, "background-color", "background");
        else if (l.type === "fill")
          captureThemeable(l.id, "fill-color", l.id.includes("water") ? "water" : "land");
        else if (l.type === "fill-extrusion")
          captureThemeable(l.id, "fill-extrusion-color", "building");
        else if (l.type === "line") captureThemeable(l.id, "line-color", "road");
        else if (l.type === "symbol") {
          captureThemeable(l.id, "text-color", "labelText");
          captureThemeable(l.id, "text-halo-color", "labelHalo");
        }
      }
      if (import.meta.env.DEV) {
        console.info(
          `[basemapTheme] ${themeable.length} layer paint properties themeable, ` +
            `${skippedExpressionLayers} skipped (expression/stop-function/unsupported colour syntax)`,
        );
      }

      let lastNightBucket = -1;
      const applyBasemapTheme = (elevationDeg: number) => {
        const t = nightFactor(elevationDeg);
        // Quantised to avoid dozens of no-op setPaintProperty calls a
        // second while the sun barely moves (e.g. deep night or midday).
        const bucket = Math.round(t * 200);
        if (bucket === lastNightBucket) return;
        lastNightBucket = bucket;
        // Blend each layer's captured original directly to the fixed night
        // target — `t` applied exactly once. (An earlier version blended
        // through an elevation-dependent `basemapTheme(elevationDeg)`,
        // which was itself already a day/night blend by `t`; composing the
        // two applied `t` twice, pulling mid-transition colours toward a
        // generic hardcoded reference that should never reach the map —
        // see basemapTheme.ts's NIGHT_THEME doc comment.)
        for (const entry of themeable) {
          const next = mixColor(entry.original, NIGHT_THEME[entry.role], t);
          if (next === entry.lastApplied) continue; // saturated already — skip the redundant write
          entry.lastApplied = next;
          map.setPaintProperty(entry.id, entry.prop, next);
        }
      };

      // Finding 7: an escape hatch for the basemap night theme — it is the
      // mechanism behind a previously reported night-legibility defect, and
      // without this a user hitting a variant on some display combination
      // has no way out short of scrubbing the clock to noon. Restores every
      // themed layer to its captured original colour and resets the bucket
      // so re-enabling recomputes from a clean slate rather than skipping a
      // write because `lastApplied` still holds a stale blended value.
      const restoreBasemapTheme = () => {
        for (const entry of themeable) {
          map.setPaintProperty(entry.id, entry.prop, entry.original);
          entry.lastApplied = entry.original;
        }
        lastNightBucket = -1;
      };
      if (!useAppStore.getState().nightThemeEnabled) restoreBasemapTheme();

      // Visibility is UI state, so it drives the scene through a subscription
      // rather than the per-frame path.
      unsubscribeVisibility = useAppStore.subscribe((state, prev) => {
        if (state.hiddenRoutes !== prev.hiddenRoutes) {
          for (let i = 0; i < net.lines.length; i++) {
            const visible = !state.hiddenRoutes.includes(i);
            layer.setLineVisible(i, visible);
            vehicleManager.setRouteVisible(i, visible);
          }
          map.triggerRepaint();
        }
        if (state.undergroundMode !== prev.undergroundMode) {
          applyUnderground(state.undergroundMode);
        }
        if (state.shadowsEnabled !== prev.shadowsEnabled) {
          layer.setShadowsEnabled(state.shadowsEnabled);
          map.triggerRepaint();
        }
        if (state.nightThemeEnabled !== prev.nightThemeEnabled) {
          if (state.nightThemeEnabled) {
            lastNightBucket = -1; // force the next updateSun tick to recompute and apply
          } else {
            restoreBasemapTheme();
          }
          map.triggerRepaint();
        }
      });

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

      // Per-frame path: interpolate + pose instances inside the layer's
      // render(), entirely outside React.
      layer.beforeRender = () => {
        const client = activeSimClient.current;
        if (!client) return;
        const { vehicles, count } = client.getInterpolated(performance.now());
        const { selectedRunIdx, following } = useAppStore.getState();
        vehicleManager.update(vehicles, count, selectedRunIdx);
        // Read the follow target here (the buffer is already in hand) but move
        // the camera in the rAF loop — jumpTo() inside render() re-enters
        // MapLibre's render path.
        follow.capture(vehicles, count, following ? selectedRunIdx : null);
        lastVehicles = vehicles;
        lastCount = count;
      };

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
        layer.setSun(dir, skyPalette(dir.elevationDeg));
        // Gated by the opt-out (finding 7) — Three.js scene lighting above
        // is unconditional (SRS §F3.3), only the separately-added MapLibre
        // basemap colour theme (Task 10b) can be turned off.
        if (useAppStore.getState().nightThemeEnabled) applyBasemapTheme(dir.elevationDeg);
      };

      // MapLibre only repaints on demand — keep frames coming while the
      // engine is running.
      const loop = () => {
        if (useAppStore.getState().engineStatus === "ready") {
          updateSun(performance.now());
          follow.apply(map);
          map.triggerRepaint();
        }
        rafId = requestAnimationFrame(loop);
      };
      rafId = requestAnimationFrame(loop);

      if (disposed) {
        // Cleanup already ran before this fired — tear down what it missed
        // instead of leaking a running rAF loop, worker and subscription.
        cancelAnimationFrame(rafId);
        unsubscribeVisibility?.();
        sim?.dispose();
        if (activeSimClient.current === sim) activeSimClient.current = null;
      }
    });

    // Click to select a train or station. Uses the most recent interpolated
    // buffer — the same poses that are on screen.
    const onMapClick = (e: { point: { x: number; y: number } }) => {
      const { stations, selectRun, selectStation, hiddenRoutes } = useAppStore.getState();
      const hit = pickAt(map, lastVehicles, lastCount, stations, e.point, hiddenRoutes);
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

    // Panning while following would fight the per-frame jumpTo, so the first
    // user drag hands control back (Mini Tokyo 3D does the same).
    const onDragStart = () => {
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

    // Dev builds always expose these; a production build (tools/verify-perf.mjs
    // runs against `npm run preview`, i.e. a real prod bundle — dev-mode React
    // and unminified Three would make the NF1 numbers meaningless) exposes them
    // too, but only when opted in via `?debug=1`, so ordinary production
    // visitors never get debug globals on `window`.
    const debugRequested =
      typeof window !== "undefined" && new URLSearchParams(window.location.search).get("debug") === "1";
    if (import.meta.env.DEV || debugRequested) {
      // dev/debug-only handles for tools/screenshot.mjs and tools/verify-*.mjs
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
      removeCameraControls();
      unsubscribeFollow();
      unsubscribeVisibility?.();
      map.off("click", onMapClick);
      map.off("dragstart", onDragStart);
      window.removeEventListener("keydown", onKeyDown);
      activeSimClient.current = null;
      sim?.dispose();
      map.remove();
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
