# Engine Contract — MVP 2 (data pipeline), MVP 3 (simulation), MVP 4 (queries), MVP 5 (multi-line breadth), MVP 6 (underground + polish)

Authoritative interface spec between the Rust side (preprocessor CLI, sim core,
Wasm bindings) and the TypeScript side (worker, loader, rendering). Both sides
are implemented against THIS document. If something here proves impossible,
stop and flag it rather than silently deviating.

SRS references: F1.1–F1.2 (pipeline), F2.1–F2.3 (motion), §3A.2 (flat buffer
API), §3A.3 (transferable buffers, NO SharedArrayBuffer), §3A.7 (fixed-cadence
sim, render-side interpolation, Zustand = UI state only).

## 0. Source-data facts (verified against the live Namtang feed, 2026-07-30)

- Feed: https://namtang-api.otp.go.th/download/namtang-gtfs.zip (CC-BY 4.0),
  `feed_version 20260729`, valid 20260101–20261231, timezone Asia/Bangkok
  (UTC+7, no DST).
- BTS Green Line = `route_id "1"` (Sukhumvit, color 65b724) and `route_id "2"`
  (Silom, color 246B5B), agency BTSC.
- **The feed is frequency-based.** Routes 1/2 have exactly 14 trip rows — these
  are *patterns*, not runs. Their `stop_times` are offsets starting at
  00:00:00 (first stop) — RELATIVE times. `frequencies.txt` (348 rows for
  these trips) defines service windows 06:00–24:00 with `headway_secs`
  207–480. `exact_times` column is absent ⇒ 0 (non-exact); we treat headways
  as an exact schedule for visualization: starts at
  `start_time, start_time+h, …` while `< end_time`.
- Patterns include short-turn services (Mo Chit, Samrong turnbacks) with their
  own shape_ids and frequency windows.
- `calendar.txt`: service "1" = Mon–Fri, service "2" = Sat–Sun (2023-01-01 →
  2026-12-31). `calendar_dates.txt` has 42 exceptions for these services
  (Thai holidays: type 2 removes weekday service, type 1 adds weekend service).
- `stop_times` for these patterns have real dwell times (arrival ≠ departure,
  e.g. 30 s dwells).

## 1. Repository layout (worktree)

```text
rust-engine/                 # Cargo WORKSPACE root
├── Cargo.toml               # [workspace] members = ["sim-core", "wasm", "preprocessor"]
├── sim-core/                # pure Rust lib: cache model + interpolation. NO wasm deps.
├── wasm/                    # wasm-bindgen bindings crate (cdylib), name: metro-sim-wasm
└── preprocessor/            # CLI bin: GTFS dir + network.json (line registry) -> cache blob
public/data/network.tmb      # generated binary cache (committed)
src/sim/                     # TS: worker, loader, protocol types, clock store integration
src/sim/protocol.ts          # message + buffer-layout constants (mirror of this doc)
```

`tools/gtfs_preprocessor/` from the SRS §6 sketch is realized as
`rust-engine/preprocessor` (one workspace, less duplication). Do not create
`tools/gtfs_preprocessor/`.

## 2. Binary cache format — `network.tmb` (TMB = Thai Metro Binary)

Serialization: **bincode 2** (`bincode = { version = "2", features = ["serde"] }`,
`bincode::serde::encode_to_vec / decode_from_slice`, standard config) of the
`CacheDoc` struct below, then the client fetches it as `ArrayBuffer`.
Rationale vs SRS §3A.6: producer and consumer are both our Rust; the blob is
< 1 MB and parsed once at load, so rkyv's zero-copy advantage is negligible
here — bincode chosen for simplicity. Re-evaluate rkyv when the full network
(MVP 5) grows the cache.

```rust
// sim-core/src/model.rs — exact field order matters (bincode).
pub const TMB_MAGIC: u32 = 0x544D_4231; // "TMB1"

#[derive(Serialize, Deserialize)]
pub struct CacheDoc {
    pub magic: u32,              // TMB_MAGIC
    pub version: u16,            // 3 (bumped in MVP 6 Task 1: InterchangeRef.route_idx widened u8 -> u16)
    pub feed_version: String,    // "20260729"
    pub generated_unix: i64,
    pub origin_lng: f64,         // MUST equal frontend ORIGIN_LNG_LAT
    pub origin_lat: f64,         // (100.5332, 13.7456)
    pub routes: Vec<RouteDoc>,   // routes[i] == src/data/network.json `lines[i]` —
                                  // registry-driven order, NOT a hardcoded pair. Today
                                  // that's [0]=Sukhumvit(route_id "1"), [1]=Silom(route_id
                                  // "2"), but the invariant is index == network.json line
                                  // order == PatternDoc.route_idx, not those specific lines.
    pub services: Vec<ServiceDoc>,
    pub patterns: Vec<PatternDoc>,
    pub runs: Vec<RunDoc>,       // sorted by (service_idx, start_sec)
}

#[derive(Serialize, Deserialize)]
pub struct RouteDoc {
    pub gtfs_route_id: String,   // "1" / "2" / "" for a track-only (unsimulated) line
    pub line_key: String,        // registry key from tools/lines.config.mjs — ties a
                                  // cache route back to its network.json geometry/colour
    pub simulated: bool,         // false = track geometry only: no patterns, no runs,
                                  // no trains (e.g. a pre-revenue line with no gtfsRouteId)
    pub name_en: String,
    pub color_rgb: u32,          // always parse_hex_color(line.color) from the registry, e.g. 0x7CB342 (Sukhumvit)
    /// Track polyline in LOCAL ENU METERS relative to (origin_lng, origin_lat),
    /// Catmull-Rom resampled at ~10 m spacing by the preprocessor.
    /// x=east, y=north, z=up(+15.0). Same frame as src/map/coordinates.ts.
    pub track_xyz: Vec<[f32; 3]>,
    /// Cumulative arc length in meters, same length as track_xyz, [0]=0.
    pub track_arc_m: Vec<f32>,
    pub stations: Vec<StationDoc>, // ordered by arc_m ascending
}

#[derive(Serialize, Deserialize)]
pub struct StationDoc {
    pub gtfs_stop_id: String,
    pub code: String,            // e.g. "N8"
    pub name_en: String,
    pub name_th: String,
    /// Station snapped ONTO the track polyline: arc-length position in meters.
    pub arc_m: f32,
    /// Other routes' stations within walking distance (MVP 5 Task 7).
    /// Symmetric, never self-referential; computed once by the preprocessor
    /// (§2's link_interchanges, below) and baked into the cache — the engine
    /// never computes this at runtime.
    pub interchanges: Vec<InterchangeRef>,
}

#[derive(Serialize, Deserialize)]
pub struct InterchangeRef {
    pub route_idx: u16,          // u16 as of MVP 6 Task 1 (was u8; unchecked
                                  // narrowing would silently wrap past 256 routes)
    pub station_idx: u16,
}

#[derive(Serialize, Deserialize)]
pub struct ServiceDoc {
    // Not always a real feed service id: the preprocessor's
    // day_qualified_service_split (MRT Blue's ambiguous weekend calendar
    // fix) synthesizes single-weekday services from headsign text, tagged
    // "<original>+0x20"/"+0x40" rather than a GTFS-sourced id. The binary
    // layout is unchanged (still a String), so no TMB_VERSION bump.
    pub gtfs_service_id: String,
    pub weekday_mask: u8,        // bit0=Monday … bit6=Sunday
    pub start_date: u32,         // YYYYMMDD inclusive
    pub end_date: u32,           // YYYYMMDD inclusive
    pub added_dates: Vec<u32>,   // calendar_dates exception_type 1
    pub removed_dates: Vec<u32>, // calendar_dates exception_type 2
}

#[derive(Serialize, Deserialize)]
pub struct PatternDoc {
    pub gtfs_trip_id: String,
    pub route_idx: u8,           // index into routes
    pub direction: u8,           // GTFS direction_id
    pub headsign_en: String,
    /// Per stop of this pattern, in sequence order:
    pub stops: Vec<PatternStop>,
}

#[derive(Serialize, Deserialize)]
pub struct PatternStop {
    pub station_idx: u16,        // index into routes[route_idx].stations
    pub arrival_s: u32,          // offset from run start (first stop = 0)
    pub departure_s: u32,        // >= arrival_s (dwell)
    pub arc_m: f32,              // copy of station arc_m (denormalized for speed)
}

#[derive(Serialize, Deserialize)]
pub struct RunDoc {
    pub pattern_idx: u16,
    pub service_idx: u8,
    pub start_sec: u32,          // seconds after service-day midnight (can be >= 86400 conceptually? no: frequencies end 24:00 -> start_sec < 86400; ARRIVALS may exceed 86400)
}
```

Preprocessor CLI:

```text
cargo run -p preprocessor --release -- \
  --gtfs <extracted-gtfs-dir> --track <path-to-src/data/network.json> \
  --out public/data/network.tmb [--report <path.json>]
```

### 2.1 `network.json` input shape (MVP 5, track vertex widened to 4 elements + `preRevenue` added in MVP 6)

Deserialized by the preprocessor as (`rust-engine/preprocessor/src/main.rs`,
`#[serde(rename_all = "camelCase")]` — field names below are the JSON keys):

```rust
struct TrackFile {
    lines: Vec<LineGeometry>,
    /// Interchange walkways the 300 m auto-link radius cannot reach — see
    /// "Interchange linking" below. Line-qualified as of MVP 6 Task 1 (was a
    /// bare [String; 2] stop_id pair): a bare pair is only safe while that id
    /// resolves to exactly two stations network-wide, and the Namtang feed
    /// reuses stop ids across operators. Optional, defaults to empty.
    interchange_overrides: Vec<InterchangeOverride>,
}

struct InterchangeOverride {
    a_line: String, // registry line key, e.g. "purple"
    a_stop: String, // gtfs_stop_id on that line
    b_line: String,
    b_stop: String,
}

struct LineGeometry {
    key: String,                    // registry key, e.g. "sukhumvit" — ties
                                     // this entry back to tools/lines.config.mjs
    name: String,                   // fallback display name for a track-only line
    color: String,                  // "#RRGGBB" — wins over GTFS routes.txt route_color
    gtfs_route_id: Option<String>,  // None = track geometry only, never simulated
    /// [lon, lat, altitude_m, structure] polyline, pre-resample. The 4th
    /// element (MVP 6 Task 2) is a string tag — "elevated" | "atGrade" |
    /// "underground" — produced by structureOfWay() from OSM way tags
    /// (bridge/tunnel/layer/embankment/covered), one call per source way.
    /// The preprocessor's own TrackVertex tuple-struct only reads the first
    /// 3 elements (altitude) via #[serde(default)] on the 4th; the structure
    /// tag itself is a rendering-only concern (src/map/structure.ts,
    /// src/map/trackGeometry.ts's per-run deck splitting) that this contract
    /// documents for completeness of the JSON shape, not because the
    /// preprocessor consumes it.
    track: Vec<[f64; 4]>,
    stations: Vec<NetworkStation>,
    /// GTFS stop_ids to drop from this line's simulation entirely (and any
    /// trip serving one, taking its whole pattern with it) — e.g. the Pink
    /// Line's Muang Thong Thani spur stops, which share Pink's gtfs_route_id
    /// but sit ~1.2 km off the main-line-only track this entry fetches.
    /// Optional, defaults to empty.
    exclude_gtfs_stop_ids: Vec<String>,
    /// GTFS stop_ids exempt from the 150 m hard snap-distance fail — for a
    /// stop verified to be a real, different, nearby station rather than bad
    /// geometry (still snapped and simulated; logged as a warning instead of
    /// erroring). Optional, defaults to empty.
    allow_large_snap_stop_ids: Vec<String>,
}
```

The real `network.json` produced by `tools/fetch-network.mjs` also carries a
`preRevenue: boolean` key on every line entry (MVP 6 Task 2/4) — but it is
**not** a field of the Rust `LineGeometry` struct above. It's a rendering-only
flag (`src/types/index.ts`'s `LineGeometry.preRevenue`, consumed by
`src/map/trackGeometry.ts` for the dashed/desaturated ghost-track treatment
and `LineSelector.tsx` for the badge) with no bearing on simulation; the
preprocessor's `serde` deserialization simply ignores it as an unrecognized
JSON key (no `#[serde(deny_unknown_fields)]` anywhere in this struct). As of
MVP 6 every registry line has `preRevenue: false` — the mechanism is built
and unit-tested but has no real user yet, since MRT Orange and MRT Purple's
southern extension (its intended first consumers) were deferred (MVP 6
Task 6, human ruling).

```rust
struct NetworkStation {
    id: String,                 // gtfs_stop_id (or a synthetic id for track-only)
    name: String,
    name_th: String,
    code: String,               // optional, defaults to ""
    position: [f64; 3],         // [lon, lat, altitude_m]
}
```

`tools/fetch-network.mjs` is the producer (OSM Overpass -> this shape, one
entry per `tools/lines.config.mjs` `LINES` line, in registry order); the
preprocessor and `src/data/network.json`'s consumer in the frontend
(`MapContainer.tsx`, typed as `NetworkData` in `src/types/index.ts`) are both
implemented against it.

- Route identity is registry-driven: the CLI parses `network.json` into the
  `TrackFile` above (one entry per `tools/lines.config.mjs` line) and builds
  `routes[i]` from `lines[i]`, in that order — no hardcoded route-id list.
  `LineGeometry.gtfs_route_id` is `Option<String>`: `Some(id)` -> the line is
  simulated (GTFS trips looked up for that `route_id`, exactly as below);
  `None` -> the line is track geometry only (`RouteDoc.simulated = false`, no
  patterns/runs for it, its own station list from `network.json` is used
  directly instead of GTFS stop_times). At least one line must have a
  `gtfsRouteId`, or the CLI fails loudly. **As of MVP 6, no line in the
  registry actually uses `gtfs_route_id: None`** — all 10 registered lines
  (Sukhumvit, Silom, Purple, ARL, Pink, Yellow, Gold, SRT Dark/Light Red,
  and MRT Blue, new this MVP) are simulated; the mechanism exists and is
  tested (`sim-core` query tests) but its intended first real users, MRT
  Orange and MRT Purple's southern extension, still aren't in the registry —
  the MVP 6 plan's Task 6, which would have added them, was deferred by
  human ruling, not merely not-yet-scheduled.
- Builds each route's track from its `network.json` line's `track` polyline:
  Catmull-Rom (centripetal) resample at ~10 m, offset z=+15 (elevated
  structure; other structure types carry their own z in the source geometry).
- Snaps each stop (by lat/lng) onto the resampled polyline → `arc_m` (nearest
  point on any segment; reject snaps > 150 m with a hard error). For a
  simulated line the stops come from GTFS `stop_times`; for a track-only line
  they come from the line's own `network.json` `stations` list.
- Direction handling: `arc_m` is measured along the line's polyline as
  stored; direction_id 1 patterns simply have DEcreasing arc_m across their
  stop list. The engine interpolates arc between consecutive stops either
  way — no reversal logic anywhere else.
- Stop→station mapping (simulated lines): GTFS stops match the line's
  `network.json` station ids (same feed) — but match by `stop_id`; fall back
  to nearest-by-distance with a warning.
- Registry colour wins over the feed's: `RouteDoc.color_rgb` is always parsed
  from `network.json`'s `color` (`#RRGGBB`), never from GTFS `routes.txt`
  `route_color` — that's what the UI legend, the track deck, and the train
  livery already use.
- **Dual run-expansion rule (MVP 5 Task 9, `runs_for_pattern()`).** GTFS
  allows two different shapes for the same feed, and the Namtang feed uses
  both: BTS-style routes (Sukhumvit, Silom) are frequency-based — relative
  `stop_times` plus `frequencies.txt` headway windows, expanded into one run
  per `start_time + k*headway_secs` for `k=0..` while `< end_time`; other
  operators (ARL, SRT Red, etc.) publish concrete absolute departures with no
  `frequencies.txt` rows for their trips at all, and become exactly one run
  starting at the trip's own first-stop arrival time. A trip's pattern is
  checked for frequency rows first — if any exist it expands by headway; if
  none exist it falls back to the single-run form. A trip matching neither
  shape (no frequencies AND an unparseable/missing first arrival) is a hard
  error, never a silently-dropped zero-run pattern.
- **Interchange linking (MVP 5 Task 7, `link_interchanges()`).** After all
  routes/stations are built, every pair of *different* routes' stations
  within `INTERCHANGE_RADIUS_M = 300.0` meters of each other gets a symmetric
  `InterchangeRef` on both `StationDoc.interchanges` (§2, never
  self-referential — same route never links to itself). `interchange_overrides`
  (§2.1, line-qualified `{a_line, a_stop, b_line, b_stop}` as of MVP 6 Task 1)
  adds links the radius can't reach — e.g. two platforms of the same
  interchange 555 m apart that happen to share one GTFS `stop_id` on both
  sides. Line-qualifying prevents a stop id shared by three or more routes
  (the Namtang feed does this) from silently widening one intended pair into
  every pairwise combination.
- Writes `--report` JSON: `{stations, patterns, runs, services, bytes,
  gzip_bytes, per_route: [...], peak_concurrent, peak_concurrent_time,
  peak_concurrent_date, peak_concurrent_weekday, peak_concurrent_weekend}` —
  used by tests and by the client-validation cross-check test.
- **Peak-concurrent scan (MVP 5 Task 8).** Before writing the report, the
  preprocessor re-evaluates the freshly-built `SimWorld` once per minute
  (1440 samples) across one weekday and one weekend date inside the feed's
  validity window, keeping the highest vehicle count `evaluate()` returns and
  the `sec_of_day` it occurred at. `peak_concurrent`/`peak_concurrent_time`/
  `peak_concurrent_date` report the larger of the two scans;
  `peak_concurrent_weekday`/`peak_concurrent_weekend` report both individually
  (`{date, peak, time}`) so a weekend-specific spike isn't hidden by a bigger
  weekday number. This answers "is MAX_VEHICLES big enough" from real data
  rather than a guess — for the Green Line alone (2 routes) the observed peak
  was 100 concurrent vehicles (weekday, 07:46), well under both MAX_VEHICLES
  and the SRS NF1 300-concurrent target; the 1024 ceiling was sized as
  headroom for the full ~9-line network Task 11 adds, not off that number.
  **With the 9-line network (MVP 5, Task 11), the real measured peak was
  171–172 concurrent vehicles** (weekday 07:52, per `network.report.json`'s
  `peak_concurrent`/`peak_concurrent_weekday`) — comfortably under 1024, but
  under the SRS NF1 300-concurrent target too. **With MRT Blue added (MVP 6,
  10 lines), the weekday peak rose to 246** (`peak_concurrent_weekday.peak`;
  `peak_concurrent_weekend.peak` = 212) — still under 1024, still under the
  300-concurrent target. This is real GTFS density, not a defect: MVP 6's one
  deferred task (MRT Orange + MRT Purple Phase 2 as track-only lines) would
  have contributed exactly zero vehicles to this count either way, so it does
  not explain the shortfall. `npm run verify:perf` leaves
  that one sub-check (of 5) failing on purpose (see ENGINE_CONTRACT §8 / CLAUDE.md)
  rather than weakening it or fabricating load to pass it; it is real GTFS
  schedule density for these lines, not a defect in the engine, buffer sizing,
  or the scan itself. 1440 extra
  `evaluate()` calls per scan run in-process against the buffer the
  preprocessor already allocated for its own self-check, adding a fraction of
  a second to preprocessing — negligible next to GTFS parsing/IO.
- MUST fail loudly (non-zero exit + message) on: missing required files,
  empty expansion, snap distance > 150 m, unknown stop ids, no simulated
  lines in `network.json`.

## 3. sim-core API (pure Rust — unit-testable without wasm)

```rust
pub struct SimWorld { /* built from CacheDoc */ }

pub const VEHICLE_STRIDE: usize = 8;      // f32 lanes per vehicle
pub const MAX_VEHICLES: usize = 1024;     // MVP 5 Task 8: raised from 512 — see below

impl SimWorld {
    pub fn from_bytes(bytes: &[u8]) -> Result<Self, CacheError>;
    pub fn validation(&self) -> ValidationSummary; // counts for the report

    /// Evaluate scheduled vehicle states at an absolute Bangkok local time.
    /// `date_yyyymmdd` + `sec_of_day` (0..86400) — LOCAL Bangkok date/time.
    /// Also evaluates the PREVIOUS service day's runs at sec_of_day+86400 to
    /// catch post-midnight spillover.
    /// Writes up to MAX_VEHICLES records into `out` (len >= MAX_VEHICLES*8),
    /// returns the vehicle count.
    pub fn evaluate(&self, date_yyyymmdd: u32, sec_of_day: f64, out: &mut [f32]) -> usize;

    /// True if the most recent `evaluate()` call hit MAX_VEHICLES and dropped
    /// vehicles (biased toward high run indices, since evaluate() iterates
    /// `runs` in order and stops once the buffer is full). Interior
    /// mutability (`Cell<bool>`, not `Mutex`) is safe here because SimWorld
    /// lives inside one Web Worker and evaluate() is never called
    /// concurrently. MVP 5 Task 8 — previously overflow was silent and looked
    /// like a data bug (trains simply missing).
    pub fn last_truncated(&self) -> bool;
}
```

**MAX_VEHICLES = 1024 (MVP 5 Task 8).** Was 512 through MVP 2-4, sized for the
Green Line's ~60 concurrent trains. Raised ahead of the ~9-line network
(Task 11) so a peak is never silently clipped — 512 left little headroom over
the SRS NF1 300-concurrent target. Cost is buffer memory only (1024 × 8 × 4 =
32 KB per frame buffer, 3 in the pool = 96 KB). The preprocessor's `--report`
now measures the real per-day peak (see §2) instead of guessing; if a future
network's reported `peak_concurrent` exceeds 1024, raise the constant again
rather than accepting truncation.

Vehicle record layout (stride 8 × f32) — **identical constants in
`src/sim/protocol.ts`**:

| lane | name      | meaning |
|------|-----------|---------|
| 0    | `x`       | east meters (local ENU frame, shared origin) |
| 1    | `y`       | north meters |
| 2    | `z`       | up meters |
| 3    | `yaw`     | radians, CCW from +x (east), from track tangent, **direction of travel** |
| 4    | `state`   | 0 = dwelling at a station, 1 = in transit |
| 5    | `run_idx` | index into CacheDoc.runs (exact f32 up to 2^24 — fine) |
| 6    | `route_idx` | index into `CacheDoc.routes` == `network.json` line order == `tools/lines.config.mjs` `LINES` order (the registry-index invariant, §2.1 — NOT a hardcoded pair; as of MVP 6 there are 10 routes, [0]=Sukhumvit … [8]=SRT Light Red, [9]=MRT Blue, new this MVP) |
| 7    | `progress`| 0..1 smoothed progress of current inter-station leg (0 while dwelling) |

Motion math (F2.1/F2.2): for time `t` within a run, find the bracketing
`PatternStop`s A→B. Dwell if `arr_A ≤ t ≤ dep_A`. In transit:
`p = (t - dep_A)/(arr_B - dep_A)`, `s = 3p² - 2p³`,
`arc = arc_A + (arc_B - arc_A)·s`, position/tangent from binary-searching
`track_arc_m` and lerping the two polyline points. Yaw from the segment
tangent, flipped to the direction of travel (`arc_B < arc_A` ⇒ +π).
A run is inactive before its first arrival and after its last arrival — a
finished run must emit nothing (**no overshoot past termini** — MVP 3 DoD).

Required unit tests (sim-core): smoothstep endpoints/midpoint; dwell vs
transit classification at boundary times; no-overshoot after final arrival;
yaw flips for a direction_id=1 run; arc binary search on a synthetic 3-point
track; frequency-expansion counts on a synthetic feed; service-day resolution
incl. weekday/weekend masks, removed holiday date, and post-midnight spillover.

## 4. Wasm bindings (`rust-engine/wasm`, crate name `metro-sim-wasm`)

```rust
#[wasm_bindgen]
pub struct Engine { world: SimWorld, buf: Vec<f32> /* MAX_VEHICLES*8 */ }

#[wasm_bindgen]
impl Engine {
    #[wasm_bindgen(constructor)]
    pub fn new(cache_bytes: &[u8]) -> Result<Engine, JsError>;
    pub fn validation_json(&self) -> String; // ValidationSummary as JSON
    /// Evaluates into the internal buffer and copies into `out`
    /// (a JS-owned Float32Array view). Returns vehicle count.
    pub fn evaluate(&mut self, date_yyyymmdd: u32, sec_of_day: f64, out: &mut [f32]) -> usize;
    /// True if the most recent `evaluate()` hit MAX_VEHICLES and dropped
    /// vehicles (MVP 5 review fix) — mirrors `SimWorld::last_truncated`; call
    /// right after `evaluate()`, before any other call re-evaluates the world.
    pub fn last_truncated(&self) -> bool;
}
```

Build: `wasm-pack build rust-engine/wasm --release --target web --out-dir ../../src/sim/pkg`
(`src/sim/pkg/` is gitignored except a `.gitkeep`? No — COMMIT the built pkg so
`npm run dev` works without a Rust toolchain; document regeneration).

## 5. Worker protocol (`src/sim/worker.ts` + `src/sim/protocol.ts`)

Plain `postMessage` with **transferable ArrayBuffers**, ping-pong buffer pool
(≥ 3 buffers of `MAX_VEHICLES*8*4` bytes). No SharedArrayBuffer anywhere.

Main → worker:

```ts
{ kind: "init", wasmUrl: string, cache: ArrayBuffer }        // cache transferred
{ kind: "clock", epochMs: number, warp: number }             // set/replace clock
{ kind: "returnBuffer", buffer: ArrayBuffer }                // recycle (transferred)
{ kind: "tickRate", tickMs: number }                         // re-cadence the sim loop (eco mode)
{ kind: "stop" }
```

Worker → main:

```ts
{ kind: "ready", validation: ValidationSummary }
{ kind: "error", message: string }
{ kind: "frame", simEpochMs: number, count: number, evalMs: number, truncated: boolean, buffer: ArrayBuffer } // transferred
```

- Worker loop: `setInterval` at **10 Hz real time**. Each tick computes
  `simEpochMs = clockEpochMs + (performance.now() - clockSetAt) * warp`,
  converts to Bangkok local date + sec-of-day (fixed UTC+7, no DST:
  `local = simEpochMs + 7*3600_000`), calls `engine.evaluate` timed with
  `performance.now()` (`evalMs`, NF1 harness — `tools/verify-perf.mjs`), reads
  `engine.last_truncated()` (`truncated`), posts a frame. `SimClient` keeps a
  600-sample rolling window of `evalMs`/`count`/`truncated`
  (`getEvalStats(): { samples, meanMs, p95Ms, maxCount, truncated, maxVehicles }`,
  `resetEvalStats()` clears the window before a fresh measurement) for that
  harness; it is not on the render path (§3A.2) — two extra fields on an
  existing message, no new boundary crossing. `getEvalStats().truncated` is
  true if *any* frame in the window was truncated, not just the latest — MVP 5
  review fix: previously nothing surfaced `last_truncated()` past sim-core, so
  `verify-perf.mjs` proxied it with `maxCount < MAX_VEHICLES`, which silently
  rots if the two constants ever drift apart.
- Warp changes rebase the clock so sim time is continuous.
- If the buffer pool is empty (main thread hasn't returned buffers), skip the
  tick — never allocate unboundedly, never block.
- **Tick cadence is mutable, not a fixed 10 Hz constant** (roadmap item 2, eco
  mode). `DEFAULT_TICK_MS = 100` (10 Hz, the MVP 3 baseline) and
  `ECO_TICK_MS = 1000` (~1 Hz) live in `src/sim/protocol.ts`. A `{ kind:
  "tickRate", tickMs }` message clamps `tickMs` to `[DEFAULT_TICK_MS,
  ECO_TICK_MS]` (guards against a zero/negative interval spinning the worker,
  or an absurdly large one looking like a hang), and — only if the loop is
  already running — clears and re-arms `setInterval` at the new cadence; a
  `tickRate` message that arrives before `init` just updates the pending
  cadence, it does not start the loop early. `SimClient.setTickMs(tickMs)` is
  the main-thread entry point; `MapContainer.tsx` drives it from the store's
  `ecoMode` boolean, and independently throttles its own rAF repaint calls to
  the same `ECO_TICK_MS` cadence, so eco mode throttles both halves of the
  pipeline. **This is a pure cost control — it never changes an evaluated
  position.** Nothing in the engine integrates or accumulates state between
  ticks (see the "Renderer-side interpolation" note just below: every frame is
  `engine.evaluate()` at the current sim time, from scratch); a tick every 1 s
  instead of every 100 ms just means fewer, further-apart samples of the same
  pure function of time. Un-throttling snaps immediately back to the correct
  current pose with no catch-up animation and no drift.

Renderer-side interpolation (§3A.7): keep the two most recent frames; at
render time `alpha = (renderSimTime - frameA.simEpochMs) / (frameB.simEpochMs
- frameA.simEpochMs)`; match vehicles across frames by `run_idx` (lane 5);
lerp x/y/z, slerp-lite yaw (shortest angular distance); a vehicle present in
only one frame renders at that frame's pose. Render sim clock =
`clockEpochMs + (now - clockSetAt) * warp` computed main-thread-side from the
same clock params (store them in Zustand when set).

## 6. Frontend (MVP 3)

- `src/map/VehicleManager.ts`: owns one `THREE.InstancedMesh` per route
  (capacity MAX_VEHICLES), stylized low-poly train (elongated rounded box,
  ~65 m × 3.2 m × 3.8 m — 4-car consist; F3.1's GLTF models come later),
  colored to `RouteDoc.color_rgb`, plus emissive-ish white cab tip at the
  front so direction of travel is visible. Matrix per vehicle from
  interpolated x/y/z/yaw. `count` set per frame; `instanceMatrix.needsUpdate`.
- Wire into the existing `ThreeLayer` scene (renamed from `GreenLineLayer`
  when the render pipeline generalized to an N-line network in MVP 5); call
  `map.triggerRepaint()` continuously while the engine is running (MapLibre
  only repaints on demand).
- `src/stores/useAppStore.ts` additions (UI state ONLY — no per-frame data):
  `engineStatus: "off" | "loading" | "ready" | "error"`,
  `validation: ValidationSummary | null`, `warp: 1|5|10|60`,
  `clockEpochMs/clockSetAt` (rebased on warp change), `vehicleCount`
  (throttled to 1 Hz updates).
- `src/components/TimeControls.tsx`: overlay card — current sim clock
  (Asia/Bangkok, HH:mm:ss), warp buttons 1×/5×/10×/60×, "now" reset button,
  vehicle count, and a small validation line (stations/patterns/runs) once
  ready — this line is the visible MVP 2 DoD artifact.
- Per-frame kinematics NEVER touch React/Zustand (§3A.7).

## 7. Schedule queries (MVP 4)

The stride-8 buffer carries **pose only**. Everything the UI shows in words —
headsign, origin/destination, next-station ETA, a station's upcoming calls —
is derived from the cache in `sim-core/src/query.rs` and crossed as JSON.

**These are UI-rate calls: on selection, or ~1 Hz. Never call them per frame.**
§3A.2's "one buffer, zero-copy read" rule still governs the frame path; JSON is
acceptable here precisely because these are not on it.

```rust
impl SimWorld {
    /// None when the run is not live at that instant — the SAME liveness rule
    /// evaluate() applies, so a train that leaves the buffer also stops
    /// returning detail.
    pub fn run_detail(&self, run_idx: u32, date_yyyymmdd: u32, sec_of_day: f64)
        -> Option<RunDetail>;

    /// Upcoming calls at one station, soonest first, at most `limit`.
    /// Keeps a call for GRACE_S = 90 s after it is due so a dwelling train
    /// does not vanish off the top of the board, and drops anything beyond
    /// HORIZON_S = 2 h so a quiet late-night board does not advertise
    /// tomorrow morning as "23h 14m". None for bad indices.
    pub fn station_board(&self, route_idx: u8, station_idx: u16,
                         date_yyyymmdd: u32, sec_of_day: f64, limit: usize)
        -> Option<StationBoard>;

    /// Every station with its ENU position, for click hit-testing. The
    /// (route_idx, station_idx) pairs are exactly what station_board takes.
    pub fn stations(&self) -> Vec<StationInfo>;
}
```

Both time-taking queries resolve the service day the same two-frame way
`evaluate` does (today at `sec_of_day`, previous day at `sec_of_day + 86400`),
so post-midnight spillover behaves identically across pose and metadata.
`BoardEntry.arrival_sec` is shifted into the **queried** day's frame, making it
directly comparable to `sec_of_day`.

`RunDetail` reports **both** `next_stop_ordinal` and `current_stop_ordinal`
(`Some` only while dwelling). The UI must not derive one from the other:
`next_stop_ordinal - 1` is the stop the train is sitting at *only* while
dwelling, and treating it as "passed" greys out the very station the inspector
says the train is at.

`station_board` scans every run, so it is written to stay allocation-light:
service activity is resolved once per service rather than once per run, frames
come back in a fixed `[Option<Frame>; 2]`, and candidates carry indices only —
strings are cloned after sorting and truncation, for the surviving entries.
It takes the **first** call at a station in a pattern, which is correct for the
Green Line; a future loop or branching pattern that calls a station twice would
need every match emitted.

Wasm surface (`rust-engine/wasm`) — all return JSON strings, `"null"` for a
`None`:

```rust
pub fn run_detail_json(&self, run_idx: u32, date_yyyymmdd: u32, sec_of_day: f64) -> String;
pub fn station_board_json(&self, route_idx: u8, station_idx: u16,
                          date_yyyymmdd: u32, sec_of_day: f64, limit: usize) -> String;
pub fn stations_json(&self) -> String;
```

There is deliberately **no `routes_json()`** (or equivalent) on this surface.
Per-route *display* metadata the UI needs at rest — name, colour, structure,
vehicle type, the legend/line-selector list — comes straight from the
frontend's own `src/data/network.json` import (`MapContainer.tsx`:
`store.setRoutes(net.lines)`), never from a wasm round-trip; `RouteDoc`'s
`name_en`/`color_rgb` inside the cache exist for the engine's own use
(`RunDetail.route_name`/`color_rgb` above) and **are guaranteed to agree
with the registry's values by construction**, not by coincidence: `main.rs`
sets `color_rgb = parse_hex_color(&line.color)?` and `name_en =
line.name.clone()` for every simulated route, straight from
`tools/lines.config.mjs` via `network.json` — never from the GTFS feed
(whose `routes.txt` gives both SRT Red routes the same ambiguous
`short_name` "Red", which is exactly why the registry's name is used
instead). The UI still never depends on this agreement for anything it
renders at rest — it reads `network.json` directly — but the cache's copy
is not a separate, potentially-drifting source of truth either.

Worker protocol additions (§5), a request/response pair keyed by `id`:

```ts
// main -> worker
{ kind: "query"; id: number; query: SimQuery }
// worker -> main
{ kind: "queryResult"; id: number; result: SimQueryResult }
{ kind: "queryError"; id: number; message: string }
```

`SimQuery` is `{kind:"runDetail"|"stationBoard"|"stations", …}` and carries
`simEpochMs`, which the worker splits into Bangkok `date_yyyymmdd` +
`sec_of_day` with the same helper the tick uses. `SimClient` wraps these as
promises (`getRunDetail`, `getStationBoard`, `getStations`) and rejects any
in-flight query on `dispose()`.

TS mirrors of the Rust structs live in `src/sim/protocol.ts` and keep serde's
**snake_case** field names verbatim — they are the wire format, not idiomatic
TS. Changing a field name in `query.rs` breaks the UI silently unless both move
together.

### Frontend (MVP 4)

- `src/map/selection.ts` — screen-space picking. Candidates are projected with
  `map.project()` and the nearest within a pixel radius wins; trains beat
  stations. Deliberately not a Three raycast: the layer's projection matrix is
  assembled per frame from MapLibre's and there is no Three camera to cast
  through. `project()` ignores altitude, so the 15 m track height costs a few
  pixels of parallax under pitch, which the radius absorbs.
- `src/map/followCamera.ts` — split capture/apply. `capture()` reads the pose
  inside the layer's render pass (the buffer is already in hand); `apply()`
  calls `jumpTo` from the rAF loop, because moving the camera inside `render()`
  re-enters MapLibre's render path. Bearing is eased, not snapped.
- Store additions are UI-derived only: `selectedRunIdx`, `selectedStation`,
  `following`, and the static `stations` list. No pose ever enters Zustand.

## 8. Definition of done

- MVP 2: `network.tmb` generated (< 3 MB compressed — expected ≪ 1 MB),
  fetched + parsed client-side, validation summary (station/pattern/run/
  service counts + feed_version) matches the preprocessor report and is
  visible in the UI; `cargo test` green. (Named `green-line.tmb` through MVP
  2–4, when the network was Green Line only; renamed `network.tmb` in MVP 5
  Task 4 when route identity became registry-driven — see §2.)
- MVP 4: a train can be selected by clicking it, followed by the camera,
  inspected (route, headsign, origin/destination, next-stop ETA, full call
  list), a station's live board read, and the clock scrubbed to any time of
  day — all asserted by `npm run verify:mvp4` against a running dev server.
- MVP 3: trains visibly dwell + move along both branches at the correct
  scheduled positions for the current Bangkok time; headings follow track
  tangent (opposite directions on the two tracks); no vehicles before first
  service (~06:00) or long after last runs; warp 1×/5×/10×/60× works; 60 FPS
  target: instanced meshes, no per-frame React state.
- MVP 5: the whole registry (9 lines, 155 stations, 4,481 runs) renders and
  simulates together — asserted by `npm run verify:mvp5` (6/6 as of this
  writing: every registry line renders in order; trains run on 3+ lines at
  once; hiding a line stops its rendering but not its simulation or its
  clickability; an interchange station shows a transfer chip; a monorail's
  *rendered* geometry — not just its config table — is shorter than a
  heavy-rail train's) — and `npm run verify:mvp4` still passes unchanged (14
  checks), i.e. single-line interaction did not regress. **NF1 is 4/5, not
  5/5, by design, not by oversight:** `npm run verify:perf` against the
  production build measures the sim actually ticking a meaningful sample
  count during the window (pass — rules out a silently-dead worker producing
  the same "one check fails" tally), sim tick p95 ≈ 0.2–0.3 ms (< 3 ms
  target, pass), no frame truncated (peak 171–172 vs `MAX_VEHICLES` 1024,
  pass), ~100 FPS (≥ 55 target, pass) — but the ≥300-concurrent-vehicles
  assertion fails, because the real 9-line network's measured peak (§2's
  peak-concurrent scan) is 171–172 vehicles, not a bug anywhere in this
  contract's implementation.
  The assertion is left as a hard, currently-failing gate rather than
  weakened or gamed with synthetic load — see CLAUDE.md's "MVP 5's one
  disclosed gap."
- MVP 6: the registry grows to 10 lines (193 stations, 8,193 runs) with MRT
  Blue added, genuinely mixed underground/elevated (234 elevated / 260
  underground track points; 494 total, one point off the keyed 495 due to a
  way-join dedup step that only fires with all 10 lines fetched together) —
  asserted by `npm run verify:mvp6` (6/6): the registry renders in order;
  Blue's *data* is mixed (structure tags present in `network.json`); Blue's
  *rendered* deck (not just its config) is split into separate per-structure
  Three.js meshes; underground mode fades the basemap into the SRS F3.2
  0.1–0.4 band; the sun tracks the sim clock; the basemap's own colour also
  gets darker at midnight than at noon. `npm run verify:mvp5` (6/6) and
  `npm run verify:mvp4` (14/14) both still pass unchanged. **NF1 is still
  4/5, and the peak-concurrency shortfall is unrelated to MVP 6's one
  deferred task:** the network's real measured peak rose to 246 (weekday;
  see §2's peak-concurrent scan above) with Blue added, but MRT Orange and
  MRT Purple Phase 2 (Task 6, deferred by human ruling) would have been
  track-only and contributed zero vehicles to this count regardless of
  whether they'd been built. The assertion is left failing on purpose, same
  discipline as MVP 5 — see CLAUDE.md's "MVP 6's NF1 result."
