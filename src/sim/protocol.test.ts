import { describe, expect, it } from "vitest";
import { ECO_TICK_MS, DEFAULT_TICK_MS, type MainToWorker, type WorkerToMain } from "./protocol";

describe("frame message", () => {
  it("carries a truncation flag", () => {
    // sim-core has recorded truncation since MVP 5, but nothing surfaced it:
    // the client's only signal was `count < MAX_VEHICLES`, a proxy that is
    // wrong at exactly MAX_VEHICLES and rots when the constant moves.
    const frame: Extract<WorkerToMain, { kind: "frame" }> = {
      kind: "frame",
      simEpochMs: 0,
      count: 3,
      evalMs: 0.2,
      truncated: false,
      buffer: new ArrayBuffer(0),
    };
    expect(frame.truncated).toBe(false);
  });
});

describe("tick-rate control", () => {
  it("exposes a default and an eco cadence, eco being much slower", () => {
    expect(DEFAULT_TICK_MS).toBe(100); // 10 Hz, the MVP 3 cadence
    expect(ECO_TICK_MS).toBeGreaterThanOrEqual(1000); // ~1 Hz or slower
  });

  it("types a tickRate message on the main-to-worker channel", () => {
    // Compile-time contract check: `kind`, not `type` — the rest of the
    // union uses `kind` and a mismatch would silently never match.
    const msg: MainToWorker = { kind: "tickRate", tickMs: ECO_TICK_MS };
    expect(msg.kind).toBe("tickRate");
  });
});
