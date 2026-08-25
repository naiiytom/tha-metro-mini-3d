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

/** Mirrors NoseProfile in src/types/index.ts. */
export const NOSE_PROFILES = ["raked", "blunt", "rounded"];
/** Mirrors RoofKit in src/types/index.ts. */
export const ROOF_KITS = ["pantograph", "none"];

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
    // Siemens EMU-A1/A2, CNR Changchun and Inspiro sets — 4-car, third rail
    // (so no pantograph). Dimensions are map-legibility-tuned, not spec-sheet.
    rollingStock: {
      cars: 4,
      carLengthM: 15.8,
      gapM: 0.6,
      widthM: 3.2,
      heightM: 3.8,
      rideHeightM: 0.4,
      cabLengthM: 3.2,
      nose: "raked",
      roof: "none",
      shell: "#E8EBEE",
      glazing: { zM: 2.45, heightM: 1.05, tint: "#2B3138" },
      bands: [
        { zM: 1.6, heightM: 0.5, tint: "route" },
        { zM: 0.35, heightM: 0.35, tint: "#6E757C" },
      ],
    },
    // Mo Chit (N8) is NOT a member of relation 444651 — verified 2026-08-04
    // and again during MVP 6 Task 13 — so a plain re-fetch can never bring it
    // back on its own. It IS a real, properly tagged OSM node: 5388599065
    // (railway=station, public_transport=station, ref=N8, name:en=Mo Chit,
    // operator BTSC, wikidata=Q873641) at 13.8025991, 100.5537913, confirmed
    // live 2026-08-22 — tags and coordinates match exactly. History: the
    // original hand patch (ef339e9) cited untagged node 270666807, ~270 m
    // from the position it was used to justify; `b4c1cb9` replaced it with
    // this node, improving the snap from 187.4 m to 2.2 m; a later full
    // re-fetch (333b799) silently dropped the station entirely (the hand
    // patch mechanism didn't survive being re-derived from network.json's own
    // regeneration path) — the regression this entry now fixes for good, via
    // the same extraStationNodeIds mechanism built for the Suvarnabhumi APM.
    // Measured snap against the committed track: 2.18 m.
    osm: { relationId: 444651, match: /sukhumvit/i, extraStationNodeIds: [{ id: "5388599065" }] },
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
    // Siemens EMU-A1/A2, CNR Changchun and Inspiro sets — 4-car, third rail
    // (so no pantograph). Dimensions are map-legibility-tuned, not spec-sheet.
    rollingStock: {
      cars: 4,
      carLengthM: 15.8,
      gapM: 0.6,
      widthM: 3.2,
      heightM: 3.8,
      rideHeightM: 0.4,
      cabLengthM: 3.2,
      nose: "raked",
      roof: "none",
      shell: "#E8EBEE",
      glazing: { zM: 2.45, heightM: 1.05, tint: "#2B3138" },
      bands: [
        { zM: 1.6, heightM: 0.5, tint: "route" },
        { zM: 0.35, heightM: 0.35, tint: "#6E757C" },
      ],
    },
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
    // J-TREC 3-car sets, third rail. Silver shell like the MRT Blue stock.
    rollingStock: {
      cars: 3,
      carLengthM: 16.6,
      gapM: 0.6,
      widthM: 3.2,
      heightM: 3.8,
      rideHeightM: 0.4,
      cabLengthM: 3.2,
      nose: "raked",
      roof: "none",
      shell: "#D7DBDF",
      glazing: { zM: 2.45, heightM: 1.05, tint: "#2B3138" },
      bands: [
        { zM: 1.6, heightM: 0.5, tint: "route" },
        { zM: 0.35, heightM: 0.35, tint: "#6E757C" },
      ],
    },
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
    // Siemens Desiro (City Line) 3-car sets. 25 kV AC overhead — one of only
    // three lines on this network that actually carries a pantograph.
    rollingStock: {
      cars: 3,
      carLengthM: 19.2,
      gapM: 0.8,
      widthM: 3.1,
      heightM: 4.0,
      rideHeightM: 0.5,
      cabLengthM: 3.6,
      nose: "raked",
      roof: "pantograph",
      shell: "#D7DBDF",
      glazing: { zM: 2.6, heightM: 1.1, tint: "#2B3138" },
      bands: [
        { zM: 1.7, heightM: 0.5, tint: "route" },
        { zM: 0.35, heightM: 0.35, tint: "#6E757C" },
      ],
    },
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
    // Alstom Innovia Monorail 300, 4-car, straddling the beam — no
    // pantograph and no underframe skirt. These wear a WIDE colour wrap
    // rather than a pinstripe, which is what makes them read as monorails.
    rollingStock: {
      cars: 4,
      carLengthM: 11.8,
      gapM: 0.5,
      widthM: 3.0,
      heightM: 3.6,
      rideHeightM: 0.2,
      cabLengthM: 2.6,
      nose: "blunt",
      roof: "none",
      shell: "#E8EBEE",
      glazing: { zM: 2.35, heightM: 1.0, tint: "#2B3138" },
      bands: [{ zM: 1.0, heightM: 1.6, tint: "route" }],
    },
    // ---- ESTIMATED RUN TIMES, NOT PUBLISHED DATA -------------------------
    // The Namtang feed gives this route ZERO seconds of transit on every
    // leg: `14630 arr 00:00:00 / dep 00:01:00`, `16936 arr 00:01:00 / dep
    // 00:02:00` — the whole inter-station minute parked in the dwell column,
    // so a train dwells and teleports instead of moving. All 66 of the
    // route's legs are like this, and unlike MRT Blue (whose degenerate
    // patterns can be repaired from its own healthy ones) NONE of Pink's 31
    // stop pairs has a real time anywhere in the feed.
    //
    // Yellow is the basis because it is the same Alstom straddle-beam
    // monorail on comparable elevated alignment with similar station
    // spacing, and its own rows are clean. Only the POINTER lives here — the
    // speed and dwell are derived from Yellow's real feed rows at preprocess
    // time (rust-engine/preprocessor/src/runtimes.rs), so no invented number
    // is stored anywhere. Disclosed to the user via ESTIMATED_RUN_TIMES_NOTE.
    estimatedRunTimes: { basisLine: "yellow" },
    osm: { relationId: 16740886, match: /pink/i },
    // The Namtang feed bundles the Muang Thong Thani spur's 4 shuttle trip
    // patterns (stop_ids 16936 "Impact Muang Thong Thani" / 16937 "Lake
    // Muang Thong Thani") into this SAME route_id alongside the 30-station
    // main line — discovered when the preprocessor's snap check hard-failed
    // (those 2 stops are ~1.2 km off the main-line-only track fetched above).
    //
    // Until issue #15 this entry carried `excludeGtfsStopIds: ["16936",
    // "16937"]`, which DROPPED those 4 trips entirely — real revenue service
    // (since 2025-06-17) missing from the map, which is exactly what the
    // issue reported. The spur is now its own registry line (`pink-spur`,
    // below) and claims those trips via `claimGtfsStopIds`, so this entry is
    // simply the route's DEFAULT claimant: it takes every 2436 trip the spur
    // does not. The exclude list is gone deliberately — keeping both would be
    // two sources of truth for the same split, free to drift apart.
    //
    // This entry stays the default claimant (no claimGtfsStopIds of its own):
    // adding a trunk claim set would mean enumerating 30 stations to say
    // "everything else".
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
    // Alstom Innovia Monorail 300, 4-car, straddling the beam — no
    // pantograph and no underframe skirt. These wear a WIDE colour wrap
    // rather than a pinstripe, which is what makes them read as monorails.
    rollingStock: {
      cars: 4,
      carLengthM: 11.8,
      gapM: 0.5,
      widthM: 3.0,
      heightM: 3.6,
      rideHeightM: 0.2,
      cabLengthM: 2.6,
      nose: "blunt",
      roof: "none",
      shell: "#E8EBEE",
      glazing: { zM: 2.35, heightM: 1.0, tint: "#2B3138" },
      bands: [{ zM: 1.0, heightM: 1.6, tint: "route" }],
    },
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
    // Bombardier Innovia APM 300, 2-car. The one line whose identity is in
    // the shell rather than the band — a PALE champagne, not the saturated
    // gold a photo suggests: the saturated value drops the skirt below the
    // WCAG floor and leaves the route band nothing to contrast against.
    // No skirt (people mover, no deep underframe).
    rollingStock: {
      cars: 2,
      carLengthM: 12.6,
      gapM: 0.5,
      widthM: 2.8,
      heightM: 3.4,
      rideHeightM: 0.2,
      cabLengthM: 2.4,
      nose: "rounded",
      roof: "none",
      shell: "#D9C273",
      glazing: { zM: 2.2, heightM: 0.95, tint: "#2B3138" },
      bands: [{ zM: 1.35, heightM: 0.45, tint: "route" }],
    },
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
    // Hitachi AT100 commuter EMUs, 4-car, 25 kV AC overhead. The longest
    // cars on the network.
    rollingStock: {
      cars: 4,
      carLengthM: 20,
      gapM: 0.8,
      widthM: 3.1,
      heightM: 4.0,
      rideHeightM: 0.5,
      cabLengthM: 3.6,
      nose: "raked",
      roof: "pantograph",
      shell: "#E8EBEE",
      glazing: { zM: 2.6, heightM: 1.1, tint: "#2B3138" },
      bands: [
        { zM: 1.7, heightM: 0.5, tint: "route" },
        { zM: 0.35, heightM: 0.35, tint: "#6E757C" },
      ],
    },
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
    // Hitachi AT100 commuter EMUs, 4-car, 25 kV AC overhead. The longest
    // cars on the network.
    rollingStock: {
      cars: 4,
      carLengthM: 20,
      gapM: 0.8,
      widthM: 3.1,
      heightM: 4.0,
      rideHeightM: 0.5,
      cabLengthM: 3.6,
      nose: "raked",
      roof: "pantograph",
      shell: "#E8EBEE",
      glazing: { zM: 2.6, heightM: 1.1, tint: "#2B3138" },
      bands: [
        { zM: 1.7, heightM: 0.5, tint: "route" },
        { zM: 0.35, heightM: 0.35, tint: "#6E757C" },
      ],
    },
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
    // Siemens Modular Metro 3-car sets, third rail. Silver shell, same family as MRT Purple.
    rollingStock: {
      cars: 3,
      carLengthM: 16.6,
      gapM: 0.6,
      widthM: 3.2,
      heightM: 3.8,
      rideHeightM: 0.4,
      cabLengthM: 3.2,
      nose: "raked",
      roof: "none",
      shell: "#D7DBDF",
      glazing: { zM: 2.45, heightM: 1.05, tint: "#2B3138" },
      bands: [
        { zM: 1.6, heightM: 0.5, tint: "route" },
        { zM: 0.35, heightM: 0.35, tint: "#6E757C" },
      ],
    },
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
    // give a genuine underground/elevated mix. Measured 2026-08-04 for the
    // COMBINED line (both sections concatenated via fetchBranchFromWayNames,
    // see the osm comment below): 275 track points, 192 underground / 83
    // elevated, ~35.3 km total (western sub-fetch 105 pts / 13.5 km +
    // eastern sub-fetch 171 pts / 21.8 km, minus the 1 shared junction
    // point at Thailand Cultural Centre — 105 + 171 - 1 = 275, confirming a
    // clean single splice with neither a duplicate nor a gap).
    structure: "underground",
    vehicleType: "heavy",
    // Pre-revenue: Eastern Section projected late 2027, Western ~2030 (SRS §2
    // caveat block, re-verified 2026-07-31). No trains until a published
    // schedule exists for either section.
    gtfsRouteId: null,
    preRevenue: true,
    // No route relation exists for this line anywhere in OSM, for either
    // section (checked operational, route=construction, and proposed:route —
    // all empty, verified 2026-08-04). What DOES exist: two disjoint sets of
    // real railway=construction ways, one per section, that physically meet
    // at Thailand Cultural Centre but were never mapped as one relation:
    // 16 ways named exactly "รถไฟฟ้ามหานคร สายสีส้ม" (Eastern Section,
    // deliberately excluding the separately-named "...ตะวันตก" (West) ways)
    // and 3 ways named "รถไฟฟ้าสายสีส้มตะวันตก ช่วงศูนย์วัฒนธรรมฯ-บางขุนนนท์"
    // (Western Section, Thailand Cultural Centre <-> Bang Khun Non).
    // wayNamePatterns (western pattern FIRST — its last point is the shared
    // junction that the eastern pattern's ways start from) fetches both via
    // fetchBranchFromWayNames, which concatenates them at that junction; see
    // that function's own doc comment for the mechanism and
    // fetchBranchFromWayName's for why stations are intentionally empty.
    // 0 stations placed: the only construction-stage station node found in
    // either section's own bounding box (Democracy Monument, western half)
    // has ref "PP22" (Purple Line's prefix, not Orange's "OR") and its own
    // fixme tag reads "update to subway stopping location when opened" —
    // OSM's own contributors flag the position as provisional, so per the
    // Mo Chit precedent (CLAUDE.md) it is not placed.
    osm: {
      relationId: null,
      wayNamePatterns: [
        "รถไฟฟ้าสายสีส้มตะวันตก ช่วงศูนย์วัฒนธรรมฯ-บางขุนนนท์",
        "^รถไฟฟ้ามหานคร สายสีส้ม$",
      ],
    },
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
  {
    // Issue #15: the Muang Thong Thani spur, branded "IMPACT Link" — in full
    // revenue service since 2025-06-17, but absent from the map until now
    // because the `pink` entry above dropped its trips (see the long comment
    // there). Appended, never inserted: the registry-index invariant means
    // LINES order == network.json order == cache route order == vehicle-buffer
    // route_idx, so reordering would invalidate every committed .tmb.
    //
    // WHY A SECOND LINE RATHER THAN A SECOND BRANCH OF `pink` — the obvious
    // question, since the two share operator, livery, route id, structure and
    // vehicle type. A branch is not representable: `RouteDoc` carries exactly
    // ONE `track_xyz`/`track_arc_m` per route, stations are sorted by a single
    // scalar arc and asserted strictly increasing, and the spur leaves the
    // trunk at Muang Thong Thani — stop 10 of 30, MID-LINE, not a terminus.
    // Splicing a mid-line branch into one polyline forces it to double back
    // through the trunk, which is the Tha Phra arc-ambiguity failure MVP 6
    // documented, except structurally guaranteed instead of incidental.
    // (`fetchBranchFromWayNames`, used for Orange East+West, joins two parts
    // END TO END into a single traverse — a linear join, not a branch.)
    // Supporting real branches would mean making a route a graph of polylines
    // with per-branch arc spaces: a cache-format change, plus the engine's
    // interpolation, the per-pattern arc resolver and VehicleManager. The
    // two-entry split is the intended permanent shape for branch lines here;
    // the next branch (e.g. a future Blue or Purple spur) should follow it.
    key: "pink-spur",
    name: "MRT Pink Line (IMPACT Link)",
    nameTh: "สายสีชมพู (ส่วนต่อขยายเมืองทองธานี)",
    // Deliberately the trunk's livery, not OSM's #C4007B: this is the same
    // Pink Line to a rider, and the two are told apart by name in the
    // selector rather than by an invented second shade.
    color: "#CD4692",
    structure: "elevated",
    vehicleType: "monorail",
    // Shared with `pink` — legal only because the two are separated per-trip
    // by claimGtfsStopIds below (see assertRegistryValid's shared-route_id
    // contract and Rust's TripRouter for the full rule).
    gtfsRouteId: "2436",
    // The spur's own two stations. Verified against the feed (2026-08-09):
    // route 2436 has exactly 6 trips, and the 4 serving these stops are the
    // spur's — patterns 14630 -> 16936 -> 16937 and the exact reverse, one
    // minute between stops, frequency-based, on services 1 and 2.
    //
    // 14630 (Muang Thong Thani) is deliberately NOT claimed: it is the
    // junction, served by BOTH the trunk and the spur. Claiming it would pull
    // every trunk trip onto the spur. Claim sets identify a branch by the
    // stops only that branch reaches.
    claimGtfsStopIds: ["16936", "16937"],
    preRevenue: false,
    // Alstom Innovia Monorail 300, 4-car, straddling the beam — no
    // pantograph and no underframe skirt. These wear a WIDE colour wrap
    // rather than a pinstripe, which is what makes them read as monorails.
    rollingStock: {
      cars: 4,
      carLengthM: 11.8,
      gapM: 0.5,
      widthM: 3.0,
      heightM: 3.6,
      rideHeightM: 0.2,
      cabLengthM: 2.6,
      nose: "blunt",
      roof: "none",
      shell: "#E8EBEE",
      glazing: { zM: 2.35, heightM: 1.0, tint: "#2B3138" },
      bands: [{ zM: 1.0, heightM: 1.6, tint: "route" }],
    },
    // Inherits the trunk's defect: the spur's 4 trips carry the same
    // zero-transit rows, and its own 2 stop pairs appear nowhere healthy.
    // Same basis and same disclosure as `pink` above.
    estimatedRunTimes: { basisLine: "yellow" },
    // A clean PTv2 relation, unlike the Orange/Purple-Phase-2 construction
    // ways: route=monorail, ref="IMPACT Link", 3 way members and 3 stop node
    // members (verified 2026-08-09), ~2.67 km. The reverse-direction twin is
    // 19150155; either direction's track is equivalent for our purposes, same
    // convention as every other relation-pinned line here.
    osm: { relationId: 19149752 },
  },
  {
    // Roadmap item 3.1. The airport people mover between the Main Terminal
    // and Midfield Satellite Concourse 1 (SAT-1) — free, operated by AOT,
    // in service since SAT-1 opened 2023-09-28, running 24 hours.
    key: "apm",
    name: "Suvarnabhumi APM",
    nameTh: "รถไฟฟ้าขนส่งผู้โดยสารอัตโนมัติ ท่าอากาศยานสุวรรณภูมิ",
    // No official livery colour to source; a neutral airport grey, chosen not
    // to collide with any operator's real line colour.
    color: "#6D7B8D",
    // Both OSM ways carry layer=-1, so structureOfWay() classifies every
    // point underground on its own — this fallback is never actually reached.
    structure: "underground",
    vehicleType: "apm",
    // NOT in the Namtang feed. Verified 2026-08-09 by scanning all 2,077
    // routes: the only Suvarnabhumi entries are buses and ferries. So there
    // is no gtfsRouteId to give it, and its schedule is synthesized below.
    gtfsRouteId: null,
    // Operational, not under construction — it must NOT get the dashed,
    // desaturated pre-revenue treatment that Orange/Purple Phase 2 use.
    preRevenue: false,
    // Siemens Airval, 2-car. The shortest consist on the network.
    rollingStock: {
      cars: 2,
      carLengthM: 12.6,
      gapM: 0.5,
      widthM: 2.8,
      heightM: 3.4,
      rideHeightM: 0.2,
      cabLengthM: 2.4,
      nose: "rounded",
      roof: "none",
      shell: "#E8EBEE",
      glazing: { zM: 2.2, heightM: 0.95, tint: "#2B3138" },
      bands: [{ zM: 1.35, heightM: 0.45, tint: "route" }],
    },
    // ---- ESTIMATED TIMETABLE, NOT PUBLISHED DATA -------------------------
    // AOT publishes no timetable for the APM — only "runs continuously".
    // These figures describe the observed service pattern (a ~1 km run at a
    // few minutes' headway, around the clock); they are NOT sourced from an
    // operator feed like every other line here. The app surfaces this to the
    // user via the `syntheticSchedule` flag (see LineSelector/StationBoard)
    // rather than presenting invented times as if they were real.
    syntheticSchedule: {
      headwaySec: 180,
      runtimeSec: 120,
      dwellSec: 40,
      startSec: 0,
      endSec: 86400,
    },
    // relation 19955655 is tagged route=light_rail but has ZERO node members
    // (verified 2026-08-09), so the usual member-derived station path finds
    // nothing. Both stations do exist as real, tagged railway=station nodes,
    // named here explicitly. Positions still come from OSM, never from here.
    osm: {
      relationId: 19955655,
      extraStationNodeIds: [
        // OSM node has name:th ("อาคารผู้โดยสารหลัก") but no name:en.
        { id: "13373875189", nameEn: "Suvarnabhumi Main Terminal" },
        // Already carries name:en="Midfield Satellite Concourse 1".
        { id: "13373875190" },
      ],
    },
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
  // Airport Rail Link <-> Suvarnabhumi APM, Suvarnabhumi. Measured 332 m
  // between the two stations' committed positions (ARL A1 at
  // 100.7513395/13.6942971, APM Main Terminal at 100.7504793/13.6914254) —
  // the same class of near-miss as the Silom<->Blue (319.3 m) and
  // ARL<->Blue (304.8 m) entries above, just outside the 300 m auto-link
  // radius. Without it the APM is a disconnected component of the routing
  // graph and route search reports "no route" for both of its stations.
  //
  // The b-side id is an OSM NODE id, not a GTFS stop id: the APM is absent
  // from the Namtang feed entirely (gtfsRouteId: null), so the preprocessor
  // stamps each of its registry stations' own `id` as its gtfs_stop_id. That
  // asymmetry is real, not a typo.
  { aLine: "arl", aStop: "326", bLine: "apm", bStop: "13373875189" },
  // BTS Sukhumvit <-> MRT Blue, Ha Yaek Lat Phrao / Phahon Yothin. Connected
  // via an elevated skywalk. Measured 364.8 m between snapped track positions.
  { aLine: "sukhumvit", aStop: "13612", bLine: "blue", bStop: "339" },
  // Airport Rail Link <-> MRT Yellow, Hua Mak. Connected via an elevated
  // skywalk across Srinakarin Rd. Measured 497.8 m between snapped positions.
  { aLine: "arl", aStop: "325", bLine: "yellow", bStop: "14128" },
  // SRT Dark Red <-> MRT Blue, Krung Thep Aphiwat / Bang Sue. Connected via
  // an underground walkway concourse. Measured 305.1 m between snapped positions.
  { aLine: "red-dark", aStop: "13846", bLine: "blue", bStop: "334" },
  // SRT Light Red <-> MRT Blue, Krung Thep Aphiwat / Bang Sue. Connected via
  // an underground walkway concourse. Measured 344.9 m between snapped positions.
  { aLine: "red-light", aStop: "13846", bLine: "blue", bStop: "334" },
];

/**
 * The order `tools/fetch-network.mjs` writes a line's NON-GEOMETRY fields in,
 * before spreading that line's fetched geometry keys on the end.
 *
 * Exported so the one real writer and every hand patch agree on it. A patch
 * script that appends its new field instead of slotting it in here produces a
 * committed file a real `data:fetch` would re-serialize in a different order —
 * so the whole file diffs, and the "diff line by line to tell my change apart
 * from upstream OSM vertex drift" practice this repo depends on stops working.
 * That is exactly what happened to `estimatedRunTimes` and `rollingStock`,
 * found in code review 2026-08-23.
 *
 * `fetch-network.mjs` asserts its own object literal against this list, and
 * `lines.config.test.mjs` pins the committed `network.json` against it, so
 * drift on either side is a failure rather than a silent whole-file diff.
 */
export const NETWORK_LINE_FIELD_ORDER = [
  "key",
  "name",
  "nameTh",
  "color",
  "structure",
  "vehicleType",
  "gtfsRouteId",
  "preRevenue",
  "excludeGtfsStopIds",
  "claimGtfsStopIds",
  "syntheticSchedule",
  "estimatedRunTimes",
  "rollingStock",
  "allowLargeSnapStopIds",
  "snapWarnExemptStopIds",
];

/**
 * Reorder one `network.json` line object into `NETWORK_LINE_FIELD_ORDER`,
 * keeping any remaining (geometry) keys in their existing relative order —
 * `fetch-network.mjs` spreads those last, so their own order is whatever the
 * fetch produced and must not be disturbed.
 */
export function orderLineFields(line) {
  const out = {};
  for (const key of NETWORK_LINE_FIELD_ORDER) {
    if (key in line) out[key] = line[key];
  }
  for (const key of Object.keys(line)) {
    if (!(key in out)) out[key] = line[key];
  }
  return out;
}

/**
 * Throws if a line object's non-geometry keys are not exactly
 * `NETWORK_LINE_FIELD_ORDER`, in order, as its leading keys.
 */
export function assertLineFieldOrder(line, where) {
  const actual = Object.keys(line).slice(0, NETWORK_LINE_FIELD_ORDER.length);
  const expected = NETWORK_LINE_FIELD_ORDER;
  for (let i = 0; i < expected.length; i++) {
    if (actual[i] !== expected[i]) {
      throw new Error(
        `${where}: line field ${i} is '${actual[i]}', expected '${expected[i]}' ` +
          `— NETWORK_LINE_FIELD_ORDER and the writer have drifted apart`,
      );
    }
  }
}

const HEX = /^#[0-9a-fA-F]{6}$/;

/** Throws on any registry mistake that would corrupt the index invariant. */
export function assertRegistryValid(lines = LINES) {
  const keys = new Set();
  // route_id -> the entries claiming it. Two lines MAY share one id now (the
  // Pink trunk and its IMPACT Link spur both sit on "2436" in the Namtang
  // feed), but only when `claimGtfsStopIds` says which trips each one takes.
  // Validated as a group after the per-line loop — mirrors the Rust
  // `TripRouter::build` contract, which re-checks it because the preprocessor
  // runs against a committed network.json without this validator.
  const byRouteId = new Map();
  for (const l of lines) {
    if (keys.has(l.key)) throw new Error(`duplicate line key '${l.key}'`);
    keys.add(l.key);
    if (l.gtfsRouteId !== null) {
      if (!byRouteId.has(l.gtfsRouteId)) byRouteId.set(l.gtfsRouteId, []);
      byRouteId.get(l.gtfsRouteId).push(l);
    }
    if (l.claimGtfsStopIds !== undefined) {
      if (
        !Array.isArray(l.claimGtfsStopIds) ||
        l.claimGtfsStopIds.length === 0 ||
        !l.claimGtfsStopIds.every((id) => typeof id === "string" && id.length > 0)
      ) {
        throw new Error(`${l.key}: claimGtfsStopIds must be a non-empty array of non-empty strings`);
      }
      if (l.gtfsRouteId === null) {
        throw new Error(`${l.key}: claimGtfsStopIds needs a gtfsRouteId to claim trips from`);
      }
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
    if (l.syntheticSchedule !== undefined) {
      const s = l.syntheticSchedule;
      if (l.gtfsRouteId !== null) {
        // Two schedule sources for one line: the GTFS trips and the
        // synthesized ones would both generate runs on the same track.
        throw new Error(`${l.key}: syntheticSchedule requires gtfsRouteId: null`);
      }
      if (l.preRevenue) {
        // A synthetic schedule means "running, just unpublished". Nothing
        // should be simulated on track that does not carry passengers yet.
        throw new Error(`${l.key}: a preRevenue line must not have a syntheticSchedule`);
      }
      for (const f of ["headwaySec", "runtimeSec", "dwellSec", "startSec", "endSec"]) {
        if (!Number.isInteger(s[f]) || s[f] < 0) {
          throw new Error(`${l.key}: syntheticSchedule.${f} must be a non-negative integer`);
        }
      }
      if (s.headwaySec <= 0) throw new Error(`${l.key}: syntheticSchedule.headwaySec must be > 0`);
      if (s.runtimeSec <= 0) throw new Error(`${l.key}: syntheticSchedule.runtimeSec must be > 0`);
      if (s.endSec <= s.startSec) {
        throw new Error(`${l.key}: syntheticSchedule.endSec must be after startSec`);
      }
    }
    if (l.estimatedRunTimes !== undefined && l.estimatedRunTimes !== null) {
      const e = l.estimatedRunTimes;
      if (typeof e.basisLine !== "string" || e.basisLine.length === 0) {
        throw new Error(`${l.key}: estimatedRunTimes.basisLine must be a non-empty string`);
      }
      if (l.gtfsRouteId === null) {
        throw new Error(
          `${l.key}: estimatedRunTimes only means something for a GTFS line — a line with ` +
            `no gtfsRouteId has no feed rows to repair`,
        );
      }
      if (e.basisLine === l.key) {
        throw new Error(`${l.key}: estimatedRunTimes.basisLine points at itself`);
      }
      const basis = lines.find((b) => b.key === e.basisLine);
      if (!basis) {
        throw new Error(
          `${l.key}: estimatedRunTimes.basisLine '${e.basisLine}' is not a registry line`,
        );
      }
      if (basis.gtfsRouteId === null) {
        throw new Error(
          `${l.key}: estimatedRunTimes basis '${e.basisLine}' must have a gtfsRouteId — ` +
            `its own real feed times are what the calibration is derived from`,
        );
      }
      if (basis.estimatedRunTimes) {
        throw new Error(
          `${l.key}: estimatedRunTimes basis '${e.basisLine}' cannot itself have ` +
            `estimatedRunTimes — calibrating an estimate from an estimate compounds it`,
        );
      }
    }
    if (l.rollingStock !== undefined && l.rollingStock !== null) {
      const s = l.rollingStock;
      if (l.preRevenue) {
        // A pre-revenue line renders track and no trains, so a stock
        // declaration on one is dead data that nothing will ever build.
        throw new Error(`${l.key}: a preRevenue line must not declare rollingStock`);
      }
      if (!Number.isInteger(s.cars) || s.cars < 1) {
        throw new Error(`${l.key}: rollingStock.cars must be a positive integer`);
      }
      for (const f of ["carLengthM", "gapM", "widthM", "heightM", "rideHeightM", "cabLengthM"]) {
        if (typeof s[f] !== "number" || !(s[f] >= 0)) {
          throw new Error(`${l.key}: rollingStock.${f} must be a non-negative number`);
        }
      }
      if (!(s.cabLengthM < s.carLengthM)) {
        // buildStockGeometry shortens the LEADING car by cabLengthM so the
        // consist's rendered extent stays equal to stockLengthM. A cab as long
        // as its car would collapse that body to zero or negative length.
        throw new Error(
          `${l.key}: rollingStock.cabLengthM must be shorter than carLengthM — ` +
            `the cab is the front of the leading car, not an extra car`,
        );
      }
      if (!NOSE_PROFILES.includes(s.nose)) {
        throw new Error(`${l.key}: unknown rollingStock.nose '${s.nose}'`);
      }
      if (!ROOF_KITS.includes(s.roof)) {
        throw new Error(`${l.key}: unknown rollingStock.roof '${s.roof}'`);
      }
      if (!HEX.test(s.shell)) {
        // Never "route": the shell is the large neutral area, and a shell in
        // the line's own colour leaves the identity band nothing to read against.
        throw new Error(`${l.key}: rollingStock.shell must be #RRGGBB`);
      }
      if (!Array.isArray(s.bands) || s.bands.length === 0) {
        throw new Error(`${l.key}: rollingStock.bands must be a non-empty array`);
      }
      if (s.bands[0].tint !== "route") {
        // bands[0] is the identity band by contract — buildStockGeometry
        // paints the nose with it, which is what marks direction of travel.
        throw new Error(`${l.key}: rollingStock.bands[0] must be the "route" identity band`);
      }
      for (const b of [s.glazing, ...s.bands]) {
        if (typeof b?.zM !== "number" || typeof b?.heightM !== "number" || !(b.heightM > 0)) {
          throw new Error(`${l.key}: every rollingStock band needs a numeric zM and a positive heightM`);
        }
        if (b.zM - b.heightM / 2 < 0 || b.zM + b.heightM / 2 > s.heightM) {
          throw new Error(
            `${l.key}: rollingStock band at zM ${b.zM} falls outside the car shell (0..${s.heightM})`,
          );
        }
        if (b.tint !== "route" && !HEX.test(b.tint)) {
          throw new Error(`${l.key}: rollingStock band tint must be "route" or #RRGGBB`);
        }
      }
      if (s.glbUrl !== undefined && (typeof s.glbUrl !== "string" || s.glbUrl.length === 0)) {
        throw new Error(`${l.key}: rollingStock.glbUrl must be a non-empty string when present`);
      }
    }
    if (l.osm?.extraStationNodeIds !== undefined) {
      const v = l.osm.extraStationNodeIds;
      if (!Array.isArray(v) || v.length === 0) {
        throw new Error(`${l.key}: osm.extraStationNodeIds must be a non-empty array`);
      }
      for (const n of v) {
        if (typeof n?.id !== "string" || !/^\d+$/.test(n.id)) {
          throw new Error(`${l.key}: each extraStationNodeIds entry needs a numeric string id`);
        }
        // Guard against anyone extending this into a position override — the
        // whole point is that coordinates always come from the live node.
        for (const banned of ["lat", "lon", "position"]) {
          if (banned in n) {
            throw new Error(
              `${l.key}: extraStationNodeIds entry ${n.id} must not carry '${banned}' — ` +
                `station positions always come from OSM, never from the registry`,
            );
          }
        }
      }
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
    // `match` only meaningful if relationId is null, for bootstrapping),
    // wayNamePattern (fetchBranchFromWayName, for a line with no route
    // relation at all), or wayNamePatterns (fetchBranchFromWayNames, for a
    // line stitched from multiple disconnected named-way branches — e.g.
    // MRT Orange's Eastern + Western Sections). An entry with none silently
    // falls into discoverRelationId and crashes on `line.osm.match.test(...)`
    // with no match regex — catch it here instead.
    const hasRelation = l.osm?.relationId != null;
    const hasWayPattern = typeof l.osm?.wayNamePattern === "string" && l.osm.wayNamePattern.length > 0;
    const hasWayPatterns = Array.isArray(l.osm?.wayNamePatterns);
    const hasMatch = l.osm?.match instanceof RegExp;
    if (hasRelation && hasWayPattern) {
      throw new Error(`${l.key}: osm.relationId and osm.wayNamePattern are mutually exclusive`);
    }
    if (hasRelation && hasWayPatterns) {
      throw new Error(`${l.key}: osm.relationId and osm.wayNamePatterns are mutually exclusive`);
    }
    if (hasWayPattern && hasWayPatterns) {
      throw new Error(`${l.key}: osm.wayNamePattern and osm.wayNamePatterns are mutually exclusive`);
    }
    if (!hasRelation && !hasWayPattern && !hasWayPatterns && !hasMatch) {
      throw new Error(
        `${l.key}: osm must set relationId, wayNamePattern, wayNamePatterns, or match (for relation discovery)`,
      );
    }
    if (hasWayPattern && /["\\]/.test(l.osm.wayNamePattern)) {
      // Interpolated raw into an Overpass regex-in-quotes filter
      // (`["name"~"${pattern}"]`) — an unescaped quote or backslash would
      // break the query string rather than fail with a clear error.
      throw new Error(`${l.key}: osm.wayNamePattern must not contain '"' or '\\'`);
    }
    if (hasWayPatterns) {
      if (
        l.osm.wayNamePatterns.length < 2 ||
        !l.osm.wayNamePatterns.every((p) => typeof p === "string" && p.length > 0)
      ) {
        throw new Error(
          `${l.key}: osm.wayNamePatterns must be an array of at least 2 non-empty strings`,
        );
      }
      if (l.osm.wayNamePatterns.some((p) => /["\\]/.test(p))) {
        throw new Error(`${l.key}: osm.wayNamePatterns entries must not contain '"' or '\\'`);
      }
    }
  }

  // Shared-route_id contract (see byRouteId above and Rust's TripRouter):
  // at most one default claimant per route, and no two claim sets may overlap
  // — otherwise a trip serving the shared stop has no single owner, and a
  // mis-assigned trip desyncs track, colour, station table and vehicle-buffer
  // lane 6 at once.
  for (const [routeId, claimants] of byRouteId) {
    const defaults = claimants.filter((l) => l.claimGtfsStopIds === undefined);
    if (defaults.length === 0) {
      // Every claimant declares a claim set, so any trip on this route serving
      // none of them has nowhere to go. TripRouter::build accepts this shape
      // too and only fails at resolve(), on the first unclaimed trip — which
      // means `data:fetch` succeeds and OVERWRITES network.json, and the
      // failure only surfaces at the later `data:preprocess`. Catch it here,
      // before anything is written.
      throw new Error(
        `gtfsRouteId '${routeId}': every claimant (${claimants.map((l) => l.key).join(", ")}) ` +
          `declares claimGtfsStopIds, so no line takes the route's remaining trips — ` +
          `exactly one must be the default claimant (omit claimGtfsStopIds)`,
      );
    }
    if (claimants.length === 1) continue;
    if (defaults.length > 1) {
      throw new Error(
        `duplicate gtfsRouteId '${routeId}': ${defaults.map((l) => l.key).join(", ")} all claim ` +
          `it with no claimGtfsStopIds — at most one line per route may be the default claimant`,
      );
    }
    const seenStop = new Map();
    for (const l of claimants) {
      for (const id of l.claimGtfsStopIds ?? []) {
        if (seenStop.has(id)) {
          throw new Error(
            `gtfsRouteId '${routeId}': lines '${seenStop.get(id)}' and '${l.key}' both claim stop '${id}'`,
          );
        }
        seenStop.set(id, l.key);
      }
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
