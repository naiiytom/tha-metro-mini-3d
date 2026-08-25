import {
  DEFAULT_MAX_TRANSFERS,
  DEFAULT_MAX_WAIT_S,
  DEFAULT_TRANSFER_BUFFER_S,
  FRAME_FLOATS,
  LANE_RUN_IDX,
  LANE_YAW,
  MAX_VEHICLES,
  VEHICLE_STRIDE,
  type MainToWorker,
  type RoutePlan,
  type RunDetail,
  type SimQuery,
  type SimQueryResult,
  type StationBoard,
  type StationInfo,
  type ValidationSummary,
  type WorkerToMain,
} from "./protocol";

/**
 * Main-thread wrapper around the sim worker (ENGINE_CONTRACT.md §5).
 *
 * Owns the worker lifecycle, the transferable frame-buffer ping-pong, the
 * warp-rebased sim clock, and render-side interpolation between the two most
 * recent frames. Per-frame data never touches React/Zustand — the render loop
 * calls getInterpolated() directly (SRS §3A.7).
 */

export interface ClockParams {
  clockEpochMs: number;
  clockSetAt: number; // performance.now() timestamp on the MAIN thread
  warp: number;
}

export interface SimClientCallbacks {
  onReady?: (validation: ValidationSummary) => void;
  onError?: (message: string) => void;
  /** Fired per worker frame (10 Hz) — throttle before touching UI state. */
  onFrame?: (simEpochMs: number, count: number) => void;
  /** Fired whenever the clock is (re)based — mirror the params into Zustand. */
  onClock?: (params: ClockParams) => void;
}

interface Frame {
  simEpochMs: number;
  count: number;
  data: Float32Array;
  /** run_idx -> record offset, built lazily for cross-frame matching. */
  byRun: Map<number, number>;
}

const TWO_PI = Math.PI * 2;

/** Give up on a schedule query after this long — see `query()`. */
const QUERY_TIMEOUT_MS = 5_000;

/** Shortest-arc angular delta from a to b, in (-PI, PI]. */
function angleDelta(a: number, b: number): number {
  let d = (b - a) % TWO_PI;
  if (d > Math.PI) d -= TWO_PI;
  if (d < -Math.PI) d += TWO_PI;
  return d;
}

function indexFrame(data: Float32Array, count: number): Map<number, number> {
  const map = new Map<number, number>();
  for (let i = 0; i < count; i++) {
    map.set(data[i * VEHICLE_STRIDE + LANE_RUN_IDX], i * VEHICLE_STRIDE);
  }
  return map;
}

/**
 * Handle to the live SimClient for UI event handlers (TimeControls). Set by
 * MapContainer; null while the engine is down.
 */
export const activeSimClient: { current: SimClient | null } = { current: null };

export class SimClient {
  private worker: Worker;
  private frameA: Frame | null = null; // older
  private frameB: Frame | null = null; // newer
  private clock: ClockParams = { clockEpochMs: Date.now(), clockSetAt: performance.now(), warp: 1 };
  /** Reused output of getInterpolated(). */
  private outVehicles = new Float32Array(FRAME_FLOATS);
  private disposed = false;
  /** In-flight schedule queries, keyed by request id. */
  private pending = new Map<
    number,
    { resolve: (r: SimQueryResult) => void; reject: (e: Error) => void }
  >();
  private nextQueryId = 1;
  /** Last 600 tick durations (~60 s at 10 Hz) for the NF1 harness. */
  private evalSamples: number[] = [];
  private maxCount = 0;
  private everTruncated = false;

  constructor(private callbacks: SimClientCallbacks = {}) {
    this.worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    this.worker.onmessage = (event: MessageEvent<WorkerToMain>) => this.onMessage(event.data);
    this.worker.onerror = (event) => this.callbacks.onError?.(event.message || "worker error");
    void this.load();
  }

  private post(msg: MainToWorker, transfer: Transferable[] = []): void {
    this.worker.postMessage(msg, transfer);
  }

  private async load(): Promise<void> {
    try {
      const res = await fetch("/data/network.tmb");
      if (!res.ok) throw new Error(`network.tmb: HTTP ${res.status}`);
      const cache = await res.arrayBuffer();
      if (this.disposed) return;
      this.post({ kind: "init", cache }, [cache]);
      this.setClock(Date.now(), 1);
    } catch (err) {
      this.callbacks.onError?.(err instanceof Error ? err.message : String(err));
    }
  }

  private onMessage(msg: WorkerToMain): void {
    switch (msg.kind) {
      case "ready":
        this.callbacks.onReady?.(msg.validation);
        break;
      case "error":
        this.callbacks.onError?.(msg.message);
        break;
      case "frame":
        this.acceptFrame(msg.simEpochMs, msg.count, msg.buffer);
        this.recordEval(msg.evalMs, msg.count, msg.truncated);
        this.callbacks.onFrame?.(msg.simEpochMs, msg.count);
        break;
      case "queryResult":
        this.pending.get(msg.id)?.resolve(msg.result);
        this.pending.delete(msg.id);
        break;
      case "queryError":
        this.pending.get(msg.id)?.reject(new Error(msg.message));
        this.pending.delete(msg.id);
        break;
    }
  }

  // ---- schedule queries (contract §7) ------------------------------------

  /**
   * Ask the engine for schedule metadata. UI-rate only — on selection or at
   * ~1 Hz. Never call this from the render loop (§3A.2: the boundary crossing,
   * not the math, is the cost).
   */
  private query(query: SimQuery): Promise<SimQueryResult> {
    if (this.disposed) return Promise.reject(new Error("sim client disposed"));
    const id = this.nextQueryId++;
    return new Promise((resolve, reject) => {
      // A wedged worker would otherwise leave the caller pending forever,
      // which surfaces as a panel stuck on "Loading…" with no signal.
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`sim query "${query.kind}" timed out`));
      }, QUERY_TIMEOUT_MS);
      this.pending.set(id, {
        resolve: (r) => {
          clearTimeout(timer);
          resolve(r);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      try {
        this.post({ kind: "query", id, query });
      } catch (err) {
        // postMessage threw (worker gone): don't leave the entry behind.
        clearTimeout(timer);
        this.pending.delete(id);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  /** Inspector detail for a run; null once the run is no longer live. */
  async getRunDetail(runIdx: number, simEpochMs: number): Promise<RunDetail | null> {
    const r = await this.query({ kind: "runDetail", runIdx, simEpochMs });
    return r.kind === "runDetail" ? r.detail : null;
  }

  /** Upcoming calls at a station, soonest first. */
  async getStationBoard(
    routeIdx: number,
    stationIdx: number,
    simEpochMs: number,
    limit = 8,
  ): Promise<StationBoard | null> {
    const r = await this.query({ kind: "stationBoard", routeIdx, stationIdx, simEpochMs, limit });
    return r.kind === "stationBoard" ? r.board : null;
  }

  /**
   * Plan a journey between two stations at `simEpochMs` — the SCRUBBED sim
   * clock, not wall time, since callers pass `getSimNow()`.
   *
   * Resolves `null` for a structurally invalid request (bad route/station
   * index). A well-formed request that simply does not connect resolves a
   * real plan with `unreachable: true` — the two mean different things and
   * the UI says different things for each, so do not collapse them.
   *
   * UI-rate: one call per submit. Never poll this.
   */
  async getRoutePlan(
    fromRouteIdx: number,
    fromStationIdx: number,
    toRouteIdx: number,
    toStationIdx: number,
    simEpochMs: number,
    opts: { maxTransfers?: number; maxWaitS?: number; transferBufferS?: number } = {},
  ): Promise<RoutePlan | null> {
    const r = await this.query({
      kind: "routePlan",
      fromRouteIdx,
      fromStationIdx,
      toRouteIdx,
      toStationIdx,
      simEpochMs,
      // Resolved here rather than left for the worker's own `??` fallbacks,
      // so the request on the wire fully describes what was planned.
      maxTransfers: opts.maxTransfers ?? DEFAULT_MAX_TRANSFERS,
      maxWaitS: opts.maxWaitS ?? DEFAULT_MAX_WAIT_S,
      transferBufferS: opts.transferBufferS ?? DEFAULT_TRANSFER_BUFFER_S,
    });
    return r.kind === "routePlan" ? r.plan : null;
  }

  /**
   * Plan alternative itineraries between two stations at `simEpochMs`.
   * Resolves empty array `[]` for a structurally invalid request.
   */
  async planAlternatives(
    fromRouteIdx: number,
    fromStationIdx: number,
    toRouteIdx: number,
    toStationIdx: number,
    simEpochMs: number,
    opts: { maxTransfers?: number; maxWaitS?: number; transferBufferS?: number } = {},
  ): Promise<RoutePlan[]> {
    const r = await this.query({
      kind: "planAlternatives",
      fromRouteIdx,
      fromStationIdx,
      toRouteIdx,
      toStationIdx,
      simEpochMs,
      maxTransfers: opts.maxTransfers ?? DEFAULT_MAX_TRANSFERS,
      maxWaitS: opts.maxWaitS ?? DEFAULT_MAX_WAIT_S,
      transferBufferS: opts.transferBufferS ?? DEFAULT_TRANSFER_BUFFER_S,
    });
    return r.kind === "planAlternatives" ? r.plans : [];
  }

  /** Every station with its ENU position — fetched once, then cached by callers. */
  async getStations(): Promise<StationInfo[]> {
    const r = await this.query({ kind: "stations" });
    return r.kind === "stations" ? r.stations : [];
  }

  private acceptFrame(simEpochMs: number, count: number, buffer: ArrayBuffer): void {
    const data = new Float32Array(buffer);
    const frame: Frame = { simEpochMs, count, data, byRun: indexFrame(data, count) };
    // Clock was rebased backwards (e.g. "Now" reset): drop stale frames.
    if (this.frameB && simEpochMs <= this.frameB.simEpochMs) {
      if (this.frameA) this.recycle(this.frameA);
      this.recycle(this.frameB);
      this.frameA = null;
      this.frameB = frame;
      return;
    }
    if (this.frameA) this.recycle(this.frameA); // keep only the last two
    this.frameA = this.frameB;
    this.frameB = frame;
  }

  private recycle(frame: Frame): void {
    const buffer = frame.data.buffer as ArrayBuffer;
    this.post({ kind: "returnBuffer", buffer }, [buffer]);
  }

  // ---- NF1 perf stats -----------------------------------------------------

  private recordEval(evalMs: number, count: number, truncated: boolean): void {
    this.evalSamples.push(evalMs);
    if (this.evalSamples.length > 600) this.evalSamples.shift();
    if (count > this.maxCount) this.maxCount = count;
    if (truncated) this.everTruncated = true;
  }

  /** Rolling-window sim-tick stats for the NF1 perf harness (verify:perf). */
  getEvalStats(): {
    samples: number;
    meanMs: number;
    p95Ms: number;
    maxCount: number;
    truncated: boolean;
    maxVehicles: number;
  } {
    const s = [...this.evalSamples].sort((a, b) => a - b);
    const mean = s.reduce((a, b) => a + b, 0) / (s.length || 1);
    return {
      samples: s.length,
      meanMs: mean,
      p95Ms: s[Math.floor(s.length * 0.95)] ?? 0,
      maxCount: this.maxCount,
      truncated: this.everTruncated,
      maxVehicles: MAX_VEHICLES,
    };
  }

  /** Clear the rolling window — call right before a measurement so stats
   * reflect only what happens after this point (e.g. after warping to a
   * specific sim time for the NF1 perf harness), not samples from page load. */
  resetEvalStats(): void {
    this.evalSamples = [];
    this.maxCount = 0;
    this.everTruncated = false;
  }

  // ---- clock -------------------------------------------------------------

  /** Current sim time in epoch ms, from the same params the worker uses. */
  getSimNow(nowPerfMs: number = performance.now()): number {
    const { clockEpochMs, clockSetAt, warp } = this.clock;
    return clockEpochMs + (nowPerfMs - clockSetAt) * warp;
  }

  getClockParams(): ClockParams {
    return { ...this.clock };
  }

  /** Base the sim clock at `epochMs` running at `warp`. */
  setClock(epochMs: number, warp: number): void {
    this.clock = { clockEpochMs: epochMs, clockSetAt: performance.now(), warp };
    this.post({ kind: "clock", epochMs, warp });
    this.callbacks.onClock?.(this.getClockParams());
  }

  /** Change warp, rebasing on the current sim time so it stays continuous. */
  setWarp(warp: number): void {
    this.setClock(this.getSimNow(), warp);
  }

  /** Re-cadence the worker's sim loop (eco mode). Positions are a pure
   *  function of time, so this changes cost, never correctness. */
  setTickMs(tickMs: number): void {
    this.post({ kind: "tickRate", tickMs } satisfies MainToWorker);
  }

  /** Snap the sim clock back to real wall-clock time (keeps current warp). */
  resetToNow(): void {
    this.setClock(Date.now(), this.clock.warp);
  }

  // ---- render-side interpolation (contract §5) ---------------------------

  /**
   * Interpolated vehicle records for render time `nowPerfMs`. Matches
   * vehicles across the two newest frames by run_idx, lerps x/y/z (and the
   * remaining scalar lanes), shortest-arc lerps yaw. Renders one sim tick
   * behind the newest frame so the render time sits inside [A, B].
   * The returned Float32Array is reused between calls — consume immediately.
   */
  getInterpolated(nowPerfMs: number = performance.now()): { vehicles: Float32Array; count: number } {
    const a = this.frameA;
    const b = this.frameB;
    const out = this.outVehicles;

    if (!b) return { vehicles: out, count: 0 };
    if (!a || b.simEpochMs <= a.simEpochMs) {
      out.set(b.data.subarray(0, b.count * VEHICLE_STRIDE));
      return { vehicles: out, count: b.count };
    }

    // One 10 Hz tick of interpolation delay (in sim ms — scales with warp).
    const renderSimTime = this.getSimNow(nowPerfMs) - 100 * this.clock.warp;
    const span = b.simEpochMs - a.simEpochMs;
    const alpha = Math.min(Math.max((renderSimTime - a.simEpochMs) / span, 0), 1.25);

    let n = 0;
    // Vehicles in the newer frame: interpolate when also present in A.
    for (let i = 0; i < b.count && n < MAX_VEHICLES; i++) {
      const ob = i * VEHICLE_STRIDE;
      const oa = a.byRun.get(b.data[ob + LANE_RUN_IDX]);
      const oo = n * VEHICLE_STRIDE;
      if (oa === undefined) {
        for (let k = 0; k < VEHICLE_STRIDE; k++) out[oo + k] = b.data[ob + k];
      } else {
        for (let k = 0; k < VEHICLE_STRIDE; k++) {
          out[oo + k] =
            k === LANE_YAW
              ? a.data[oa + k] + angleDelta(a.data[oa + k], b.data[ob + k]) * alpha
              : a.data[oa + k] + (b.data[ob + k] - a.data[oa + k]) * alpha;
        }
      }
      n++;
    }
    // Vehicles only in the older frame render at that frame's pose.
    for (let i = 0; i < a.count && n < MAX_VEHICLES; i++) {
      const oa = i * VEHICLE_STRIDE;
      if (b.byRun.has(a.data[oa + LANE_RUN_IDX])) continue;
      const oo = n * VEHICLE_STRIDE;
      for (let k = 0; k < VEHICLE_STRIDE; k++) out[oo + k] = a.data[oa + k];
      n++;
    }
    return { vehicles: out, count: n };
  }

  dispose(): void {
    this.disposed = true;
    for (const p of this.pending.values()) p.reject(new Error("sim client disposed"));
    this.pending.clear();
    this.post({ kind: "stop" });
    this.worker.terminate();
    this.frameA = null;
    this.frameB = null;
  }
}
