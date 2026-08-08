import { create } from "zustand";
import type { BasemapStyleKey } from "../map/basemapStyles";
import type { ThemeMode } from "../map/themeMode";
import type { StationInfo, ValidationSummary } from "../sim/protocol";
import type { ClockParams } from "../sim/SimClient";
import type { LineGeometry } from "../types";

/**
 * UI-facing state only (SRS §3A.7): per-frame render/kinematic state must
 * never live here — Zustand state changes trigger React re-renders. Vehicle
 * buffers stay inside SimClient/VehicleManager; only slow-changing engine
 * status, clock params (rebased on warp change) and a 1 Hz-throttled vehicle
 * count pass through the store (ENGINE_CONTRACT.md §6).
 */

export type EngineStatus = "off" | "loading" | "ready" | "error";
export type Warp = 1 | 5 | 10 | 60;

interface AppState {
  mapReady: boolean;
  setMapReady: (ready: boolean) => void;

  engineStatus: EngineStatus;
  engineError: string | null;
  setEngineStatus: (status: EngineStatus, error?: string) => void;

  validation: ValidationSummary | null;
  setValidation: (validation: ValidationSummary | null) => void;

  /** Sim clock params — simNow = clockEpochMs + (perfNow - clockSetAt) * warp. */
  warp: Warp;
  clockEpochMs: number;
  clockSetAt: number;
  setClock: (params: ClockParams) => void;

  /** Throttled to 1 Hz by MapContainer — never per-frame. */
  vehicleCount: number;
  setVehicleCount: (count: number) => void;

  // ---- MVP 4 selection (UI-derived; the pose itself stays out of here) ----

  /** Selected train, identified by its run index (vehicle lane 5). */
  selectedRunIdx: number | null;
  /** Selected station, as the indices the engine's board query takes. */
  selectedStation: { routeIdx: number; stationIdx: number } | null;
  /** Third-person camera locked to the selected train (F3.2). */
  following: boolean;

  /** Selecting a train clears any station selection, and vice versa; either
   *  also closes an open search panel — see `setSearchOpen`'s own comment
   *  for why these three are kept mutually exclusive. */
  selectRun: (runIdx: number | null) => void;
  selectStation: (station: { routeIdx: number; stationIdx: number } | null) => void;
  setFollowing: (following: boolean) => void;

  /** Static station list from the engine, fetched once at ready. */
  stations: StationInfo[];
  setStations: (stations: StationInfo[]) => void;

  // ---- MVP 5 line visibility (F4.1) ----

  /** Line table from network.json, index == route_idx. */
  routes: LineGeometry[];
  setRoutes: (routes: LineGeometry[]) => void;

  /** Route indices the user has switched off (F4.1). Array, not Set —
   *  Zustand equality checks are reference-based and a Set mutated in place
   *  would not re-render. */
  hiddenRoutes: number[];
  toggleRoute: (routeIdx: number) => void;
  isRouteVisible: (routeIdx: number) => boolean;

  // ---- MVP 6 view modes (F3.2 / §3A.5) ----

  /** Underground transparency: dim the basemap and the surface network so
   *  sub-surface track is the subject (SRS §F3.2). */
  undergroundMode: boolean;
  setUndergroundMode: (on: boolean) => void;

  /** Shadow quality toggle — off by default for the 30-FPS mobile target. */
  shadowsEnabled: boolean;
  setShadowsEnabled: (on: boolean) => void;

  /** Tri-state day/night appearance (roadmap item 21). `auto` is the
   *  clock-driven SRS F3.3 behaviour and the default; `light`/`dark` pin it.
   *  Replaces MVP 6's `nightThemeEnabled` boolean — that flag's "off" was
   *  always really "light", and a user who wanted a permanently dark map had
   *  no way to ask for one short of scrubbing the clock to midnight. */
  themeMode: ThemeMode;
  setThemeMode: (mode: ThemeMode) => void;

  /** Mobile-only "hide UI" toggle: collapses every overlay panel to leave an
   *  unobstructed map. No effect at the `md:` desktop layout, which has no
   *  panel-overlap problem to escape. */
  uiHidden: boolean;
  setUiHidden: (hidden: boolean) => void;

  /** Which key-free vector basemap is loaded (roadmap item 21). Changing it
   *  calls map.setStyle(), which destroys and rebuilds the Three custom
   *  layer — see src/map/styleBinding.ts for what is re-created and what is
   *  deliberately not. */
  basemapStyle: BasemapStyleKey;
  setBasemapStyle: (key: BasemapStyleKey) => void;

  /** Eco mode: drop the render loop and the worker tick to ~1 Hz to save
   *  power (roadmap item 2). Off by default. */
  ecoMode: boolean;
  setEcoMode: (on: boolean) => void;

  /** Station search panel (roadmap item 3). Kept mutually exclusive with a
   *  train/station selection, the same way `selectRun`/`selectStation`
   *  already exclude each other: opening search clears any existing
   *  selection (and drops `following`), and selecting a train or station
   *  closes an open search panel. Without this, `StationSearch` could stack
   *  on top of an already-open `TrainInspector`/`StationBoard` and overflow
   *  the mobile bottom-sheet stack. */
  searchOpen: boolean;
  setSearchOpen: (open: boolean) => void;

  /** One-shot camera-jump request from station search / nearest-station
   *  selection. `window.__map` is dev/debug-only, so this store field is how
   *  a UI action reaches MapContainer.tsx's real MapLibre instance. Cleared
   *  immediately after MapContainer's subscribe handler consumes it — this
   *  is a UI-rate one-shot event, not per-frame state (§3A.7 doesn't apply). */
  flyToRequest: { lng: number; lat: number } | null;
  requestFlyTo: (target: { lng: number; lat: number }) => void;
  clearFlyToRequest: () => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  mapReady: false,
  setMapReady: (ready) => set({ mapReady: ready }),

  engineStatus: "off",
  engineError: null,
  setEngineStatus: (status, error) => set({ engineStatus: status, engineError: error ?? null }),

  validation: null,
  setValidation: (validation) => set({ validation }),

  warp: 1,
  clockEpochMs: Date.now(),
  clockSetAt: 0,
  setClock: ({ clockEpochMs, clockSetAt, warp }) =>
    set({ clockEpochMs, clockSetAt, warp: warp as Warp }),

  vehicleCount: 0,
  setVehicleCount: (count) => set({ vehicleCount: count }),

  selectedRunIdx: null,
  selectedStation: null,
  following: false,

  selectRun: (runIdx) =>
    set(
      runIdx === null
        ? { selectedRunIdx: null, following: false }
        : { selectedRunIdx: runIdx, selectedStation: null, searchOpen: false },
    ),
  selectStation: (station) =>
    set(
      station === null
        ? { selectedStation: null }
        : { selectedStation: station, selectedRunIdx: null, following: false, searchOpen: false },
    ),
  setFollowing: (following) => set({ following }),

  stations: [],
  setStations: (stations) => set({ stations }),

  routes: [],
  setRoutes: (routes) => set({ routes }),

  hiddenRoutes: [],
  toggleRoute: (routeIdx) =>
    set((s) => ({
      hiddenRoutes: s.hiddenRoutes.includes(routeIdx)
        ? s.hiddenRoutes.filter((r) => r !== routeIdx)
        : [...s.hiddenRoutes, routeIdx],
    })),
  isRouteVisible: (routeIdx) => !get().hiddenRoutes.includes(routeIdx),

  undergroundMode: false,
  setUndergroundMode: (on) => set({ undergroundMode: on }),

  shadowsEnabled: false,
  setShadowsEnabled: (on) => set({ shadowsEnabled: on }),

  themeMode: "auto",
  setThemeMode: (mode) => set({ themeMode: mode }),

  uiHidden: false,
  setUiHidden: (hidden) => set({ uiHidden: hidden }),

  basemapStyle: "liberty",
  setBasemapStyle: (key) => set({ basemapStyle: key }),

  ecoMode: false,
  setEcoMode: (on) => set({ ecoMode: on }),

  searchOpen: false,
  setSearchOpen: (open) =>
    set(
      open
        ? { searchOpen: true, selectedStation: null, selectedRunIdx: null, following: false }
        : { searchOpen: false },
    ),

  flyToRequest: null,
  requestFlyTo: (target) => set({ flyToRequest: target }),
  clearFlyToRequest: () => set({ flyToRequest: null }),
}));
