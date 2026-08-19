import init, { Engine } from "./pkg/metro_sim_wasm";
import {
  DEFAULT_TICK_MS,
  ECO_TICK_MS,
  FRAME_BYTES,
  DEFAULT_MAX_TRANSFERS,
  DEFAULT_MAX_WAIT_S,
  DEFAULT_TRANSFER_BUFFER_S,
  type MainToWorker,
  type RunDetail,
  type SimQuery,
  type SimQueryResult,
  type StationBoard,
  type StationInfo,
  type ValidationSummary,
  type ValidationSummaryRaw,
  type WorkerToMain,
  type RoutePlan,
} from "./protocol";

/**
 * Dedicated module worker running the wasm sim engine (ENGINE_CONTRACT.md §5).
 *
 * Fixed-cadence loop at 10 Hz REAL time; each tick evaluates the schedule at
 * the current warped sim time and posts a transferable frame buffer from a
 * fixed ping-pong pool (never allocates unboundedly, never blocks). The main
 * thread interpolates between frames at render time (SRS §3A.7).
 */

const POOL_SIZE = 3;
/** Asia/Bangkok is fixed UTC+7, no DST — a constant offset is exact. */
const BANGKOK_OFFSET_MS = 7 * 3_600_000;

let engine: Engine | null = null;
let timer: number | null = null;
/** Mutable worker tick cadence (ms), re-armable via a "tickRate" message
 *  (eco mode). Starts at the MVP 3 baseline, 10 Hz. */
let tickMs: number = DEFAULT_TICK_MS;
const pool: ArrayBuffer[] = [];

// Sim clock: simEpochMs = clockEpochMs + (performance.now() - clockSetAt) * warp.
// The main thread rebases epochMs on warp change so sim time stays continuous.
let clockEpochMs = Date.now();
let clockSetAt = performance.now();
let warp = 1;

// lib.dom types `self` as Window whose postMessage lacks the plain
// (message, transfer[]) worker overload — cast once here.
const post = (msg: WorkerToMain, transfer: Transferable[] = []): void =>
  (self as unknown as { postMessage(m: WorkerToMain, t?: Transferable[]): void }).postMessage(
    msg,
    transfer,
  );

/** Split an epoch-ms instant into the Bangkok service-day fields the engine takes. */
function bangkokFields(simEpochMs: number): { dateYyyymmdd: number; secOfDay: number } {
  // Shift to Bangkok local, then read the wall-clock fields with UTC getters.
  const local = new Date(simEpochMs + BANGKOK_OFFSET_MS);
  return {
    dateYyyymmdd:
      local.getUTCFullYear() * 10_000 + (local.getUTCMonth() + 1) * 100 + local.getUTCDate(),
    secOfDay:
      local.getUTCHours() * 3600 +
      local.getUTCMinutes() * 60 +
      local.getUTCSeconds() +
      local.getUTCMilliseconds() / 1000,
  };
}

function tick(): void {
  if (!engine) return;
  const buffer = pool.pop();
  if (!buffer) return; // pool exhausted (main hasn't returned buffers) — skip tick

  const simEpochMs = clockEpochMs + (performance.now() - clockSetAt) * warp;
  const { dateYyyymmdd, secOfDay } = bangkokFields(simEpochMs);

  const t0 = performance.now();
  const count = engine.evaluate(dateYyyymmdd, secOfDay, new Float32Array(buffer));
  const evalMs = performance.now() - t0;
  const truncated = engine.last_truncated();
  post({ kind: "frame", simEpochMs, count, evalMs, truncated, buffer }, [buffer]);
}

/** UI-rate schedule lookups (contract §7) — never called on the frame path. */
function runQuery(query: SimQuery): SimQueryResult {
  if (!engine) throw new Error("engine not ready");
  switch (query.kind) {
    case "runDetail": {
      const { dateYyyymmdd, secOfDay } = bangkokFields(query.simEpochMs);
      const json = engine.run_detail_json(query.runIdx, dateYyyymmdd, secOfDay);
      return { kind: "runDetail", detail: JSON.parse(json) as RunDetail | null };
    }
    case "stationBoard": {
      const { dateYyyymmdd, secOfDay } = bangkokFields(query.simEpochMs);
      const json = engine.station_board_json(
        query.routeIdx,
        query.stationIdx,
        dateYyyymmdd,
        secOfDay,
        query.limit,
      );
      return { kind: "stationBoard", board: JSON.parse(json) as StationBoard | null };
    }
    case "routePlan": {
      // Same bangkokFields() split every other time-taking query uses — which
      // is what makes the plan come off the SCRUBBED clock, not wall time,
      // with no new machinery.
      const { dateYyyymmdd, secOfDay } = bangkokFields(query.simEpochMs);
      const json = engine.plan_route_json(
        query.fromRouteIdx,
        query.fromStationIdx,
        query.toRouteIdx,
        query.toStationIdx,
        dateYyyymmdd,
        secOfDay,
        query.maxTransfers ?? DEFAULT_MAX_TRANSFERS,
        query.maxWaitS ?? DEFAULT_MAX_WAIT_S,
        query.transferBufferS ?? DEFAULT_TRANSFER_BUFFER_S,
      );
      return { kind: "routePlan", plan: JSON.parse(json) as RoutePlan | null };
    }
    case "stations":
      return { kind: "stations", stations: JSON.parse(engine.stations_json()) as StationInfo[] };
  }
}

async function handleInit(cache: ArrayBuffer): Promise<void> {
  try {
    await init(); // wasm URL resolves inside the pkg via import.meta.url
    engine = new Engine(new Uint8Array(cache));
    const raw = JSON.parse(engine.validation_json()) as ValidationSummaryRaw;
    const validation: ValidationSummary = {
      feedVersion: raw.feed_version,
      routes: raw.routes,
      stations: raw.stations,
      patterns: raw.patterns,
      runs: raw.runs,
      services: raw.services,
    };
    for (let i = 0; i < POOL_SIZE; i++) pool.push(new ArrayBuffer(FRAME_BYTES));
    timer = setInterval(tick, tickMs);
    post({ kind: "ready", validation });
  } catch (err) {
    post({ kind: "error", message: err instanceof Error ? err.message : String(err) });
  }
}

self.onmessage = (event: MessageEvent<MainToWorker>) => {
  const msg = event.data;
  switch (msg.kind) {
    case "init":
      void handleInit(msg.cache);
      break;
    case "clock":
      clockEpochMs = msg.epochMs;
      warp = msg.warp;
      clockSetAt = performance.now();
      break;
    case "returnBuffer":
      pool.push(msg.buffer);
      break;
    case "query":
      try {
        post({ kind: "queryResult", id: msg.id, result: runQuery(msg.query) });
      } catch (err) {
        post({
          kind: "queryError",
          id: msg.id,
          message: err instanceof Error ? err.message : String(err),
        });
      }
      break;
    case "tickRate": {
      // Clamp: a zero or negative interval would spin the worker, and an
      // absurd one would look like a hang.
      const next = Math.max(DEFAULT_TICK_MS, Math.min(msg.tickMs, ECO_TICK_MS));
      if (next === tickMs) break;
      tickMs = next;
      // Only re-arm if the loop is actually running — a tickRate message
      // before init must not start it early.
      if (timer !== null) {
        clearInterval(timer);
        timer = setInterval(tick, tickMs);
      }
      break;
    }
    case "stop":
      if (timer !== null) clearInterval(timer);
      timer = null;
      engine?.free();
      engine = null;
      self.close();
      break;
  }
};
