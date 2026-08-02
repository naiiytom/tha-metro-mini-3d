import { describe, expect, it } from "vitest";
import type { WorkerToMain } from "./protocol";

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
