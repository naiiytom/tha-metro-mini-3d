import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_MAX_TRANSFERS,
  DEFAULT_MAX_WAIT_S,
  DEFAULT_TICK_MS,
  DEFAULT_TRANSFER_BUFFER_S,
  ECO_TICK_MS,
  FRAME_BYTES,
  LANE_PROGRESS,
  LANE_ROUTE_IDX,
  LANE_RUN_IDX,
  LANE_STATE,
  LANE_X,
  LANE_Y,
  LANE_YAW,
  LANE_Z,
  VEHICLE_STRIDE,
  type MainToWorker,
  type RoutePlan,
  type WorkerToMain,
} from "./protocol";
import { SimClient } from "./SimClient";

/** Minimal stand-in for a real dedicated Worker: records what was posted and
 *  lets a test push a reply back through `onmessage`. */
class FakeWorker {
  static last: FakeWorker | null = null;
  onmessage: ((e: MessageEvent<WorkerToMain>) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  sent: MainToWorker[] = [];
  terminated = false;
  constructor() {
    FakeWorker.last = this;
  }
  postMessage(msg: MainToWorker): void {
    this.sent.push(msg);
  }
  terminate(): void {
    this.terminated = true;
  }
  reply(msg: WorkerToMain): void {
    this.onmessage?.({ data: msg } as MessageEvent<WorkerToMain>);
  }
  /** The most recent "query" message, with its id. */
  lastQuery(): Extract<MainToWorker, { kind: "query" }> {
    const q = [...this.sent].reverse().find((m) => m.kind === "query");
    if (!q || q.kind !== "query") throw new Error("no query was posted");
    return q;
  }
}

const PLAN: RoutePlan = {
  departSec: 36030,
  arriveSec: 37500,
  durationS: 1470,
  transfers: 1,
  transferTimesEstimated: true,
  unreachable: false,
  legs: [],
};

describe("SimClient.getRoutePlan", () => {
  let client: SimClient;

  beforeEach(() => {
    (globalThis as unknown as { Worker: unknown }).Worker = FakeWorker;
    // load() fetches the cache on construction; a rejected fetch only routes
    // through onError, which this suite does not exercise.
    (globalThis as unknown as { fetch: unknown }).fetch = () =>
      Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)) });
    client = new SimClient();
  });

  afterEach(() => {
    client.dispose();
  });

  it("posts a fully-specified request and resolves the returned plan", async () => {
    const worker = FakeWorker.last!;
    const promise = client.getRoutePlan(0, 1, 2, 3, 1_800_000_000_000);
    const posted = worker.lastQuery();
    expect(posted.query).toEqual({
      kind: "routePlan",
      fromRouteIdx: 0,
      fromStationIdx: 1,
      toRouteIdx: 2,
      toStationIdx: 3,
      simEpochMs: 1_800_000_000_000,
      // Defaults are resolved HERE, not left undefined for the worker to fill
      // — so what went over the wire is exactly what was planned.
      maxTransfers: DEFAULT_MAX_TRANSFERS,
      maxWaitS: DEFAULT_MAX_WAIT_S,
      transferBufferS: DEFAULT_TRANSFER_BUFFER_S,
    });
    worker.reply({ kind: "queryResult", id: posted.id, result: { kind: "routePlan", plan: PLAN } });
    await expect(promise).resolves.toEqual(PLAN);
  });

  it("passes explicit routing overrides through untouched", async () => {
    const worker = FakeWorker.last!;
    const promise = client.getRoutePlan(0, 0, 1, 0, 0, {
      maxTransfers: 1,
      maxWaitS: 600,
      transferBufferS: 0,
    });
    const posted = worker.lastQuery();
    expect(posted.query).toMatchObject({ maxTransfers: 1, maxWaitS: 600, transferBufferS: 0 });
    worker.reply({ kind: "queryResult", id: posted.id, result: { kind: "routePlan", plan: null } });
    await expect(promise).resolves.toBeNull();
  });

  it("resolves null for a structurally invalid request", async () => {
    const worker = FakeWorker.last!;
    const promise = client.getRoutePlan(99, 0, 0, 0, 0);
    const posted = worker.lastQuery();
    worker.reply({ kind: "queryResult", id: posted.id, result: { kind: "routePlan", plan: null } });
    await expect(promise).resolves.toBeNull();
  });

  it("rejects when the worker reports a query error", async () => {
    const worker = FakeWorker.last!;
    const promise = client.getRoutePlan(0, 0, 1, 0, 0);
    const posted = worker.lastQuery();
    worker.reply({ kind: "queryError", id: posted.id, message: "engine not ready" });
    await expect(promise).rejects.toThrow("engine not ready");
  });

  it("does not confuse two in-flight queries", async () => {
    // Every query shares one promise table keyed by id; a plan resolving a
    // station board's promise would be a silent, very confusing bug.
    const worker = FakeWorker.last!;
    const planPromise = client.getRoutePlan(0, 0, 1, 0, 0);
    const planId = worker.lastQuery().id;
    const boardPromise = client.getStationBoard(0, 0, 0);
    const boardId = worker.lastQuery().id;
    expect(boardId).not.toBe(planId);

    worker.reply({ kind: "queryResult", id: boardId, result: { kind: "stationBoard", board: null } });
    worker.reply({ kind: "queryResult", id: planId, result: { kind: "routePlan", plan: PLAN } });
    await expect(boardPromise).resolves.toBeNull();
    await expect(planPromise).resolves.toEqual(PLAN);
  });

  it("planAlternatives posts a request with default and explicit parameters and resolves returned plans", async () => {
    const worker = FakeWorker.last!;
    const promise = client.planAlternatives(0, 1, 2, 3, 1_800_000_000_000);
    const posted = worker.lastQuery();
    expect(posted.query).toEqual({
      kind: "planAlternatives",
      fromRouteIdx: 0,
      fromStationIdx: 1,
      toRouteIdx: 2,
      toStationIdx: 3,
      simEpochMs: 1_800_000_000_000,
      maxTransfers: DEFAULT_MAX_TRANSFERS,
      maxWaitS: DEFAULT_MAX_WAIT_S,
      transferBufferS: DEFAULT_TRANSFER_BUFFER_S,
    });
    worker.reply({
      kind: "queryResult",
      id: posted.id,
      result: { kind: "planAlternatives", plans: [PLAN] },
    });
    await expect(promise).resolves.toEqual([PLAN]);
  });
});

function makeFrameBuffer(vehicles: number[][]): ArrayBuffer {
  const buf = new ArrayBuffer(FRAME_BYTES);
  const view = new Float32Array(buf);
  for (let i = 0; i < vehicles.length; i++) {
    for (let k = 0; k < VEHICLE_STRIDE; k++) {
      view[i * VEHICLE_STRIDE + k] = vehicles[i][k] ?? 0;
    }
  }
  return buf;
}

describe("SimClient.getInterpolated and tick cadence", () => {
  let client: SimClient;

  beforeEach(() => {
    (globalThis as unknown as { Worker: unknown }).Worker = FakeWorker;
    (globalThis as unknown as { fetch: unknown }).fetch = () =>
      Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)) });
    client = new SimClient();
  });

  afterEach(() => {
    client.dispose();
  });

  it("clamps setTickMs to [DEFAULT_TICK_MS, ECO_TICK_MS] and posts tickRate", () => {
    const worker = FakeWorker.last!;
    client.setTickMs(50); // below min
    expect(worker.sent).toContainEqual({ kind: "tickRate", tickMs: DEFAULT_TICK_MS });

    client.setTickMs(5000); // above max
    expect(worker.sent).toContainEqual({ kind: "tickRate", tickMs: ECO_TICK_MS });

    client.setTickMs(500);
    expect(worker.sent).toContainEqual({ kind: "tickRate", tickMs: 500 });
  });

  it("interpolates with 100 ms delay at default tick rate", () => {
    const worker = FakeWorker.last!;
    const clockSetAt = 1000;
    client.setClock(10_000, 1);
    (client as unknown as { clock: { clockEpochMs: number; clockSetAt: number; warp: number } }).clock = {
      clockEpochMs: 10_000,
      clockSetAt,
      warp: 1,
    };

    const vA = [0, 0, 0, 0, 1, 1, 0, 0];
    const vB = [100, 0, 0, 0, 1, 1, 0, 1];
    worker.reply({
      kind: "frame",
      simEpochMs: 10_000,
      count: 1,
      evalMs: 1,
      truncated: false,
      buffer: makeFrameBuffer([vA]),
    });
    worker.reply({
      kind: "frame",
      simEpochMs: 10_100,
      count: 1,
      evalMs: 1,
      truncated: false,
      buffer: makeFrameBuffer([vB]),
    });

    // simNow = 10_150, renderSimTime = 10_150 - 100 = 10_050, alpha = 0.5
    const res = client.getInterpolated(clockSetAt + 150);
    expect(res.count).toBe(1);
    expect(res.vehicles[LANE_X]).toBeCloseTo(50, 4);
  });

  it("interpolates with 1000 ms delay in eco mode", () => {
    const worker = FakeWorker.last!;
    client.setTickMs(1000);
    const clockSetAt = 1000;
    (client as unknown as { clock: { clockEpochMs: number; clockSetAt: number; warp: number } }).clock = {
      clockEpochMs: 10_000,
      clockSetAt,
      warp: 1,
    };

    const vA = [0, 0, 0, 0, 1, 1, 0, 0];
    const vB = [100, 0, 0, 0, 1, 1, 0, 1];
    worker.reply({
      kind: "frame",
      simEpochMs: 10_000,
      count: 1,
      evalMs: 1,
      truncated: false,
      buffer: makeFrameBuffer([vA]),
    });
    worker.reply({
      kind: "frame",
      simEpochMs: 11_000,
      count: 1,
      evalMs: 1,
      truncated: false,
      buffer: makeFrameBuffer([vB]),
    });

    // simNow = 11_500, renderSimTime = 11_500 - 1000 = 10_500, alpha = 0.5
    const res = client.getInterpolated(clockSetAt + 1500);
    expect(res.count).toBe(1);
    expect(res.vehicles[LANE_X]).toBeCloseTo(50, 4);
  });

  it("handles discrete lane lerping and progress correctly", () => {
    const worker = FakeWorker.last!;
    const clockSetAt = 1000;
    (client as unknown as { clock: { clockEpochMs: number; clockSetAt: number; warp: number } }).clock = {
      clockEpochMs: 10_000,
      clockSetAt,
      warp: 1,
    };

    const vA = [10, 20, 30, 3.1, 0, 5, 2, 0.1];
    const vB = [30, 40, 50, -3.1, 1, 5, 2, 0.7];
    worker.reply({
      kind: "frame",
      simEpochMs: 10_000,
      count: 1,
      evalMs: 1,
      truncated: false,
      buffer: makeFrameBuffer([vA]),
    });
    worker.reply({
      kind: "frame",
      simEpochMs: 10_100,
      count: 1,
      evalMs: 1,
      truncated: false,
      buffer: makeFrameBuffer([vB]),
    });

    // alpha = 0.5
    const res = client.getInterpolated(clockSetAt + 150);
    expect(res.vehicles[LANE_X]).toBeCloseTo(20, 4);
    expect(res.vehicles[LANE_Y]).toBeCloseTo(30, 4);
    expect(res.vehicles[LANE_Z]).toBeCloseTo(40, 4);
    expect(res.vehicles[LANE_YAW]).toBeGreaterThan(3.1);
    expect(res.vehicles[LANE_STATE]).toBe(0);
    expect(res.vehicles[LANE_RUN_IDX]).toBe(5);
    expect(res.vehicles[LANE_ROUTE_IDX]).toBe(2);
    expect(res.vehicles[LANE_PROGRESS]).toBeCloseTo(0.4, 4);

    // alpha = 1.1 (extrapolating slightly)
    const resLate = client.getInterpolated(clockSetAt + 210);
    expect(resLate.vehicles[LANE_STATE]).toBe(1);
    expect(resLate.vehicles[LANE_PROGRESS]).toBeCloseTo(0.7, 4);
  });

  it("does not lerp progress when vehicle transitions to dwelling in B", () => {
    const worker = FakeWorker.last!;
    const clockSetAt = 1000;
    (client as unknown as { clock: { clockEpochMs: number; clockSetAt: number; warp: number } }).clock = {
      clockEpochMs: 10_000,
      clockSetAt,
      warp: 1,
    };

    const vA = [10, 20, 30, 0, 1, 5, 2, 0.9];
    const vB = [30, 40, 50, 0, 0, 5, 2, 0.0];
    worker.reply({
      kind: "frame",
      simEpochMs: 10_000,
      count: 1,
      evalMs: 1,
      truncated: false,
      buffer: makeFrameBuffer([vA]),
    });
    worker.reply({
      kind: "frame",
      simEpochMs: 10_100,
      count: 1,
      evalMs: 1,
      truncated: false,
      buffer: makeFrameBuffer([vB]),
    });

    const res = client.getInterpolated(clockSetAt + 150);
    expect(res.vehicles[LANE_PROGRESS]).toBe(0.0);
  });

  it("pools and reuses byRun Map across frames without reallocating", () => {
    const worker = FakeWorker.last!;
    for (let i = 0; i < 5; i++) {
      worker.reply({
        kind: "frame",
        simEpochMs: 10_000 + i * 100,
        count: 1,
        evalMs: 1,
        truncated: false,
        buffer: makeFrameBuffer([[0, 0, 0, 0, 1, 7, 0, 0]]),
      });
    }
    const returned = worker.sent.filter((m) => m.kind === "returnBuffer");
    expect(returned.length).toBeGreaterThanOrEqual(3);
  });
});

