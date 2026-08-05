# Addition Roadmap

Features to close parity with [nagix/mini-tokyo-3d](https://github.com/nagix/mini-tokyo-3d), adapted for the Bangkok context.

> **Out of scope:** Playback mode (date picker / historical time), airplane/flight layer, fireworks plugin, live camera plugin, PLATEAU 3D city model plugin — these are either Tokyo-specific or not relevant for this project.

---

## Trivial / Easy

### 1. Full-Screen Toggle — ✅ delivered in MVP 7
- ✅ Fullscreen button in `ViewControls.tsx`, targeting the app's whole-shell container (`[data-testid="map-container"]`) rather than `document.documentElement`, so every overlay stays visible in fullscreen too
- ✅ Esc key exits natively (the browser's own Fullscreen API behaviour); the button's own pressed-state mirrors `document.fullscreenElement` via a `fullscreenchange` listener rather than app state, since Esc bypasses any click handler
- See `npm run verify:mvp7` check 8 (asserts the element exposes `requestFullscreen` and the button calls it — headless Edge can refuse the resulting viewport change, so the check asserts the call, not the outcome)

### 2. Eco Mode — ✅ delivered in MVP 7
- ✅ Toggle button in `ViewControls.tsx` (`ecoMode` in the store)
- ✅ When enabled, throttles both the render loop's repaint cadence and the sim worker's own tick rate to ~1 Hz (`ECO_TICK_MS = 1000`, not literally "1 FPS" but the same intent) — measured steady-state is an exact 1 repaint/second once a brief enable-moment transient (MapLibre's own internal repaint settling, not this throttle) passes
- ✅ Positions are a pure function of time, so nothing drifts while throttled — verified directly (`verify:mvp7` check 7: a fresh engine read immediately after disabling matches the last-rendered pose to within ~1.5 m, consistent with ordinary train speed over the elapsed tens of milliseconds, not a catch-up jump)

### 3. Station Search
- Add a search button that opens a search panel
- Text input with autocomplete over all 155+ stations
- Selecting a station flies the camera to it and opens the station board
- Filter results as the user types

### 3.1 Suvarnabhumi Airport (BKK) - APM (Can be implemented as Plugin)
- APM to move people from main terminal to SAT-1
- Operate 24Hr
- Need more research

---

## Medium

### 4. Mobile / Responsive Layout — ✅ delivered (post-MVP 6, landed alongside the on-map train tooltip)
- ✅ Responsive UI panels (inspector, station board, time controls) restructure into a full-width bottom-sheet stack below Tailwind's `md:` (768px) breakpoint
- ✅ Touch-optimized controls — 40px+ touch targets, a real single-finger touch drag pans the map, `devicePixelRatio` capped at 2 on coarse-pointer (touch) devices only (desktop retina displays are exempt — capping them was a measurable sharpness regression solving a problem they don't have)
- ✅ Proper viewport handling — safe-area-inset-aware positioning (notched devices)
- ✅ Tested against real layout math, not just visual inspection — `npm run verify:mobile` (11/11): no overlap between the line selector, `NavigationControl`, and the bottom sheet at 320-375px viewports; the 768px desktop/mobile boundary is exact
- ✅ Collapsible line-selector card (default collapsed on phones) with a "hide UI" toggle that collapses every overlay, including the DOM-owned (non-React) train tooltip

### 5. Underground Mode — ✅ delivered (MVP 6 + MVP 7)
- ✅ Toggle button to switch between overground and underground views (`ViewControls.tsx`)
- ✅ When on: map darkens, overground railways/stations/trains become translucent, underground elements appear bright
- ✅ **Auto-switch when a tracked train enters/exits a tunnel — delivered in MVP 7** (`src/map/autoUnderground.ts`'s `decideAutoUnderground`). Decides on the followed vehicle's real ALTITUDE (LANE_Z), not its track segment's structure tag — a tagged-underground point can legitimately sit near the surface mid-ramp, and altitude is already in the vehicle buffer with no extra track lookup needed. Engages below −5 m, releases above −1 m (a 4 m hysteresis band so it doesn't flicker at a portal straddle); a manual toggle mid-follow overrides auto for the rest of that follow session, so auto never fights the user. Verified end-to-end against the real running app (`npm run verify:mvp7` check 5). Two small, disclosed edge-case gaps in the state machine (not exercised by the acceptance checks): turning underground ON before crossing the threshold then OFF after crossing it doesn't register as an override; if the followed run vanishes from the vehicle buffer entirely mid-follow, an auto-engaged state can stick until following is explicitly cleared.
- ✅ **Depends on:** MRT Blue line implementation (MVP 6) — delivered, with real per-segment structure from OSM tags
- ⚠️ **Honest limitation:** the effect is **opacity-based, not depth-correct**. Surface geometry is made translucent; it is not true occlusion against MapLibre's depth buffer. Basemap fades to 0.25 opacity (SRS §F3.2 band is 0.1–0.4). Sorting is by each mesh's `userData.structure` **tag**, not its altitude — so a point mid-way up a portal ramp renders in its tag's band even where it is visually near the surface.

### 6. Day/Night Lighting — ✅ delivered (MVP 6 + MVP 7 sky dome)
- ✅ Scenery color changes based on Bangkok sunrise/sunset times — both the Three.js scene (`sun.ts`, SRS F3.3) and the MapLibre basemap (`basemapTheme.ts`, added beyond F3.3 by request)
- ✅ Sunset glow effect — **delivered in MVP 7**: a real horizon-clipped Three.js sky dome shipped (`src/map/skyDome.ts`, `RADIUS_M = 120_000`), not the MapLibre-sky fallback the plan also scoped. It discards every fragment below the local ENU horizon plane rather than attempting real depth interop with MapLibre's tiles — same disclosed-tradeoff shape as item 5's opacity-based underground mode. Colours come from the same `skyPalette` that lights the scene, so the horizon warms exactly when the key light warms. Its verified-clean envelope is pitch ≥70° at zoom ≤12.5 (the dome's fixed radius is smaller than MapLibre's dynamically-computed far clip plane at closer zoom — a pre-existing MapLibre v6 behaviour, not a regression); pitch 0/45° pass vacuously since nothing is drawn there to wash in the first place.
- ✅ Smooth transition between day and night — `nightFactor` ramps across civil twilight rather than switching at 0°, so scrubbing through dusk does not pop
- ✅ Calculated solar position (NOAA low-precision, UTC+7 fixed, no DST)
- ⚠️ **Night legibility rests on a raised lighting floor** (`sunIntensity` 0.9, `ambientIntensity` 1.35 at night) so the network stays readable against the dark city. **An automated check now exists** (MVP 7, see item 20) — and it currently fails honestly for 9 of 10 simulated lines at night, a materially bigger gap than this raised floor alone closes. Read item 20 before assuming "readable" is fully true.

### 7. Multi-Language Support (EN + TH)
- Internationalization framework (i18n)
- Thai translations for all UI labels, station names, line names
- Language switcher in the UI
- Station names should display in the selected language

### 8. Route Search (A → B)
- Search panel with origin and destination station inputs
- Pathfinding over the station graph using interchange metadata (already auto-linked within 300 m + manual overrides)
- BFS/Dijkstra weighted by scheduled travel times from the binary timetable
- Display route with transfer instructions, estimated travel time, and departure/arrival times
- Highlight the route on the map

### 9. Plugin Architecture
- Formal plugin interface (register/unregister, lifecycle hooks)
- Layer display settings panel to toggle plugin layers on/off
- Potential first plugins: weather overlay, points of interest

### 10. Custom Train / Rolling Stock Models
- Replace generic vehicle-type geometry (heavy-rail, monorail, APM, commuter) with accurate per-line 3D models matching real rolling stock
- Examples: BTS Sukhumvit/Silom (Siemens EMU), MRT Purple (CRRC EMU), Airport Rail Link (CAF), SRT Red (Hitachi), Pink/Yellow (Alstom monorail), Gold (Bombardier APM)
- Source or create `.glb` models for each operator's train set
- Correct livery colors, car count, and proportions per line
- Lazy-load models with LOD (level of detail) fallback to keep bundle size under budget

---

## Deferred from MVP 6

Concrete, already-scoped work that fell out of MVP 6. Constraints below were established during MVP 6 — they are not guesses, and they are the expensive part to rediscover.

### 19. MRT Orange + MRT Purple Phase 2 (track-only, pre-revenue) — ✅ delivered 2026-08-04
- Was Task 6 of the MVP 6 plan, deferred by decision, then picked back up and completed
- Both render as track geometry with no trains (`gtfsRouteId: null`, `preRevenue: true`), dashed centerline + desaturated deck — the pre-revenue treatment built in MVP 5/6 got its first real users
- **The plan's assumed mechanism didn't hold**: neither line has a route relation in OSM (checked operational, `route=construction`, `proposed:route` — all empty, verified 2026-08-04). The widened discovery query correctly found nothing; what exists instead is raw, individually-tagged `railway=construction` ways with no relation grouping them. A new way-name-based fetch path (`fetchBranchFromWayName` in `tools/fetch-network.mjs`) queries and stitches these directly, skipping the relation layer — see CLAUDE.md's "Orange/Purple Phase 2 track-only fetch" implementation notes for the full mechanism (crossover-way filtering, why stations are empty, etc.)
- **Both lines have zero stations** — a citywide search found only 2 named construction-stage station nodes in all of OSM, both outside these lines' own track bounding boxes and not trustworthy enough to place
- `LINES` grew from 10 to 12 (append-only, invariant preserved); network totals (8,193 runs, 193 stations) unchanged since both lines contribute zero of either
- The two `verify:mvp6` acceptance checks this item's absence had caused to be deferred (a pre-revenue line renders but never simulates; a pre-revenue station's board resolves empty) are restored — harness is 8/8, up from 6/6
- **Caught in code review, not before merge: the first version of the way-based fetch stitched MRT Orange into an out-and-back double-track loop** (43.6 km for a real ~22 km alignment — two nearly-parallel construction ways with no direction tag greedily stitched end-to-end). Fixed with a fold-detection/truncation pass (`truncateAtFold` in `tools/trackProfile.mjs`, now unit-tested with synthetic fixtures) before merge — see CLAUDE.md for the full story. Worth naming for future way-based fetches: a raw name-based way query has none of a PTv2 route relation's built-in curation (ordering, single direction, no crossovers), so this class of bug is a standing risk whenever this mechanism gets a third user.
- **MRT Orange Western Section (Thailand Cultural Centre ↔ Bang Khun Non) — added separately, then merged into one combined `orange` entry.** The item above describes the Eastern Section fetch; the Western Section (`osm.wayNamePattern` matching `รถไฟฟ้าสายสีส้มตะวันตก ช่วงศูนย์วัฒนธรรมฯ-บางขุนนนท์`, 3 ways) landed as its own `orange-west` registry entry in a later task (105 track points, all underground, 13.5 km, 0 stations — same "no route relation, no trustworthy station node" situation as the Eastern Section). **An ad-hoc task (2026-08-04, requested mid-plan, not in any plan file) then merged `orange-west` and the original `orange` into one combined `orange` entry** via a new `fetchBranchFromWayNames` (plural — calls the existing single-pattern fetcher per part, splices at a shared junction point with a 20 m gap safety check): 105 western points + 171 eastern points − 1 shared junction at Thailand Cultural Centre = 275 points, 192 underground/83 elevated, ~35.3 km. The standalone `orange-west` key no longer exists; the registry stayed at 12 lines (the merge changed representation, not count). `npm run verify:mvp7` check 2 re-verifies the merged line is still a single clean traverse (haversine length within 15% of ~35.3 km), not a doubled-back polyline — the same class of bug item 19 already found and fixed once for the Eastern Section alone.

### 20. Automated coverage for visual/perceptual regressions — ✅ delivered in MVP 7
- **All three defects found at the end of MVP 6 were spotted by a human looking at the running app** — broken portal geometry, a station ~187 m off its track, and an unreadable network at night. `verify:mvp6` (6/6), `verify:mvp4`, `verify:mvp5`, `verify:kinematics` and the full unit suite were **green throughout**.
- ✅ **Preprocessor sanity gates (2, both hard-fail):** `check_track_gradient` (`rust-engine/preprocessor/src/main.rs`) rejects any consecutive track-vertex pair steeper than the 4% ruling gradient — closes the "108% ramp / vertical wall at a portal" defect class directly. A closed bypass in the existing snap-distance gate (`MAX_SNAP_M`/`SNAP_WARN_M`) now also checks registry-hand-patched station positions for GTFS-simulated lines, not just GTFS's own raw coordinate — the pre-existing gate had never actually fired for Mo Chit's 187.4 m pre-fix defect, because it only ever saw GTFS's coordinate, not `network.json`'s hand-patched one (see CLAUDE.md's MVP 7 notes for the precise finding). Both gates fail the build with a clear message rather than warning and continuing.
- ✅ **Night-legibility assertion:** `npm run verify:legibility` samples real lit deck pixels (not the unlit centerline a first attempt at this harness accidentally always hit) at noon and 02:00 for every simulated line, computing WCAG contrast against the basemap. **It currently fails, honestly and by design** — `MIN_CONTRAST` is pinned at the real WCAG floor (3.0), not weakened to pass: **14 of 20 line/time samples fail**, including **9 of 10 simulated lines at night** (only Airport Rail Link passes both times; noon failures: Sukhumvit, Yellow, Gold, Red Light, Blue). MRT Blue's failure is specifically traced to 8-bit sRGB colour quantization saturating its `#1964B7` livery near-black at night regardless of the ambient-light floor — not fixable by another `sun.ts` floor tweak; the other 8 failing lines may have more headroom. A follow-up task (not MVP 7) should fix the underlying night-lighting shortfall with a per-material minimum-brightness mechanism.
- This was the single highest-value item on this list — it is the gap that let all three MVP 6 defects ship — and closing it surfaced a real, bigger, previously-undetected problem (network-wide night illegibility) rather than just adding a check that happened to pass.

### 21. Dark / light theme toggle + basemap style cycle (satellite, terrain, …) — ✅ delivered in MVP 7 (vector styles only)
- ✅ Tri-state **Auto / Light / Dark** (`src/map/themeMode.ts`), not a boolean — "Auto" is exactly the pre-existing clock-driven F3.3 behaviour, byte-for-byte; Light/Dark pin the *palette* only (`effectiveElevationDeg`), the sun's direction stays clock-real in every mode
- ✅ Basemap style cycle — 3 key-free vector styles (Liberty/Bright/Positron, `src/map/basemapStyles.ts`). **Satellite and terrain were NOT added** — still out of scope, per constraint 2 below.
- **How the four constraints found while scoping this were actually resolved:**
  1. `map.setStyle()` **destroys every custom layer**, including the Three.js `network-3d` scene. ✅ Resolved: `src/map/styleBinding.ts` isolates everything that must re-run per `style.load` (underground-opacity snapshot, basemap-colour snapshot) from everything that must NOT (SimClient, FollowCamera, TrainTooltip, the rAF loop — re-creating those on a style swap would leak a second worker). A real bug found along the way: MapLibre v6's diffed `setStyle()` never sees custom layers (`Style.serialize()` excludes `type: "custom"`), so the old `NetworkLayer` survived a swap untouched and the new `addLayer()` collided — fixed with an explicit `map.removeLayer()` before `setStyle()`.
  2. Satellite/terrain are **raster** basemaps with no `fill`/`fill-extrusion`/`line` layers — **still true, still why they're not in the cycle.** Unaddressed; a future raster style needs `raster-opacity`/`raster-brightness-*` equivalents.
  3. **No-API-key constraint** — ✅ satisfied; all 3 delivered styles are OpenFreeMap, key-free.
  4. Underground dimming owns **opacity**; night theming owns **colour**, never the same paint property — ✅ resolved, `styleBinding.ts` enforces this split structurally (`applyUnderground` vs. `applyThemeElevation`, two different capture lists).
- ⚠️ **Known disclosed gap, found during Task 12's own harness work:** on Bright/Positron, a handful of layers (`landcover-glacier`/`landcover_wood`/`landuse_residential`/`aeroway-area`) use a zoom-expression `fill-opacity` rather than a flat number; the underground-dimming capture has no type guard for that case (unlike its colour-capture code, which does guard), so `Math.min(expression, 0.25)` silently NaNs and logs a console validation error for those specific layers — every other layer still dims correctly, and the feature works overall. Small, low-risk fix mirroring the existing colour-skip pattern; not yet scheduled.

### 22. Reaching the NF1 concurrency target
- NF1 wants sim tick < 3 ms for **≥300 concurrent vehicles**. Measured peak is **246** (was 171–172 before MRT Blue).
- **Adding item 19 will not close this** — Orange and Purple Phase 2 are track-only and contribute zero vehicles. 246 is the real GTFS density of the current ten lines.
- Closing it honestly means either more *simulated* lines (MRT Blue's Muang Thong Thani-style spurs, the Pink spur, future extensions) or accepting the target was set against a denser network than Bangkok's published feed describes.
- The `>=300` assertion in `verify:perf` is deliberately left **failing** rather than weakened or fed synthetic load. `MAX_VEHICLES` is 1024, ~4× the measured peak, so there is real headroom.

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
