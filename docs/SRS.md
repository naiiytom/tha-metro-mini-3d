# Software Requirements Specification (SRS)

**Project Name:** Greater Bangkok Metro Mini 3D — 3D Transit Simulation Platform
**Version:** 1.0.0
**Status:** Draft / Technical Proposal
**Last Updated:** 2026-08-02
**Repository:** [tha-metro-mini-3d](https://github.com/naiiytom/tha-metro-mini-3d)

---

## 1. Executive Summary & Vision

Greater Bangkok Metro Mini 3D is an interactive, web-based 3D visualization and simulation platform that models the scheduled movement of Bangkok's rail transit network. Inspired by [Mini Tokyo 3D](https://minitokyo3d.com/), the application renders 3D train models operating along authentic geographic coordinates, station elevations, and published schedule constraints.

The platform uses the open **Static GTFS** data standard published for Thailand's transit networks (via the Namtang / OTP open-data programme) and computes vehicle kinematics in a high-performance simulation core compiled from **Rust to WebAssembly**. Rendering is handled by a modern web 3D stack: **Vite**, **TypeScript**, **MapLibre GL JS**, and **Three.js**.

> **Scope note — simulated vs. real-time.** Version 1.0 is driven exclusively by *static* GTFS timetables. Trains are placed by interpolating scheduled arrival/departure times, not by live vehicle positions (GTFS-Realtime). The product therefore visualizes the *scheduled* network state at any chosen moment, including past and future times via time-scrubbing. Live real-time tracking is explicitly out of scope for this version (see §8).

---

## 2. System Scope & Transit Coverage

The simulation covers the major urban rail networks in the Bangkok Metropolitan Region:

| Line | Transit Type | Operator | Structure |
|------|-------------|----------|-----------|
| BTS Sukhumvit & Silom Lines | Heavy Rail | BTSC | Elevated |
| MRT Blue Line | Heavy Rail | BEM | Underground / Elevated |
| MRT Purple Line | Heavy Rail | BEM | Elevated |
| SRT Red Lines (North & West) | Commuter Rail | SRTET (SRT) | At-Grade / Elevated (nominal — see note) |
| Airport Rail Link (ARL) | Express / Commuter | Asia Era One (SRT) | Elevated |
| MRT Pink Line | Monorail | NBM | Elevated |
| MRT Yellow Line | Monorail | EBM | Elevated |
| BTS Gold Line | Automated People Mover (Monorail-class) | BMA / KT (operated by BTSC) | Elevated |
| MRT Orange Line *(track only — pre-revenue)* | Heavy Rail | — | Underground / Elevated |

**Coverage assumptions**

- All lines above are in scope for v1.0. The **Gold Line** is operational and receives full simulation (track + moving trains). The **Orange Line** is not yet in passenger service, so it is included as **rendered track geometry only** — no vehicles, no timetable — until an operational schedule exists (see §7 MVP 6 and §8).
- Interchange relationships between lines are modelled for the UI inspector but do not affect vehicle motion (no passenger routing in v1.0).

> **⚠ Operational-status caveat — re-verified 2026-07-31 (MVP 5, Task 11).** The classification above was originally drafted from an early-2025 snapshot and unconfirmed against a live source. Three open questions flagged in that draft have now been checked against current sources:
> - **MRT Orange Line** — still pre-revenue, confirmed via [Wikipedia: Orange Line (Bangkok)](https://en.wikipedia.org/wiki/Orange_Line_(Bangkok)) and [Bangkok Post, "Orange Line due to fully open in 2030"](https://www.bangkokpost.com/thailand/general/2832487/orange-line-due-to-fully-open-in-2030) (accessed 2026-07-31). The Eastern Section (Thailand Cultural Centre–Yaek Rom Klao) is now projected to open **late 2027** (per an August 2025 announcement, moved up from a prior 2028 target); the Western Section (Bang Khun Non–Thailand Cultural Centre) is projected for **July 2030**, with only ~14% of civil works complete as of end-July 2025. **Remains track-only, MVP 6** — the classification in this table and in MVP 6's scope is unchanged and correctly conservative.
> - **Pink Line spur to Muang Thong Thani** — confirmed **open and in full paid revenue service since 2025-06-17** (free trial ran from 2025-05-20), per [Nation Thailand, "Bangkok's Pink Metro Line Extension Opens Early with Free Rides"](https://www.nationthailand.com/news/general/40050080) (published 2025-05-16, accessed 2026-07-31). Two new stations: Impact Muang Thong Thani (MT01) and Lake Muang Thong Thani (MT02). **Not added to the registry in Task 11** — the OSM relation pair for the spur (19149752/19150155) is separate from the main Pink Line relation (16740886/16740887) fetched for this task, and pulling it in was deliberately deferred to keep Task 11's scope to the main line; a future task should add it as its own registry entry once its GTFS route id (if the Namtang feed publishes one separately) is confirmed.
> - **MRT Purple Line southern extension (Tao Poon–Rat Burana)** — confirmed **still under construction, not open**, per [Bangkok Post, "Purple Line extension '50% done'"](https://www.bangkokpost.com/thailand/general/2920320/purple-line-extension-50-done) and [Nation Thailand, "Southern extension of Purple Line 65% complete"](https://www.nationthailand.com/news/policy/40057649) (accessed 2026-07-31). A cross-river tunnel segment is due by May 2026, but the earliest partial opening (Tao Poon–National Library) is now projected for 2028, full completion 2030 — delayed further by a September 2025 road collapse at the worksite. The registry's `purple` entry in this task covers only the existing operational Purple Line (Khlong Bang Phai–Tao Poon); the southern extension is out of scope until it opens.
> - Lines listed as operational (Green, Purple, ARL, Pink [main line], Yellow, Gold, Red North/West) were all confirmed against the real Namtang GTFS feed in this task (`tools/inspect-gtfs.mjs`, 2026-07-31) — each has a live `route_id` with real `frequencies.txt` rows, not just a bare `trips.txt` pattern. **MRT Blue Line remains unverified in this draft** (still scoped to MVP 6, not touched by Task 11) — re-check it when that task starts.
>
> **MVP 6 update (2026-08-02).** MRT Blue is now built, verified, and delivered — real `route_id "3"`, OSM relation 444659, 10th registry entry, genuinely mixed underground/elevated structure (§7 has the full delivered summary). **MRT Orange and the MRT Purple southern extension ("Purple Phase 2") were still NOT in the registry as of this date.** The MVP 6 plan's Task 6 would have added both as track-only, pre-revenue entries (reusing the mechanism this document's §F4.1/§7 MVP 6 describes); that task was **deferred by human ruling** within the MVP 6 cycle, then **delivered 2026-08-04** once picked back up (§7's MVP 6 summary has the full story, including a way-based fetch mechanism the original plan didn't anticipate needing). The construction-status facts above (Orange late-2027/2030, Purple southern extension 2028/2030) are unchanged throughout.

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
  - *Underground transparency* — reduce terrain/building opacity (**0.1 to 0.4**) when viewing underground segments (MRT Blue). **Delivered MVP 7:** auto-engage/release while following — `src/map/autoUnderground.ts`'s `decideAutoUnderground` reads the followed vehicle's LANE_Z altitude (not its track structure tag) each frame, engaging underground mode below −5 m and releasing above −1 m, with a 4 m hysteresis band so it doesn't flicker at a portal straddle; a manual toggle mid-follow overrides auto for the rest of that follow session so auto never fights the user. Verified end-to-end (real store, real vehicle buffer, real rAF loop) by `npm run verify:mvp7` checks 5.
  - *Basemap style cycle.* **Delivered MVP 7 (roadmap item 21):** three key-free vector styles — Liberty (default), Bright, Positron (`src/map/basemapStyles.ts`) — swappable at runtime. `map.setStyle()` destroys the Three.js custom layer, so every `style.load` side-effect re-runs (`src/map/styleBinding.ts`'s per-style/per-map split — see CLAUDE.md's MVP 7 implementation notes). Vector-only, deliberately: satellite/terrain would need `raster-opacity`/`raster-brightness-*` equivalents plus a keyed provider and its own ToS review, out of scope here. **Known disclosed gap:** on Bright/Positron, a handful of layers (`landcover-glacier`/`landcover_wood`/`landuse_residential`/`aeroway-area`) use a zoom-expression `fill-opacity` rather than a flat number; `styleBinding.ts`'s underground-dimming capture has no type guard for that (unlike its colour-capture path, which does guard), so `Math.min(expression, 0.25)` silently NaNs for those layers and logs a console validation error — underground mode still dims every other layer correctly. Found in MVP 6 Task 6 review (Bright), re-confirmed on Positron by `verify:mvp7` (4 layers); small, low-risk fix mirroring the existing colour-skip pattern, not yet scheduled.
- **F3.3 — Environmental effects.** Dynamic day/night lighting driven by the simulated clock (sun-position calculation). **Delivered MVP 7:**
  - *Theme tri-state (roadmap item 21).* Auto (clock-driven, the original F3.3 behaviour and default) / Light / Dark (`src/map/themeMode.ts`). Light and Dark pin the *palette* only via `effectiveElevationDeg` — the sun's direction stays clock-real in every mode, only `sun.ts`'s `skyPalette` and `basemapTheme.ts`'s `nightFactor` read the pinned elevation instead of the real one.
  - *Sky dome (roadmap item 6, "sunset glow").* `src/map/skyDome.ts` — a horizon-clipped Three.js sphere (`RADIUS_M = 120_000`) that discards every fragment below the local ENU horizon plane rather than attempting real depth interop with MapLibre's tiles (same disclosed-tradeoff shape as F3.2's underground opacity mode). Colours come from the same `skyPalette` that lights the scene, so the horizon warms exactly when the key light warms. Verified visually clean at pitch ≥70° (its only meaningfully-exercised regime — pitch 0/45 pass vacuously, nothing is drawn there to wash) across noon/02:00; `verify:mvp7` check 6 asserts the mesh's `renderOrder < 0` and disabled depth write/test.
- **F3.5 — Power saving (new, roadmap item 2).** *Eco mode* (`src/stores/useAppStore.ts`'s `ecoMode`) throttles both the render loop's repaint cadence and the sim worker's own tick rate to ~1 Hz (`ECO_TICK_MS = 1000`); measured steady-state is an exact 1 repaint/second once a ~1 s enable-moment transient (MapLibre's own internal repaint settling, not the app's throttle) passes. Positions are a pure function of time, so nothing drifts while throttled — confirmed by `verify:mvp7` check 7 comparing a fresh `getInterpolated()` read immediately after disabling against the last-rendered pose (sub-2 m delta, consistent with ordinary train speed over the elapsed tens of milliseconds, not a catch-up jump).
- **F3.6 — Fullscreen (new, roadmap item 1).** The browser Fullscreen API on the app's whole-shell container (`[data-testid="map-container"]`, `App.tsx`'s top-level wrapper — not `MapContainer.tsx`'s own div, which only ever holds MapLibre's injected DOM plus the imperative train tooltip, never the React-rendered overlays). Esc exits natively; `ViewControls.tsx` mirrors `document.fullscreenElement` via a `fullscreenchange` listener rather than store state, since Esc bypasses any app-level handler.

### F4. User Interface & Information Overlay

- **F4.1 — Live line selector.** Toggle visibility of individual lines (e.g., BTS Sukhumvit, MRT Blue, monorails).
- **F4.2 — Station & vehicle inspector card.** Clicking a train or station shows route name, next-station ETA, interchange options, and origin/destination.
- **F4.3 — Live timetable drawer.** Bottom panel listing currently active trains and upcoming departures for the selected station.

---

## 5. Non-Functional Requirements

**NF1 — Performance & frame rate.**
Target 60 FPS on desktop (GTX 1050 / Apple M1 or equivalent) and 30+ FPS on mobile WebGL browsers. The Wasm simulation tick must complete in **< 3 ms per frame** for up to **300 concurrent active vehicles**.

> **Status as of MVP 6 (2026-08-02), measured by `npm run verify:perf` against a production build of the full 10-line network:** 4 of 5 sub-checks pass — the same tally as MVP 5. The sim ticks a meaningful sample count during the measurement window (rules out a silently-dead worker), sim tick p95 ≈ 0.3 ms (well under the 3 ms budget) and frame rate ≈ 100 FPS (well over both the 60/30 FPS targets) both pass comfortably, and no frame is truncated. The **300-concurrent-vehicle scale target is still not reached**: the real network's measured daily peak (`public/data/network.report.json`'s `peak_concurrent`, the preprocessor's static per-minute weekday scan) is **246** vehicles with MRT Blue added — up from MVP 5's 171–172, still short of 300. A live `verify:perf` run on 2026-08-02 (a Sunday) observed `stats.maxCount = 197`, not 246, because the harness's probe clock is built from *today's* date at the weekday peak's time-of-day — on a weekend run that samples the weekend calendar at the weekday's busiest minute, landing between the true weekday peak (246) and weekend peak (212). Either real number is a fact about actual GTFS schedule density across these 10 lines, not a performance defect. **This gap is not explained by MVP 6's one deferred task** (Task 6, MRT Orange + MRT Purple's southern extension): both would have been track-only, contributing zero simulated vehicles to this count regardless of whether they were built. `MAX_VEHICLES` = 1024 leaves ~4× headroom over the higher (246) measured peak. The `verify:perf` assertion is left as a hard, currently-failing gate rather than weakened or satisfied with synthetic load, so a future regression (or a future denser network) is still caught.

> **Status as of MVP 7 (2026-08-05):** unchanged. The registry (12 lines, 10 simulated) and its schedule density didn't move in MVP 7 — Tasks 1-11 were guardrails/presentation work (preprocessor sanity gates, theme/basemap/eco/fullscreen/sky UI, a legibility harness), none of which add or remove a simulated vehicle. A fresh `npm run verify:perf` run (2026-08-05, a Wednesday, sampling the real weekday peak) reproduces the same 4/5 tally: sim tick p95 0.30 ms, ~100 FPS, no truncation, peak 246 — still the disclosed, deliberately-failing gate above.

**NF2 — Initial load & optimization.**
Total initial bundle **≤ 5 MB** (compressed assets + binary timetable). 3D GLTF models lazy-load asynchronously with Level-of-Detail (LOD) progressive detail.

> **Status as of MVP 7 (2026-08-05):** `npm run check:bundle` reports **1.03 MB gzip / 5.00 MB budget** for the full production build (`dist/` + `network.tmb`) — up from MVP 6+Orange/Purple's 1.01 MB, from MVP 7's added UI/control-surface code (theme tri-state, basemap style cycle, auto-underground, sky dome, eco mode) and its CSS. Still comfortably under budget (21% used).

**NF3 — Cross-platform compatibility.**
Modern desktop and mobile browsers supporting WebGL 2.0 and WebAssembly: Chrome 90+, Safari 15+, Firefox 88+, Edge (Chromium).

**NF4 — Data provenance & licensing.** *(Added — required before public release.)*
All data sources must be license-compatible with public deployment. GTFS feeds are used under their published open-data terms; OpenStreetMap geometry requires ODbL attribution. Any scraped source must comply with the origin site's Terms of Service — scraping is a fallback only where no open feed exists, and its legal basis must be confirmed per source.

**NF5 — Accessibility & internationalization.** *(Added.)*
UI text supports Thai and English. Interactive controls meet WCAG 2.1 AA for contrast and keyboard operability where feasible within a 3D canvas app.

> **Status as of MVP 7 (2026-08-05):** the WCAG 3:1 contrast half of this requirement is now machine-checked for the first time (`npm run verify:legibility`, MVP 7 Task 11) — and it currently **fails honestly**, not passes. Sampling real lit deck pixels (not the unlit centerline a first attempt at this harness accidentally always hit — see CLAUDE.md's MVP 7 notes) against the basemap at noon and 02:00 for all 10 simulated lines: 14 of 20 line/time combinations fall under the 3:1 floor, including 9 of 10 lines at night (only Airport Rail Link passes both times). `MIN_CONTRAST` is pinned at the real WCAG value (3.0), not weakened to whatever passes — same precedent as NF1's `verify:perf` gate above. MRT Blue's failure is specifically traced to 8-bit sRGB colour quantization saturating its `#1964B7` livery near-black at night regardless of the ambient-light floor; the other 8 failing lines may have more headroom. A follow-up task (not MVP 7) should address the underlying night-lighting shortfall with a per-material minimum-brightness mechanism, not another `sun.ts` ambient-floor tweak.

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

## 7. Delivery Roadmap — MVP Ladder

The project is delivered as a sequence of **vertical, shippable MVPs** rather than horizontal technical layers. Each MVP is independently demonstrable and de-risks the next. The original phase work (data pipeline, Wasm core, map integration, motion, UI polish — see §7A) is distributed across these MVPs rather than done all at once.

Guiding principle: **prove the full render pipeline on one line before adding motion; prove motion on one line before adding breadth.**

### MVP 1 — Green Line track laid (geometry only, no trains)

**Goal:** Render the BTS Green Line as accurate, elevated 3D track over the MapLibre base map. This is the thinnest possible slice that exercises the entire visual pipeline end-to-end.

**Scope:** BTS Green Line = **Sukhumvit branch (light green) + Silom branch (dark green)**. *(Option to narrow to Sukhumvit-only for the very first slice; see §7B.)*

**In scope**

- Vite + TypeScript + React app shell; MapLibre GL JS base map centred on Bangkok.
- Three.js custom WebGL layer wired into MapLibre (the F3 bridge), including the `MercatorCoordinate` projection and camera-relative/floating-origin coordinate setup (§3A.4–3A.5).
- Green Line track geometry extracted to 3D GeoJSON with elevated Z-offsets (+12–22 m), spline-smoothed (F1.3).
- Track rendered as a 3D ribbon/line at correct elevation; station node markers placed.
- Free-camera orbit controls (subset of F3.2).

**Explicitly NOT in this MVP:** no trains, no motion, no timetable, no Wasm engine yet, no UI panels beyond basic map controls.

**Definition of done:** the Green Line's two branches appear as correctly-positioned elevated 3D track that stays glued to the map through pan/zoom/tilt, on the NF3 browser matrix, within the bundle budget so far.

**Why first:** it forces the hardest integration problem (MapLibre↔Three coordinate/depth/precision) to be solved on day one, with static geometry as the only variable. Everything else builds on this foundation.

### MVP 2 — Green Line data pipeline & static schedule

**Goal:** Stand up the offline preprocessing path and load a real timetable for the Green Line.

- Rust CLI preprocessor: GTFS ZIP → compact binary cache (§F1.1–F1.2), Green Line only.
- Client loads the binary timetable; parse/validate against source.
- Stops snapped onto the track shape; service-calendar resolution (`calendar.txt`).
- No motion yet — this MVP proves the data is correct and loadable, feeding MVP 3.

**Definition of done:** the Green Line timetable loads client-side under the <3 MB cache target and passes pipeline validation (trip/stop counts, calendars).

### MVP 3 — Green Line trains moving (single-line simulation)

**Goal:** Trains move along the Green Line on schedule. First "living" build.

- Rust→Wasm interpolation engine (F2.1): status resolution + `3p²−2p³` S-curve, exposed via the flat `Float32Array` transform-buffer API (§3A.2).
- Web Worker runs the sim tick; transforms delivered via transferable buffer (§3A.3); fixed-timestep sim with render-side interpolation (§3A.7).
- `InstancedMesh` train models coloured to line identity (F3.1, §3A.5); continuous yaw from track tangent (F2.2).
- Basic time-warp: 1×/5×/10×/60× and a real-time clock (F2.3).

**Definition of done:** Green Line trains dwell and transit on schedule at 60 FPS desktop, correct headings, no overshoot past termini.

### MVP 4 — Interaction & core UI (still Green Line)

**Goal:** Make the single line explorable and inspectable.

- Vehicle-follow (third-person) camera (F3.2).
- Station & vehicle inspector card: route, next-station ETA, origin/destination (F4.2).
- Time-scrubber / custom time picker (F2.3, `TimeScrubber.tsx`).
- Live timetable drawer for the selected station (F4.3).
- Zustand holds only UI-derived state, never per-frame kinematics (§3A.7).

**Definition of done:** a user can select a train, follow it, scrub time, and read live schedule info — a complete single-line product.

### MVP 5 — Multi-line breadth (elevated network)

**Goal:** Generalize from one line to many by making everything line-agnostic and adding the remaining **elevated** lines: MRT Purple, ARL, the Pink & Yellow monorails, the **BTS Gold Line** (short elevated automated people-mover — full track + trains), plus SRT Red (at-grade/elevated).

- Line selector to toggle visibility (F4.1).
- Monorail / APM (short-consist) vehicle models; per-line colours and structure types.
- Interchange metadata for the inspector.
- Performance validated toward the 300-concurrent-vehicle / <3 ms tick target (NF1).

**Definition of done:** all elevated + at-grade lines (including Gold) render and simulate together within performance budget.

**Delivered (2026-07-31).** The registry (`tools/lines.config.mjs`) grew from 2 lines to 9: Sukhumvit, Silom, MRT Purple, Airport Rail Link, MRT Pink, MRT Yellow, BTS Gold, SRT Dark Red, SRT Light Red — 155 stations, 34 trip patterns, 4,481 expanded runs, all pinned to real OSM relation ids and verified against the live Namtang GTFS feed. **A mixed-structure line gets one nominal altitude in MVP 5:** SRT Red runs both at-grade and elevated in reality, but every one of the 9 registered lines — SRT Red included — currently sets `structure: "elevated"`, so it renders and simulates at a single nominal elevated altitude; the `atGrade` mechanism (`STRUCTURE_ALTITUDE_M`/`DECK_PROFILE`) exists and works but isn't exercised by any registered line yet. Real per-segment (at-grade vs. elevated) structure belongs with MVP 6's underground work. Line selector (F4.1), cross-route interchange metadata (auto-linked within 300 m plus a manual override list), and monorail/APM/commuter vehicle models (distinct consist lengths per vehicle type, verified against actual rendered geometry) are all in place and exercised by `npm run verify:mvp5` (6/6). `npm run verify:mvp4` still passes unchanged (14/14) — single-line interaction did not regress. **Performance is validated with real measured numbers, not just "toward" the target:** 4 of NF1's 5 sub-checks pass outright (tick-count sanity, sim tick, no truncation, frame rate); the 300-concurrent-vehicle scale target is not yet reached by this real network (measured peak 171–172 vehicles) — see §5's NF1 status note for the full picture and why that assertion is left failing on purpose rather than weakened.

### MVP 6 — Underground + environmental polish (full v1.0)

**Goal:** Complete the network and the "wow" layer.

- MRT Blue Line, including underground segments at −12 to −25 m.
- **MRT Orange Line — track geometry only** (no trains, no timetable), including its underground alignment. Reuses the MVP 1 track-rendering path; benefits from the same underground depth/transparency work. Rendered as a visually distinct "pre-revenue / not yet operational" line.
- Underground transparency mode — terrain/building opacity toggle with depth-buffer handling (F3.2, §3A.4); the hardest rendering feature, deliberately last.
- Dynamic day/night lighting and sun position (F3.3); shadow quality toggle (§3A.5).
- Glassmorphism UI pass; LOD tuning; final bundle-budget and cross-browser hardening (NF2/NF3).

**Definition of done:** full v1.0 scope (§2) shipped against all NF targets — every operational line simulated, Orange Line track laid and clearly marked pre-revenue.

**Delivered (2026-08-02), with one plan item deferred.** MRT Blue joined the registry as the 10th line — real `route_id "3"`, OSM relation 444659, 38 GTFS stations, 24 patterns, 3,712 runs, and genuinely **mixed per-segment structure** (234 elevated / 260 underground track points) rather than one nominal altitude; getting there required fixing a real topology bug where Blue's alignment passes near itself at Tha Phra (a loop joined to a branch), which broke the original global-nearest stop snapping and made some scheduled legs interpolate as ~38 km sweeps — fixed with per-pattern monotonic stop snapping in the preprocessor (see `CLAUDE.md`'s MVP 6 implementation notes for the full mechanism). Network totals: 193 stations, 58 patterns, 8,193 runs, 3 services, structure totals 2,350 elevated / 262 underground / 48 at-grade across the whole network (SRT Dark/Light Red's at-grade segments render correctly for the first time, closing an MVP 5 gap). 16 interchanges (up from 14), two requiring new line-qualified overrides just outside the 300 m auto-link radius (Silom↔Blue at Sala Daeng/Si Lom, 319.3 m; ARL↔Blue at Makkasan/Phetchaburi, 304.8 m). Underground transparency mode (F3.2) is implemented and **is opacity-based, not depth-correct** — it fades the basemap into the 0.1–0.4 band (measured 0.25) and makes sub-surface track translucent with depth-write disabled, but there is no real depth-buffer interop with MapLibre's tiles; this is a disclosed, deliberate cost of skipping §3A.4's harder depth-interop path, not a defect. Day/night lighting (F3.3) drives the Three.js scene from a real solar-position calculation; a basemap day/night colour theme was added beyond F3.3's original scope (human ruling) so the MapLibre base style itself also darkens at night, not just the 3D layer. A shadow-quality toggle (§3A.5) defaults off and roughly doubles the renderer's own per-frame render-call cost when enabled (measured on software rendering, illustrative not a hardware benchmark — see `CLAUDE.md`). A glassmorphism UI pass unifies all five overlay panels. NF2: `npm run check:bundle` reports 0.96 MB gzip / 5.00 MB budget. NF3: Chrome/Firefox/Edge driven programmatically against real installed binaries (9/9 each); Safari untested (unavailable on this machine). **NF1 is still 4 of 5** — peak concurrency rose to 246 (weekday) with Blue added, still short of ≥300; this is real GTFS density for these 10 lines, and is **not** explained by the one deferred item below.

**MRT Orange and MRT Purple's southern extension ("Purple Phase 2") were deferred by human ruling (Task 6 of the MVP 6 plan), then delivered 2026-08-04** as track-only, pre-revenue registry entries (`orange`, `purple-ext`; `gtfsRouteId: null`, `preRevenue: true`). The `preRevenue` rendering mechanism (dashed centerline, desaturated deck, registry validation, `LineSelector` badge), built and unit-tested since MVP 5/6, got its first real users. One deviation from the original plan: neither line has a route relation in OSM, so their track comes from a new way-name-based fetch path rather than the relation-based one every other line uses, and neither has station data (see CLAUDE.md's implementation notes for both). Both lines' construction-status facts (§2's caveat block) are unchanged. This closes the one v1.0 DoD line item MVP 6 itself did not fully reach — "Orange Line track laid and clearly marked pre-revenue" is now true, delivered as a follow-up to the MVP 6 cycle rather than inside it. **A later ad-hoc task (2026-08-04, requested mid-MVP-7, not in either the MVP 6 or MVP 7 plan files) merged MRT Orange's separately-fetched East and West sections into one combined `orange` registry entry** (275 track points, 192 underground/83 elevated, ~35.3 km, 0 stations — the standalone `orange-west` entry this paragraph originally described no longer exists). The registry is still **12 lines** (10 simulated + `orange`/`purple-ext` track-only) — the merge changed how Orange is represented, not the line count.

### MVP 7 — Guardrails & presentation (post-v1.0-DoD hardening)

**Not part of the original SRS ladder** — scoped and executed as its own plan (`docs/superpowers/plans/2026-08-04-mvp7-guardrails-and-presentation.md`) after MVP 6's v1.0 DoD (§7 above) was already met. Two kinds of work: closing the automated-coverage gap MVP 6 exposed (§8's addition-roadmap item 20 — three real user-reported defects that shipped past every existing gate), and delivering the addition-roadmap's remaining "Trivial/Easy" and "Medium" UI items (1, 2, 4, 5's last piece, 21).

**Delivered (2026-08-05).** Two new preprocessor sanity gates, both hard-fail (not silent warnings): a track-gradient gate (`check_track_gradient` in `rust-engine/preprocessor/src/main.rs`, rejects any consecutive track-vertex pair steeper than the 4% ruling gradient) closes the class of defect that shipped as MVP 6's "vertical wall at a portal" bug; a closed bypass in the existing snap-distance gate now also checks registry-hand-patched station positions for GTFS-simulated lines, not just GTFS's own raw coordinate (the exact gap that let Mo Chit's 187.4 m pre-fix defect through undetected — see CLAUDE.md's MVP 7 notes for the precise finding). A machine-checkable night-legibility harness (`npm run verify:legibility`, §5 NF5 status above) closes the third gap, and — honestly — currently fails: 14 of 20 line/time contrast samples are under WCAG 3:1, a real and disclosed finding, not a harness bug. On the UI side: F3.2's underground mode now auto-engages/releases while following a train (closing addition-roadmap item 5's last piece); a 3-style basemap cycle and Auto/Light/Dark theme tri-state (F3.2/F3.3 above, addition-roadmap item 21); a horizon-clipped sky dome (F3.3, item 6); eco mode (F3.5, item 2) and fullscreen (F3.6, item 1). `npm run verify:mvp7` (12/12) is the new acceptance harness, modeled on `verify:mvp6.mjs`'s structure; the full existing suite (`verify:mvp4/5/6`, `verify:mobile`, `verify:train-tooltip`, `verify:kinematics`, `verify:camera`) stays green unchanged. NF2: `npm run check:bundle` reports 1.03 MB gzip / 5.00 MB budget. NF1 is unchanged at 4/5 (peak concurrency still 246 — MVP 7 added no simulated lines or vehicles). One documentation-only fix: `rust-engine/sim-core/src/model.rs`'s `CacheDoc.version` field had a stale `// 2` comment since MVP 6 bumped it to 3; corrected here since this task already touches the preprocessor.

### MVP summary

| MVP | Theme | Lines | Trains move? | Key requirements | Status |
|-----|-------|-------|--------------|------------------|--------|
| 1 | Track laid | Green only | No | F1.3, F3 bridge, §3A.4–3A.5 | Delivered |
| 2 | Data pipeline | Green only | No | F1.1–F1.2, NF6 | Delivered |
| 3 | Motion | Green only | **Yes** | F2, §3A.2–3A.3, 3A.7 | Delivered |
| 4 | Interaction/UI | Green only | Yes | F3.2, F4.2–F4.3, F2.3 | Delivered |
| 5 | Breadth | + Purple, ARL, Pink, Yellow, **Gold**, Red (9 lines total) | Yes | F4.1, NF1 (scale) | Delivered 2026-07-31 — NF1 4/5 (300-vehicle scale target not yet reached by the real network's 171–172 measured peak; see §5) |
| 6 | Underground + polish | + MRT Blue (10 lines total) | Yes | F3.2 underground, F3.3, NF2 | Delivered 2026-08-02 — MRT Blue simulated with real per-segment structure; underground mode is opacity-based, not depth-correct (disclosed, not a defect); day/night lighting + basemap theming, shadow toggle, glassmorphism, NF2/NF3 all delivered; NF1 still 4/5 (peak concurrency 246, not yet 300). Two user-reported visual defects were found post-delivery and fixed same-day: gradient-limited track altitude (portal transitions rendered as vertical walls; see CLAUDE.md's MVP 6 implementation notes) and a raised night-lighting floor (the network read as near-invisible after dark). Both landed with unit tests but neither was caught by any automated gate at the time — that coverage gap is what MVP 7 (below) closes. |
| 7 | Guardrails & presentation | Same 12 lines (10 simulated + `orange`/`purple-ext` track-only, `orange` now a single merged entry) | Yes, unchanged | preprocessor gates, F3.2/F3.3/F3.5/F3.6, NF5 | Delivered 2026-08-05 — 2 new hard-fail preprocessor gates (gradient, station-position snap bypass); `npm run verify:legibility` closes the night-legibility coverage gap and **fails honestly** (14/20 line/time samples under WCAG 3:1, disclosed not gamed); auto-underground-while-following, basemap style cycle, theme tri-state, sky dome, eco mode, fullscreen all delivered and verified (`verify:mvp7`, 12/12). NF1 unchanged (4/5, peak 246). NF2 1.03 MB/5.00 MB. |

---

## 7A. Original Phase Mapping (reference)

The five technical phases from the initial proposal are preserved here and map onto the MVP ladder as follows:

| Phase | Milestone | Realized in |
|-------|-----------|-------------|
| 1 | Data pipelines & geometry | MVP 1 (geometry) + MVP 2 (timetable) |
| 2 | Wasm core engine | MVP 3 |
| 3 | Map & 3D integration | MVP 1 |
| 4 | Vehicle motion & interpolation | MVP 3 |
| 5 | UI controls & polish | MVP 4 (core UI) + MVP 6 (polish) |

## 7B. Optional narrower first slice

If an even smaller MVP 1 is desired to validate tooling fastest, scope it to the **Sukhumvit branch only** (single continuous alignment, no branch junction). This removes the Sukhumvit/Silom interchange-and-branch handling from the first slice and can be expanded to the full Green Line before MVP 2.

---

## 8. Out of Scope (v1.0) & Future Work

The following are explicitly excluded from v1.0 and recorded for future consideration:

- **GTFS-Realtime / live vehicle positions** — v1.0 is schedule-driven only.
- **Passenger routing / journey planning** — no trip-planning between stations.
- **Orange Line train simulation** — track geometry is in v1.0 (§7 MVP 6), but moving trains and a timetable are deferred until the line enters revenue service and a schedule is published.
- **Future line extensions** — planned or under-construction extensions of the in-scope lines (e.g., additional phases of existing lines) and any other lines beyond §2 are future work. When each opens, an operational line reuses the MVP 5/6 path (add feed → simulate), and a pre-revenue line reuses the Orange Line pattern (track geometry only).
- **GLTF/GLB train models + LOD** — deferred out of MVP 6; see F3.1's note above. Procedural geometry covers the requirement's visual-distinctness intent for v1.0.
- ~~MRT Orange + MRT Purple Phase 2 (track-only, pre-revenue)~~ — **delivered 2026-08-04**, no longer out of scope. See §7 MVP 6's own delivery note above (both are in the registry, `orange` since merged from separate East/West entries into one).
- ~~Manual dark/light theme toggle + basemap style cycling~~ — **delivered in MVP 7** (F3.2/F3.3 above, §7 MVP 7). Satellite/terrain specifically stayed out of scope, deliberately (constraint 2 below still applies to them, unresolved): vector styles only (Liberty/Bright/Positron). The four constraints originally recorded here for whoever picked this up: (1) `map.setStyle()` destroys every custom layer including the Three.js scene, so a style cycle must re-run every `style.load` side-effect — the underground-opacity snapshot, the basemap-colour snapshot, vehicle-manager wiring, click handlers, and the sun sync (`src/map/styleBinding.ts`'s per-style/per-map split is how MVP 7 resolved this); (2) satellite/terrain are raster basemaps with no `fill`/`fill-extrusion`/`line` layers, so both underground dimming and night theming (both vector-layer-only mechanisms) would silently become no-ops on them unless given raster equivalents (`raster-opacity`/`raster-brightness-*`) or explicitly disabled with that disablement surfaced in the UI — still true, still why they're not in the cycle; (3) the no-API-key constraint that chose OpenFreeMap Liberty in the first place still applies — the three vector styles delivered stay key-free; (4) a manual light/dark toggle conflicts with clock-driven auto theming, resolved with a tri-state Auto/Light/Dark control (`src/map/themeMode.ts`), not a boolean, with "Auto" preserving F3.3's original clock-driven behaviour exactly.
- **Svelte UI variant** — React is the committed framework for v1.0.
- **Backend services / user accounts** — the app is a static, client-side deployment.
- **Visual/legibility regression coverage** — MVP 6 shipped two post-delivery defect fixes (`b4c1cb9` gradient-limited track altitude ramps + corrected Mo Chit's position; `0b9a921` raised the night-lighting floor), both found by a human looking at the running app, not by `npm run verify:mvp6`, `npm run verify:kinematics`, or the unit suite — all of which stayed green throughout, because none of them assert anything about visual smoothness or legibility, only data-shape/numeric invariants. A **machine-checkable night-legibility assertion** (e.g. an offscreen render + luminance/contrast readback of track and vehicle pixels against the basemap, at two clock times) would close the largest part of this gap and is the natural next backlog item; the other two defects at least have numeric proxies now (gradient percentage, snap distance) even if nothing gates on them yet.
- **`onRamp` station-resampling heuristic boundary** (`tools/fetch-network.mjs`'s `fetchBranch`, added alongside the gradient limiter) — a station is only resampled onto the ramped track altitude if its single *nearest* track vertex was itself one of the points the gradient limiter moved. A station that is geometrically inside a ramp zone but whose nearest vertex happens to fall just outside that changed set would keep a stale nominal altitude. No such case exists in the current 10-line network (verified in the MVP 6 Task 13 report), and the narrow scoping is deliberate rather than an oversight — recorded here as a known, documented boundary for whoever extends the network next.
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
- **Performance:** Frame-rate and Wasm tick-time targets (NF1) verified on reference hardware with 300 active vehicles. As of MVP 6, `npm run verify:perf` verifies tick-count sanity, tick time, no-truncation, and frame rate against the real 10-line network (all pass, 4/5); the 300-vehicle scale check itself is a known-failing gate against the network's real 246-vehicle (weekday) peak — see §5's NF1 status note.
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
