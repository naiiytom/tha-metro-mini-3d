# Addition Roadmap

Features to close parity with [nagix/mini-tokyo-3d](https://github.com/nagix/mini-tokyo-3d), adapted for the Bangkok context.

> **Out of scope:** Playback mode (date picker / historical time), airplane/flight layer, fireworks plugin, live camera plugin, PLATEAU 3D city model plugin — these are either Tokyo-specific or not relevant for this project.

---

## Trivial / Easy

### 1. Full-Screen Toggle
- Add a fullscreen button to the map UI
- Use the browser Fullscreen API (`document.documentElement.requestFullscreen()`)
- Esc key to exit

### 2. Eco Mode
- Add a battery icon toggle button
- When enabled, throttle rendering to ~1 FPS to save resources
- Useful for background tabs or low-power devices

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

### 4. Mobile / Responsive Layout
- Responsive UI panels (inspector, station board, time controls) that adapt to small screens
- Touch-optimized controls (larger tap targets, swipe-to-dismiss panels)
- Proper viewport meta handling for mobile browsers
- Test and fix any layout issues on phones and tablets
- Collapsible/drawer-based panels instead of fixed overlays

### 5. Underground Mode — ✅ mostly delivered in MVP 6
- ✅ Toggle button to switch between overground and underground views (`ViewControls.tsx`)
- ✅ When on: map darkens, overground railways/stations/trains become translucent, underground elements appear bright
- ⬜ **Auto-switch when a tracked train enters/exits a tunnel** — not built; the only remaining piece
- ✅ **Depends on:** MRT Blue line implementation (MVP 6) — delivered, with real per-segment structure from OSM tags
- ⚠️ **Honest limitation:** the effect is **opacity-based, not depth-correct**. Surface geometry is made translucent; it is not true occlusion against MapLibre's depth buffer. Basemap fades to 0.25 opacity (SRS §F3.2 band is 0.1–0.4). Sorting is by each mesh's `userData.structure` **tag**, not its altitude — so a point mid-way up a portal ramp renders in its tag's band even where it is visually near the surface.

### 6. Day/Night Lighting — ✅ delivered in MVP 6
- ✅ Scenery color changes based on Bangkok sunrise/sunset times — both the Three.js scene (`sun.ts`, SRS F3.3) and the MapLibre basemap (`basemapTheme.ts`, added beyond F3.3 by request)
- 🟡 Sunset glow effect — partial: `skyPalette` warms the light through a golden band around the horizon, but there is no sky/atmosphere glow
- ✅ Smooth transition between day and night — `nightFactor` ramps across civil twilight rather than switching at 0°, so scrubbing through dusk does not pop
- ✅ Calculated solar position (NOAA low-precision, UTC+7 fixed, no DST)
- ⚠️ **Night legibility rests on a raised lighting floor** (`sunIntensity` 0.9, `ambientIntensity` 1.35 at night) so the network stays readable against the dark city. **No automated check asserts this** — see item 20.

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

### 20. Automated coverage for visual/perceptual regressions
- **All three defects found at the end of MVP 6 were spotted by a human looking at the running app** — broken portal geometry, a station ~187 m off its track, and an unreadable network at night. `verify:mvp6` (6/6), `verify:mvp4`, `verify:mvp5`, `verify:kinematics` and the full unit suite were **green throughout**.
- Nearest concrete fixes:
  - Night-legibility assertion: offscreen luminance readback at two clock times, asserting a minimum network-vs-basemap contrast ratio
  - A preprocessor sanity gate on track gradient and per-stop snap distance, so a 108% ramp or a 187 m snap fails the build rather than reaching a screenshot
- This is the single highest-value item on this list: it is the gap that let all three ship.

### 21. Dark / light theme toggle + basemap style cycle (satellite, terrain, …)
- Tri-state **Auto / Light / Dark**, not a boolean — "Auto" must remain the clock-driven F3.3 behaviour already delivered
- **Four constraints found while scoping this — read before starting:**
  1. `map.setStyle()` **destroys every custom layer**, including the Three.js `network-3d` scene. Every `style.load` side-effect must re-run: the underground opacity snapshot, the basemap colour snapshot, `VehicleManager` wiring, click handlers, and the sun sync. A style cycle makes repeated `style.load` firing the *normal* case, where today it is an edge case guarded for React StrictMode.
  2. Satellite and terrain are **raster** basemaps with no `fill`/`fill-extrusion`/`line` layers. Both underground dimming **and** night theming mutate vector layer colours/opacities, so **both silently become no-ops** on a raster basemap. They need `raster-opacity`/`raster-brightness-*` equivalents, or must be visibly disabled on raster styles.
  3. **No-API-key is a standing project constraint** (why OpenFreeMap Liberty was chosen). Vector variants stay key-free; satellite needs a third-party raster source with its own attribution and ToS review, and terrain needs a DEM source. Any addition must render its attribution — ODbL/NF6 discipline.
  4. Underground dimming owns **opacity**; night theming owns **colour**. They must never write the same paint property, and night theming must blend from the colour captured once at `style.load` — blending from the live value compounds at ~2 Hz and drives the map to black.

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
