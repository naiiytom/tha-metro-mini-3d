# Software Requirements Specification (SRS)

> **Note (2026-08-09):** every browser acceptance harness referenced in this document — the MVP 4/5/6/7, camera, kinematics, closeup, perf, mobile, train-tooltip, legibility, station-search and spur/APM runs — **was deleted**, along with its `npm run verify:*` script. References are kept as the record of how each finding was established; they are not runnable instructions. `npm test`, `cargo test` and `npm run check:bundle` are the only automated checks left.

**Project Name:** Greater Bangkok Metro Mini 3D — 3D Transit Simulation Platform
**Version:** 1.0.0
**Status:** Active Specification
**Last Updated:** 2026-08-26
**Repository:** [tha-metro-mini-3d](https://github.com/naiiytom/tha-metro-mini-3d)

---

## 1. Executive Summary & Vision

Greater Bangkok Metro Mini 3D is an interactive, web-based 3D visualization and simulation platform that models the scheduled movement of Bangkok's rail transit network. Inspired by [Mini Tokyo 3D](https://minitokyo3d.com/), the application renders 3D train models operating along authentic geographic coordinates, station elevations, and published schedule constraints.

The platform uses the open **Static GTFS** data standard published for Thailand's transit networks (via the Namtang / OTP open-data programme) and computes vehicle kinematics in a high-performance simulation core compiled from **Rust to WebAssembly**. Rendering is handled by a modern web 3D stack: **Vite**, **TypeScript**, **MapLibre GL JS**, and **Three.js**.

> **Scope note — simulated vs. real-time.** Version 1.0 is driven exclusively by *static* GTFS timetables. Trains are placed by interpolating scheduled arrival/departure times, not by live vehicle positions (GTFS-Realtime). The product therefore visualizes the *scheduled* network state at any chosen moment, including past and future times via time-scrubbing. Live real-time tracking is explicitly out of scope for this version (see §8).

---

## 2. System Scope & Transit Coverage

The simulation covers the major urban rail networks in the Bangkok Metropolitan Region (14 lines in registry total: 12 simulated lines, 2 track-only pre-revenue lines, 198 stations, 9,609 daily expanded runs):

| Line | Transit Type | Operator | Structure | Status |
|------|-------------|----------|-----------|--------|
| BTS Sukhumvit Line | Heavy Rail | BTSC | Elevated | Full Simulation |
| BTS Silom Line | Heavy Rail | BTSC | Elevated | Full Simulation |
| MRT Blue Line | Heavy Rail | BEM | Underground / Elevated (per-segment) | Full Simulation |
| MRT Purple Line | Heavy Rail | BEM | Elevated | Full Simulation |
| SRT Dark Red Line | Commuter Rail | SRTET (SRT) | At-Grade / Elevated (per-segment) | Full Simulation |
| SRT Light Red Line | Commuter Rail | SRTET (SRT) | At-Grade / Elevated (per-segment) | Full Simulation |
| Airport Rail Link (ARL) | Express / Commuter | Asia Era One (SRT) | Elevated | Full Simulation |
| MRT Pink Line (Trunk) | Monorail | NBM | Elevated | Full Simulation (Est. transit times) |
| MRT Yellow Line | Monorail | EBM | Elevated | Full Simulation |
| BTS Gold Line | Automated People Mover | BMA / KT (operated by BTSC) | Elevated | Full Simulation |
| MRT Orange Line | Heavy Rail | MRTA | Underground / Elevated (per-segment) | Track-only (Pre-revenue) |
| MRT Purple Line (Phase 2) | Heavy Rail | MRTA / BEM | Underground / Elevated (per-segment) | Track-only (Pre-revenue) |
| MRT Pink Line (IMPACT Link) | Monorail | NBM | Elevated | Full Simulation (Est. transit times) |
| Suvarnabhumi APM | Automated People Mover | AOT | Underground | Full Simulation (Synthetic 24h schedule) |

**Coverage assumptions & data provenance**

- **Full Simulation (12 lines)**: Operating lines receive schedule interpolation, vehicle kinematics, and station arrival/departure boards.
- **Track-Only Pre-Revenue (2 lines)**: MRT Orange and MRT Purple Phase 2 are rendered as track geometry with pre-revenue styling (dashed centerline, desaturated deck), 0 simulated vehicles, and 0 stations.
- **Estimated / Synthesized Schedules**:
  - *MRT Pink Line & IMPACT Link Spur*: The Namtang GTFS feed carries 0 s transit time rows; inter-station runtimes are estimated from track arc length using a speed calibrated from the MRT Yellow Line.
  - *Suvarnabhumi APM*: Absent from GTFS; operational continuous service is synthesized from observed headway parameters (180 s headway, 120 s runtime, 40 s dwell) and badged in the UI.
- **Interchange relationships**: Linked automatically within a 300 m radius, augmented by explicit manual overrides for long pedestrian connections (e.g. Nonthaburi Civic Center, Sala Daeng/Si Lom, Phetchaburi/Makkasan, Suvarnabhumi ARL/APM, Ha Yaek Lat Phrao/Phahon Yothin, Hua Mak ARL/Yellow, Bang Sue SRT/MRT). Used for the station board, inspector, and RAPTOR route search.

---

## 3. Recommended Tech Stack

To achieve high rendering performance (target 60 FPS) and fast data parsing without blocking the main UI thread, the following modern stack is specified.

```
+-----------------------------------------------------------------------+
|                             USER INTERFACE                            |
|             React 19 / Tailwind CSS / Lucide React / Vite             |
+-----------------------------------------------------------------------+
                                   |
+----------------------------------v------------------------------------+
|                         VISUALIZATION LAYER                           |
|      MapLibre GL JS (Base Map)  <--->  Three.js / WebGL Layer         |
+-----------------------------------------------------------------------+
                                   |
+----------------------------------v------------------------------------+
|                         SIMULATION CORE ENGINE                        |
|  Rust (Wasm Engine via `wasm-pack`) + Web Worker Thread               |
|  - GTFS Parsing & Binary Serialization (Bincode / MessagePack)        |
|  - Timetable Interpolation & Spline Curve Calculation                 |
+-----------------------------------------------------------------------+
                                   |
+----------------------------------v------------------------------------+
|                            DATA PIPELINE                              |
|  OTP / Namtang GTFS Feed + OpenStreetMap (Geometry) + Scraper         |
+-----------------------------------------------------------------------+
```

**Build tooling & dev server:** Vite + TypeScript.

**UI layer:** React 19. *(The framework is fixed to React for v1.0 to match the component structure in §6. Svelte was considered but is deferred to keep a single, consistent component model; see §8.)*

**Core processing engine (Rust → Wasm):**

- Rust compiled to WebAssembly via `wasm-pack` for fast binary parsing of GTFS datasets, timetable lookup, spatial interpolation, and spline vector generation.
- Web Workers execute the Wasm simulation loop off the main UI/render thread.

**Map & spatial rendering:**

- **MapLibre GL JS** — vector-tile base map, 3D terrain and building extrusion support.
- **Three.js** (via a custom MapLibre WebGL layer) — 3D vehicle models (`.glb` / `.gltf`), lighting, shadows, and camera matrices.
- **Spatial utilities** — Turf.js on the JS side, or Rust spatial crates (`geo`, `spade`) inside Wasm.

---

## 3A. Technical Design Deep-Dive & Stack Validation

This section validates each stack choice against the project's actual constraints, documents the non-obvious risks, and records where a different tool would be the better call. It exists because several of these decisions are load-bearing and expensive to reverse once code is written.

### 3A.1 Overall verdict

The stack is well-matched to the problem and closely mirrors the proven Mini Tokyo 3D architecture. **No layer needs to be replaced**, but four decisions carry real risk and are called out below: the cross-origin isolation requirement for shared-memory threading (3A.3), the MapLibre↔Three coordinate/depth bridge (3A.4), floating-point precision at city scale (3A.5), and the serialization-format choice (3A.6). Each has a concrete recommendation.

### 3A.2 Rust → WebAssembly core

**Why it fits.** GTFS parsing, spline generation, and per-frame interpolation for hundreds of vehicles are CPU-bound numeric work — exactly where Wasm's near-native throughput and predictable (GC-free) timing beat JavaScript. Rust's `wasm-bindgen` / `wasm-pack` toolchain is the mature default.

**Gotchas & recommendations.**

- **The JS↔Wasm boundary is the bottleneck, not the math.** Marshalling data across the boundary every frame (especially anything that touches JS objects or strings) will dominate your 3-ms budget. *Recommendation:* the engine should write vehicle transforms into a single flat, pre-allocated `Float32Array` (a linear-memory view), and JS reads that buffer directly with zero per-vehicle calls. Design the API around "tick(time) → fills shared buffer," not "getVehicle(id)."
- **Wasm bundle weight.** Pull in `wee_alloc` or the default allocator carefully, enable `opt-level = "z"`/`"s"` and `lto`, and run `wasm-opt` (via `wasm-pack`'s release profile). A careless build can add 300–500 KB against your 5 MB budget.
- **`geo`/`spade` are fine**; you likely only need `geo` for Catmull-Rom/Bézier resampling. `spade` (Delaunay) is probably overkill for v1.0 — defer it.

### 3A.3 Web Worker concurrency — the cross-origin isolation trap

**This is the highest-risk item in the spec.** The plan to run the Wasm simulation loop in a Worker and share results with the main thread implies `SharedArrayBuffer`. Since Spectre, `SharedArrayBuffer` is **only available in cross-origin-isolated contexts**, which requires serving the app with both headers:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp   (or credentialless)
```

**Consequences you must plan for now, not later:**

- Every cross-origin sub-resource (map tiles, fonts, CDN scripts, GLTF assets) must send `Cross-Origin-Resource-Policy` / proper CORS, or it will be **blocked** under `require-corp`. Your MapLibre tile source in particular must be COEP-compatible.
- Static hosts differ in header support — GitHub Pages can't set these; Netlify/Cloudflare Pages/Vercel can. **Confirm the deployment target supports custom headers before the Worker is introduced in MVP 3** (only required if the `SharedArrayBuffer` path is chosen).

**Two mitigation paths:**

1. **Avoid `SharedArrayBuffer` entirely (recommended for v1.0).** Use standard `postMessage` with **transferable** `ArrayBuffer`s. The Worker owns the buffer, computes a tick, and transfers it to the main thread each frame (or on a fixed sim cadence, decoupled from render). Transfer is zero-copy and sidesteps the entire COOP/COEP problem. This is simpler and almost certainly fast enough at 300 vehicles.
2. **Use `SharedArrayBuffer`** only if profiling proves transfer overhead matters — and only after confirming the header/hosting story.

*Recommendation:* Spec v1.0 around transferable buffers; treat `SharedArrayBuffer` as an optimization behind a feature flag.

### 3A.4 MapLibre GL JS ↔ Three.js bridge

**Why it fits.** This is the canonical way to draw true-3D content (models, shadows, arbitrary meshes) over a vector base map, and it's exactly what Mini Tokyo 3D does. MapLibre's `CustomLayerInterface` hands you the WebGL context and a per-frame projection matrix.

**Gotchas & recommendations.**

- **Coordinate conversion.** Three.js world units are *not* lng/lat. You must project every position through `MercatorCoordinate.fromLngLat()` and apply the resulting scale, and feed MapLibre's supplied matrix into your Three camera each frame. Getting the mercator *meters-per-unit* scale right (it varies with latitude) is the classic source of "my trains are the size of buildings" bugs.
- **Depth & occlusion.** Sharing the depth buffer between MapLibre's tiles/buildings and the Three layer is fiddly — this is precisely what makes the **underground transparency mode (F3.2)** non-trivial. Underground track at −25 m must be occluded by terrain unless transparency is toggled. Budget explicit time for depth-test/params tuning; don't assume it's free.
- **Context sharing.** Both must render into the **same** WebGL context. Do not let Three create its own canvas/context.

**Alternative worth a look:** **deck.gl** with `MapboxOverlay` (interleaved mode) works with MapLibre and manages the projection/depth interop for you, and it excels at large numbers of instanced objects. Trade-off: less low-level control over custom shaders/camera than raw Three.js, and Mini Tokyo 3D deliberately uses Three for that control. *Recommendation:* stay with Three.js for the model fidelity and follow-camera requirements, but if the bridge math becomes a time sink, deck.gl is a credible fallback.

### 3A.5 Rendering scale: instancing and float precision

- **Draw calls.** 300 trains as 300 separate meshes = 300 draw calls plus overhead. *Recommendation:* use Three.js `InstancedMesh` per vehicle type, updating a single instance-matrix buffer from the Wasm output array. This collapses hundreds of draws into a handful and is the key to hitting 60 FPS on a GTX 1050.
- **Float32 precision at city scale.** WebGL is `float32`. Absolute mercator/world coordinates for Bangkok are large enough that `float32` precision causes visible vertex jitter, especially in follow-camera. *Recommendation:* adopt a **floating-origin / camera-relative** scheme — keep geometry in coordinates relative to a local origin near the current view, not absolute world space. This is a well-known WebGL-mapping pattern; design it in from MVP 1 (the initial map↔Three bridge) rather than retrofitting.
- **Shadows (F3.1/F3.3).** Real-time shadow maps for a day/night cycle across the whole city are expensive. *Recommendation:* single directional light with a tightly-fit shadow frustum (or shadows only near the camera), and make shadows a quality toggle for the 30-FPS mobile target.

### 3A.6 Serialization format for the binary cache

The spec lists "Bincode or MessagePack" (and mentions Protobuf elsewhere). These are **not** equivalent for this use case:

- **MessagePack** — cross-language, self-describing, good if any non-Rust tool must read the cache. Requires full deserialization into structs before use.
- **Bincode** — compact and fast, Rust-to-Rust only; also requires deserialization into owned structs (allocations at load time).
- **`rkyv` (recommended to evaluate)** — zero-copy deserialization: you memory-map/typecast the bytes and read structs *in place* with no parse step. For a "load a big timetable blob once, then random-access it" pattern, this meaningfully improves cold-start and memory. Trade-off: stricter schema handling and a slightly steeper learning curve.

*Recommendation:* if the cache is only ever produced and consumed by your own Rust code (it is), evaluate **`rkyv`** first; fall back to **Bincode** for simplicity. Reserve MessagePack/Protobuf for any interchange boundary that must be language-neutral. Whichever you pick, `gzip`/`brotli` on the wire still applies to the <3 MB target.

### 3A.7 Simulation-loop architecture

- **Decouple sim tick from render frame.** Run the Wasm simulation at a fixed cadence (e.g., a stable timestep) and **interpolate transforms on the render side** between the two latest sim states. This keeps motion smooth even if a sim tick occasionally runs long, and makes the time-warp multipliers (F2.3) a clean scalar on sim time rather than a render-rate hack.
- **State ownership.** The Worker/Wasm owns simulation truth; the main thread owns render/camera/UI. Zustand (already chosen) holds only UI-facing derived state (selected train, active line filters), not per-frame kinematics — those never enter React state or you'll thrash re-renders.

### 3A.8 Data pipeline reality check

- **Scraping (Apify) is a legal/stability risk, not a technical one.** Treat any scraped schedule as a fallback where no GTFS exists, cache it aggressively, and record provenance (see NF4). Do not put a live scrape in the client runtime — it belongs in the offline preprocessing CLI only.
- **GTFS `shapes.txt` quality varies.** Bangkok feeds may have coarse or missing shapes; the OSM-geometry fallback and spline resampling (F1.3) are therefore not optional polish — they're core pipeline steps. Budget for shape/stop-snapping (aligning stop coordinates onto the track line).

### 3A.9 Summary of recommendations

| Area | Spec as written | Recommendation | Priority |
|------|-----------------|----------------|----------|
| Worker sharing | Web Worker (implies SharedArrayBuffer) | Transferable `ArrayBuffer` via `postMessage`; avoid COOP/COEP for v1.0 | **High** |
| JS↔Wasm API | per-vehicle access implied | Single flat `Float32Array` transform buffer | **High** |
| Rendering | GLTF per vehicle | `InstancedMesh` per vehicle type | **High** |
| Precision | absolute world coords | Floating-origin / camera-relative coords | **High** |
| MapLibre↔Three | custom WebGL layer | Keep Three; know `MercatorCoordinate` + depth-buffer work; deck.gl as fallback | Medium |
| Serialization | Bincode / MessagePack / Protobuf | Evaluate `rkyv` first; else Bincode | Medium |
| Sim loop | 60 FPS tick | Fixed-timestep sim + render-side interpolation | Medium |
| Shadows | dynamic day/night shadows | Tight shadow frustum; quality toggle on mobile | Low |

---

## 4. Architectural & Functional Requirements

### F1. Data Pipeline & Preprocessing Engine

- **F1.1 — GTFS ingestion.** The engine must ingest static GTFS datasets. Required files: `trips.txt`, `stop_times.txt`, `shapes.txt`, `routes.txt`, `stops.txt`, `calendar.txt`, and `calendar_dates.txt`. `agency.txt` is parsed for operator attribution. *(Calendar files are required to resolve which services run on a given date and were added here because scheduling is impossible without them.)*
- **F1.2 — Pre-compiled binary cache.** A Rust CLI preprocessor converts raw GTFS ZIP feeds into a compact binary format (Bincode or MessagePack) to minimize client payload. **Target: < 3 MB compressed** for the timetable/geometry bundle.
- **F1.3 — Route geometry & elevation (Z-axis).**
  - GeoJSON shapes carry 3D coordinates: `[longitude, latitude, altitude_meters]`.
  - Altitude offsets by structure type:
    - Underground (MRT Blue tunnelled sections): **−12.0 m to −25.0 m**
    - At-grade (SRT ground sections): **+0.5 m**
    - Elevated (BTS / monorails / ARL): **+12.0 m to +22.0 m**
  - Spline smoothing (Catmull-Rom or cubic Bézier) is applied to track paths to prevent abrupt heading changes at curve nodes.

### F2. Timetable & Motion Interpolation Engine

- **F2.1 — Interpolation algorithm.** Given system time *t*, the vehicle's active state is:

$$
\text{Status}(t) =
\begin{cases}
\text{Dwell at Station } A, & t_{\text{arr},A} \le t \le t_{\text{dep},A} \\
\text{In transit } A \rightarrow B, & t_{\text{dep},A} < t < t_{\text{arr},B} \\
\text{Inactive}, & \text{otherwise}
\end{cases}
$$

  The in-transit position uses a normalized progress value *p* with a smooth ease-in/ease-out (S-curve / smoothstep) profile to mimic acceleration and deceleration:

$$
p = \frac{t - t_{\text{dep},A}}{t_{\text{arr},B} - t_{\text{dep},A}}, \qquad
\text{Progress}(p) = 3p^2 - 2p^3
$$

- **F2.2 — Heading & orientation.** Compute continuous yaw angles from the track's 3D tangent vector so models face the exact direction of travel.
- **F2.3 — Time-warp controls.** Support real-time clock synchronization, speed multipliers (**1×, 5×, 10×, 60×**), and a custom time-picker for scrubbing to any moment.

### F3. 3D Scene Rendering & Camera Control

- **F3.1 — Train models.** Lightweight GLTF/GLB models per vehicle type (4-car heavy rail; 3/4-car monorail), coloured to each line's identity. **Not delivered as of MVP 6 (deliberately, not silently dropped).** The shipped implementation uses procedural `ConsistSpec` geometry (merged vertex-colored `InstancedMesh` per route) instead — it already gives four visually distinct fleets at one draw call per route and satisfies every other F3.1/§3A.5 requirement, so swapping in real GLTF assets was judged a self-contained visual upgrade with its own asset-pipeline questions (sourcing, licensing, LOD thresholds — see NF2) that doesn't gate any other v1.0 requirement. It is the one v1.0 functional requirement this SRS's delivered MVPs (1–6) do not close; it belongs in its own future task.
- **F3.2 — View modes.**
  - *Overview / free camera* — smooth orbit controls over the Bangkok area.
  - *Vehicle follow (third-person)* — camera transform smoothly locks to a selected train ID.
  - *Underground transparency* — reduce terrain/building opacity (**0.1 to 0.4**) when viewing underground segments (MRT Blue). **Delivered MVP 7:** auto-engage/release while following — `src/map/autoUnderground.ts`'s `decideAutoUnderground` reads the followed vehicle's LANE_Z altitude (not its track structure tag) each frame, engaging underground mode below −5 m and releasing above −1 m, with a 4 m hysteresis band so it doesn't flicker at a portal straddle; a manual toggle mid-follow overrides auto for the rest of that follow session so auto never fights the user. Verified end-to-end (real store, real vehicle buffer, real rAF loop) by the MVP 7 acceptance harness checks 8-9.
  - *Basemap style cycle.* **Delivered MVP 7 (roadmap item 21):** three key-free vector styles — Liberty (default), Bright, Positron (`src/map/basemapStyles.ts`) — swappable at runtime. `map.setStyle()` destroys the Three.js custom layer, so every `style.load` side-effect re-runs (`src/map/styleBinding.ts`'s per-style/per-map split — see CLAUDE.md's MVP 7 implementation notes). Vector-only, deliberately: satellite/terrain would need `raster-opacity`/`raster-brightness-*` equivalents plus a keyed provider and its own ToS review, out of scope here. **Known disclosed gap:** on Bright/Positron, a handful of layers (`landcover-glacier`/`landcover_wood`/`landuse_residential`/`aeroway-area`) use a zoom-expression `fill-opacity` rather than a flat number; `styleBinding.ts`'s underground-dimming capture has no type guard for that (unlike its colour-capture path, which does guard), so `Math.min(expression, 0.25)` silently NaNs for those layers and logs a console validation error — underground mode still dims every other layer correctly. Found in MVP 6 Task 6 review (Bright), re-confirmed on Positron by the MVP 7 harness (4 layers); small, low-risk fix mirroring the existing colour-skip pattern, not yet scheduled.
- **F3.3 — Environmental effects.** Dynamic day/night lighting driven by the simulated clock (sun-position calculation). **Delivered MVP 7:**
  - *Theme tri-state (roadmap item 21).* Auto (clock-driven, the original F3.3 behaviour and default) / Light / Dark (`src/map/themeMode.ts`). Light and Dark pin the *palette* only via `effectiveElevationDeg` — the sun's direction stays clock-real in every mode, only `sun.ts`'s `skyPalette` and `basemapTheme.ts`'s `nightFactor` read the pinned elevation instead of the real one.
  - *Sky dome (roadmap item 6, "sunset glow").* `src/map/skyDome.ts` — a horizon-clipped Three.js sphere (`RADIUS_M = 120_000`) that discards every fragment below the local ENU horizon plane rather than attempting real depth interop with MapLibre's tiles (same disclosed-tradeoff shape as F3.2's underground opacity mode). Colours come from the same `skyPalette` that lights the scene, so the horizon warms exactly when the key light warms. Verified visually clean at pitch ≥70° (its only meaningfully-exercised regime — pitch 0/45 pass vacuously, nothing is drawn there to wash) across noon/02:00; the MVP 7 harness check 10 asserts the mesh's `renderOrder < 0` and disabled depth write/test.
- *(F3.4 intentionally unused — no requirement was ever assigned this number; F3.5/F3.6 below were appended by MVP 7 without renumbering to avoid invalidating existing cross-references to F3.5/F3.6 elsewhere in this document and in CLAUDE.md.)*
- **F3.5 — Power saving (new, roadmap item 2).** *Eco mode* (`src/stores/useAppStore.ts`'s `ecoMode`) throttles both the render loop's repaint cadence and the sim worker's own tick rate to ~1 Hz (`ECO_TICK_MS = 1000`); measured steady-state is an exact 1 repaint/second once a ~1 s enable-moment transient (MapLibre's own internal repaint settling, not the app's throttle) passes. Positions are a pure function of time, so nothing drifts while throttled — confirmed by the MVP 7 harness check 12 comparing a fresh `getInterpolated()` read immediately after disabling against the last-rendered pose (sub-2 m delta, consistent with ordinary train speed over the elapsed tens of milliseconds, not a catch-up jump).
- **F3.6 — Fullscreen (new, roadmap item 1).** The browser Fullscreen API on the app's whole-shell container (`[data-testid="map-container"]`, `App.tsx`'s top-level wrapper — not `MapContainer.tsx`'s own div, which only ever holds MapLibre's injected DOM plus the imperative train tooltip, never the React-rendered overlays). Esc exits natively; `ViewControls.tsx` mirrors `document.fullscreenElement` via a `fullscreenchange` listener rather than store state, since Esc bypasses any app-level handler.

### F4. User Interface & Information Overlay

- **F4.1 — Live line selector.** Toggle visibility of individual lines (e.g., BTS Sukhumvit, MRT Blue, monorails).
- **F4.2 — Station & vehicle inspector card.** Clicking a train or station shows route name, next-station ETA, interchange options, and origin/destination.
- **F4.3 — Live timetable drawer.** Bottom panel listing currently active trains and upcoming departures for the selected station.

---

## 5. Non-Functional Requirements

**NF1 — Performance & frame rate.**
Target 60 FPS on desktop (GTX 1050 / Apple M1 or equivalent) and 30+ FPS on mobile WebGL browsers. The Wasm simulation tick must complete in **< 3 ms per frame** for up to **300 concurrent active vehicles**.

> **Status as of MVP 6 (2026-08-02), measured by the NF1 perf harness against a production build of the full 10-line network:** 4 of 5 sub-checks pass — the same tally as MVP 5. The sim ticks a meaningful sample count during the measurement window (rules out a silently-dead worker), sim tick p95 ≈ 0.3 ms (well under the 3 ms budget) and frame rate ≈ 100 FPS (well over both the 60/30 FPS targets) both pass comfortably, and no frame is truncated. The **300-concurrent-vehicle scale target is still not reached**: the real network's measured daily peak (`public/data/network.report.json`'s `peak_concurrent`, the preprocessor's static per-minute weekday scan) is **246** vehicles with MRT Blue added — up from MVP 5's 171–172, still short of 300. A live the perf harness run on 2026-08-02 (a Sunday) observed `stats.maxCount = 197`, not 246, because the harness's probe clock is built from *today's* date at the weekday peak's time-of-day — on a weekend run that samples the weekend calendar at the weekday's busiest minute, landing between the true weekday peak (246) and weekend peak (212). Either real number is a fact about actual GTFS schedule density across these 10 lines, not a performance defect. **This gap is not explained by MVP 6's one deferred task** (Task 6, MRT Orange + MRT Purple's southern extension): both would have been track-only, contributing zero simulated vehicles to this count regardless of whether they were built. `MAX_VEHICLES` = 1024 leaves ~4× headroom over the higher (246) measured peak. The the perf harness assertion is left as a hard, currently-failing gate rather than weakened or satisfied with synthetic load, so a future regression (or a future denser network) is still caught.

> **Status as of MVP 7 (2026-08-05):** unchanged. The registry (12 lines, 10 simulated) and its schedule density didn't move in MVP 7 — Tasks 1-11 were guardrails/presentation work (preprocessor sanity gates, theme/basemap/eco/fullscreen/sky UI, a legibility harness), none of which add or remove a simulated vehicle. A fresh the NF1 perf harness run (2026-08-05, a Wednesday, sampling the real weekday peak) reproduces the same 4/5 tally: sim tick p95 0.30 ms, ~100 FPS, no truncation, peak 246 — still the disclosed, deliberately-failing gate above.
>
> **Stale as of this paragraph — corrected 2026-08-08.** The weekend peak of **212** cited above was itself inflated by a real bug (see CLAUDE.md's "MRT Blue weekend calendar split" note): MRT Blue's day-qualified trips ("Tao Poon (Saturday)" vs. "Tao Poon (Sunday and Public Holiday)") shared one ambiguous Saturday+Sunday GTFS calendar entry, so both variants were simulated simultaneously on every weekend day, roughly double-counting that line's weekend vehicles. After the fix, the real weekend peak is **173**. The **weekday** peak (246) is unaffected — none of the fixed trips ran on a weekday service — so the 300-vehicle gap and everything else in the paragraph above still holds unchanged.

**NF2 — Initial load & optimization.**
Total initial bundle **≤ 5 MB** (compressed assets + binary timetable). 3D GLTF models lazy-load asynchronously with Level-of-Detail (LOD) progressive detail.

> **Status as of MVP 7 (2026-08-05):** `npm run check:bundle` reports **1.03 MB gzip / 5.00 MB budget** for the full production build (`dist/` + `network.tmb`) — up from MVP 6+Orange/Purple's 1.01 MB, from MVP 7's added UI/control-surface code (theme tri-state, basemap style cycle, auto-underground, sky dome, eco mode) and its CSS. Still comfortably under budget (21% used).

**NF3 — Cross-platform compatibility.**
Modern desktop and mobile browsers supporting WebGL 2.0 and WebAssembly: Chrome 90+, Safari 15+, Firefox 88+, Edge (Chromium).

**NF4 — Data provenance & licensing.** *(Added — required before public release.)*
All data sources must be license-compatible with public deployment. GTFS feeds are used under their published open-data terms; OpenStreetMap geometry requires ODbL attribution. Any scraped source must comply with the origin site's Terms of Service — scraping is a fallback only where no open feed exists, and its legal basis must be confirmed per source.

**NF5 — Accessibility & internationalization.** *(Added.)*
UI text supports Thai and English. Interactive controls meet WCAG 2.1 AA for contrast and keyboard operability where feasible within a 3D canvas app.

> **Status as of MVP 7 (2026-08-05):** the WCAG 3:1 contrast half of this requirement is now machine-checked for the first time (the night-legibility harness, MVP 7 Task 11) — and it currently **fails honestly**, not passes. Sampling real lit deck pixels (not the unlit centerline a first attempt at this harness accidentally always hit — see CLAUDE.md's MVP 7 notes) against the basemap at noon and 02:00 for all 10 simulated lines: 14 of 20 line/time combinations fall under the 3:1 floor, including 9 of 10 lines at night (only Airport Rail Link passes both times). `MIN_CONTRAST` is pinned at the real WCAG value (3.0), not weakened to whatever passes — same precedent as NF1's the perf harness gate above. MRT Blue's failure is specifically traced to 8-bit sRGB colour quantization saturating its `#1964B7` livery near-black at night regardless of the ambient-light floor; the other 8 failing lines may have more headroom. A follow-up task (not MVP 7) should address the underlying night-lighting shortfall with a per-material minimum-brightness mechanism, not another `sun.ts` ambient-floor tweak.

**NF6 — Maintainability & data refresh.** *(Added.)*
Timetable data is versioned; the preprocessing CLI is re-runnable to regenerate the binary cache when a new GTFS feed is published. Target refresh cadence: on each upstream feed update.

---

## 6. Proposed Project Folder Structure

```
tha-metro-mini-3d/
├── rust-engine/                 # Rust Wasm simulation core
│   ├── Cargo.toml
│   └── src/
│       ├── lib.rs               # Wasm bindings (wasm-bindgen)
│       ├── gtfs_parser.rs       # Binary schedule reader
│       ├── interpolation.rs     # Velocity curves & spatial solver
│       └── spatial.rs           # Track geometry & spline utilities
├── src/                         # Vite + React frontend
│   ├── assets/                  # Models (.glb), textures, icons
│   ├── components/              # UI overlay, line controls, inspector
│   │   ├── MapContainer.tsx
│   │   ├── ControlPanel.tsx
│   │   ├── TrainInspector.tsx
│   │   └── TimeScrubber.tsx
│   ├── map/                     # MapLibre & Three.js bridge
│   │   ├── ThreeLayer.ts        # Custom MapLibre WebGL layer
│   │   ├── VehicleManager.ts    # 3D model pool & transform updates
│   │   └── CameraController.ts  # Smooth follow & pitch logic
│   ├── stores/                  # State management (Zustand)
│   ├── types/                   # TypeScript interfaces
│   ├── App.tsx
│   └── main.tsx
├── tools/                       # CLI preprocessing tools
│   └── gtfs_preprocessor/       # Converts GTFS zip to optimized binary
├── index.html
├── vite.config.ts
└── package.json
```

---

## 7. System Architecture & Subsystems

The system is organized into modular subsystems operating with clear boundaries:

### 7.1 Data Pipeline & Offline Processing
- **OpenStreetMap Overpass Extractor**: Fetches high-precision 3D railway track geometries and station nodes from pinned route relations and construction ways (`tools/fetch-network.mjs`). Applies automated grade-limit relaxation (`tools/trackProfile.mjs`, ruling gradient ≤4%) to prevent portal visual artifacts.
- **GTFS Preprocessor CLI (`rust-engine/preprocessor`)**: Ingests static GTFS data and OSM track geometry, snaps station coordinates monotonically along each pattern's arc length, expands headways/frequencies into concrete daily runs, resolves multi-trip route claims, and serializes the complete network into a compact bincode binary timetable (`public/data/network.tmb`).

### 7.2 Simulation Core & WebAssembly Engine (`rust-engine/sim-core`, `rust-engine/wasm`)
- **Kinematics & Interpolation**: Computes continuous train poses (position, elevation, yaw heading, transit state) as a pure function of simulated Bangkok time (UTC+7). Employs cubic smoothstep S-curves (`3p² − 2p³`) for realistic station acceleration and deceleration.
- **RAPTOR Multi-Criteria Route Planner**: Executes round-based connection scans over the preprocessed timetable graph. Computes non-dominated itineraries (earliest arrival and fewest transfers), transfer instructions, and ride leg geometries.
- **Web Worker Decoupling**: The simulation loop runs at a fixed 10 Hz in a Web Worker, publishing state via ping-pong transferable `Float32Array` buffers to decouple compute from the 60 FPS rendering loop.

### 7.3 Visualization & Rendering Subsystem (`src/map/`)
- **MapLibre ↔ Three.js Bridge**: Custom WebGL layer rendering inside MapLibre GL JS's context with a floating local ENU meter origin around Siam (`ORIGIN_LNG_LAT`).
- **Vehicle Manager**: High-performance single-draw-call per route rendering via `THREE.InstancedMesh`. Supports parametric carriage geometry, authentic consist lengths, roof pantographs on 25 kV AC lines, and glowing cabin windows at night.
- **Atmosphere & Theming**: Real-time solar position calculations (NOAA) driving dynamic sky palettes, horizon-clipped sky dome, and WCAG-compliant emissive contrast lifting for night readability.
- **Underground Mode**: Altitude-aware sub-surface visualization with automatic tunnel entry/exit engagement and hysteresis.

### 7.4 User Interface Subsystem (`src/components/`, `src/stores/`)
- **Overlay Panels**: Glassmorphism controls for train inspection, live station departures board, bilingual station search with Geolocation, and RAPTOR route planning.
- **State Management**: Reactive UI state managed via Zustand, keeping high-frequency per-frame transform data strictly off the React render path.

---

## 8. Out of Scope (v1.0) & Future Work

The following are explicitly excluded from v1.0 and recorded for future consideration:

- **GTFS-Realtime / live vehicle positions** — v1.0 is schedule-driven only.
- ~~Passenger routing / journey planning~~ — **delivered 2026-08-16** via timetable-aware RAPTOR router in Rust/Wasm with multi-criteria alternative itineraries.
- ~~Station search & Geolocation~~ — **delivered 2026-08-07** with bilingual Thai/English search and HTML5 Geolocation.
- **Orange Line train simulation** — track geometry is in v1.0 (§7 MVP 6), but moving trains and a timetable are deferred until the line enters revenue service and a schedule is published.
- **Future line extensions** — planned or under-construction extensions of the in-scope lines (e.g., additional phases of existing lines) and any other lines beyond §2 are future work. When each opens, an operational line reuses the MVP 5/6 path (add feed → simulate), and a pre-revenue line reuses the Orange Line pattern (track geometry only).
- ~~Custom rolling stock models & liveries~~ — **delivered 2026-08-22** via procedural parametric consist models and GLB override seam.
- ~~MRT Orange + MRT Purple Phase 2 (track-only, pre-revenue)~~ — **delivered 2026-08-04**, no longer out of scope. See §7 MVP 6's own delivery note above (both are in the registry, `orange` since merged from separate East/West entries into one).
- ~~Manual dark/light theme toggle + basemap style cycling~~ — **delivered in MVP 7** (F3.2/F3.3 above, §7 MVP 7).
- **Svelte UI variant** — React is the committed framework for v1.0.
- **Backend services / user accounts** — the app is a static, client-side deployment.
- **`tools/trackProfile.mjs`'s gradient-limiting relaxation sweep is bounded at `maxIterations = points.length + 2`** — an O(n²) worst case never exercised by real track data (every line converges in 1–2 passes) and one that logs nothing if it were ever actually hit, so a future pathological input could silently slow the pipeline with no visible signal.

---

## 9. Assumptions & Dependencies

- A reasonably complete and current static GTFS feed is available for each in-scope line; where a feed is missing or incomplete, gaps are filled from OpenStreetMap geometry and documented.
- Station elevations are approximated from structure type (§F1.3) rather than surveyed values, unless authoritative altitude data is available.
- 3D train models are either sourced under a compatible license or produced in-house.
- End-user devices meet the WebGL 2.0 / WebAssembly baseline in NF3.

---

## 10. Testing & Acceptance Criteria *(Added)*

- **Data pipeline:** Preprocessor output validated against source GTFS (trip counts, stop sequences, service calendars) with automated checks.
- **Simulation correctness:** For a sampled set of trips, computed positions at known times match scheduled stop locations within tolerance; no train overshoots its terminus or renders while inactive.
- **Performance:** Frame-rate and Wasm tick-time targets (NF1) verified on reference hardware with 300 active vehicles. As of MVP 6, the NF1 perf harness verifies tick-count sanity, tick time, no-truncation, and frame rate against the real 10-line network (all pass, 4/5); the 300-vehicle scale check itself is a known-failing gate against the network's real 246-vehicle (weekday) peak — see §5's NF1 status note.
- **Bundle size:** CI check enforces the ≤ 5 MB initial-load budget (NF2).
- **Cross-browser:** Smoke tests pass on the NF3 browser matrix.

---

## Appendix A — Glossary

| Term | Definition |
|------|-----------|
| **GTFS** | General Transit Feed Specification — open standard for static transit schedules and geometry. |
| **GTFS-Realtime** | Companion standard for live vehicle positions/alerts (out of scope, §8). |
| **Namtang / OTP** | Thailand's open transit data programme / Office of Transport and Traffic Policy and Planning. |
| **Wasm** | WebAssembly — portable binary instruction format run in the browser. |
| **LOD** | Level of Detail — swapping model complexity by distance for performance. |
| **Dwell** | Period a train is stopped at a station between arrival and departure. |
| **Smoothstep** | The `3p² − 2p³` easing curve used for acceleration/deceleration (§F2.1). |
| **Catmull-Rom / Bézier** | Spline methods used to smooth track geometry (§F1.3). |
