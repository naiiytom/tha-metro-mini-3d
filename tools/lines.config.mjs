/**
 * Line registry — the single source of truth for line identity across the
 * Overpass fetcher, the Rust preprocessor and the frontend renderer.
 *
 * ORDER IS LOAD-BEARING: index in LINES == network.json lines[i]
 * == cache routes[i] == vehicle-buffer route_idx (contract §3 lane 6).
 * Appending is safe; reordering or removing invalidates a committed .tmb.
 *
 * `gtfsRouteId: null` means "track geometry only" — rendered, never simulated
 * (the MVP 6 Orange Line pattern, also the fallback when a feed omits a line).
 */

/** Nominal deck heights, SRS §F1.3 (elevated +12..+22, at-grade +0.5). */
export const STRUCTURE_ALTITUDE_M = {
  elevated: 15,
  atGrade: 0.5,
  underground: -18,
};

export const VEHICLE_TYPES = ["heavy", "monorail", "apm", "commuter"];

/**
 * Classify one OSM way as underground / elevated / at-grade from its
 * tunnel/bridge/layer tags.
 *
 * Duplicated from src/map/structure.ts because this file runs in plain node
 * (the fetcher imports it directly) and cannot import a .ts module. Keep the
 * two copies in sync — lines.config.test.mjs asserts they agree on the same
 * cases structure.test.ts checks for the TS copy.
 *
 * `tunnel=building_passage` is a deliberate exception: OSM uses it for track
 * running through/under a building, not a physically bored tunnel. Verified
 * against real Bangkok data — both SRT Dark Red and Light Red are tagged
 * tunnel=building_passage + layer=1 (positive) + covered=yes at Bang Sue
 * Grand Station, and the SRT Red lines have no underground track anywhere.
 * Falls through to bridge/layer/fallback, same as tunnel=no.
 */
export function structureOfWay(tags, fallback = "elevated") {
  const tunnel = tags.tunnel;
  if (tunnel && tunnel !== "no" && tunnel !== "building_passage") return "underground";
  const bridge = tags.bridge;
  if (bridge && bridge !== "no") return "elevated";
  if (tunnel === "no" || bridge === "no") return "elevated";
  const layer = Number.parseInt(tags.layer ?? "", 10);
  if (Number.isFinite(layer) && layer < 0) return "underground";
  if (Number.isFinite(layer) && layer > 0) return "elevated";
  return fallback;
}

export const LINES = [
  {
    key: "sukhumvit",
    name: "Sukhumvit Line",
    nameTh: "สายสุขุมวิท",
    color: "#7CB342",
    structure: "elevated",
    vehicleType: "heavy",
    gtfsRouteId: "1",
    preRevenue: false,
    osm: { relationId: 444651, match: /sukhumvit/i },
    // Disclosed snap in the 50-150 m band (see SNAP_WARN_M in the
    // preprocessor). GTFS stop 13608 "BTS Kheha" (this line's northern-most
    // extension terminus) snaps 63.9 m from the fetched OSM track — a
    // genuine terminus geometry offset, not bad data (see the MVP 2/3
    // implementation notes in CLAUDE.md: Kheha has snapped 60-65 m since
    // MVP 2, well under the 150 m hard limit). Measured 2026-08-04 — re-run
    // npm run data:fetch and re-measure if the feed or track moves.
    //   13608 BTS Kheha  63.9 m
    snapWarnExemptStopIds: ["13608"],
  },
  {
    key: "silom",
    name: "Silom Line",
    nameTh: "สายสีลม",
    color: "#00877C",
    structure: "elevated",
    vehicleType: "heavy",
    gtfsRouteId: "2",
    preRevenue: false,
    osm: { relationId: 2067854, match: /silom/i },
  },
  {
    key: "purple",
    name: "MRT Purple Line",
    nameTh: "สายสีม่วง",
    // Feed route_color (660066) differs from the conventional #7E57C2 livery
    // swatch — using the feed's value per tools/inspect-gtfs.mjs.
    color: "#660066",
    structure: "elevated",
    vehicleType: "heavy",
    gtfsRouteId: "4",
    preRevenue: false,
    osm: { relationId: 6988563, match: /purple/i },
  },
  {
    key: "arl",
    name: "Airport Rail Link",
    nameTh: "แอร์พอร์ต เรล ลิงก์",
    // Feed route_color (E32020) differs from the conventional #D32F2F swatch.
    color: "#E32020",
    structure: "elevated",
    vehicleType: "commuter",
    gtfsRouteId: "5",
    preRevenue: false,
    osm: { relationId: 2148241, match: /airport rail link/i },
  },
  {
    key: "pink",
    name: "MRT Pink Line",
    nameTh: "สายสีชมพู",
    // Feed route_color (cd4692) differs from the conventional #EC407A swatch.
    color: "#CD4692",
    structure: "elevated",
    vehicleType: "monorail",
    gtfsRouteId: "2436",
    preRevenue: false,
    osm: { relationId: 16740886, match: /pink/i },
    // The Namtang feed bundles the Muang Thong Thani spur's 4 shuttle trip
    // patterns (stop_ids 16936 "Impact Muang Thong Thani" / 16937 "Lake
    // Muang Thong Thani") into this SAME route_id alongside the 30-station
    // main line — discovered when the preprocessor's snap check hard-failed
    // (those 2 stops are ~1.2 km off the main-line-only track fetched
    // above). The spur is a real, separate physical branch (relation pair
    // 19149752/19150155 in OSM) whose own track geometry is out of scope
    // for this registry entry (see docs/SRS.md §2's caveat block) — until a
    // future task adds it as its own line, drop these 2 stops (and the
    // trips that serve them) rather than mis-snapping them onto the trunk.
    excludeGtfsStopIds: ["16936", "16937"],
    // GTFS stop 359 ("MRT Nonthaburi Civic Center", the Pink Line's own
    // western terminus) is 555 m from where this line's fetched track ends
    // — but that's a GTFS coordinate quirk, not a stitching bug: the
    // Namtang feed's lat/lng for stop 359 is 8 m from OSM node 5222843684
    // (MRT Purple, ref PP11) — the Purple-side half of this interchange —
    // while the real Pink-side platform (OSM node 11364308559, ref PK01)
    // is 555 m away and matches this line's fetched track endpoint to
    // within 2.7 m. Verified via a direct Overpass node-tag lookup
    // (2026-07-31); allowing the large snap keeps the real terminus in
    // simulation instead of failing the whole route or dropping it.
    allowLargeSnapStopIds: ["359"],
    // Stop 359's 554.7 m snap is already disclosed above via
    // allowLargeSnapStopIds; classify_snap() in the preprocessor treats that
    // list as also satisfying the 50 m warn band, so no separate
    // snapWarnExemptStopIds entry is needed for it (one disclosure per
    // stop — see main.rs's snap_band_defers_to_the_existing_large_snap_
    // allowance_above_the_hard_limit test).
  },
  {
    key: "yellow",
    name: "MRT Yellow Line",
    nameTh: "สายสีเหลือง",
    // Feed route_color (FFE547) is a very pale yellow that reads as nearly
    // invisible against the basemap's tan/beige — unlike the other lines'
    // feed-vs-conventional mismatches (a few degrees of hue/saturation), this
    // one is a legibility problem, not just a stylistic difference. Uses the
    // conventional MRT Yellow swatch instead.
    color: "#FBC02D",
    structure: "elevated",
    vehicleType: "monorail",
    gtfsRouteId: "2224",
    preRevenue: false,
    osm: { relationId: 15806897, match: /yellow/i },
  },
  {
    key: "gold",
    name: "BTS Gold Line",
    nameTh: "สายสีทอง",
    // Feed route_color (A3862A) differs from the conventional #C9A227 swatch.
    color: "#A3862A",
    structure: "elevated",
    vehicleType: "apm",
    gtfsRouteId: "2025",
    preRevenue: false,
    osm: { relationId: 11681439, match: /gold/i },
  },
  {
    key: "red-dark",
    name: "SRT Dark Red Line",
    nameTh: "สายสีแดงเข้ม",
    // Feed route_color (e10506) differs from the conventional #B71C1C swatch.
    color: "#E10506",
    // Default (untagged-way fallback) is atGrade, not elevated: SRT commuter
    // rail is fundamentally ground-level track with elevated viaduct sections
    // through the city core near Bang Sue Grand Station, the opposite mix of
    // every other (fully-elevated) line in this registry. Verified against
    // real OSM way tags (2026-08-01): of 23 track ways, 17 carry an explicit
    // bridge/positive-layer tag (elevated) and the other 6 carry neither
    // (4 bare, 2 embankment=yes) — embankment is raised earthwork, not a
    // viaduct, so it reads as atGrade same as an untagged way.
    structure: "atGrade",
    vehicleType: "commuter",
    gtfsRouteId: "2026",
    preRevenue: false,
    osm: { relationId: 13058384, match: /dark red|red line.*rangsit/i },
  },
  {
    key: "red-light",
    name: "SRT Light Red Line",
    nameTh: "สายสีแดงอ่อน",
    // Feed route_color (fd5353) differs from the conventional #EF5350 swatch.
    color: "#FD5353",
    // Same reasoning as red-dark above: 10 of 19 ways carry an explicit
    // bridge/positive-layer tag, the other 9 (7 bare, 2 embankment=yes) fall
    // through to this atGrade default.
    structure: "atGrade",
    vehicleType: "commuter",
    gtfsRouteId: "2027",
    preRevenue: false,
    osm: { relationId: 13178788, match: /light red|red line.*taling chan/i },
  },
  {
    key: "blue",
    name: "MRT Blue Line",
    nameTh: "สายสีน้ำเงิน",
    // Feed route_color (1964B7) from tools/inspect-gtfs.mjs.
    color: "#1964B7",
    // DEFAULT only: MRT Blue's real alignment is mixed. Per-point structure
    // comes from each OSM way's tunnel/bridge/layer tags (Task 2). Elevated
    // is the safer fallback for an untagged way — a mis-defaulted underground
    // segment would sink through the ground plane invisibly, while a
    // mis-defaulted elevated one is obvious on screen.
    structure: "elevated",
    vehicleType: "heavy",
    gtfsRouteId: "3",
    preRevenue: false,
    // Discovery (npm run data:fetch -- blue) returned 2 candidates, both
    // directional variants of the full alignment (no short-turn variant
    // appeared): 444659 "MRT Blue Line (Tha Phra -> Lak Song)" and 7725025
    // "MRT Blue Line (Lak Song -> Tha Phra)". Picked 444659 (either
    // direction's track is fine, per fetch-network.mjs's own comment) —
    // confirmed it covers the full loop-plus-branch alignment: the committed
    // network.json (full `npm run data:fetch` run) has 494 track points with
    // BOTH elevated:234 and underground:260, not a partial/short-turn subset.
    // (The single-line `-- blue` fetch used to pick this id logged 495/261 —
    // a one-point delta from a way-join dedup step that only fires when all
    // ten lines are fetched together; not a discrepancy worth chasing.)
    osm: { relationId: 444659, match: /blue/i },
    // Disclosed snaps in the 50-150 m band (see SNAP_WARN_M in the
    // preprocessor). Blue's underground alignment is denser and more
    // convoluted than the elevated BTS lines the 150 m limit was originally
    // benchmarked against, so a worse snap here is the expected shape, not a
    // red flag (see CLAUDE.md's MVP 2/3 implementation notes: Itsaraphap is
    // already documented there as the network's single largest snap,
    // 109.47 m, confirmed from the preprocessor's own stderr). Measured
    // 2026-08-04 — re-run npm run data:fetch and re-measure if the feed or
    // track moves. (Queen Sirikit NCC, stop 361, is 48.9 m — under the 50 m
    // warn band, so it needs no entry here.)
    //   13627 MRT Itsaraphap      109.5 m
    //   352   MRT Chatuchak Park   61.1 m
    snapWarnExemptStopIds: ["13627", "352"],
  },
  {
    key: "orange",
    name: "MRT Orange Line",
    nameTh: "สายสีส้ม",
    color: "#F57C00",
    // Default only; real per-point tunnel/bridge/layer tags on these ways
    // give a genuine underground/elevated mix (verified 2026-08-04: 88
    // underground / 83 elevated points across the stitched alignment, after
    // truncateAtFold removes an out-and-back double-back the raw greedy
    // stitch produced — see tools/trackProfile.mjs).
    structure: "underground",
    vehicleType: "heavy",
    // Pre-revenue: Eastern Section projected late 2027 (SRS §2 caveat block,
    // re-verified 2026-07-31). No trains until it has a published schedule.
    gtfsRouteId: null,
    preRevenue: true,
    // No route relation exists for this line anywhere in OSM (checked
    // operational, route=construction, and proposed:route — none, verified
    // 2026-08-04), so there is no relationId to pin. What DOES exist: 16 real
    // railway=construction ways named exactly "รถไฟฟ้ามหานคร สายสีส้ม" (the
    // Eastern Section — deliberately excluded the separately-named "...
    // ตะวันตก" (West) ways, same Eastern-only scoping the original plan
    // called for). wayNamePattern pins that exact name so fetchBranchFromWayName
    // can stitch them directly; see that function's own comment for why
    // stations are intentionally empty.
    osm: { relationId: null, wayNamePattern: "^รถไฟฟ้ามหานคร สายสีส้ม$" },
  },
  {
    key: "purple-ext",
    name: "MRT Purple Line (Phase 2)",
    nameTh: "สายสีม่วงใต้ ช่วงเตาปูน–ราษฎร์บูรณะ",
    // Same hue as the operational Purple so the two read as one line; the
    // dashed/desaturated pre-revenue treatment distinguishes them on screen.
    color: "#660066",
    // Default only; real per-point tags give a genuine mix (verified
    // 2026-08-04: elevated/underground both present across the stitched
    // alignment, spanning the full Rat Burana-to-Tao Poon extent).
    structure: "underground",
    vehicleType: "heavy",
    // Still under construction: opening_date=2027 per the OSM way tags
    // themselves (cross-checked against SRS §2's caveat block, re-verified
    // 2026-07-31, which also notes a September 2025 worksite road collapse).
    gtfsRouteId: null,
    preRevenue: true,
    // Same situation as `orange` above: no route relation exists in OSM for
    // this extension (verified 2026-08-04). The real geometry is 10
    // railway=construction ways named "รถไฟฟ้าสายสีม่วงใต้ ช่วงเตาปูน–
    // ราษฎร์บูรณะ-ครุใน" (Purple South, Tao Poon-Rat Burana-Khru Nai) — this
    // is the southern extension, distinct from the operational `purple`
    // entry's own relation. wayNamePattern pins the exact name; see
    // fetchBranchFromWayName for why stations are intentionally empty.
    osm: { relationId: null, wayNamePattern: "สายสีม่วงใต้" },
  },
];

/**
 * Interchanges the 300 m radius cannot see — long paid/unpaid walkways.
 * Entries are line-qualified: a bare stop-id pair would link every route
 * that happens to reuse that id (Namtang reuses ids across operators).
 */
export const INTERCHANGE_OVERRIDES = [
  // MRT Purple <-> MRT Pink, Nonthaburi Civic Center. The Namtang feed uses
  // the SAME gtfs_stop_id (359) on both lines' schedules, but the platforms
  // are ~555 m apart (Purple's PP11 vs Pink's PK01, confirmed against OSM
  // node tags — see the allowLargeSnapStopIds note on the `pink` entry).
  { aLine: "purple", aStop: "359", bLine: "pink", bStop: "359" },
  // BTS Silom <-> MRT Blue, Sala Daeng / Si Lom. A real, heavily-used
  // interchange (shared paid-area walkway) that the 300 m auto-link radius
  // does not reach: measured 319.3 m between the two stations' actual
  // snapped-onto-track positions (a temporary debug print in
  // link_interchanges, task 5, since reverted — not a bug, just outside the
  // radius). GTFS stop ids: Silom's Sala Daeng is "10", Blue's Si Lom is
  // "329" (per inspect-gtfs.mjs / preprocessor snap-warning stop names).
  { aLine: "silom", aStop: "10", bLine: "blue", bStop: "329" },
  // Airport Rail Link <-> MRT Blue, Phetchaburi / Makkasan. Also real and
  // heavily used. Measured 304.8 m between the two stations' snapped-onto-
  // track positions (same temporary debug print as above) — just outside
  // the 300 m radius, not a link_interchanges bug (both stops individually
  // snap within 40 m of their own line's GTFS coordinates, so the shortfall
  // is genuine geometry, not a snap artifact). GTFS stop ids: ARL's Makkasan
  // is "324", Blue's Phetchaburi is "345".
  { aLine: "arl", aStop: "324", bLine: "blue", bStop: "345" },
];

const HEX = /^#[0-9a-fA-F]{6}$/;

/** Throws on any registry mistake that would corrupt the index invariant. */
export function assertRegistryValid(lines = LINES) {
  const keys = new Set();
  const routeIds = new Set();
  for (const l of lines) {
    if (keys.has(l.key)) throw new Error(`duplicate line key '${l.key}'`);
    keys.add(l.key);
    if (l.gtfsRouteId !== null) {
      if (routeIds.has(l.gtfsRouteId)) {
        throw new Error(`duplicate gtfsRouteId '${l.gtfsRouteId}'`);
      }
      routeIds.add(l.gtfsRouteId);
    }
    if (!(l.structure in STRUCTURE_ALTITUDE_M)) {
      throw new Error(`${l.key}: unknown structure '${l.structure}'`);
    }
    if (!VEHICLE_TYPES.includes(l.vehicleType)) {
      throw new Error(`${l.key}: unknown vehicleType '${l.vehicleType}'`);
    }
    if (!HEX.test(l.color)) throw new Error(`${l.key}: color must be #RRGGBB`);
    if (typeof l.preRevenue !== "boolean") {
      throw new Error(`${l.key}: preRevenue must be a boolean`);
    }
    if (l.preRevenue && l.gtfsRouteId !== null) {
      // A line with a live GTFS route id would be simulated — trains running
      // on track that does not exist yet.
      throw new Error(`${l.key}: a preRevenue line must have gtfsRouteId: null`);
    }
    for (const field of ["excludeGtfsStopIds", "allowLargeSnapStopIds", "snapWarnExemptStopIds"]) {
      const v = l[field];
      if (v === undefined) continue;
      if (!Array.isArray(v) || !v.every((id) => typeof id === "string" && id.length > 0)) {
        throw new Error(`${l.key}: ${field} must be an array of non-empty strings`);
      }
    }
    // Exactly one OSM discovery mode: a pinned relationId (with an optional
    // `match` only meaningful if relationId is null, for bootstrapping), or
    // wayNamePattern (fetchBranchFromWayName, for a line with no route
    // relation at all). An entry with neither silently falls into
    // discoverRelationId and crashes on `line.osm.match.test(...)` with no
    // match regex — catch it here instead.
    const hasRelation = l.osm?.relationId != null;
    const hasWayPattern = typeof l.osm?.wayNamePattern === "string" && l.osm.wayNamePattern.length > 0;
    const hasMatch = l.osm?.match instanceof RegExp;
    if (hasRelation && hasWayPattern) {
      throw new Error(`${l.key}: osm.relationId and osm.wayNamePattern are mutually exclusive`);
    }
    if (!hasRelation && !hasWayPattern && !hasMatch) {
      throw new Error(
        `${l.key}: osm must set relationId, wayNamePattern, or match (for relation discovery)`,
      );
    }
    if (hasWayPattern && /["\\]/.test(l.osm.wayNamePattern)) {
      // Interpolated raw into an Overpass regex-in-quotes filter
      // (`["name"~"${pattern}"]`) — an unescaped quote or backslash would
      // break the query string rather than fail with a clear error.
      throw new Error(`${l.key}: osm.wayNamePattern must not contain '"' or '\\'`);
    }
  }

  for (const o of INTERCHANGE_OVERRIDES) {
    for (const side of ["a", "b"]) {
      if (!keys.has(o[`${side}Line`])) {
        throw new Error(`interchange override names unknown line '${o[`${side}Line`]}'`);
      }
    }
  }
}
