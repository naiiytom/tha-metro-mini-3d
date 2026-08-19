import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_MAX_TRANSFERS,
  DEFAULT_MAX_WAIT_S,
  DEFAULT_TRANSFER_BUFFER_S,
  ECO_TICK_MS,
  DEFAULT_TICK_MS,
  type MainToWorker,
  type WorkerToMain,
  type PlanLeg,
  type RoutePlan,
} from "./protocol";

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

describe("route plan wire format", () => {
  // Verbatim serde output shape from sim-core/src/route.rs. Unlike every
  // other §7 query, these keys are camelCase — a deliberate deviation from
  // the "snake_case verbatim" convention, because this structure is consumed
  // by a React component rather than mirrored field-for-field.
  const RAW = {
    departSec: 36030,
    arriveSec: 37500,
    durationS: 1470,
    transfers: 1,
    transferTimesEstimated: true,
    unreachable: false,
    legs: [
      {
        kind: "ride",
        routeIdx: 0,
        routeName: "Line A",
        colorRgb: "#65B724",
        headsign: "A2",
        direction: 0,
        runIdx: 0,
        boardStationIdx: 0,
        boardName: "A0",
        boardSec: 36030,
        boardArcM: 0,
        alightStationIdx: 2,
        alightName: "A2",
        alightSec: 36600,
        alightArcM: 2000,
        intermediateStops: ["A1"],
      },
      {
        kind: "transfer",
        fromRouteIdx: 0,
        fromStationIdx: 2,
        toRouteIdx: 1,
        toStationIdx: 0,
        walkM: 100,
        transferS: 180,
        waitS: 450,
      },
    ],
  };

  it("parses into the declared RoutePlan type", () => {
    const plan = JSON.parse(JSON.stringify(RAW)) as RoutePlan;
    expect(plan.departSec).toBe(36030);
    expect(plan.unreachable).toBe(false);
    expect(plan.legs).toHaveLength(2);
  });

  it("discriminates legs on `kind`", () => {
    const legs = RAW.legs as PlanLeg[];
    const ride = legs.find((l) => l.kind === "ride");
    const transfer = legs.find((l) => l.kind === "transfer");
    // Arcs come from PatternStop::arc_m — this is what the map highlight draws.
    expect(ride?.kind === "ride" && ride.alightArcM).toBe(2000);
    // walkM is display context; transferS is the flat routing cost.
    expect(transfer?.kind === "transfer" && transfer.walkM).toBe(100);
    expect(transfer?.kind === "transfer" && transfer.transferS).toBe(180);
  });

  it("pins the routing defaults, which live here and not in the registry", () => {
    // Global routing-model parameters, not per-line displayed-timetable data,
    // so the "parameters live in the registry" rule does not apply the same
    // way. Keeping them here keeps them tunable without a cache change.
    expect(DEFAULT_MAX_TRANSFERS).toBe(4);
    expect(DEFAULT_MAX_WAIT_S).toBe(90 * 60);
    expect(DEFAULT_TRANSFER_BUFFER_S).toBe(3 * 60);
  });
});

describe("wasm ambient typings", () => {
  it("mirrors every Engine method the worker calls", () => {
    // src/sim/pkg.d.ts is the fallback that keeps `tsc` green when
    // src/sim/pkg/ has not been generated. Forgetting to mirror a new method
    // breaks the no-Rust-toolchain build path while local builds stay green —
    // exactly the failure this pins.
    const dts = readFileSync(new URL("./pkg.d.ts", import.meta.url), "utf8");
    const rust = readFileSync(
      new URL("../../rust-engine/wasm/src/lib.rs", import.meta.url),
      "utf8",
    );
    for (const method of [
      "validation_json",
      "run_detail_json",
      "station_board_json",
      "stations_json",
      "plan_route_json",
    ]) {
      expect(rust, `${method} in lib.rs`).toContain(`pub fn ${method}(`);
      expect(dts, `${method} in pkg.d.ts`).toContain(`${method}(`);
    }
  });
});
