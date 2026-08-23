# Addition Roadmap

Features to close parity with [nagix/mini-tokyo-3d](https://github.com/nagix/mini-tokyo-3d), adapted for the Bangkok context.

> **Out of scope:** Playback mode (date picker / historical time), airplane/flight layer, fireworks plugin, live camera plugin, PLATEAU 3D city model plugin — these are either Tokyo-specific or not relevant for this project.

---

> **Note (2026-08-09):** every browser acceptance harness referenced below — the MVP 4/5/6/7, camera, kinematics, closeup, perf, mobile, train-tooltip, legibility, station-search and spur/APM runs — **was deleted**, along with its `npm run verify:*` script. References are kept as the record of how each finding was established; they are not runnable instructions. `npm test`, `cargo test` and `npm run check:bundle` are the only automated checks left.

## Trivial / Easy

### 1. Full-Screen Toggle — ✅ delivered in MVP 7
- ✅ Fullscreen button in `ViewControls.tsx`, targeting the app's whole-shell container (`[data-testid="map-container"]`) rather than `document.documentElement`, so every overlay stays visible in fullscreen too
- ✅ Esc key exits natively (the browser's own Fullscreen API behaviour); the button's own pressed-state mirrors `document.fullscreenElement` via a `fullscreenchange` listener rather than app state, since Esc bypasses any click handler
- See the MVP 7 acceptance harness check 13 (asserts the element exposes `requestFullscreen` and the button calls it — headless Edge can refuse the resulting viewport change, so the check asserts the call, not the outcome)

### 2. Eco Mode — ✅ delivered in MVP 7
- ✅ Toggle button in `ViewControls.tsx` (`ecoMode` in the store)
- ✅ When enabled, throttles both the render loop's repaint cadence and the sim worker's own tick rate to ~1 Hz (`ECO_TICK_MS = 1000`, not literally "1 FPS" but the same intent) — measured steady-state is an exact 1 repaint/second once a brief enable-moment transient (MapLibre's own internal repaint settling, not this throttle) passes
- ✅ Positions are a pure function of time, so nothing drifts while throttled — verified directly (the MVP 7 harness check 12: a fresh engine read immediately after disabling matches the last-rendered pose to within ~1.5 m, consistent with ordinary train speed over the elapsed tens of milliseconds, not a catch-up jump)

### 3. Station Search — ✅ delivered
- ✅ Search button in `LineSelector.tsx`'s header opens a panel (`StationSearch.tsx`)
- ✅ Text input matches both English and Thai station names, case-insensitive substring, capped at 8 results
- ✅ Selecting a result flies the camera to the station (`map.easeTo`, zoom 16) and opens the existing `StationBoard` — no new timetable UI needed, this reuses the live next-departures board that already existed
- ✅ **Extended beyond the original item, by request:** a "nearest station" card via one-shot browser Geolocation, requested automatically when the panel opens (not `watchPosition` — nothing needs it to live-update). Denied/unsupported geolocation degrades to an inline message without blocking name search.
- See the station-search harness, `src/search/stationSearch.test.ts`, `src/components/__tests__/StationSearch.test.tsx`

### 3.1 Suvarnabhumi Airport (BKK) - APM — ✅ delivered 2026-08-09
- ✅ Main Terminal ↔ Midfield Satellite Concourse 1 (SAT-1), ~1.0 km, all underground, 2 stations, in the registry as `apm` with `vehicleType: "apm"` (reuses the Gold Line's existing consist geometry)
- **Not built as a plugin** — the plugin architecture (item 9) still doesn't exist, and this needed no extension point beyond a registry entry
- **The research that was "needed": the APM is in OSM but not in GTFS.** Relation `19955655` (`route=light_rail`, `wikidata=Q123569532`), two ways tagged `layer=-1` so `structureOfWay()` classifies them underground with no new classifier work. It is **absent from the Namtang feed entirely** — verified 2026-08-09 by scanning all 2,077 routes; the only Suvarnabhumi entries are buses and ferries.
- **Two mechanisms had to be built for it:**
  1. **`osm.extraStationNodeIds`** (`fetchBranch` in `tools/fetch-network.mjs`) — relation `19955655` has **zero node members**, so the usual member-derived station path finds nothing. Both stations do exist as properly tagged `railway=station` nodes (`13373875189` Main Terminal, `13373875190` SAT-1) and are named explicitly in the registry. An optional `nameEn` covers the Main Terminal node's missing `name:en` (it has `name:th` only). **Positions are never registry-supplied** — they always come from the live node fetch, and the validator rejects any `lat`/`lon`/`position` key on these entries. That guard exists because the Mo Chit hand-patch turned out to be a citation to an untagged node ~270 m from the position it justified.
  2. **`syntheticSchedule`** (`rust-engine/preprocessor/src/synthetic.rs`) — see below.
- ⚠️ **The APM's timetable is ESTIMATED, not published.** AOT publishes nothing machine-readable. The alternative was rendering it as dead track with no vehicles; instead its observed service pattern is declared in `tools/lines.config.mjs` (180 s headway, 120 s runtime, 40 s dwell, 24 h span) and the preprocessor synthesizes two patterns plus an all-days service from it. This is the **only** invented timetable in a project whose entire premise is real published schedules, and it is contained deliberately: parameters live in the registry (no magic numbers in Rust), every generated id is prefixed `synthetic:` so it can't be mistaken for a feed id, and the UI states it plainly — an "estimated" badge in `LineSelector` plus a `SYNTHETIC_SCHEDULE_NOTE` banner on both the station board and the train inspector. If that disclosure is ever removed, the feature should be cut back to track-only rather than left showing invented times silently.
- See the spur/APM acceptance harness (checks 7–9) and `synthetic.rs`'s own unit tests

---

## Medium

### 4. Mobile / Responsive Layout — ✅ delivered (post-MVP 6, landed alongside the on-map train tooltip)
- ✅ Responsive UI panels (inspector, station board, time controls) restructure into a full-width bottom-sheet stack below Tailwind's `md:` (768px) breakpoint
- ✅ Touch-optimized controls — 40px+ touch targets, a real single-finger touch drag pans the map, `devicePixelRatio` capped at 2 on coarse-pointer (touch) devices only (desktop retina displays are exempt — capping them was a measurable sharpness regression solving a problem they don't have)
- ✅ Proper viewport handling — safe-area-inset-aware positioning (notched devices)
- ✅ Tested against real layout math, not just visual inspection — the mobile acceptance harness (11/11): no overlap between the line selector, `NavigationControl`, and the bottom sheet at 320-375px viewports; the 768px desktop/mobile boundary is exact
- ✅ Collapsible line-selector card (default collapsed on phones) with a "hide UI" toggle that collapses every overlay, including the DOM-owned (non-React) train tooltip

### 5. Underground Mode — ✅ delivered (MVP 6 + MVP 7)
- ✅ Toggle button to switch between overground and underground views (`ViewControls.tsx`)
- ✅ When on: map darkens, overground railways/stations/trains become translucent, underground elements appear bright
- ✅ **Auto-switch when a tracked train enters/exits a tunnel — delivered in MVP 7** (`src/map/autoUnderground.ts`'s `decideAutoUnderground`). Decides on the followed vehicle's real ALTITUDE (LANE_Z), not its track segment's structure tag — a tagged-underground point can legitimately sit near the surface mid-ramp, and altitude is already in the vehicle buffer with no extra track lookup needed. Engages below −5 m, releases above −1 m (a 4 m hysteresis band so it doesn't flicker at a portal straddle); a manual toggle mid-follow overrides auto for the rest of that follow session, so auto never fights the user. Verified end-to-end against the real running app (the MVP 7 acceptance harness checks 8-9). Two small, disclosed edge-case gaps in the state machine (not exercised by the acceptance checks): turning underground ON before crossing the threshold then OFF after crossing it doesn't register as an override; if the followed run vanishes from the vehicle buffer entirely mid-follow, an auto-engaged state can stick until following is explicitly cleared.
- ✅ **Depends on:** MRT Blue line implementation (MVP 6) — delivered, with real per-segment structure from OSM tags
- ⚠️ **Honest limitation:** the effect is **opacity-based, not depth-correct**. Surface geometry is made translucent; it is not true occlusion against MapLibre's depth buffer. Basemap fades to 0.25 opacity (SRS §F3.2 band is 0.1–0.4). Sorting is by each mesh's `userData.structure` **tag**, not its altitude — so a point mid-way up a portal ramp renders in its tag's band even where it is visually near the surface.

### 6. Day/Night Lighting — ✅ delivered (MVP 6 + MVP 7 sky dome)
- ✅ Scenery color changes based on Bangkok sunrise/sunset times — both the Three.js scene (`sun.ts`, SRS F3.3) and the MapLibre basemap (`basemapTheme.ts`, added beyond F3.3 by request)
- ✅ Sunset glow effect — **delivered in MVP 7**: a real horizon-clipped Three.js sky dome shipped (`src/map/skyDome.ts`, `RADIUS_M = 120_000`), not the MapLibre-sky fallback the plan also scoped. It discards every fragment below the local ENU horizon plane rather than attempting real depth interop with MapLibre's tiles — same disclosed-tradeoff shape as item 5's opacity-based underground mode. Colours come from the same `skyPalette` that lights the scene, so the horizon warms exactly when the key light warms. Its verified-clean envelope is pitch ≥70° at zoom ≤12.5 (the dome's fixed radius is smaller than MapLibre's dynamically-computed far clip plane at closer zoom — a pre-existing MapLibre v6 behaviour, not a regression); pitch 0/45° pass vacuously since nothing is drawn there to wash in the first place.
- ✅ Smooth transition between day and night — `nightFactor` ramps across civil twilight rather than switching at 0°, so scrubbing through dusk does not pop
- ✅ Calculated solar position (NOAA low-precision, UTC+7 fixed, no DST)
- ✅ **Night legibility — fixed 2026-08-12.** The raised lighting floor (`sunIntensity` 0.9, `ambientIntensity` 1.35 at night) was never enough on its own: it cannot reach a dark livery, because at 8-bit sRGB a colour like MRT Blue's `#1964B7` saturates near-black at any ambient level. A **per-material emissive floor** now sits on top of it (`src/map/nightLift.ts`), lifting each material by the minimum amount needed to clear WCAG 3:1 — built from the material's *own* colour, so hue is preserved and the map still matches the UI swatch. See item 20 for the mechanism and the honest limits.

### 7. Multi-Language Support (EN + TH)
- Internationalization framework (i18n)
- Thai translations for all UI labels, station names, line names
- Language switcher in the UI
- Station names should display in the selected language

### 8. Route Search (A → B) — ✅ delivered 2026-08-16
- ✅ Search panel with origin and destination station pickers (`RoutePlanner.tsx`), reusing `filterStations` and StationSearch's result-row UX; triggered from `LineSelector`'s header
- ✅ **Full schedule-aware planning, not a static "typical travel time"**: RAPTOR over the real timetable (`sim-core/src/route.rs`), against the app's scrubbed clock, so a plan made at a scrubbed 23:50 is the plan for 23:50
- ✅ Earliest arrival, tied-broken by fewest transfers — RAPTOR's native output, since the round index is the boarding count
- ✅ Leg-by-leg transfer instructions, board/alight times, total duration and transfer count; map highlight of each ride leg's arc span
- ✅ Suvarnabhumi APM is plannable, via a new ARL↔APM interchange override (332 m, just outside the 300 m auto-link radius) — it was a disconnected component of the routing graph before
- ✅ **Incidental fix**: `station_board` now shows post-midnight departures late at night. It shared the two-service-day-frame rule and structurally could not show a 00:10 departure at 23:00
- ⚠️ **Honest limitations**: one route is returned, not a ranked set (no Pareto frontier — RAPTOR's round structure leaves McRAPTOR open later). **Transfer time is one FLAT allowance** at every interchange regardless of walking distance, disclosed in the panel via `TRANSFER_TIMES_ESTIMATED_NOTE`; distance-derived times were considered and declined, since there is no per-interchange data to calibrate against. Interchange complexes expand **one hop** — a three-line complex whose outer pair is not directly linked is not treated as one complex. Leg instructions are English only (item 7). Track-only lines (`orange`, `purple-ext`) are structurally absent from the graph: they have zero stations.

### 9. Plugin Architecture
- Formal plugin interface (register/unregister, lifecycle hooks)
- Layer display settings panel to toggle plugin layers on/off
- Potential first plugins: weather overlay, points of interest

### 10. Custom Train / Rolling Stock Models — ✅ delivered 2026-08-22
- Per-line rolling stock replaces the four shared vehicle-type shapes: real car
  counts (BTS 4, MRT Blue/Purple/ARL 3, Gold and the Suvarnabhumi APM 2, the
  Alstom monorails 4, SRT Red 4), per-line nose profile, roof kit and livery.
- **Declared in `tools/lines.config.mjs`**, carried through `network.json` into
  `LineGeometry.rollingStock` — the same path `syntheticSchedule` takes, so it
  gets `assertRegistryValid` coverage and a sync test rather than being a
  second, unguarded enumeration of the network in `src/map/`.
- **Roof kit is a real distinction, not decoration:** only the Airport Rail
  Link and both SRT Red lines carry a pantograph (25 kV AC overhead). BTS and
  both MRT heavy lines take power from a third rail; the monorails and people
  movers from the beam.
- **`.glb` models were NOT sourced, and the roadmap's original wording is not
  met literally.** No correctly-licensed model of this network's real stock
  exists that could be found, so the geometry is procedural and
  `src/map/glbStock.ts` is an override seam: a line that declares `glbUrl`
  loads and merges a model, everything else builds procedurally. Nothing
  declares one today and that is the expected steady state, not a gap waiting
  to be filled. The seam is **connected** — `MapContainer.tsx`'s
  `attachStockOverrides`, called from `style.load` — which it was not when
  first written; code review 2026-08-23 found `loadStockGeometry` had no
  caller at all, so declaring `glbUrl` would have passed every gate and
  changed nothing on screen.
- **LOD was deliberately not built.** A distance-keyed switch needs two levels
  that differ in cost; with no `.glb` in the tree there is one. The seam it
  would need (`VehicleManager.setRouteGeometry`) exists, built for the `.glb`
  hook. LOD lands with the first real model.
- **The WCAG night gate was extended and still passes at `MIN_CONTRAST = 3`,
  unweakened — but it now asks two separate questions, gated at two different
  times, and one of them is deliberately not gated at night at all.**
  Large-area roles (shell, identity band) are scored against the night
  basemap reference, **night-only** (a pre-existing `test.each(TIMES)` bug
  that also checked this at noon — an invalid comparison, since the reference
  is only valid at night — was found and fixed to match `nightLift.test.ts`'s
  established pattern). **Half of that gate is tautological and its headline
  number used to be quoted from the tautological half** (found in code review
  2026-08-23): the identity band is `ROUTE_TINT` on all 14 lines, and
  `nightLift` bisects each route colour to the minimum lift clearing
  `MIN_CONTRAST`, so the band can only ever score ~3.00 — measured 3.000
  (red-dark, gold) to 3.032 (apm). It proves the lift is wired in, nothing
  about the livery. The **shell** is the real new coverage — it takes the
  route's lift but not its hue, so it can genuinely fail — and its worst is
  **3.081:1** (BTS Gold's champagne `#D9C273`, the network's only non-white/
  silver shell), best 3.234:1 (purple-ext). It now has its own assertion so a
  shell regression cannot hide behind the band's guaranteed 3.00. Detail
  roles (glazing ribbon, skirt vs. the train's own shell)
  are scored **noon-only**: worst measured **3.44:1** (skirt `#6E757C` vs.
  silver shell `#D7DBDF`, on purple/arl/blue). **At night the detail role is
  NOT gated — a real, disclosed, permanent limitation of the shared-material
  shading model**, measured at ~1.05–1.09:1, nowhere near the 3.0 floor: the
  additive per-material night lift is identical for every colour on a route's
  one `MeshLambertMaterial`, so it compresses internal livery contrast toward
  1 regardless of how large that line's own lift is (theoretical best case at
  night is ~1.39:1, already under the floor before any lift is applied). No
  palette choice closes this; it stands alongside NF1's `>=300` gate and
  Safari-untested as a disclosed, not-silently-solved gap.
- Draw calls unchanged — still one `InstancedMesh` per route. Bundle
  1.06 MB gzip / 5.00 MB.

---

## Reported defects

### 23. MRT Pink's Muang Thong Thani spur is missing (GitHub issue #15) — ✅ fixed 2026-08-09
- The "IMPACT Link" branch (Muang Thong Thani → Impact → Lake Muang Thong Thani) has been in revenue service since 2025-06-17 but never appeared on the map. Not an oversight: the `pink` registry entry carried `excludeGtfsStopIds: ["16936","16937"]`, which **dropped the spur's 4 trips outright**, added in MVP 5 as a deliberate stopgap with its reasoning recorded in the entry's own comment.
- **Root cause was a pipeline limit, not bad data.** The Namtang feed files the spur's trips under the **same `route_id "2436"`** as the 30-station trunk, and route identity in this pipeline was a strict `route_id -> line` map, guarded against duplicates at two independent points (`assertRegistryValid`, and Rust's `build_route_idx_by_gtfs_id`). Those guards were correct — a duplicate silently stamps the wrong `route_idx` and desyncs track, colour, station table and vehicle-buffer lane 6 at once — so they were **narrowed, not removed**.
- **Fix: per-trip route claiming.** `claimGtfsStopIds` on a registry entry says which of a shared route's trips belong to it; Rust's new `TripRouter` resolves each **trip** (not each route) to exactly one line. Contract per route id: at most one default claimant, every other claimant declares a non-empty disjoint stop set, and every ambiguity is a hard error. `pink` is now simply the default claimant and its exclude list is **gone** — keeping both would have been two sources of truth for one split, free to drift.
- Verified against the feed before writing the fix: route `2436` has exactly **6** trips — 4 spur (`14630 → 16936 → 16937` and the exact reverse, frequency-based, services 1 and 2) and 2 trunk. Stop `14630` (Muang Thong Thani) is the junction and is served by **both**, so it is deliberately *not* claimed; claiming it would have pulled every trunk trip onto the spur. It now appears in both lines' station tables and auto-links as an interchange.
- OSM side was straightforward by comparison: relation `19149752` is clean PTv2 (`route=monorail`, `ref="IMPACT Link"`, 3 way members, 3 stop node members, ~2.67 km), so the existing `fetchBranch` handled it with no new fetch code.
- See the spur/APM acceptance harness (checks 1–6), `TripRouter`'s unit tests, and the new `lines.config.test.mjs` cases

### 24. MRT Pink dwells and teleports; MRT Blue does too — ✅ fixed 2026-08-12
- The Namtang feed gives some patterns **zero seconds of transit** between stations — the whole inter-station minute parked in the dwell column — so those trains never animate along track. The engine was correct on the data it was given.
- **Recorded as Pink-only; it was not.** Measured across the feed: 1,660 of 9,609 runs (17%) affected — Pink 732/732, **MRT Blue 928/3,712 on 6 of its 24 patterns**, every other line clean. Blue's share had gone undetected for two MVPs.
- **Two tiers, deliberately separated.** All 29 of Blue's degenerate stop pairs have real published times in another pattern of the same line, so Blue is repaired by **recovery** — nothing invented, no disclosure needed. None of Pink's 31 pairs do, so Pink alone is **estimated** from track arc length at a speed calibrated from MRT Yellow's own real rows (same rolling stock, comparable alignment). The registry names only the basis line; the speed is derived at preprocess time, so no invented constant exists in the tree.
- Pink's estimate is disclosed in the UI with a note that deliberately makes a **weaker claim** than the APM's synthetic-timetable note: departures, calendars and headsigns are real; only travel time between stations is estimated. If that disclosure is dropped, revert Pink to unrepaired data.
- A **hard-fail preprocessor gate** now rejects any surviving zero-transit leg by name — the same disclosure-by-build-failure precedent as `check_track_gradient`. Nothing detected this class before, which is exactly why Blue's share sat unnoticed.
- Side effect, stated plainly: `peak_concurrent` rose **250 → 285** because previously-frozen runs now occupy track for real time. That is **not** progress toward NF1's ≥300 target and must never be cited as such.
- See `rust-engine/preprocessor/src/runtimes.rs`, `network.report.json`'s `run_time_repairs` block, and CLAUDE.md's "Known issues" section.

---

## Deferred from MVP 6

Concrete, already-scoped work that fell out of MVP 6. Constraints below were established during MVP 6 — they are not guesses, and they are the expensive part to rediscover.

### 19. MRT Orange + MRT Purple Phase 2 (track-only, pre-revenue) — ✅ delivered 2026-08-04
- Was Task 6 of the MVP 6 plan, deferred by decision, then picked back up and completed
- Both render as track geometry with no trains (`gtfsRouteId: null`, `preRevenue: true`), dashed centerline + desaturated deck — the pre-revenue treatment built in MVP 5/6 got its first real users
- **The plan's assumed mechanism didn't hold**: neither line has a route relation in OSM (checked operational, `route=construction`, `proposed:route` — all empty, verified 2026-08-04). The widened discovery query correctly found nothing; what exists instead is raw, individually-tagged `railway=construction` ways with no relation grouping them. A new way-name-based fetch path (`fetchBranchFromWayName` in `tools/fetch-network.mjs`) queries and stitches these directly, skipping the relation layer — see CLAUDE.md's "Orange/Purple Phase 2 track-only fetch" implementation notes for the full mechanism (crossover-way filtering, why stations are empty, etc.)
- **Both lines have zero stations** — a citywide search found only 2 named construction-stage station nodes in all of OSM, both outside these lines' own track bounding boxes and not trustworthy enough to place
- `LINES` grew from 10 to 12 (append-only, invariant preserved); network totals (8,193 runs, 193 stations) unchanged since both lines contribute zero of either
- The two the MVP 6 harness acceptance checks this item's absence had caused to be deferred (a pre-revenue line renders but never simulates; a pre-revenue station's board resolves empty) are restored — harness is 8/8, up from 6/6
- **Caught in code review, not before merge: the first version of the way-based fetch stitched MRT Orange into an out-and-back double-track loop** (43.6 km for a real ~22 km alignment — two nearly-parallel construction ways with no direction tag greedily stitched end-to-end). Fixed with a fold-detection/truncation pass (`truncateAtFold` in `tools/trackProfile.mjs`, now unit-tested with synthetic fixtures) before merge — see CLAUDE.md for the full story. Worth naming for future way-based fetches: a raw name-based way query has none of a PTv2 route relation's built-in curation (ordering, single direction, no crossovers), so this class of bug is a standing risk whenever this mechanism gets a third user.
- **MRT Orange Western Section (Thailand Cultural Centre ↔ Bang Khun Non) — added separately, then merged into one combined `orange` entry.** The item above describes the Eastern Section fetch; the Western Section (`osm.wayNamePattern` matching `รถไฟฟ้าสายสีส้มตะวันตก ช่วงศูนย์วัฒนธรรมฯ-บางขุนนนท์`, 3 ways) landed as its own `orange-west` registry entry in a later task (105 track points, all underground, 13.5 km, 0 stations — same "no route relation, no trustworthy station node" situation as the Eastern Section). **An ad-hoc task (2026-08-04, requested mid-plan, not in any plan file) then merged `orange-west` and the original `orange` into one combined `orange` entry** via a new `fetchBranchFromWayNames` (plural — calls the existing single-pattern fetcher per part, splices at a shared junction point with a 20 m gap safety check): 105 western points + 171 eastern points − 1 shared junction at Thailand Cultural Centre = 259 points, 183 underground/76 elevated (was 275/192/83 before a 2026-08-09 re-fetch; upstream OSM vertex-density edits only, length unchanged to within 0.2 m), ~35.3 km. The standalone `orange-west` key no longer exists; the registry stayed at 12 lines (the merge changed representation, not count). the MVP 7 acceptance harness check 5 re-verifies the merged line is still a single clean traverse (haversine length within 15% of ~35.3 km), not a doubled-back polyline — the same class of bug item 19 already found and fixed once for the Eastern Section alone.

### 20. Automated coverage for visual/perceptual regressions — ✅ delivered in MVP 7
- **All three defects found at the end of MVP 6 were spotted by a human looking at the running app** — broken portal geometry, a station ~187 m off its track, and an unreadable network at night. the MVP 6 harness (6/6), `verify:mvp4`, `verify:mvp5`, `verify:kinematics` and the full unit suite were **green throughout**.
- ✅ **Preprocessor sanity gates (2, both hard-fail):** `check_track_gradient` (`rust-engine/preprocessor/src/main.rs`) rejects any consecutive track-vertex pair steeper than the 4% ruling gradient — closes the "108% ramp / vertical wall at a portal" defect class directly. A closed bypass in the existing snap-distance gate (`MAX_SNAP_M`/`SNAP_WARN_M`) now also checks registry-hand-patched station positions for GTFS-simulated lines, not just GTFS's own raw coordinate — the pre-existing gate had never actually fired for Mo Chit's 187.4 m pre-fix defect, because it only ever saw GTFS's coordinate, not `network.json`'s hand-patched one (see CLAUDE.md's MVP 7 notes for the precise finding). Both gates fail the build with a clear message rather than warning and continuing.
- ✅ **Night-legibility assertion — SUPERSEDED 2026-08-12, and now passing.** See the block directly below this item for the replacement. The original harness-based text is kept for the record: it samples real lit deck pixels (not the unlit centerline a first attempt at this harness accidentally always hit) at noon and 02:00 for every simulated line, computing WCAG contrast against the basemap. **It failed, honestly and by design** — `MIN_CONTRAST` is pinned at the real WCAG floor (3.0), not weakened to pass: **14 of 20 line/time samples failed** (last measured 2026-08-09: **15**, after `pink-spur` was added; the harness has since been deleted, so this is no longer measurable), including **9 of 10 simulated lines at night** (only Airport Rail Link passes both times; noon failures: Sukhumvit, Yellow, Gold, Red Light, Blue). MRT Blue's failure is specifically traced to 8-bit sRGB colour quantization saturating its `#1964B7` livery near-black at night regardless of the ambient-light floor — not fixable by another `sun.ts` floor tweak; the other 8 failing lines may have more headroom. A follow-up task (not MVP 7) should fix the underlying night-lighting shortfall with a per-material minimum-brightness mechanism.
- This was the single highest-value item on this list — it is the gap that let all three MVP 6 defects ship — and closing it surfaced a real, bigger, previously-undetected problem (network-wide night illegibility) rather than just adding a check that happened to pass.

**Resolution (2026-08-12).** The shortfall this item measured is fixed, and it is measurable again **without reinstating a browser harness** — the shading model was made a pure function, so WCAG contrast for all 14 registry lines at noon and 02:00 is asserted inside `npm test`.

- **Mechanism:** each lit material gets an emissive term built from its own colour. Stage 1 is the minimum intensity that clears the floor (hue preserved exactly); stage 2 whitens by the minimum amount, only for a livery its own hue cannot save. 11 of 14 lines never whiten; `blue`, `purple`, `purple-ext` do — Blue at night only, the two Purples at both times. `MIN_CONTRAST` remains the real WCAG 3.0 and was never weakened.
- **`SHADING_SCALE = 1/π`, derived rather than fitted.** Three's `BRDF_Lambert` multiplies by `RECIPROCAL_PI` in both the direct and indirect Lambert paths; nothing compensates it, and `NoToneMapping` keeps the relationship multiplicative. A real-pixel measurement corroborates it (0.3271 ± 0.0108 over 13 samples, 0.81σ away; cleanest noon-only subset 0.315-0.318). `tools/calibrate-night-lift.mjs` re-derives it and is deliberately **unregistered** — a manual instrument, not a gate.
- **Two traps that bit during this work, worth remembering:** a material's `.color` lies about its real albedo wherever per-instance or per-vertex tinting is used (both `VehicleManager`'s trains and `buildMarkerPair`'s station discs do this), hence `materialAlbedo()` and the `userData.liveryHex` stamps; and the deleted harness's original sin was sampling the unlit `Line2` centerline instead of the lit deck.
- **Honest limits:** the gate asserts a *modelled* contrast, not a screenshot. It is only as good as `predictRendered`, which is why the calibration script stays in the tree. Nothing here checks the basemap's own contribution beyond the single night building colour used as the reference.

### 21. Dark / light theme toggle + basemap style cycle (satellite, terrain, …) — ✅ delivered in MVP 7 (vector styles only)
- ✅ Tri-state **Auto / Light / Dark** (`src/map/themeMode.ts`), not a boolean — "Auto" is exactly the pre-existing clock-driven F3.3 behaviour, byte-for-byte; Light/Dark pin the *palette* only (`effectiveElevationDeg`), the sun's direction stays clock-real in every mode
- ✅ Basemap style cycle — 3 key-free vector styles (Liberty/Bright/Positron, `src/map/basemapStyles.ts`). **Satellite and terrain were NOT added** — still out of scope, per constraint 2 below.
- **How the four constraints found while scoping this were actually resolved:**
  1. `map.setStyle()` **destroys every custom layer**, including the Three.js `network-3d` scene. ✅ Resolved: `src/map/styleBinding.ts` isolates everything that must re-run per `style.load` (underground-opacity snapshot, basemap-colour snapshot) from everything that must NOT (SimClient, FollowCamera, TrainTooltip, the rAF loop — re-creating those on a style swap would leak a second worker). A real bug found along the way: MapLibre v6's diffed `setStyle()` never sees custom layers (`Style.serialize()` excludes `type: "custom"`), so the old `NetworkLayer` survived a swap untouched and the new `addLayer()` collided — fixed with an explicit `map.removeLayer()` before `setStyle()`.
  2. Satellite/terrain are **raster** basemaps with no `fill`/`fill-extrusion`/`line` layers — **still true, still why they're not in the cycle.** Unaddressed; a future raster style needs `raster-opacity`/`raster-brightness-*` equivalents.
  3. **No-API-key constraint** — ✅ satisfied; all 3 delivered styles are OpenFreeMap, key-free.
  4. Underground dimming owns **opacity**; night theming owns **colour**, never the same paint property — ✅ resolved, `styleBinding.ts` enforces this split structurally (`applyUnderground` vs. `applyThemeElevation`, two different capture lists).
- ✅ **Expression-valued opacity guard — fixed 2026-08-05.** Bright/Positron basemaps use zoom expressions for `fill-opacity` on several layers (`landcover-glacier`, `landcover_wood`, `landuse_residential`, `aeroway-area`) instead of flat numbers. The underground-dimming capture originally cast these straight to number, so `Math.min(expression, 0.25)` evaluated to NaN and `setPaintProperty(..., NaN)` logged console validation errors. Fixed in `c92369f` by adding a type guard that skips non-number opacity values — mirroring the colour-capture guard's own skip pattern in the same function. Verified by `src/map/styleBinding.test.ts` line 104 ("skips layers whose fill-opacity is an expression..."), which asserts no NaN writes occur and the expression layer is never called with `setPaintProperty`.

### 22. Reaching the NF1 concurrency target
- NF1 wants sim tick < 3 ms for **≥300 concurrent vehicles**. Measured peak is **285** as of 2026-08-12 (was 246 with MRT Blue, 171–172 before it, and 250 once the Pink spur and APM landed).
- **The 250 → 285 rise is not progress on this item.** It came from fixing the zero-transit defect (item 24), which put 17% of the network's runs back in motion; no optimisation was done, and sim tick at the new concurrency has not been re-measured because the perf harness no longer exists.
- **Adding item 19 will not close this** — Orange and Purple Phase 2 are track-only and contribute zero vehicles. 246 is the real GTFS density of the current ten lines.
- Closing it honestly means either more *simulated* lines (MRT Blue's Muang Thong Thani-style spurs, the Pink spur, future extensions) or accepting the target was set against a denser network than Bangkok's published feed describes.
- The `>=300` assertion in the perf harness is deliberately left **failing** rather than weakened or fed synthetic load. `MAX_VEHICLES` is 1024, ~4× the measured peak, so there is real headroom.

---

## Hard / External Dependencies

### 11. Delay Information Display
- Show per-train delay time in the train inspector
- Requires a live data feed (GTFS-RT or equivalent) — **not currently available** for Bangkok operators
- **Status:** Blocked — revisit when BTS/MRT/SRT publish real-time feeds

### 12. Real-Time Train Positions
- Consume live vehicle position feeds to correct timetable-based interpolation
- **Status:** Not feasible — no public GTFS-RT or equivalent API exists for Bangkok transit

### 13. Real-Time Weather / Precipitation Overlay
- Display rain radar animation on the map
- Would need Thai Meteorological Department (TMD) or similar Bangkok radar data source
- **Status:** Requires research into available APIs

### 14. GTFS-Realtime Feed Support
- Accept `gtfsurl` / `gtfsvpurl` query parameters for external GTFS-RT feeds
- **Status:** Not feasible without available feeds

---

## Developer / Ecosystem

### 15. Embeddable Map API
- Expose a `Map` constructor: `new BangkokMetro3D({ container, ...options })`
- Allow third-party developers to embed the map in their own pages

### 16. API Methods & Events
- Programmatic control: `setClockSpeed()`, `setViewMode()`, `flyTo()`, etc.
- Event system: `on('trainclick')`, `on('stationclick')`, `on('load')`, etc.

### 17. Configuration Options
- Constructor options: `ecoFrameRate`, `configControl`, `lang`, `center`, `zoom`, etc.
- URL query parameter overrides

### 18. npm Package Distribution
- Publish as an installable npm package
- ESM and UMD builds
- TypeScript type definitions included
