# Greater Bangkok Metro Mini 3D

> Interactive, web-based 3D visualization of Bangkok's rail transit network — trains moving on schedule along authentic geography, elevations, and timetables.

**Status:** 🚧 Early development — **MVP 1–6 delivered**: BTS Green Line 3D track, GTFS→binary data pipeline, scheduled trains moving with time-warp, click-to-inspect with a follow camera and time scrubber, multi-line breadth, and underground + polish (MRT Blue Line with real underground/elevated structure, an opacity-based underground view mode, day/night lighting, an optional shadow toggle, and a glassmorphism UI pass) — **10 lines simulated, 193 stations, 8,193 runs**, plus **MRT Orange and MRT Purple Phase 2 as track-only pre-revenue lines** (12 lines in the registry total; see [Coverage](#coverage)); see the [roadmap](#roadmap). **Repo:** [`tha-metro-mini-3d`](https://github.com/naiiytom/tha-metro-mini-3d)

---

## What it is

Greater Bangkok Metro Mini 3D renders the Bangkok Metropolitan Region's metro/rail lines as 3D track over a vector map and animates trains along them using published **static GTFS** timetables. Vehicle positions are computed by interpolating scheduled arrival/departure times — so you can watch the *scheduled* network at any moment, scrub through time, and follow individual trains.

> **Schedule-driven, not live.** v1.0 uses static timetables only, not real-time vehicle feeds (GTFS-Realtime). It shows where trains *should* be per schedule.

Full requirements live in [`docs/SRS.md`](./docs/SRS.md).

## Features

- 3D track geometry with real elevations — elevated (+12–22 m), at-grade, and underground (−12 to −25 m) segments.
- Schedule-based train motion with acceleration/deceleration easing and correct heading along the track.
- Time controls — real-time clock, 1×/5×/10×/60× speed, and scrub to any time.
- Camera modes — free orbit, third-person train-follow, and an underground transparency toggle.
- Line filters, a station/vehicle inspector, and a live timetable drawer.

### Camera controls

| Gesture | Effect |
|---------|--------|
| Left-drag | Pan |
| Scroll wheel | Zoom |
| Press the wheel + drag, right-drag, or ctrl + left-drag | Orbit — drag up to tilt toward the horizon, down to flatten toward top-down, sideways to swing the compass bearing |

Orbiting moves both axes in one motion, so a diagonal drag tilts and turns together.

## Coverage

Operational lines receive full simulation (track + trains). **As of MVP 6 (2026-08-02), ten lines are simulated**: BTS Sukhumvit & Silom, MRT Purple, Airport Rail Link, MRT Pink, MRT Yellow, BTS Gold, SRT Dark/Light Red, and (new in MVP 6) **MRT Blue** — 193 stations, 58 trip patterns, 8,193 expanded runs. MRT Blue is the first line in the registry with genuinely mixed structure: 234 elevated + 260 underground track points, not one nominal altitude.

**MRT Orange and MRT Purple's southern extension ("Purple Phase 2") are in the registry as track-only, pre-revenue lines** — track geometry renders (dashed centerline, desaturated deck, a `LineSelector` badge), no trains, zero stations. Neither line has a route relation in OSM yet, so their track comes from a different mechanism than every other line: real, individually-tagged `railway=construction` ways, stitched directly by name rather than via a relation. See [CLAUDE.md](./CLAUDE.md)'s "Orange/Purple Phase 2 track-only fetch" implementation notes for why (and why there are no stations).

| Line | Type | Operator | Structure | v1.0 |
|------|------|----------|-----------|------|
| BTS Sukhumvit & Silom (Green) | Heavy Rail | BTSC | Elevated | Full |
| MRT Purple | Heavy Rail | BEM | Elevated | Full |
| Airport Rail Link (ARL) | Express / Commuter | Asia Era One | Elevated | Full |
| MRT Pink | Monorail | NBM | Elevated | Full |
| MRT Yellow | Monorail | EBM | Elevated | Full |
| BTS Gold | APM (monorail-class) | BMA/KT (BTSC) | Elevated | Full |
| SRT Dark Red | Commuter Rail | SRTET | Elevated / At-grade (per-segment, MVP 6) | Full |
| SRT Light Red | Commuter Rail | SRTET | Elevated / At-grade (per-segment, MVP 6) | Full |
| MRT Blue | Heavy Rail | BEM | Underground / Elevated (per-segment) | **Full (new, MVP 6)** |
| MRT Orange | Heavy Rail | — | Underground / Elevated (per-segment) | **Track-only, pre-revenue** |
| MRT Purple Phase 2 | Heavy Rail | BEM | Underground / Elevated (per-segment) | **Track-only, pre-revenue** |

> Line status re-verified 2026-07-31 (see [`docs/SRS.md` §2](./docs/SRS.md#2-system-scope--transit-coverage)): MRT Orange is still pre-revenue (Eastern Section now projected late 2027, Western Section 2030). The Pink Line's Muang Thong Thani spur has been in full paid revenue service since 2025-06-17 but is **not yet in this registry** — the Namtang feed bundles its 4 shuttle trip patterns into the same GTFS route id as the main Pink Line, and its own OSM relation pair wasn't fetched for this task, so it's excluded from simulation for now (main Pink Line is unaffected). The Purple Line's Tao Poon–Rat Burana southern extension remains under construction, not open (OSM way tags carry `opening_date=2027`) — it's in the registry as track-only, but not simulated.
>
> **"Elevated / At-grade (per-segment, MVP 6)" for SRT Red:** MVP 5 modeled each Dark/Light Red line as a single nominal elevated altitude; MVP 6's per-point structure classification (OSM way tags: `bridge`/`tunnel`/`layer`/`embankment`) now correctly splits both lines into real at-grade and elevated segments — 2,350 elevated / 262 underground / 48 at-grade track points network-wide, all 48 at-grade points on SRT Red.
>
> **Per-segment structure for MRT Blue was the hard part of this MVP.** Blue's alignment passes near itself at Tha Phra (a loop joined to a branch), which broke the original global-nearest stop-snapping — see [CLAUDE.md](./CLAUDE.md)'s MVP 6 implementation notes for the fix (per-pattern monotonic snapping in the preprocessor).

### Track geometry provenance (OSM relations)

Every line's 3D track polyline comes from a **pinned** OpenStreetMap route relation (never a live discovery lookup at build time — a name-match discovery mode exists in `tools/fetch-network.mjs` only for bootstrapping a *new* line, and its resolved id must be pinned back into the registry before it's committed). Station coordinates for simulated lines come from the Namtang GTFS feed; track-only lines (currently none — see [Coverage](#coverage)) would use OSM stop nodes instead.

| Line | OSM relation id | GTFS `route_id` |
|------|-----------------|------------------|
| BTS Sukhumvit | [444651](https://www.openstreetmap.org/relation/444651) | `1` |
| BTS Silom | [2067854](https://www.openstreetmap.org/relation/2067854) | `2` |
| MRT Purple | [6988563](https://www.openstreetmap.org/relation/6988563) | `4` |
| Airport Rail Link | [2148241](https://www.openstreetmap.org/relation/2148241) | `5` |
| MRT Pink | [16740886](https://www.openstreetmap.org/relation/16740886) | `2436` |
| MRT Yellow | [15806897](https://www.openstreetmap.org/relation/15806897) | `2224` |
| BTS Gold | [11681439](https://www.openstreetmap.org/relation/11681439) | `2025` |
| SRT Dark Red | [13058384](https://www.openstreetmap.org/relation/13058384) | `2026` |
| SRT Light Red | [13178788](https://www.openstreetmap.org/relation/13178788) | `2027` |
| MRT Blue | [444659](https://www.openstreetmap.org/relation/444659) | `3` |

Source of truth for this table: `tools/lines.config.mjs`'s `LINES` registry — update there first, this table is descriptive.

## Tech stack

| Layer | Technology |
|-------|-----------|
| UI | React 19, Tailwind CSS, Lucide, Zustand |
| Build | Vite + TypeScript |
| Base map | MapLibre GL JS (vector tiles, 3D terrain) |
| 3D | Three.js via a custom MapLibre WebGL layer |
| Simulation core | Rust → WebAssembly (`wasm-pack`), run in a Web Worker |
| Data pipeline | Rust CLI: GTFS ZIP → compact binary cache (+ OpenStreetMap geometry) |

See [§3A of the SRS](./docs/SRS.md) for design rationale and key risks (cross-origin isolation, the MapLibre↔Three bridge, float precision at city scale, serialization).

## Project structure

```
tha-metro-mini-3d/
├── rust-engine/          # Rust Wasm simulation core (parser, interpolation, spatial)
├── src/                  # Vite + React frontend
│   ├── components/       # UI overlay, controls, inspector, time scrubber
│   ├── map/              # MapLibre ↔ Three.js bridge, vehicle & camera managers
│   ├── stores/           # Zustand state
│   └── types/
├── tools/                # data-fetch, verification & screenshot scripts
├── index.html
└── vite.config.ts
```

## Getting started

> Prerequisites: [Node.js](https://nodejs.org/) 18+. The built Wasm engine (`src/sim/pkg/`) and binary timetable (`public/data/network.tmb`) are committed, so a Rust toolchain is **only** needed to regenerate them ([Rust](https://rustup.rs/) + `wasm32-unknown-unknown` target + [`wasm-pack`](https://rustwasm.github.io/wasm-pack/); see `rust-engine/`).

```bash
# clone
git clone https://github.com/naiiytom/tha-metro-mini-3d.git
cd tha-metro-mini-3d

# install deps and run the dev server
npm install
npm run dev
```

Other scripts:

| Command | What it does |
|---------|--------------|
| `npm run build` | Type-check (`tsc -b`) + production build to `dist/` |
| `npm run typecheck` | Type-check only |
| `npm test` | Vitest unit tests for pure helpers (`src/**/*.test.ts`, `tools/*.test.mjs`, e.g. time formatting, bearing math, track gradient limiting, day/night lighting); **the only automated test surface** — the browser acceptance harnesses were deleted 2026-08-09 |
| `npm run preview` | Serve the production build locally |
| `npm run data:fetch [lineKey ...]` | Regenerate `src/data/network.json` — every registry line's track geometry + stations from OpenStreetMap (Overpass); pass one or more `tools/lines.config.mjs` keys to fetch a subset |
| `node tools/inspect-gtfs.mjs <gtfs-dir>` | Read-only: print every route in an extracted GTFS feed (id, agency, names, colour, trip count, frequency-based or not) — the fastest way to check a feed before adding a `tools/lines.config.mjs` entry |
| `npm run screenshot -- [url] [outDir]` | Headless-browser screenshots from several camera poses (visual check) |
| `npm run check:bundle` | NF2 bundle-budget gate against a **production** build (`npm run build` first) — sums gzip size of every `dist/` asset plus `network.tmb`, fails loudly on a missing/incomplete build rather than risking a spurious pass |

Rust toolchain required for these (see [CONTRIBUTING](./docs/CONTRIBUTING.md)):

| Command | What it does |
|---------|--------------|
| `npm run rust:test` | `cargo test` across the `rust-engine/` workspace (48 tests as of MVP 6; was 36 through MVP 5) |
| `npm run wasm:build` | Rebuild the Wasm engine into `src/sim/pkg/` (committed output) |
| `npm run data:preprocess -- --gtfs <gtfs-dir>` | Regenerate `public/data/network.tmb` for the whole registry from an extracted GTFS feed (committed output) — route identity comes entirely from `network.json`'s line order |

## Roadmap

Delivered as vertical, shippable slices — track geometry first, then motion, then breadth.

| MVP | Deliverable |
|-----|-------------|
| **1** ✅ | **BTS Green Line track laid** — 3D geometry over the map, no trains. Proves the full render pipeline. **Delivered:** MapLibre (OpenFreeMap vector tiles) + Three.js custom layer with floating-origin coordinates; spline-smoothed elevated track for both branches; station markers; free orbit camera. |
| **2** ✅ | Green Line data pipeline — GTFS → binary cache, loaded & validated client-side. **Delivered:** Rust preprocessor expands the frequency-based Namtang feed (14 patterns → 2,162 runs, 61 stations snapped onto track) into a 123 KB bincode cache (71 KB gzip vs 3 MB budget); client validation summary shown in the UI. |
| **3** ✅ | Green Line trains moving — Wasm interpolation engine + Web Worker. **Delivered:** 93 KB Wasm engine (dwell/transit/smoothstep/tangent-yaw) evaluated at 10 Hz in a worker, transferable-buffer ping-pong, render-side interpolation, InstancedMesh 4-car trains (2 draw calls), 1×/5×/10×/60× time-warp with Bangkok clock. |
| **4** ✅ | Interaction & UI — follow-cam, inspector, time scrubber, timetable drawer. **Delivered:** click-to-select trains and stations (screen-space picking), third-person follow camera, train inspector with next-stop ETA and the full call list, live station board, and a scrubber over the service day; schedule lookups added to the Rust engine and crossed over a promise-based worker query channel. |
| **5** ✅ | Multi-line breadth — Purple, ARL, Pink, Yellow, Gold, Red. **Delivered:** the line registry (`tools/lines.config.mjs`) grew from 2 to 9 entries with pinned OSM relation ids and GTFS route ids verified against the real Namtang feed; 155 stations, 34 patterns, 4,481 runs, ~213 KB gzip cache. Surfaced and fixed real data-pipeline gaps along the way: an OSM-node-id type mismatch, the Pink Line's Muang Thong Thani spur trips sharing a GTFS route id with the main line, a GTFS/OSM coordinate mismatch at the Pink Line's own terminus, and OSM stop-position nodes without name tags silently blanking station names. Line selector, cross-route interchange metadata, and monorail/APM vehicle models shipped alongside; the MVP 5 acceptance harness (since removed) (6/6) and the MVP 4 acceptance harness (since removed) (14/14, unchanged) both green. **NF1 performance is 4 of 5 sub-checks, disclosed not hidden:** the sim ticks a meaningful sample count, sim tick (p95 ≈ 0.2–0.3 ms), no truncation, and frame rate (~100 FPS) all pass; the ≥300-concurrent-vehicle scale target is not yet reached — this real 9-line network's measured peak is 171–172 vehicles, well under `MAX_VEHICLES` (1024) but under the 300 target too. That's real GTFS schedule density for these lines, not a bug, and the assertion is left failing on purpose rather than weakened. |
| **6** ✅ | Underground + polish — MRT Blue, underground view mode, day/night, bundle/browser hardening. **Delivered:** MRT Blue joined the registry (10 simulated lines, 193 stations, 8,193 runs) with real per-segment underground/elevated structure from OSM tags — 234 elevated / 260 underground track points, not a nominal altitude — after fixing a genuine topology bug where Blue's alignment passing near itself at Tha Phra broke the original stop-snapping (fixed with per-pattern monotonic snapping in the preprocessor, see [CLAUDE.md](./CLAUDE.md)). An underground view mode fades the basemap into the SRS F3.2 0.1–0.4 opacity band and re-weights the surface/sub-surface track — **opacity-based, not depth-correct**; there is no real depth-buffer interop between MapLibre's tiles and the Three.js layer, disclosed plainly rather than glossed. Day/night lighting drives the Three.js scene from a real solar-position calculation, plus a separately-added basemap colour theme so the whole map (not just the 3D layer) reads as night. A shadow-quality toggle (default off) roughly doubles the renderer's own per-frame render-call cost when enabled (measured on software rendering — see CLAUDE.md for the caveat and numbers). A glassmorphism UI pass unifies all five overlay panels. **NF2:** `npm run check:bundle` reports **0.96 MB gzip / 5.00 MB budget (19% used)**. **NF3:** Chrome, Firefox, and Edge were driven programmatically against their real installed binaries (9/9 checks each); **Safari is untested** (unavailable on this machine). **NF1 is still 4 of 5, not fixed by this MVP:** peak concurrency rose to **246** (weekday) with Blue added, still short of the ≥300 target. **MRT Orange and MRT Purple Phase 2 (Task 6 of the plan)** were deferred by human ruling within this cycle, then delivered 2026-08-04 as track-only pre-revenue lines once picked back up — neither carries vehicles, so the NF1 gap is unaffected either way; see [Coverage](#coverage). |

## Data & licensing

- Transit schedules & station coordinates: static **GTFS** ([Namtang / OTP open-data programme](https://namtang-api.otp.go.th/opendata), CC-BY 4.0).
- Track geometry: **OpenStreetMap** — © OpenStreetMap contributors, [ODbL](https://opendatacommons.org/licenses/odbl/); attribution required (rendered in the map attribution control).
- Base map: [OpenFreeMap](https://openfreemap.org/) vector tiles (Liberty style).
- Any scraped source is a fallback only, used in the offline preprocessor, subject to the source's terms.

## Contributing

Contributions are welcome. Start with [CONTRIBUTING.md](./docs/CONTRIBUTING.md) — it covers setup, how work is scoped into MVP slices, and the architectural conventions that get checked in review. By participating you agree to the [Code of Conduct](./docs/CODE_OF_CONDUCT.md).

## License

Source code is licensed under the [MIT License](./LICENSE).

Bundled data keeps its own terms: OpenStreetMap-derived track geometry is ODbL, and the Namtang GTFS-derived timetables and station coordinates are CC-BY 4.0. Both attributions render in the map's attribution control and must be kept in any redistribution.

---

*This is a fan/hobby visualization project and is not affiliated with any transit operator.*
