import { create } from "zustand";
import type { BasemapStyleKey } from "../map/basemapStyles";
import type { ThemeMode } from "../map/themeMode";
import type { RoutePlan, StationInfo, ValidationSummary } from "../sim/protocol";
import type { ClockParams } from "../sim/SimClient";
import type { LineGeometry } from "../types";
import { type TrainScale, loadTrainScale, saveTrainScale } from "../map/trainScale";
import { resolveInitialLanguage, savePrimaryLang } from "../i18n/persistence";

/**
 * UI-facing state only (SRS §3A.7): per-frame render/kinematic state must
 * never live here — Zustand state changes trigger React re-renders. Vehicle
 * buffers stay inside SimClient/VehicleManager; only slow-changing engine
 * status, clock params (rebased on warp change) and a 1 Hz-throttled vehicle
 * count pass through the store (ENGINE_CONTRACT.md §6).
 */

export type EngineStatus = "off" | "loading" | "ready" | "error";
export type Warp = 1 | 5 | 10 | 60;
export type NavigationTab = "lines" | "stations" | "route" | "about";
export type PrimaryLanguage = "en" | "th";
export type SheetDetent = "peek" | "half" | "full";

interface AppState {
  primaryLang: PrimaryLanguage;
  setPrimaryLang: (lang: PrimaryLanguage) => void;
  togglePrimaryLang: () => void;

  sheetDetent: SheetDetent;
  setSheetDetent: (detent: SheetDetent) => void;
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

  // ---- Navigation Tabs ----

  /** Active navigation tab. Default is "lines", or null when collapsed. */
  activeTab: NavigationTab | null;
  setActiveTab: (tab: NavigationTab | null) => void;
  toggleTab: (tab: NavigationTab) => void;

  /** 3D perspective (pitch 55°) vs 2D top-down (pitch 0°) view mode. Default true. */
  map3D: boolean;
  setMap3D: (on: boolean) => void;
  toggleMap3D: () => void;

  // ---- Selection (UI-derived; the pose itself stays out of here) ----

  /** Selected train, identified by its run index (vehicle lane 5). */
  selectedRunIdx: number | null;
  /** Selected station, as the indices the engine's board query takes. */
  selectedStation: { routeIdx: number; stationIdx: number } | null;
  /** Third-person camera locked to the selected train (F3.2). */
  following: boolean;

  selectRun: (runIdx: number | null) => void;
  selectStation: (station: { routeIdx: number; stationIdx: number } | null) => void;
  clearSelection: () => void;
  setFollowing: (following: boolean) => void;

  /** Static station list from the engine, fetched once at ready. */
  stations: StationInfo[];
  setStations: (stations: StationInfo[]) => void;

  // ---- Line visibility (F4.1) ----

  /** Line table from network.json, index == route_idx. */
  routes: LineGeometry[];
  setRoutes: (routes: LineGeometry[]) => void;

  /** Route indices the user has switched off (F4.1). */
  hiddenRoutes: number[];
  toggleRoute: (routeIdx: number) => void;
  isRouteVisible: (routeIdx: number) => boolean;

  // ---- View modes (F3.2 / §3A.5) ----

  /** Underground transparency: dim the basemap and the surface network so
   *  sub-surface track is the subject (SRS §F3.2). */
  undergroundMode: boolean;
  setUndergroundMode: (on: boolean) => void;

  /** Shadow quality toggle — off by default for the 30-FPS mobile target. */
  shadowsEnabled: boolean;
  setShadowsEnabled: (on: boolean) => void;

  /** Tri-state day/night appearance (roadmap item 21). */
  themeMode: ThemeMode;
  setThemeMode: (mode: ThemeMode) => void;

  /** Mobile-only "hide UI" toggle: collapses every overlay panel. */
  uiHidden: boolean;
  setUiHidden: (hidden: boolean) => void;

  /** Which key-free vector basemap is loaded (roadmap item 21). */
  basemapStyle: BasemapStyleKey;
  setBasemapStyle: (key: BasemapStyleKey) => void;

  /** Eco mode: drop the render loop and the worker tick to ~1 Hz to save
   *  power (roadmap item 2). Off by default. */
  ecoMode: boolean;
  setEcoMode: (on: boolean) => void;

  /** Train model scale (GitHub issue #5). Default 1 (1x realistic scale). */
  trainScale: TrainScale;
  setTrainScale: (scale: TrainScale) => void;

  /** Station search panel open status. */
  searchOpen: boolean;
  setSearchOpen: (open: boolean) => void;

  /** Route planner panel open status. */
  routePlannerOpen: boolean;
  setRoutePlannerOpen: (open: boolean) => void;

  /** The plan currently being shown, or null. */
  routePlan: RoutePlan | null;
  setRoutePlan: (plan: RoutePlan | null) => void;

  /** One-shot camera-jump request (bridge contract §4). Consumed and cleared by MapContainer.
   *  Includes the full BridgeState.cameraFlightRequest payload. */
  cameraFlightRequest: { lng: number; lat: number; altitudeM?: number; zoom?: number; pitch?: number; bearing?: number } | null;
  requestFlyTo: (target: { lng: number; lat: number; altitudeM?: number; zoom?: number; pitch?: number; bearing?: number }) => void;
  clearFlyToRequest: () => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  primaryLang: resolveInitialLanguage(),
  setPrimaryLang: (lang) => {
    savePrimaryLang(lang);
    set({ primaryLang: lang });
  },
  togglePrimaryLang: () =>
    set((s) => {
      const next = s.primaryLang === "en" ? "th" : "en";
      savePrimaryLang(next);
      return { primaryLang: next };
    }),

  sheetDetent: "peek",
  setSheetDetent: (detent) => set({ sheetDetent: detent }),

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

  activeTab: "lines",
  setActiveTab: (tab) =>
    set((s) => ({
      activeTab: tab,
      searchOpen: tab === "stations",
      routePlannerOpen: tab === "route",
      ...(tab !== null ? { selectedRunIdx: null, selectedStation: null, following: false } : {}),
      ...(tab !== "route" && s.routePlan ? { routePlan: null } : {}),
    })),
  toggleTab: (tab) => {
    const current = get().activeTab;
    const next = current === tab ? null : tab;
    get().setActiveTab(next);
  },

  map3D: true,
  setMap3D: (on) => set({ map3D: on }),
  toggleMap3D: () => set((s) => ({ map3D: !s.map3D })),

  selectedRunIdx: null,
  selectedStation: null,
  following: false,

  selectRun: (runIdx) =>
    set(
      runIdx === null
        ? { selectedRunIdx: null, following: false }
        : {
            selectedRunIdx: runIdx,
            selectedStation: null,
            searchOpen: false,
            routePlannerOpen: false,
            routePlan: null,
          },
    ),
  selectStation: (station) =>
    set(
      station === null
        ? { selectedStation: null }
        : {
            selectedStation: station,
            selectedRunIdx: null,
            following: false,
            searchOpen: false,
            routePlannerOpen: false,
            routePlan: null,
          },
    ),
  clearSelection: () =>
    set({
      selectedRunIdx: null,
      selectedStation: null,
      following: false,
    }),
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

  trainScale: loadTrainScale(),
  setTrainScale: (scale) => {
    saveTrainScale(scale);
    set({ trainScale: scale });
  },

  searchOpen: false,
  setSearchOpen: (open) =>
    set((s) => ({
      searchOpen: open,
      activeTab: open ? "stations" : s.activeTab === "stations" ? null : s.activeTab,
      ...(open
        ? {
            selectedStation: null,
            selectedRunIdx: null,
            following: false,
            routePlannerOpen: false,
            routePlan: null,
          }
        : {}),
    })),

  routePlannerOpen: false,
  setRoutePlannerOpen: (open) =>
    set((s) => ({
      routePlannerOpen: open,
      activeTab: open ? "route" : s.activeTab === "route" ? null : s.activeTab,
      ...(open
        ? {
            searchOpen: false,
            selectedStation: null,
            selectedRunIdx: null,
            following: false,
          }
        : { routePlan: null }),
    })),

  routePlan: null,
  setRoutePlan: (plan) => set({ routePlan: plan }),

  cameraFlightRequest: null,
  requestFlyTo: (target) => set({ cameraFlightRequest: target }),
  clearFlyToRequest: () => set({ cameraFlightRequest: null }),
}));
