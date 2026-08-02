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
| `npm test` | Vitest unit tests for pure helpers (`src/**/*.test.ts`, `tools/*.test.mjs`); browser-level checks live in `tools/verify-*.mjs` (`vitest` directly for watch mode) |
| `npm run preview` | Serve the production build |
| `npm run data:fetch [lineKey ...]` | Regenerate `src/data/network.json` — every registry line's (`tools/lines.config.mjs`) track geometry + stations from OSM Overpass via `tools/fetch-network.mjs`; pass one or more line keys to fetch a subset |
| `node tools/inspect-gtfs.mjs <gtfs-dir>` | Read-only: print every route in an extracted GTFS feed — the fastest way to populate a new registry entry |

With the dev server running, several scripts assert behaviour against the live app (dev builds expose `window.__map` and `window.__sim` for exactly this):

```bash
npm run verify:camera       # camera gestures, driven by real mouse events
npm run verify:mvp4         # MVP 4 acceptance: selection, follow, inspector, board, scrub
npm run verify:mvp5         # MVP 5 acceptance: line selector, multi-line simulation, interchanges, monorail geometry
npm run verify:mvp6         # MVP 6 acceptance: MRT Blue's mixed structure (data + rendered deck), underground opacity band, sun + basemap day/night theming
npm run verify:kinematics   # data-level motion assertions
npm run verify:closeup      # camera-on-a-train screenshot
npm run screenshot          # screenshots from several camera poses
```

Two more run against a **production** build instead of the dev server — build it first (`npm run build`):

```bash
npm run check:bundle        # NF2 bundle-budget gate: sums gzip size of dist/ + network.tmb against the 5 MB budget
```

Then, with `npm run preview` serving that same build, in another shell:

```bash
npm run verify:perf         # NF1 acceptance: sim tick time, tick-count sanity, no truncation, frame rate, peak-concurrency scale
```

As of MVP 6, `verify:perf` passes 4 of its 5 sub-checks by design, not 5/5 — see [CLAUDE.md](../CLAUDE.md)'s "MVP 6's NF1 result" for why the peak-concurrency check is left failing on purpose (the real network's measured peak is 246 concurrent vehicles, still short of the 300 target, and unrelated to any deferred MVP 6 task).

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

The Cargo workspace has three members: `sim-core` (kinematics, geo math, model), `wasm` (the `wasm-bindgen` surface), and `preprocessor` (the GTFS→binary CLI).

## How work is scoped

The project ships as **vertical MVP slices**, not horizontal layers. Each MVP is a complete, demoable increment, and later ones assume earlier ones are done. MVP 1–6 are delivered (track, data pipeline, moving trains, interaction/UI, multi-line breadth, underground + polish) — with one plan item deferred: MRT Orange and MRT Purple's southern extension (MVP 6's Task 6, track-only/pre-revenue) were deferred by human ruling and are not in the registry. See the [roadmap](../README.md#roadmap) and SRS §7.

If you are adding a feature, **place it in the right MVP** rather than building ahead of the current one.

## Conventions that will be checked in review

These are the ones most likely to bite — most are documented at length in `SRS.md` §3A.

- **Never put absolute mercator values into vertex data.** All Three.js geometry is built in a local east/north/up meter frame around the floating origin in `src/map/coordinates.ts`.
- **Per-frame kinematics must never enter React or Zustand state.** Zustand holds UI-derived state only (selected train, line filters); per-frame data goes straight from the worker buffer to the renderer.
- **Trains stay at one draw call per route** — one merged vertex-colored `InstancedMesh` per route in `VehicleManager`, never one per train. That was "2 draw calls total" when the network was Green Line only (Sukhumvit + Silom); it's 10 draw calls for the current 10-line network. Keep it one-per-route as lines are added.
- **Worker↔main-thread transfer uses transferable `ArrayBuffer`s**, not `SharedArrayBuffer` — this deliberately avoids the COOP/COEP cross-origin-isolation requirement so the app can be hosted statically.
- **Engine positions are a pure function of time** (no integration), evaluated into pooled buffers that never allocate on the frame path.
- **`sim-core/src/geo.rs` replicates MapLibre's earth radius of 6371008.8 m**, not the WGS84 circumference, so Rust ENU output matches the TypeScript side to sub-millimeter. Don't "fix" it.
- **maplibre-gl v6 needs `setWorkerUrl()`.** v6 resolves its tile worker from `import.meta.url` with a dynamic specifier, which no bundler can rewrite; `MapContainer.tsx` passes it a `?worker&url` import instead. Remove that and the base map silently goes blank while the Three layer keeps drawing.
- **Camera rotation is a single merged orbit** (`src/map/cameraControls.ts`, which disables MapLibre's `dragRotate` and owns both axes). Middle-, right- and ctrl+left-drag all orbit: vertical pitches, horizontal turns, both at once, in MapLibre's own directions. Pan and scroll-zoom stay MapLibre's. `npm run verify:camera` asserts every direction with real mouse events.

### Performance budgets

Changes should not regress these (SRS §NF): 60 FPS desktop / 30+ FPS mobile, Wasm sim tick under 3 ms/frame for up to 300 concurrent vehicles, and an initial bundle at or under 5 MB compressed including the binary timetable.

## Data and licensing

Track geometry is OpenStreetMap-derived (ODbL) and station coordinates come from the Namtang GTFS feed (CC-BY 4.0). **Both attributions render in the map's attribution control — keep them.**

Any scraped source is a fallback for the **offline preprocessor only**, subject to that source's terms. Scraping never belongs in client runtime.

## Submitting a change

1. Branch off `main`.
2. Run `npm run build` (type-check + build) and `npm test`; if you touched Rust, `npm run rust:test`.
3. Update `ENGINE_CONTRACT.md` if you changed anything crossing the Rust↔TS boundary.
4. Open a pull request describing what changed and which MVP it belongs to.
