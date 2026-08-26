# Contributing

Thanks for your interest in Greater Bangkok Metro Mini 3D. This document covers how to get the project running, how the codebase is organized, and the conventions a change is expected to follow.

By participating you agree to the [Code of Conduct](./CODE_OF_CONDUCT.md). Contributions are accepted under the project's [MIT License](../LICENSE).

## Before you start

Two documents are load-bearing — read the relevant one before writing code:

- **[`SRS.md`](./SRS.md)** — the versioned design record. **Read §3A** before touching the MapLibre↔Three.js bridge, the Worker/Wasm boundary, or the serialization format. Those decisions are deliberate and expensive to reverse.
- **[`ENGINE_CONTRACT.md`](./ENGINE_CONTRACT.md)** — the interface spec for the binary cache format, the stride-8 `Float32Array` vehicle buffer, the worker protocol, and the wasm API. It is what keeps the Rust and TypeScript sides in sync. **Update it in the same change** whenever any of those cross the boundary differently than before.

## Getting set up

### Frontend

Node.js 18+ is required. The built Wasm engine (`src/sim/pkg/`) and the binary timetable (`public/data/network.tmb`) are **committed**, so a plain frontend contributor needs no Rust toolchain.

```bash
npm install
npm run dev        # Vite dev server at http://localhost:5173
```

| Command | What it does |
|---------|--------------|
| `npm run dev` | Vite dev server |
| `npm run build` | `tsc -b` type-check + production build to `dist/` |
| `npm run typecheck` | Type-check only |
| `npm test` | Vitest unit tests for pure helpers (`src/**/*.test.ts`, `tools/*.test.mjs`); **the only automated test surface** (`vitest` directly for watch mode) |
| `npm run preview` | Serve the production build |
| `npm run data:fetch [lineKey ...]` | Regenerate `src/data/network.json` — every registry line's (`tools/lines.config.mjs`) track geometry + stations from OSM Overpass via `tools/fetch-network.mjs`; pass one or more line keys to fetch a subset |
| `node tools/inspect-gtfs.mjs <gtfs-dir>` | Read-only: print every route in an extracted GTFS feed — the fastest way to populate a new registry entry |

With the dev server running, `npm run screenshot` captures the app from several camera poses (dev builds expose `window.__map` and `window.__sim` for exactly this):

```bash
npm run screenshot          # screenshots from several camera poses
```

One gate runs against a **production** build instead of the dev server — build it first (`npm run build`):

```bash
npm run check:bundle        # NF2 bundle-budget gate: sums gzip size of dist/ + network.tmb against the 5 MB budget
```

> **The browser acceptance harnesses were deleted on 2026-08-09** — all 13 `tools/verify-*.mjs` scripts (camera, kinematics, closeup, perf, mvp4-7, mobile, train-tooltip, legibility, station-search, spur-apm) and their `npm run verify:*` entries, by explicit decision. **`npm test`, `cargo test` and `npm run check:bundle` are the only automated checks that remain**, and none of them exercises rendering, interaction, or performance. Two of the removed harnesses were deliberately-failing gates whose numbers remain the honest current state: NF1 peak concurrency (measured 250, target ≥300) and WCAG night legibility (15 line/time samples below the 3:1 floor). Verifying anything visual or behavioural now means running the app and looking at it — which is exactly how the three MVP 6 defects were found before those harnesses existed.

`tools/extract-stations.mjs` is **legacy, MVP 1/2-era only** and is not wired up as an npm script — it reads the old two-branch `src/data/green-line.json` schema, which no longer exists. `tools/fetch-network.mjs` now fetches station positions for every registry line itself. The file is left in the tree for history only; do not resurrect it as a pipeline step.

### Rust engine

Only needed if you are changing the simulation core or the data pipeline. Requires a Rust toolchain with the `wasm32-unknown-unknown` target and [`wasm-pack`](https://rustwasm.github.io/wasm-pack/). All three commands are wrapped as npm scripts so they run from the repo root:

```bash
npm run rust:test    # sim-core + preprocessor unit tests
npm run wasm:build   # rebuild the Wasm engine into src/sim/pkg/ (output is committed)

# regenerate the binary timetable cache (output is committed)
npm run data:preprocess -- --gtfs <extracted-gtfs-dir>
```

> wasm-pack writes a `src/sim/pkg/.gitignore` containing `*`. Delete it if it reappears — the built package is intentionally committed so `npm run dev` works without Rust.

The Cargo workspace has three members: `sim-core` (kinematics, RAPTOR route planner, geo math, model), `wasm` (the `wasm-bindgen` surface), and `preprocessor` (the GTFS→binary CLI).

## Architecture & Feature Planning

The project is organized around a clean separation between offline data preprocessing (Rust CLI), high-performance simulation (Rust Wasm in a Web Worker), and reactive rendering (MapLibre GL JS + Three.js + React 19). All 14 Greater Bangkok rail transit lines (12 simulated, 2 pre-revenue track-only) are currently integrated. For planned future features and enhancements, refer to the [Addition Roadmap](./addition-roadmap.md).

## Conventions that will be checked in review

These are the ones most likely to bite — most are documented at length in `SRS.md` §3A.

- **Never put absolute mercator values into vertex data.** All Three.js geometry is built in a local east/north/up meter frame around the floating origin in `src/map/coordinates.ts`.
- **Per-frame kinematics must never enter React or Zustand state.** Zustand holds UI-derived state only (selected train, line filters); per-frame data goes straight from the worker buffer to the renderer.
- **Trains stay at one draw call per route** — one merged vertex-colored `InstancedMesh` per route in `VehicleManager`, never one per train. That is 12 draw calls for the 12 simulated lines. Keep it one-per-route as lines are added.
- **Worker↔main-thread transfer uses transferable `ArrayBuffer`s**, not `SharedArrayBuffer` — this deliberately avoids the COOP/COEP cross-origin-isolation requirement so the app can be hosted statically.
- **Engine positions are a pure function of time** (no integration), evaluated into pooled buffers that never allocate on the frame path.
- **`sim-core/src/geo.rs` replicates MapLibre's earth radius of 6371008.8 m**, not the WGS84 circumference, so Rust ENU output matches the TypeScript side to sub-millimeter. Don't "fix" it.
- **maplibre-gl v6 needs `setWorkerUrl()`.** v6 resolves its tile worker from `import.meta.url` with a dynamic specifier, which no bundler can rewrite; `MapContainer.tsx` passes it a `?worker&url` import instead. Remove that and the base map silently goes blank while the Three layer keeps drawing.
- **Camera rotation is a single merged orbit** (`src/map/cameraControls.ts`, which disables MapLibre's `dragRotate` and owns both axes). Middle-, right- and ctrl+left-drag all orbit: vertical pitches, horizontal turns, both at once, in MapLibre's own directions. Pan and scroll-zoom stay MapLibre's.

### Performance budgets

Changes should not regress these (SRS §NF): 60 FPS desktop / 30+ FPS mobile, Wasm sim tick under 3 ms/frame for up to 300 concurrent vehicles, and an initial bundle at or under 5 MB compressed including the binary timetable.

## Data and licensing

Track geometry is OpenStreetMap-derived (ODbL) and station coordinates come from the Namtang GTFS feed (CC-BY 4.0). **Both attributions render in the map's attribution control — keep them.**

Any scraped source is a fallback for the **offline preprocessor only**, subject to that source's terms. Scraping never belongs in client runtime.

## Submitting a change

1. Branch off `main`.
2. Run `npm run build` (type-check + build) and `npm test`; if you touched Rust, `npm run rust:test` and `npm run rust:lint`.
3. Update `ENGINE_CONTRACT.md` if you changed anything crossing the Rust↔TS boundary.
4. Open a pull request describing your changes and rationale.
