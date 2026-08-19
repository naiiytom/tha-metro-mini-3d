import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_MAX_TRANSFERS,
  DEFAULT_MAX_WAIT_S,
  DEFAULT_TRANSFER_BUFFER_S,
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
});
