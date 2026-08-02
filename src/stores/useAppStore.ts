import { create } from "zustand";
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

  /** Selecting a train clears any station selection, and vice versa. */
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

  /** Basemap day/night colour theming (Task 10b) opt-out. On by default;
   *  the escape hatch exists because it is the mechanism behind a previously
   *  reported night-legibility defect, and a user hitting a variant on
   *  different hardware otherwise has no way out short of scrubbing to noon
   *  (finding 7). Forward-compatible with the tri-state Auto/Light/Dark
   *  scoped for MVP 7 — "off" becomes "Light" later. */
  nightThemeEnabled: boolean;
  setNightThemeEnabled: (on: boolean) => void;
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
        : { selectedRunIdx: runIdx, selectedStation: null },
    ),
  selectStation: (station) =>
    set(
      station === null
        ? { selectedStation: null }
        : { selectedStation: station, selectedRunIdx: null, following: false },
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

  nightThemeEnabled: true,
  setNightThemeEnabled: (on) => set({ nightThemeEnabled: on }),
}));
