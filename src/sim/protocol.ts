/**
 * Worker protocol + flat vehicle-buffer layout (ENGINE_CONTRACT.md §3/§5).
 * These constants MUST mirror rust-engine/sim-core exactly.
 */

/** Worker tick cadence, ms. 10 Hz is the MVP 3 baseline (ENGINE_CONTRACT §5). */
export const DEFAULT_TICK_MS = 100;
/** Eco-mode cadence, ms. ~1 Hz. Safe because engine positions are a pure
 *  function of time — nothing integrates, so nothing drifts while throttled
 *  and un-throttling snaps straight back to the correct pose. */
export const ECO_TICK_MS = 1000;

/** f32 lanes per vehicle record. */
export const VEHICLE_STRIDE = 8;
/** Must mirror `MAX_VEHICLES` in rust-engine/sim-core/src/world.rs (source of
 * truth) — they size the transferable frame buffer together (FRAME_BYTES). */
export const MAX_VEHICLES = 1024;

/** Floats / bytes per frame buffer. */
export const FRAME_FLOATS = MAX_VEHICLES * VEHICLE_STRIDE;
export const FRAME_BYTES = FRAME_FLOATS * 4;

// Vehicle record lanes (contract §3 table).
export const LANE_X = 0; // east meters (local ENU frame)
export const LANE_Y = 1; // north meters
export const LANE_Z = 2; // up meters
export const LANE_YAW = 3; // radians CCW from +x (east), direction of travel
export const LANE_STATE = 4; // 0 = dwelling, 1 = in transit
export const LANE_RUN_IDX = 5; // index into CacheDoc.runs
export const LANE_ROUTE_IDX = 6; // 0 = Sukhumvit, 1 = Silom
export const LANE_PROGRESS = 7; // 0..1 smoothed leg progress

/** Parsed + camelCased form of Engine.validation_json() (contract §8 DoD). */
export interface ValidationSummary {
  feedVersion: string;
  routes: number;
  stations: number;
  patterns: number;
  runs: number;
  services: number;
}

// ---- UI-rate schedule queries (contract §7) --------------------------------
// Shapes below are the Rust serde output verbatim (snake_case) — see
// sim-core/src/query.rs. They are requested on selection or at ~1 Hz and MUST
// NOT be called on the frame path.

/** One scheduled call, seconds since the run's service-day midnight. */
export interface StopCall {
  station_idx: number;
  code: string;
  name_en: string;
  name_th: string;
  arrival_sec: number;
  departure_sec: number;
}

/** Everything the train inspector shows for one active run. */
export interface RunDetail {
  run_idx: number;
  route_idx: number;
  route_name: string;
  color_rgb: number;
  headsign: string;
  direction: number;
  origin: string;
  destination: string;
  /** 0 = dwelling, 1 = in transit — matches vehicle lane 4. */
  state: number;
  at_station: string | null;
  prev_station: string | null;
  next_station: string | null;
  next_arrival_in_s: number | null;
  next_stop_ordinal: number | null;
  /** Index into `stops` of the call being dwelt at; null while in transit. */
  current_stop_ordinal: number | null;
  stops: StopCall[];
}

/** One upcoming call on a station board. */
export interface BoardEntry {
  run_idx: number;
  route_idx: number;
  headsign: string;
  destination: string;
  direction: number;
  arrival_sec: number;
  departure_sec: number;
  in_s: number;
}

export interface StationBoard {
  route_idx: number;
  station_idx: number;
  code: string;
  name_en: string;
  name_th: string;
  entries: BoardEntry[];
}

/** A walking connection to another route's station (contract §7). */
export interface InterchangeRef {
  route_idx: number;
  station_idx: number;
}

/** Station with its ENU position, for click hit-testing. */
export interface StationInfo {
  route_idx: number;
  station_idx: number;
  code: string;
  name_en: string;
  name_th: string;
  arc_m: number;
  x: number;
  y: number;
  z: number;
  interchanges: InterchangeRef[];
}

/** Query request payloads (main -> worker). */
export type SimQuery =
  | { kind: "runDetail"; runIdx: number; simEpochMs: number }
  | { kind: "stationBoard"; routeIdx: number; stationIdx: number; simEpochMs: number; limit: number }
  | { kind: "stations" };

/** Query result payloads (worker -> main), keyed by request id. */
export type SimQueryResult =
  | { kind: "runDetail"; detail: RunDetail | null }
  | { kind: "stationBoard"; board: StationBoard | null }
  | { kind: "stations"; stations: StationInfo[] };

/** Raw snake_case shape emitted by the Rust side; the worker maps it. */
export interface ValidationSummaryRaw {
  feed_version: string;
  routes: number;
  stations: number;
  patterns: number;
  runs: number;
  services: number;
}

// Main -> worker. NOTE deviation from contract §5: `wasmUrl` is dropped from
// "init" — the worker statically imports the pkg, so the .wasm URL resolves
// via the pkg's own `new URL("metro_sim_wasm_bg.wasm", import.meta.url)`.
export type MainToWorker =
  | { kind: "init"; cache: ArrayBuffer } // cache transferred
  | { kind: "clock"; epochMs: number; warp: number } // set/replace clock
  | { kind: "returnBuffer"; buffer: ArrayBuffer } // recycle (transferred)
  | { kind: "query"; id: number; query: SimQuery }
  | { kind: "tickRate"; tickMs: number } // eco mode: re-cadence the sim loop
  | { kind: "stop" };

// Worker -> main.
export type WorkerToMain =
  | { kind: "ready"; validation: ValidationSummary }
  | { kind: "error"; message: string }
  | {
      kind: "frame";
      simEpochMs: number;
      count: number;
      evalMs: number;
      truncated: boolean;
      buffer: ArrayBuffer;
    } // transferred
  | { kind: "queryResult"; id: number; result: SimQueryResult }
  | { kind: "queryError"; id: number; message: string };
