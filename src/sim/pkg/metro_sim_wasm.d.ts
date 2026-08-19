/* tslint:disable */
/* eslint-disable */

export class Engine {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Evaluates into the internal buffer and copies into `out` (a JS-owned
     * Float32Array view of length >= MAX_VEHICLES*8). Returns vehicle count.
     */
    evaluate(date_yyyymmdd: number, sec_of_day: number, out: Float32Array): number;
    /**
     * True if the most recent `evaluate()` call hit `MAX_VEHICLES` and
     * dropped vehicles (contract §3) — call right after `evaluate()`, before
     * any other call that might re-evaluate the world.
     */
    last_truncated(): boolean;
    constructor(cache_bytes: Uint8Array);
    /**
     * `RoutePlan` as JSON, or `"null"` for a structurally invalid request
     * (bad route/station index). A well-formed request that simply does not
     * connect comes back as a real plan with `unreachable: true` — the two
     * are different answers and the UI says different things for each.
     *
     * Nine parameters is past clippy's threshold, and accepted here: this is
     * ONE UI-rate call per submit, and introducing a second serialization
     * boundary just to pack the arguments would cost more than it saves.
     * NOTE this is the FIRST `too_many_arguments` allow in this crate — the
     * design spec claimed an existing precedent, and there wasn't one.
     */
    plan_route_json(from_route_idx: number, from_station_idx: number, to_route_idx: number, to_station_idx: number, date_yyyymmdd: number, sec_of_day: number, max_transfers: number, max_wait_s: number, transfer_buffer_s: number): string;
    /**
     * `RunDetail` as JSON, or `"null"` when the run is not live at that time.
     */
    run_detail_json(run_idx: number, date_yyyymmdd: number, sec_of_day: number): string;
    /**
     * `StationBoard` as JSON, or `"null"` for unknown route/station indices.
     */
    station_board_json(route_idx: number, station_idx: number, date_yyyymmdd: number, sec_of_day: number, limit: number): string;
    /**
     * All stations with ENU positions, as JSON. Fetched once after init.
     */
    stations_json(): string;
    /**
     * ValidationSummary as JSON (stations/patterns/runs/services/feed_version).
     */
    validation_json(): string;
}

export function max_vehicles(): number;

/**
 * Layout constants mirrored in src/sim/protocol.ts.
 */
export function vehicle_stride(): number;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_engine_free: (a: number, b: number) => void;
    readonly engine_evaluate: (a: number, b: number, c: number, d: number, e: number, f: any) => number;
    readonly engine_last_truncated: (a: number) => number;
    readonly engine_new: (a: number, b: number) => [number, number, number];
    readonly engine_plan_route_json: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number) => [number, number];
    readonly engine_run_detail_json: (a: number, b: number, c: number, d: number) => [number, number];
    readonly engine_station_board_json: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
    readonly engine_stations_json: (a: number) => [number, number];
    readonly engine_validation_json: (a: number) => [number, number];
    readonly max_vehicles: () => number;
    readonly vehicle_stride: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
