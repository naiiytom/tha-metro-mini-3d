//! GTFS + network.json -> public/data/network.tmb (contract §2).
//!
//! Route identity comes from the line registry (src/data/network.json,
//! generated from tools/lines.config.mjs): cache route order == network.json
//! line order, and a line with no `gtfsRouteId` is encoded as track geometry
//! only (`RouteDoc.simulated = false`) — rendered, never simulated.
//!
//! Usage:
//!   cargo run -p preprocessor --release -- \
//!     --gtfs <extracted-gtfs-dir> --track src/data/network.json \
//!     --out public/data/network.tmb [--report public/data/network.report.json]

mod gtfs;
mod spline;

use std::collections::{HashMap, HashSet};
use std::io::Write as _;
use std::path::{Path, PathBuf};
use std::process::ExitCode;

use serde::Deserialize;
use sim_core::calendar::expand_frequency;
use sim_core::geo::{EnuProjector, ORIGIN_LNG_LAT};
use sim_core::model::*;
use sim_core::SimWorld;

const RESAMPLE_SPACING_M: f64 = 10.0;
const MAX_SNAP_M: f64 = 150.0;
/// Stops snapping further than this are reported in network.report.json's
/// `snap_warnings` and must be individually disclosed in the registry.
///
/// MAX_SNAP_M (150 m) catches catastrophically wrong geometry. This lower
/// band catches the quiet case: five real stops sit between 40 m and 110 m,
/// so before this a NEW bad snap could land at 140 m and pass in silence.
/// Disclosure is per stop, so a genuinely-explained outlier stays explained
/// and an unexplained new one fails.
const SNAP_WARN_M: f64 = 50.0;

#[derive(Debug)]
enum SnapVerdict {
    Ok,
    /// Over SNAP_WARN_M, and named in the registry — reported, not fatal.
    Disclosed { snap_m: f64 },
    /// Over SNAP_WARN_M with no disclosure — fatal.
    Undisclosed { snap_m: f64 },
}

/// Classify one stop's snap distance against the warning band.
///
/// `allow_large` (the pre-existing MAX_SNAP_M exemption list) also satisfies
/// this band: a stop already disclosed as a known 554 m outlier should not
/// need a second, redundant entry in a second list.
fn classify_snap(
    _line_key: &str,
    stop_id: &str,
    snap_m: f64,
    warn_exempt: &[String],
    allow_large: &[String],
) -> SnapVerdict {
    if snap_m <= SNAP_WARN_M {
        return SnapVerdict::Ok;
    }
    let disclosed = warn_exempt.iter().any(|s| s == stop_id)
        || allow_large.iter().any(|s| s == stop_id);
    if disclosed {
        SnapVerdict::Disclosed { snap_m }
    } else {
        SnapVerdict::Undisclosed { snap_m }
    }
}

/// Even a disclosed `allow_large_snap_stop_ids` exception has a ceiling —
/// it's meant for known, verified cases like the Pink terminus/interchange
/// coordinate quirk (555 m), not an unbounded escape hatch. A future
/// exception past this is almost certainly a real mistake, not a known one.
const ALLOW_LARGE_SNAP_CEILING_M: f64 = 1_000.0;
/// Maximum |altitude change| per meter of horizontal travel between two
/// consecutive track vertices. Mirrors MAX_TRACK_GRADIENT in
/// tools/trackProfile.mjs (0.04 — the standard heavy-rail ruling gradient).
///
/// tools/trackProfile.mjs's limitTrackGradient ESTABLISHES this invariant in
/// the pipeline; this gate ASSERTS it still holds in whatever network.json
/// actually reached the preprocessor. Without it, a hand-edited network.json,
/// a fetch that skipped the limiter, or a future pipeline regression
/// reintroduces the 108% portal wall a user reported in MVP 6 and nothing
/// fails until somebody looks at a screenshot.
const MAX_TRACK_GRADIENT: f64 = 0.04;
/// f64 slack only. limitTrackGradient converges to exactly 4.00% on the
/// current network (blue idx 347), so this must stay tight enough that a
/// real regression cannot hide inside it.
const GRADIENT_EPSILON: f64 = 1e-4;
/// Below this horizontal separation two vertices are treated as coincident:
/// dividing by their distance would report a meaningless (or infinite)
/// gradient. A coincident PAIR is still rejected if its altitudes differ by
/// more than this, which is the genuinely broken case (a vertical wall).
const COINCIDENT_POINT_M: f64 = 0.5;

/// Weekday/weekend sample dates for the peak-concurrent scan, inside the
/// Namtang feed's 20260101-20261231 validity window (contract §0). Ordinary
/// (non-holiday) dates already exercised by the sim-core test fixtures.
const PEAK_SAMPLE_WEEKDAY: u32 = 20_260_722; // Wednesday
const PEAK_SAMPLE_WEEKEND: u32 = 20_260_725; // Saturday

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TrackFile {
    lines: Vec<LineGeometry>,
    /// Walkways the 300 m radius cannot reach, qualified by line key so a
    /// stop id reused across unrelated routes (the Namtang feed does this)
    /// can't silently widen a two-station override into extra links.
    #[serde(default)]
    interchange_overrides: Vec<InterchangeOverride>,
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct InterchangeOverride {
    pub a_line: String,
    pub a_stop: String,
    pub b_line: String,
    pub b_stop: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LineGeometry {
    key: String,
    /// Fallback display name for a track-only line (no `gtfs_route_id`).
    name: String,
    color: String,
    /// None = track geometry only; rendered, never simulated.
    gtfs_route_id: Option<String>,
    track: Vec<TrackVertex>,
    stations: Vec<NetworkStation>,
    /// GTFS stop_ids to drop from this line's simulation entirely (and any
    /// trip that serves one, taking its whole pattern with it) — for a stop
    /// on a real physical branch this line's `track` polyline does not cover.
    /// Needed for MRT Pink (route_id 2436): the Namtang feed bundles the
    /// Muang Thong Thani spur's 4 shuttle trip patterns into the *same*
    /// route_id as the 30-station main line, so without this the spur's two
    /// stations (gtfs_stop_id 16936/16937) fail the snap check — they sit
    /// ~1.2 km off the main-line-only track this registry entry fetches
    /// (see tools/lines.config.mjs; spur geometry is out of scope for now).
    #[serde(default)]
    exclude_gtfs_stop_ids: Vec<String>,
    /// GTFS stop_ids exempt from the MAX_SNAP_M hard-fail — for a stop whose
    /// GTFS lat/lng is verified to be a *different, real* nearby station,
    /// not bad geometry. Needed for MRT Pink stop 359 "Nonthaburi Civic
    /// Center": the Namtang feed's coordinate for this stop is 8 m from
    /// OSM's MRT Purple node (ref PP11) — the interchange's Purple-side
    /// platform — while the real Pink-side platform (OSM ref PK01, which
    /// this line's fetched track correctly ends 2.7 m from) is 555 m away.
    /// Two distinct physical stations sharing a name/GTFS stop_id, not a
    /// stitching bug (verified directly against OSM node tags, see
    /// tools/lines.config.mjs). Still snapped and simulated, just without
    /// the usual proximity guarantee — logged as a warning, not an error.
    #[serde(default)]
    allow_large_snap_stop_ids: Vec<String>,
    /// GTFS stop_ids disclosed as snapping between SNAP_WARN_M and
    /// MAX_SNAP_M — a real, understood geometry offset (a terminus, a
    /// convoluted underground alignment), not bad data. Every entry needs a
    /// comment in tools/lines.config.mjs saying WHY, same discipline as
    /// allow_large_snap_stop_ids.
    #[serde(default)]
    snap_warn_exempt_stop_ids: Vec<String>,
}

/// One track vertex from network.json: [lng, lat, altitude_m, structure].
/// The structure tag is a rendering concern (src/map/structure.ts); the
/// preprocessor needs only the altitude, but must tolerate the 4th element.
#[derive(Deserialize)]
struct TrackVertex(f64, f64, f64, #[serde(default)] String);

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct NetworkStation {
    id: String,
    name: String,
    name_th: String,
    #[serde(default)]
    code: String,
    position: [f64; 3],
}

/// route_id -> index into `lines`. Errors on a duplicate instead of silently
/// keeping the last one: a duplicate would stamp every trip on that route with
/// the wrong route_idx (wrong track, wrong colour, wrong station table), and
/// assertRegistryValid() only runs inside fetch-network.mjs — the preprocessor
/// consumes committed network.json and is routinely run without re-fetching.
fn build_route_idx_by_gtfs_id(
    lines: &[(String, Option<String>)],
) -> Result<HashMap<String, usize>, String> {
    let mut map = HashMap::new();
    for (i, (key, route_id)) in lines.iter().enumerate() {
        let Some(id) = route_id else { continue };
        if let Some(prev) = map.insert(id.clone(), i) {
            return Err(format!(
                "duplicate gtfsRouteId '{id}': lines[{prev}] and lines[{i}] ('{key}') both claim it"
            ));
        }
    }
    Ok(map)
}

/// `#RRGGBB` from the registry -> the u32 the cache and UI use.
fn parse_hex_color(s: &str) -> Result<u32, String> {
    let digits = s.trim_start_matches('#');
    if digits.len() != 6 {
        return Err(format!("bad colour '{s}' (want #RRGGBB, 6 hex digits)"));
    }
    u32::from_str_radix(digits, 16).map_err(|_| format!("bad colour '{s}' (want #RRGGBB)"))
}

struct Args {
    gtfs: PathBuf,
    track: PathBuf,
    out: PathBuf,
    report: Option<PathBuf>,
}

fn parse_args() -> Result<Args, String> {
    let mut gtfs = None;
    let mut track = None;
    let mut out = None;
    let mut report = None;
    let mut it = std::env::args().skip(1);
    while let Some(flag) = it.next() {
        let mut val = |name: &str| it.next().ok_or(format!("{name} needs a value"));
        match flag.as_str() {
            "--gtfs" => gtfs = Some(PathBuf::from(val("--gtfs")?)),
            "--track" => track = Some(PathBuf::from(val("--track")?)),
            "--out" => out = Some(PathBuf::from(val("--out")?)),
            "--report" => report = Some(PathBuf::from(val("--report")?)),
            other => return Err(format!("unknown flag '{other}'")),
        }
    }
    Ok(Args {
        gtfs: gtfs.ok_or("--gtfs is required")?,
        track: track.ok_or("--track is required")?,
        out: out.ok_or("--out is required")?,
        report,
    })
}

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("error: {e}");
            ExitCode::FAILURE
        }
    }
}

fn run() -> Result<(), String> {
    let args = parse_args()?;
    let gtfs_dir: &Path = &args.gtfs;

    // ---- Load inputs -------------------------------------------------------
    let track_json = std::fs::read_to_string(&args.track)
        .map_err(|e| format!("cannot read {}: {e}", args.track.display()))?;
    let track_file: TrackFile =
        serde_json::from_str(&track_json).map_err(|e| format!("bad track JSON: {e}"))?;

    let simulated_route_ids: Vec<&str> = track_file
        .lines
        .iter()
        .filter_map(|l| l.gtfs_route_id.as_deref())
        .collect();
    if simulated_route_ids.is_empty() {
        return Err("network.json has no simulated lines (every gtfsRouteId is null)".into());
    }

    let feed_version = gtfs::read_feed_version(gtfs_dir)?;
    let route_rows = gtfs::read_routes(gtfs_dir, &simulated_route_ids)?;
    for id in &simulated_route_ids {
        if !route_rows.contains_key(*id) {
            return Err(format!("route_id '{id}' not found in routes.txt"));
        }
    }
    let mut trips = gtfs::read_trips(gtfs_dir, &simulated_route_ids)?;
    if trips.is_empty() {
        return Err("no trips found for the simulated routes".into());
    }
    let trip_ids: HashSet<String> = trips.iter().map(|t| t.trip_id.clone()).collect();
    let service_ids: HashSet<String> = trips.iter().map(|t| t.service_id.clone()).collect();
    let stop_times = gtfs::read_stop_times(gtfs_dir, &trip_ids)?;
    let frequencies = gtfs::read_frequencies(gtfs_dir, &trip_ids)?;
    let calendar = gtfs::read_calendar(gtfs_dir, &service_ids)?;
    let mut calendar_dates = gtfs::read_calendar_dates(gtfs_dir, &service_ids)?;

    // Drop any trip (i.e. its whole pattern) that touches a line's
    // exclude_gtfs_stop_ids — see the field's doc comment on LineGeometry.
    // stop_times/frequencies/calendar above were loaded from the full trip
    // set and may now carry a few unused entries; harmless, since everything
    // downstream is driven by (the now-filtered) `trips`, not those maps.
    let excluded_stops_by_route: HashMap<&str, HashSet<&str>> = track_file
        .lines
        .iter()
        .filter_map(|l| {
            if l.exclude_gtfs_stop_ids.is_empty() {
                return None;
            }
            l.gtfs_route_id.as_deref().map(|id| {
                (id, l.exclude_gtfs_stop_ids.iter().map(String::as_str).collect())
            })
        })
        .collect();
    if !excluded_stops_by_route.is_empty() {
        let before = trips.len();
        trips.retain(|t| {
            let Some(excluded) = excluded_stops_by_route.get(t.route_id.as_str()) else {
                return true;
            };
            let touches_excluded = stop_times
                .get(&t.trip_id)
                .is_some_and(|rows| rows.iter().any(|r| excluded.contains(r.stop_id.as_str())));
            if touches_excluded {
                eprintln!(
                    "note: dropping trip {} (route {}) — serves an excluded stop",
                    t.trip_id, t.route_id
                );
            }
            !touches_excluded
        });
        eprintln!(
            "note: excluded-stop filter dropped {} of {before} trips",
            before - trips.len()
        );
        if trips.is_empty() {
            return Err("exclude_gtfs_stop_ids filtering removed every trip".into());
        }
    }

    // route_id -> allow_large_snap_stop_ids, so the per-pattern resolver
    // (below) can honour the same escape hatch the station-level snapping
    // loop does when it validates a PATTERN-CHOSEN candidate's distance
    // (task 5 follow-up finding 1b) — the resolver can select a candidate
    // whose distance the station-level check, which only ever saw the
    // globally-nearest candidate, never validated.
    let allow_large_snap_by_route: HashMap<&str, HashSet<&str>> = track_file
        .lines
        .iter()
        .filter_map(|l| {
            if l.allow_large_snap_stop_ids.is_empty() {
                return None;
            }
            l.gtfs_route_id.as_deref().map(|id| {
                (id, l.allow_large_snap_stop_ids.iter().map(String::as_str).collect())
            })
        })
        .collect();

    let all_stop_ids: HashSet<String> = stop_times
        .values()
        .flat_map(|rows| rows.iter().map(|r| r.stop_id.clone()))
        .collect();
    let stop_rows = gtfs::read_stops(gtfs_dir, &all_stop_ids)?;
    for id in &all_stop_ids {
        if !stop_rows.contains_key(id) {
            return Err(format!("unknown stop id '{id}' (in stop_times but not stops.txt)"));
        }
    }

    // ---- Tracks + stations -------------------------------------------------
    let proj = EnuProjector::new(ORIGIN_LNG_LAT.0, ORIGIN_LNG_LAT.1);
    let mut routes: Vec<RouteDoc> = Vec::new();
    let mut station_maps: Vec<HashMap<String, u16>> = Vec::new(); // stop_id -> station_idx
    // stop_id -> every local-minimum candidate position on this route's
    // polyline (task 5: a route whose alignment passes near itself twice,
    // e.g. MRT Blue's loop-plus-branch joint at Tha Phra, has stops with
    // more than one candidate). Parallel to station_maps; used by the
    // pattern-building loop below to pick the candidate consistent with
    // each specific pattern's direction, not just the closest one overall.
    let mut candidate_maps: Vec<HashMap<String, Vec<(f64, f64)>>> = Vec::new();
    // Tracked separately from large_snap_exceptions below so a disclosed,
    // known exception (e.g. the Pink terminus's 555 m coordinate quirk)
    // doesn't hide a genuinely-bad snap on some other, future line — an
    // undisclosed regression would still show up here.
    let mut max_snap_m = 0.0f64;
    let mut large_snap_exceptions: Vec<serde_json::Value> = Vec::new();
    let mut snap_warnings: Vec<serde_json::Value> = Vec::new();

    for line in &track_file.lines {
        check_track_gradient(&line.key, &line.track, &proj)?;
        let ctrl: Vec<[f64; 3]> = line
            .track
            .iter()
            .map(|v| proj.project(v.0, v.1, v.2))
            .collect();
        let poly = spline::catmull_rom_resample(&ctrl, RESAMPLE_SPACING_M)?;
        let arcs = spline::cumulative_arc(&poly);

        // Snap each station onto this line's polyline. (stop_id, snap_d, doc)
        let mut snapped: Vec<(String, f64, StationDoc)> = Vec::new();
        let mut stop_candidates: HashMap<String, Vec<(f64, f64)>> = HashMap::new();

        match line.gtfs_route_id.as_deref() {
            Some(route_id) => {
                // Stop ids served by this route's patterns.
                let route_stop_ids: HashSet<&String> = trips
                    .iter()
                    .filter(|t| t.route_id == route_id)
                    .flat_map(|t| {
                        stop_times
                            .get(&t.trip_id)
                            .map(|rows| rows.iter().map(|s| &s.stop_id))
                            .into_iter()
                            .flatten()
                    })
                    .collect();
                if route_stop_ids.is_empty() {
                    return Err(format!("route {route_id}: no stop_times rows"));
                }

                let network_by_id: HashMap<&str, &NetworkStation> =
                    line.stations.iter().map(|s| (s.id.as_str(), s)).collect();

                // Snap each GTFS stop (by lat/lng from stops.txt) onto the polyline.
                for stop_id in route_stop_ids {
                    let row = &stop_rows[stop_id];
                    let p = proj.project(row.lon, row.lat, 0.0);
                    let candidates = spline::snap_candidates(&poly, &arcs, [p[0], p[1]]);
                    let (arc_m, snap_d) = *candidates
                        .iter()
                        .min_by(|a, b| a.1.total_cmp(&b.1))
                        .expect("snap_candidates always returns >= 1 candidate");
                    stop_candidates.insert(stop_id.clone(), candidates);
                    let large_snap_allowed = line
                        .allow_large_snap_stop_ids
                        .iter()
                        .any(|s| s.as_str() == stop_id.as_str());
                    if snap_d > MAX_SNAP_M && !large_snap_allowed {
                        return Err(format!(
                            "stop {stop_id} snaps {snap_d:.1} m from route {route_id} track (limit {MAX_SNAP_M} m)"
                        ));
                    }
                    if large_snap_allowed && snap_d > ALLOW_LARGE_SNAP_CEILING_M {
                        return Err(format!(
                            "stop {stop_id} snaps {snap_d:.1} m from route {route_id} track — \
                             past the {ALLOW_LARGE_SNAP_CEILING_M} m allow_large_snap_stop_ids \
                             ceiling; this is too far to be the known exception, check the id"
                        ));
                    }
                    if large_snap_allowed {
                        eprintln!(
                            "warning: stop {stop_id} snaps {snap_d:.1} m from route {route_id} track — allowed (allow_large_snap_stop_ids)"
                        );
                        large_snap_exceptions.push(serde_json::json!({
                            "route_id": route_id,
                            "gtfs_stop_id": stop_id,
                            "snap_m": snap_d,
                        }));
                    } else if snap_d > 40.0 {
                        eprintln!(
                            "warning: stop {stop_id} ({}) is {snap_d:.1} m from route {route_id} track",
                            row.name
                        );
                    }
                    if !large_snap_allowed {
                        max_snap_m = max_snap_m.max(snap_d);
                    }
                    match classify_snap(
                        &line.key,
                        stop_id,
                        snap_d,
                        &line.snap_warn_exempt_stop_ids,
                        &line.allow_large_snap_stop_ids,
                    ) {
                        SnapVerdict::Ok => {}
                        SnapVerdict::Disclosed { snap_m } => {
                            snap_warnings.push(serde_json::json!({
                                "line": line.key, "gtfs_stop_id": stop_id, "snap_m": snap_m,
                            }));
                        }
                        SnapVerdict::Undisclosed { snap_m } => {
                            return Err(format!(
                                "stop {stop_id} on line '{}' snaps {snap_m:.1} m from track \
                                 (warn limit {SNAP_WARN_M} m). If this is real, understood \
                                 geometry, add it to that line's snapWarnExemptStopIds in \
                                 tools/lines.config.mjs WITH a comment saying why, then \
                                 re-run npm run data:fetch. If it is not, the stop position \
                                 or the track is wrong — fix that, do not exempt it.",
                                line.key
                            ));
                        }
                    }
                    // OSM candidates only win if they actually carry a name:
                    // route-relation `role=stop` members are usually bare
                    // stop_position nodes with no name tag at all (the name
                    // lives on a separate platform/station node this fetch
                    // never queries) — every one of the ~130 "matched by
                    // distance" fallbacks below turned out to have g.name ==
                    // "" before this check existed, silently blanking most
                    // new-line station names even though the correctly-named
                    // GTFS fallback was right there. Prefer any named
                    // candidate; only give up and use bare GTFS naming when
                    // nothing nearby has a name at all.
                    let (code, name_en, name_th) = match network_by_id
                        .get(stop_id.as_str())
                        .filter(|g| !g.name.is_empty())
                    {
                        Some(g) => (g.code.clone(), g.name.clone(), g.name_th.clone()),
                        None => {
                            // Fall back to nearest network.json station by distance.
                            let nearest = line
                                .stations
                                .iter()
                                .filter(|g| !g.name.is_empty())
                                .map(|g| {
                                    let q = proj.project(g.position[0], g.position[1], 0.0);
                                    let d2 = (q[0] - p[0]).powi(2) + (q[1] - p[1]).powi(2);
                                    (d2, g)
                                })
                                .min_by(|a, b| a.0.total_cmp(&b.0));
                            let (th, en) = gtfs::split_th_en(&row.name);
                            match nearest {
                                Some((d2, g)) if d2.sqrt() < 100.0 => {
                                    eprintln!(
                                        "warning: stop {stop_id} not in network.json; matched '{}' by distance ({:.1} m)",
                                        g.name,
                                        d2.sqrt()
                                    );
                                    (g.code.clone(), g.name.clone(), g.name_th.clone())
                                }
                                _ => {
                                    eprintln!(
                                        "warning: stop {stop_id} not in network.json; using GTFS name '{en}'"
                                    );
                                    (String::new(), en, th)
                                }
                            }
                        }
                    };
                    snapped.push((
                        stop_id.clone(),
                        snap_d,
                        StationDoc {
                            gtfs_stop_id: stop_id.clone(),
                            code,
                            name_en,
                            name_th,
                            arc_m: arc_m as f32,
                            interchanges: Vec::new(),
                        },
                    ));
                }

                // Finding (Step 1): the loop above validates each GTFS stop's
                // OWN coordinate (stops.txt row.lon/row.lat) against the
                // track — it never reads network.json's `station.position`
                // field for a GTFS-simulated line at all. That field is what
                // src/map/trackGeometry.ts's buildStationMarkers actually
                // renders as the on-map station dot, and what the id-based
                // enrichment lookup above keys off. A hand-patched registry
                // entry can therefore carry a badly wrong position that the
                // MAX_SNAP_M/SNAP_WARN_M gates above never see, because they
                // never look at it — exactly the historical Mo Chit defect
                // (187.4 m, pre-b4c1cb9): its GTFS stop (37) had an accurate
                // coordinate that always passed the loop above, while the
                // separately hand-authored network.json entry citing an
                // untagged OSM node sat 187 m from the real track and was
                // never checked by anything. Verified by direct experiment
                // (see task-2-report.md Step 1): re-running this
                // preprocessor against Mo Chit's pre-fix network.json entry
                // produced zero snap warning/error from the loop above.
                //
                // Close that gap here: validate every registry-declared
                // station position for this line too, independent of its
                // GTFS stop's own snap result.
                for s in &line.stations {
                    let p = proj.project(s.position[0], s.position[1], 0.0);
                    let (_, snap_d) = spline::snap_to_polyline(&poly, &arcs, [p[0], p[1]]);
                    if snap_d > MAX_SNAP_M {
                        return Err(format!(
                            "station {} ({}) on line '{}' snaps {snap_d:.1} m from track \
                             (limit {MAX_SNAP_M} m) — this is network.json's own station \
                             position (used for the map marker), independent of its GTFS \
                             stop's own snap distance",
                            s.id, s.name, line.key
                        ));
                    }
                    match classify_snap(
                        &line.key,
                        &s.id,
                        snap_d,
                        &line.snap_warn_exempt_stop_ids,
                        &line.allow_large_snap_stop_ids,
                    ) {
                        SnapVerdict::Ok => {}
                        SnapVerdict::Disclosed { snap_m } => {
                            snap_warnings.push(serde_json::json!({
                                "line": line.key, "gtfs_stop_id": s.id, "snap_m": snap_m,
                                "source": "registry_position",
                            }));
                        }
                        SnapVerdict::Undisclosed { snap_m } => {
                            return Err(format!(
                                "station {} ({}) on line '{}' registry position snaps \
                                 {snap_m:.1} m from track (warn limit {SNAP_WARN_M} m). If \
                                 this is real, understood geometry, add it to that line's \
                                 snapWarnExemptStopIds in tools/lines.config.mjs WITH a \
                                 comment saying why, then re-run npm run data:fetch. If it \
                                 is not, the station's hand-authored/fetched position is \
                                 wrong — fix that, do not exempt it.",
                                s.id, s.name, line.key
                            ));
                        }
                    }
                }
            }
            None => {
                // Track-only line (no gtfsRouteId): there are no GTFS trips to
                // snap against, so the registry's own station list is
                // authoritative — snap each declared station onto this line's
                // polyline directly.
                for s in &line.stations {
                    let p = proj.project(s.position[0], s.position[1], 0.0);
                    let (arc_m, snap_d) = spline::snap_to_polyline(&poly, &arcs, [p[0], p[1]]);
                    if snap_d > MAX_SNAP_M {
                        return Err(format!(
                            "station {} snaps {snap_d:.1} m from line '{}' track (limit {MAX_SNAP_M} m)",
                            s.id, line.key
                        ));
                    }
                    max_snap_m = max_snap_m.max(snap_d);
                    match classify_snap(
                        &line.key,
                        &s.id,
                        snap_d,
                        &line.snap_warn_exempt_stop_ids,
                        &line.allow_large_snap_stop_ids,
                    ) {
                        SnapVerdict::Ok => {}
                        SnapVerdict::Disclosed { snap_m } => {
                            snap_warnings.push(serde_json::json!({
                                "line": line.key, "gtfs_stop_id": s.id, "snap_m": snap_m,
                            }));
                        }
                        SnapVerdict::Undisclosed { snap_m } => {
                            return Err(format!(
                                "stop {} on line '{}' snaps {snap_m:.1} m from track \
                                 (warn limit {SNAP_WARN_M} m). If this is real, understood \
                                 geometry, add it to that line's snapWarnExemptStopIds in \
                                 tools/lines.config.mjs WITH a comment saying why, then \
                                 re-run npm run data:fetch. If it is not, the stop position \
                                 or the track is wrong — fix that, do not exempt it.",
                                s.id, line.key
                            ));
                        }
                    }
                    snapped.push((
                        s.id.clone(),
                        snap_d,
                        StationDoc {
                            gtfs_stop_id: s.id.clone(),
                            code: s.code.clone(),
                            name_en: s.name.clone(),
                            name_th: s.name_th.clone(),
                            arc_m: arc_m as f32,
                            interchanges: Vec::new(),
                        },
                    ));
                }
            }
        }

        // Order by arc ascending; must be strictly increasing.
        snapped.sort_by(|a, b| a.2.arc_m.total_cmp(&b.2.arc_m));
        for w in snapped.windows(2) {
            if w[1].2.arc_m <= w[0].2.arc_m {
                return Err(format!(
                    "line {}: stations {} and {} share arc position {:.1}",
                    line.key, w[0].0, w[1].0, w[0].2.arc_m
                ));
            }
        }
        let map: HashMap<String, u16> = snapped
            .iter()
            .enumerate()
            .map(|(i, (id, _, _))| (id.clone(), i as u16))
            .collect();

        // Registry name/colour win over the feed's for both branches: they're
        // what the UI legend, the track deck and the train livery already
        // use, and they're unique — the GTFS route_short_name is not (the
        // Namtang feed gives both SRT Dark Red (2026) and Light Red (2027)
        // the bare short_name "Red", which the inspector's "<name> · run N"
        // header would otherwise show identically for either line).
        let color_rgb = parse_hex_color(&line.color)?;
        let name_en = line.name.clone();
        routes.push(RouteDoc {
            gtfs_route_id: line.gtfs_route_id.clone().unwrap_or_default(),
            line_key: line.key.clone(),
            simulated: line.gtfs_route_id.is_some(),
            name_en,
            color_rgb,
            track_xyz: poly.iter().map(|p| [p[0] as f32, p[1] as f32, p[2] as f32]).collect(),
            track_arc_m: arcs.iter().map(|&a| a as f32).collect(),
            stations: snapped.into_iter().map(|(_, _, s)| s).collect(),
        });
        station_maps.push(map);
        candidate_maps.push(stop_candidates);
    }

    link_interchanges(&mut routes, INTERCHANGE_RADIUS_M, &track_file.interchange_overrides)?;

    // ---- Services ----------------------------------------------------------
    let mut service_id_list: Vec<String> = service_ids.iter().cloned().collect();
    service_id_list.sort();
    let mut services = Vec::new();
    let mut service_idx_by_id: HashMap<String, u8> = HashMap::new();
    for id in &service_id_list {
        let cal = calendar
            .get(id)
            .ok_or(format!("service '{id}' missing from calendar.txt"))?;
        let (mut added, mut removed) = calendar_dates.remove(id).unwrap_or_default();
        added.sort_unstable();
        removed.sort_unstable();
        service_idx_by_id.insert(id.clone(), services.len() as u8);
        services.push(ServiceDoc {
            gtfs_service_id: id.clone(),
            weekday_mask: cal.weekday_mask,
            start_date: cal.start_date,
            end_date: cal.end_date,
            added_dates: added,
            removed_dates: removed,
        });
    }

    // ---- Patterns ----------------------------------------------------------
    let route_idx_by_gtfs_id = build_route_idx_by_gtfs_id(
        &track_file
            .lines
            .iter()
            .map(|l| (l.key.clone(), l.gtfs_route_id.clone()))
            .collect::<Vec<_>>(),
    )?;
    let mut patterns = Vec::new();
    let mut pattern_idx_by_trip: HashMap<String, u16> = HashMap::new();
    // Total per-stop fallbacks (finding 1d): the resolver found no candidate
    // consistent with the running arc and fell back to the plain-nearest
    // position instead. Previously stderr-only, so a future regression here
    // was invisible in committed data; now gateable via --report.
    let mut pattern_arc_fallback_count: usize = 0;
    for trip in &trips {
        let route_idx = route_idx_by_gtfs_id[trip.route_id.as_str()];
        let rows = stop_times
            .get(&trip.trip_id)
            .ok_or(format!("trip {} has no stop_times", trip.trip_id))?;
        let t0 = rows.first().map(|r| r.arrival_s).unwrap_or(0);

        // Resolve every row's station_idx up front so the per-pattern
        // monotonic arc solver (task 5) sees the whole pattern's candidate
        // lists at once — which candidate is correct for an ambiguous stop
        // (a route that passes near itself twice, e.g. MRT Blue at Tha
        // Phra) depends on this trip's OTHER stops, not on the stop alone.
        let mut station_idxs = Vec::with_capacity(rows.len());
        let mut candidate_lists = Vec::with_capacity(rows.len());
        for row in rows {
            let station_idx = *station_maps[route_idx]
                .get(&row.stop_id)
                .ok_or(format!("trip {}: unknown stop id {}", trip.trip_id, row.stop_id))?;
            station_idxs.push(station_idx);
            candidate_lists.push(
                candidate_maps[route_idx]
                    .get(&row.stop_id)
                    .cloned()
                    .ok_or(format!(
                        "trip {}: stop {} has no snap candidates recorded",
                        trip.trip_id, row.stop_id
                    ))?,
            );
        }
        let (resolved_arcs, resolved_dists, used_fallback) =
            resolve_pattern_arcs_full(&candidate_lists);

        let mut stops = Vec::with_capacity(rows.len());
        let mut prev_arr = 0u32;
        for (i, row) in rows.iter().enumerate() {
            let arrival_s = row.arrival_s - t0; // relative offsets; first stop = 0
            let departure_s = row.departure_s - t0;
            if departure_s < arrival_s || arrival_s < prev_arr {
                return Err(format!("trip {}: non-monotonic stop times", trip.trip_id));
            }
            prev_arr = arrival_s;
            if used_fallback[i] {
                pattern_arc_fallback_count += 1;
                eprintln!(
                    "warning: trip {} stop {} (station_idx {}): no snap candidate stayed \
                     consistent with this pattern's direction — used its plain nearest \
                     position instead of inventing one",
                    trip.trip_id, row.stop_id, station_idxs[i]
                );
            }
            // Finding 1b: MAX_SNAP_M was checked against each stop's
            // globally-nearest candidate in the station-snapping loop above,
            // but the resolver can choose a DIFFERENT candidate for this
            // specific pattern, arbitrarily farther away, that check never
            // saw. Validate the actually-chosen candidate too, under the
            // same rule (and the same allow_large_snap_stop_ids escape
            // hatch + ceiling).
            let dist = resolved_dists[i];
            let large_snap_allowed = allow_large_snap_by_route
                .get(trip.route_id.as_str())
                .is_some_and(|s| s.contains(row.stop_id.as_str()));
            if dist > MAX_SNAP_M && !large_snap_allowed {
                return Err(format!(
                    "trip {}: stop {} resolves to a pattern-specific candidate {dist:.1} m \
                     from route {} track (limit {MAX_SNAP_M} m) — this differs from the \
                     stop's globally-nearest snap, which passed the same check",
                    trip.trip_id, row.stop_id, trip.route_id
                ));
            }
            if large_snap_allowed && dist > ALLOW_LARGE_SNAP_CEILING_M {
                return Err(format!(
                    "trip {}: stop {} resolves to a pattern-specific candidate {dist:.1} m \
                     from route {} track — past the {ALLOW_LARGE_SNAP_CEILING_M} m \
                     allow_large_snap_stop_ids ceiling; this is too far to be the known \
                     exception, check the id",
                    trip.trip_id, row.stop_id, trip.route_id
                ));
            } else if large_snap_allowed && dist > MAX_SNAP_M {
                eprintln!(
                    "warning: trip {} stop {} resolves {dist:.1} m from route {} track — \
                     allowed (allow_large_snap_stop_ids)",
                    trip.trip_id, row.stop_id, trip.route_id
                );
            }
            stops.push(PatternStop {
                station_idx: station_idxs[i],
                arrival_s,
                departure_s,
                arc_m: resolved_arcs[i] as f32,
            });
        }
        let (_, headsign_en) = gtfs::split_th_en(&trip.headsign);
        pattern_idx_by_trip.insert(trip.trip_id.clone(), patterns.len() as u16);
        patterns.push(PatternDoc {
            gtfs_trip_id: trip.trip_id.clone(),
            route_idx: route_idx as u8,
            direction: trip.direction_id,
            headsign_en,
            stops,
        });
    }

    // ---- Runs (frequency expansion, or one run per scheduled trip) --------
    let mut runs = Vec::new();
    for trip in &trips {
        let pattern_idx = pattern_idx_by_trip[&trip.trip_id];
        let service_idx = service_idx_by_id[&trip.service_id];
        let first_arrival_s = stop_times[&trip.trip_id].first().map(|r| r.arrival_s).unwrap_or(0);
        runs.extend(runs_for_pattern(
            &trip.trip_id,
            &frequencies,
            first_arrival_s,
            pattern_idx,
            service_idx,
        ));
    }
    if runs.is_empty() {
        return Err("expansion produced zero runs".into());
    }
    runs.sort_by_key(|r| (r.service_idx, r.start_sec, r.pattern_idx));

    for (idx, route) in routes.iter().enumerate() {
        if !route.simulated {
            continue;
        }
        let has_runs = runs.iter().any(|r| patterns[r.pattern_idx as usize].route_idx as usize == idx);
        if !has_runs {
            return Err(format!(
                "route '{}' ({}) is marked simulated but expanded to zero runs — \
                 check frequencies.txt/stop_times for route_id '{}'",
                route.line_key, route.name_en, route.gtfs_route_id
            ));
        }
    }

    // ---- Encode + write ----------------------------------------------------
    let doc = CacheDoc {
        magic: TMB_MAGIC,
        version: TMB_VERSION,
        feed_version: feed_version.clone(),
        generated_unix: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0),
        origin_lng: ORIGIN_LNG_LAT.0,
        origin_lat: ORIGIN_LNG_LAT.1,
        routes,
        services,
        patterns,
        runs,
    };
    let bytes = bincode::serde::encode_to_vec(&doc, bincode::config::standard())
        .map_err(|e| format!("bincode encode failed: {e}"))?;
    if let Some(dir) = args.out.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("mkdir {}: {e}", dir.display()))?;
    }
    std::fs::write(&args.out, &bytes)
        .map_err(|e| format!("write {}: {e}", args.out.display()))?;

    let gzip_bytes = {
        let mut gz =
            flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
        gz.write_all(&bytes).map_err(|e| e.to_string())?;
        gz.finish().map_err(|e| e.to_string())?.len()
    };

    // ---- Cross-check through sim-core + report -----------------------------
    let world = SimWorld::from_bytes(&bytes).map_err(|e| format!("self-check failed: {e}"))?;
    let v = world.validation();
    let per_route: Vec<serde_json::Value> = world
        .doc()
        .routes
        .iter()
        .enumerate()
        .map(|(i, r)| {
            let pat_idxs: Vec<usize> = world
                .doc()
                .patterns
                .iter()
                .enumerate()
                .filter(|(_, p)| p.route_idx as usize == i)
                .map(|(k, _)| k)
                .collect();
            let run_count = world
                .doc()
                .runs
                .iter()
                .filter(|run| pat_idxs.contains(&(run.pattern_idx as usize)))
                .count();
            serde_json::json!({
                "gtfs_route_id": r.gtfs_route_id,
                "name_en": r.name_en,
                "stations": r.stations.len(),
                "track_points": r.track_xyz.len(),
                "length_m": r.track_arc_m.last().copied().unwrap_or(0.0),
                "patterns": pat_idxs.len(),
                "runs": run_count,
            })
        })
        .collect();
    // One entry per undirected link (route_idx ordering dedupes the symmetric pair).
    let interchanges: Vec<serde_json::Value> = world
        .doc()
        .routes
        .iter()
        .enumerate()
        .flat_map(|(ri, r)| {
            r.stations.iter().enumerate().flat_map(move |(si, st)| {
                st.interchanges
                    .iter()
                    .filter(move |link| (ri, si) < (link.route_idx as usize, link.station_idx as usize))
                    .map(move |link| (ri, si, link))
            })
        })
        .map(|(ri, si, link)| {
            let a = &world.doc().routes[ri];
            let b = &world.doc().routes[link.route_idx as usize];
            serde_json::json!({
                "a": format!("{}/{}", a.line_key, a.stations[si].name_en),
                "b": format!("{}/{}", b.line_key, b.stations[link.station_idx as usize].name_en),
            })
        })
        .collect();
    let (weekday_peak, weekday_peak_sec) = peak_concurrent(&world, PEAK_SAMPLE_WEEKDAY);
    let (weekend_peak, weekend_peak_sec) = peak_concurrent(&world, PEAK_SAMPLE_WEEKEND);
    let (peak_concurrent_count, peak_concurrent_time, peak_concurrent_date) =
        if weekday_peak >= weekend_peak {
            (weekday_peak, weekday_peak_sec, PEAK_SAMPLE_WEEKDAY)
        } else {
            (weekend_peak, weekend_peak_sec, PEAK_SAMPLE_WEEKEND)
        };

    let report = serde_json::json!({
        "feed_version": v.feed_version,
        "stations": v.stations,
        "patterns": v.patterns,
        "runs": v.runs,
        "services": v.services,
        "interchanges": interchanges,
        "bytes": bytes.len(),
        "gzip_bytes": gzip_bytes,
        // Excludes any allow_large_snap_stop_ids exceptions (reported
        // separately below) so a disclosed, known offset like Pink's 555 m
        // terminus/interchange quirk can't hide a genuinely-bad snap
        // elsewhere behind an already-large "normal" baseline.
        "max_snap_m": max_snap_m,
        "large_snap_exceptions": large_snap_exceptions,
        "snap_warnings": snap_warnings,
        // Finding 1d: count of per-stop pattern-arc resolutions that could
        // not stay consistent with their pattern's running arc and fell
        // back to a plain-nearest position (previously stderr-only warnings,
        // invisible in committed data). Zero on a healthy network; a future
        // self-approaching-alignment regression would show up here first.
        "pattern_arc_fallbacks": pattern_arc_fallback_count,
        "per_route": per_route,
        // Highest simultaneous vehicle count over a sampled service day —
        // answers "is MAX_VEHICLES big enough" with data, not a guess
        // (contract §3/§8). The overall max of a weekday and a weekend scan;
        // both are reported separately too so a future weekend-only spike
        // isn't hidden by taking just the bigger number's weekday assumption.
        "peak_concurrent": peak_concurrent_count,
        "peak_concurrent_time": peak_concurrent_time,
        "peak_concurrent_date": peak_concurrent_date,
        "peak_concurrent_weekday": {"date": PEAK_SAMPLE_WEEKDAY, "peak": weekday_peak, "time": weekday_peak_sec},
        "peak_concurrent_weekend": {"date": PEAK_SAMPLE_WEEKEND, "peak": weekend_peak, "time": weekend_peak_sec},
    });
    let report_str = serde_json::to_string_pretty(&report).unwrap();
    if let Some(path) = &args.report {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir).map_err(|e| format!("mkdir {}: {e}", dir.display()))?;
        }
        std::fs::write(path, &report_str)
            .map_err(|e| format!("write {}: {e}", path.display()))?;
    }
    println!("{report_str}");
    Ok(())
}

/// Cross-route walking connections, from station ENU distance plus a manual
/// override list for long walkways the radius cannot reach.
///
/// GTFS `parent_station` cannot do this job: interchanges here span operators
/// (BTS/BEM/SRT) that publish independent feeds and never share a parent.
/// Distance-clustering with a manual escape hatch is the pragmatic substitute.
///
/// Errors if any override matched zero station pairs (finding 2: this used
/// to be silent — `overrides.iter().any(...)` just never matching on a
/// typo'd line key or stop id, and the interchange it was meant to add
/// silently never appeared). `assertRegistryValid()` only covers line keys,
/// runs inside `fetch-network.mjs`, and the preprocessor is routinely run
/// against a committed `network.json` without a re-fetch — the same reason
/// `build_route_idx_by_gtfs_id` guards duplicate gtfs_route_ids here rather
/// than trusting the registry validator alone.
fn link_interchanges(
    routes: &mut [RouteDoc],
    radius_m: f64,
    overrides: &[InterchangeOverride],
) -> Result<(), String> {
    // (route_idx, station_idx, x, y, line_key, stop_id)
    let mut pts: Vec<(usize, usize, f32, f32, String, String)> = Vec::new();
    for (ri, route) in routes.iter().enumerate() {
        for (si, st) in route.stations.iter().enumerate() {
            let [x, y, _z] = sim_core::world::position_at_arc(route, st.arc_m);
            pts.push((ri, si, x, y, route.line_key.clone(), st.gtfs_stop_id.clone()));
        }
    }

    let r2 = (radius_m * radius_m) as f32;
    let mut links: Vec<(usize, usize, usize, usize)> = Vec::new();
    let mut override_matched = vec![false; overrides.len()];
    for i in 0..pts.len() {
        for j in (i + 1)..pts.len() {
            let (ri, si, xi, yi, li, idi) = (pts[i].0, pts[i].1, pts[i].2, pts[i].3, &pts[i].4, &pts[i].5);
            let (rj, sj, xj, yj, lj, idj) = (pts[j].0, pts[j].1, pts[j].2, pts[j].3, &pts[j].4, &pts[j].5);
            if ri == rj {
                continue; // same line: adjacent stations are not an interchange
            }
            let near = (xi - xj).powi(2) + (yi - yj).powi(2) <= r2;
            let mut forced = false;
            for (oi, o) in overrides.iter().enumerate() {
                let hit = (o.a_line == *li && o.a_stop == *idi && o.b_line == *lj && o.b_stop == *idj)
                    || (o.a_line == *lj && o.a_stop == *idj && o.b_line == *li && o.b_stop == *idi);
                if hit {
                    override_matched[oi] = true;
                    forced = true;
                }
            }
            if near || forced {
                links.push((ri, si, rj, sj));
            }
        }
    }

    let unmatched: Vec<String> = overrides
        .iter()
        .zip(override_matched.iter())
        .filter(|&(_, &matched)| !matched)
        .map(|(o, _)| format!("{}/{} <-> {}/{}", o.a_line, o.a_stop, o.b_line, o.b_stop))
        .collect();
    if !unmatched.is_empty() {
        return Err(format!(
            "interchange_overrides matched zero station pairs (typo'd line key or stop id, \
             or a route no longer carries that stop?): {}",
            unmatched.join(", ")
        ));
    }

    for (ri, si, rj, sj) in links {
        routes[ri].stations[si]
            .interchanges
            .push(InterchangeRef { route_idx: rj as u16, station_idx: sj as u16 });
        routes[rj].stations[sj]
            .interchanges
            .push(InterchangeRef { route_idx: ri as u16, station_idx: si as u16 });
    }
    Ok(())
}

const INTERCHANGE_RADIUS_M: f64 = 300.0;

/// Highest simultaneous vehicle count over a service day, sampled per minute.
/// Answers "is MAX_VEHICLES big enough" with data instead of a guess.
/// Returns (peak count, seconds-of-day the peak occurred at).
fn peak_concurrent(world: &SimWorld, date_yyyymmdd: u32) -> (usize, u32) {
    let mut out = vec![0.0f32; sim_core::world::MAX_VEHICLES * sim_core::world::VEHICLE_STRIDE];
    let mut best = (0usize, 0u32);
    for minute in 0..1440u32 {
        let sec = (minute * 60) as f64;
        let n = world.evaluate(date_yyyymmdd, sec, &mut out);
        if n > best.0 {
            best = (n, minute * 60);
        }
    }
    best
}

/// Runs for one pattern, from `frequencies.txt` when the trip has rows there,
/// otherwise from the trip's own absolute `stop_times`.
///
/// GTFS allows both shapes in one feed and the Namtang feed uses both: BTS
/// routes are frequency-based (relative stop_times + headway windows) while
/// other operators publish concrete departures. A trip with neither must never
/// silently vanish — the caller errors on an empty total.
fn runs_for_pattern(
    trip_id: &str,
    freqs: &[gtfs::FrequencyRow],
    first_arrival_s: u32,
    pattern_idx: u16,
    service_idx: u8,
) -> Vec<RunDoc> {
    let mut runs = Vec::new();
    let mut had_freq = false;
    for f in freqs.iter().filter(|f| f.trip_id == trip_id) {
        had_freq = true;
        for start_sec in expand_frequency(f.start_sec, f.end_sec, f.headway_secs) {
            runs.push(RunDoc { pattern_idx, service_idx, start_sec });
        }
    }
    if !had_freq {
        runs.push(RunDoc { pattern_idx, service_idx, start_sec: first_arrival_s });
    }
    runs
}

/// Chooses one arc position per stop for a single pattern, from each stop's
/// candidate list (`spline::snap_candidates`), such that the chosen arcs are
/// monotonic along the pattern's own direction of travel.
///
/// Needed because a station-level global-nearest snap (the pre-task-5
/// behaviour) is wrong whenever a route's alignment passes close to the same
/// real-world point more than once — MRT Blue's loop-plus-branch joint at
/// Tha Phra, where the alignment comes back near itself ~38 km later in arc
/// terms. A single stop can then have >1 legitimate candidate position, and
/// which one is correct depends on the OTHER stops in that specific
/// pattern, not on the stop in isolation.
///
/// Direction is not read from GTFS `direction_id` (unreliable/not always
/// present in this feed). It's decided by voting: each stop's own plain
/// nearest candidate (ignoring any cross-stop constraint) gives one data
/// point per consecutive pair — does it trend up or down? A pattern of N
/// stops gives N-1 votes, so one ambiguous stop (the common case — MRT
/// Blue's patterns are 8-30 stops long with at most one or two
/// self-approach joints each) can't flip the outcome; only the SUM of
/// consecutive-pair total cost was tried first and rejected — for a
/// single-candidate stop the chosen arc (and its distance) is identical
/// regardless of which direction is assumed, so that stop's cost cancels out
/// of any forward-vs-reverse comparison and the "total cost" signal ends up
/// decided almost entirely by whichever raw distance happens to be smaller
/// at the one ambiguous stop — not by the surrounding context that should
/// settle it. Voting on trend, not cost, uses that context properly.
///
/// Once direction is decided, a dynamic-programming pass — not a greedy
/// left-to-right walk — assigns each stop a candidate. `O(N*C^2)` with C the
/// widest candidate list (<=2-3 at this scale, per `snap_candidates`), so
/// this is free. The pass always runs in "forward" order — for a
/// reverse-direction pattern the stop list is reversed first and the result
/// reversed back.
///
/// A prior greedy version anchored the walk's first stop (no earlier
/// candidate to compare against) to its own plain-nearest pick, unconditionally,
/// with no visibility into the rest of the pattern. That's fine when the
/// first stop is unambiguous (the overwhelmingly common case), but wrong
/// whenever the pattern's first stop IS the ambiguous one (Tha Phra is the
/// Bang Wa/Lak Song branch terminus, so patterns beginning or ending there
/// are exactly the shape at risk): picking blind can lock in a candidate
/// that is locally nearest but forces every later stop into a fallback,
/// cascading a single bad early guess through the rest of the pattern with
/// no way to recover. The DP fixes this by construction — every stop's
/// candidate is judged by its effect on the WHOLE pattern's total cost, so
/// an ambiguous first stop is resolved using exactly the later-stop context
/// that should settle it, not a name-only distance tiebreak.
///
/// A candidate that breaks monotonicity relative to its predecessor is still
/// legal (never invents a position) but pays a large, fixed penalty in the
/// DP's cost function — real per-stop snap distances are two to three orders
/// of magnitude smaller, so the DP prefers ANY fully-monotonic assignment
/// whenever one exists, and otherwise takes the assignment with the fewest,
/// cheapest breaks. This exactly reproduces the greedy fallback's role (a
/// real geometry/schedule problem, not invented) while being decided
/// globally instead of by an irrevocable earlier choice.
///
/// For an ordinary stop with one candidate this is a no-op: every DP row has
/// exactly one entry, so the result is identical to the old global-nearest
/// behaviour.
///
/// Returns (chosen arc per stop, whether that stop's choice broke
/// monotonicity relative to its predecessor — no assignment kept the whole
/// pattern monotonic through this stop, so its plain nearest candidate
/// [picked by the DP itself, not a separate fallback path] was used instead
/// and the running arc reset from there). The caller logs any such break.
// Only `resolve_pattern_arcs_full` is called from `run()` now (it needs the
// resolved distances too, for finding 1b's validation) — this thin wrapper
// exists purely so the pre-existing test suite below can keep asserting
// against the simpler (arcs, fallback) shape unchanged.
#[cfg(test)]
fn resolve_pattern_arcs(candidate_lists: &[Vec<(f64, f64)>]) -> (Vec<f64>, Vec<bool>) {
    let (arcs, _dists, fallback) = resolve_pattern_arcs_full(candidate_lists);
    (arcs, fallback)
}

/// Same as `resolve_pattern_arcs`, but also returns each chosen candidate's
/// snap distance — needed by the caller to validate the PATTERN-RESOLVED
/// candidate against `MAX_SNAP_M`/`ALLOW_LARGE_SNAP_CEILING_M` (finding 1b):
/// the station-snapping loop only ever validated each stop's
/// globally-nearest candidate, not whichever candidate a specific pattern
/// goes on to choose.
fn resolve_pattern_arcs_full(candidate_lists: &[Vec<(f64, f64)>]) -> (Vec<f64>, Vec<f64>, Vec<bool>) {
    fn nearest(cands: &[(f64, f64)]) -> (f64, f64) {
        *cands
            .iter()
            .min_by(|a, b| a.1.total_cmp(&b.1))
            .expect("snap_candidates always returns >= 1 candidate")
    }

    /// A monotonicity-breaking transition costs this much extra on top of
    /// the real snap distance, so the DP only ever takes a break when no
    /// fully-monotonic assignment exists. Real per-stop distances are bounded
    /// well under ALLOW_LARGE_SNAP_CEILING_M (1000 m); even an implausibly
    /// long ~50-stop pattern, every stop at that ceiling, sums to 50,000 m —
    /// nowhere near this, in either direction (as a floor on avoiding one
    /// break, or as a total across many).
    const BREAK_PENALTY: f64 = 1.0e9;

    /// One DP pass, always in the "forward" (arc non-decreasing) sense — the
    /// caller reverses the input/output for the other direction. For each
    /// stop, tries every (this stop's candidate) x (previous stop's
    /// candidate) pair and keeps the cheapest, backtracking at the end for
    /// the global optimum — unlike a greedy walk, an early stop's choice is
    /// judged by its effect on every later stop, not locked in unconditionally.
    fn walk_forward(lists: &[Vec<(f64, f64)>]) -> (Vec<f64>, Vec<f64>, Vec<bool>) {
        let n = lists.len();
        // dp[i][k] = (best total cost of a prefix ending at stop i with
        // candidate k, whether THIS stop's transition broke monotonicity,
        // backpointer to the chosen candidate index at stop i-1).
        let mut dp: Vec<Vec<(f64, bool, Option<usize>)>> = Vec::with_capacity(n);
        for (i, cands) in lists.iter().enumerate() {
            let mut row = Vec::with_capacity(cands.len());
            for &(arc, dist) in cands {
                if i == 0 {
                    row.push((dist, false, None));
                    continue;
                }
                let mut best: Option<(f64, bool, usize)> = None;
                for (k, &(prev_arc, _)) in lists[i - 1].iter().enumerate() {
                    let (prev_cost, _, _) = dp[i - 1][k];
                    let is_break = arc < prev_arc;
                    let cost = prev_cost + dist + if is_break { BREAK_PENALTY } else { 0.0 };
                    if best.is_none_or(|(b, _, _)| cost < b) {
                        best = Some((cost, is_break, k));
                    }
                }
                let (cost, is_break, k) =
                    best.expect("lists[i - 1] is non-empty: snap_candidates always returns >= 1");
                row.push((cost, is_break, Some(k)));
            }
            dp.push(row);
        }

        let mut k = (0..dp[n - 1].len())
            .min_by(|&a, &b| dp[n - 1][a].0.total_cmp(&dp[n - 1][b].0))
            .expect("every pattern has >= 1 stop");
        let mut arcs = vec![0.0; n];
        let mut dists = vec![0.0; n];
        let mut fallback = vec![false; n];
        for i in (0..n).rev() {
            let (_, is_break, back) = dp[i][k];
            arcs[i] = lists[i][k].0;
            dists[i] = lists[i][k].1;
            fallback[i] = is_break;
            if let Some(prev_k) = back {
                k = prev_k;
            }
        }
        (arcs, dists, fallback)
    }

    if candidate_lists.is_empty() {
        return (Vec::new(), Vec::new(), Vec::new());
    }

    let global_nearest: Vec<f64> = candidate_lists.iter().map(|c| nearest(c).0).collect();
    let mut votes = 0i32;
    for w in global_nearest.windows(2) {
        votes += match w[1].total_cmp(&w[0]) {
            std::cmp::Ordering::Greater => 1,
            std::cmp::Ordering::Less => -1,
            std::cmp::Ordering::Equal => 0,
        };
    }
    let forward = votes >= 0; // tie defaults forward — no signal either way

    if forward {
        walk_forward(candidate_lists)
    } else {
        let mut reversed: Vec<Vec<(f64, f64)>> = candidate_lists.to_vec();
        reversed.reverse();
        let (mut arcs, mut dists, mut fallback) = walk_forward(&reversed);
        arcs.reverse();
        dists.reverse();
        fallback.reverse();
        (arcs, dists, fallback)
    }
}

/// Reject any consecutive track-vertex pair steeper than the ruling gradient.
/// Returns the FIRST violation with enough context to find it in
/// src/data/network.json (line key + vertex index + the measured grade).
fn check_track_gradient(
    key: &str,
    track: &[TrackVertex],
    proj: &EnuProjector,
) -> Result<(), String> {
    for i in 1..track.len() {
        let a = proj.project(track[i - 1].0, track[i - 1].1, track[i - 1].2);
        let b = proj.project(track[i].0, track[i].1, track[i].2);
        let horiz = ((b[0] - a[0]).powi(2) + (b[1] - a[1]).powi(2)).sqrt();
        let rise = (b[2] - a[2]).abs();
        if horiz < COINCIDENT_POINT_M {
            if rise > COINCIDENT_POINT_M {
                return Err(format!(
                    "line '{key}' vertex {i}: {rise:.1} m altitude step across only \
                     {horiz:.2} m of track — a vertical wall. Re-run the fetch so \
                     tools/trackProfile.mjs's limitTrackGradient ramps it."
                ));
            }
            continue;
        }
        let grade = rise / horiz;
        if grade > MAX_TRACK_GRADIENT + GRADIENT_EPSILON {
            return Err(format!(
                "line '{key}' vertex {i}: track gradient {:.1}% exceeds the \
                 {:.0}% ruling limit ({rise:.1} m rise over {horiz:.1} m). \
                 Re-run the fetch so tools/trackProfile.mjs's limitTrackGradient \
                 ramps it.",
                grade * 100.0,
                MAX_TRACK_GRADIENT * 100.0
            ));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A two-line network file, minimal but structurally real.
    ///
    /// Uses a double-hash raw-string delimiter: the JSON contains `"#111111"`
    /// (a `"` immediately followed by `#`), which would otherwise close a
    /// single-hash `r#"..."#` raw string early.
    fn track_json() -> &'static str {
        r##"{"lines":[
            {"key":"a","name":"A","color":"#111111","structure":"elevated",
             "vehicleType":"heavy","gtfsRouteId":"1","track":[[100.5,13.7,15.0],[100.51,13.7,15.0]],
             "stations":[{"id":"s1","name":"S1","nameTh":"ส1","code":"A1","position":[100.5,13.7,15.0]}]},
            {"key":"b","name":"B","color":"#222222","structure":"atGrade",
             "vehicleType":"commuter","gtfsRouteId":"9","track":[[100.6,13.8,0.5],[100.61,13.8,0.5]],
             "stations":[{"id":"s2","name":"S2","nameTh":"ส2","code":"B1","position":[100.6,13.8,0.5]}]}
        ]}"##
    }

    #[test]
    fn rejects_two_lines_claiming_the_same_gtfs_route_id() {
        // Silent misrouting: HashMap::collect keeps the LAST duplicate, so every
        // trip on the shared id would be stamped with the wrong route_idx and
        // rendered on the wrong line's track.
        let lines = vec![
            ("a".to_string(), Some("1".to_string())),
            ("b".to_string(), Some("1".to_string())),
        ];
        let err = build_route_idx_by_gtfs_id(&lines).unwrap_err();
        assert!(err.contains("duplicate gtfsRouteId '1'"), "got: {err}");
    }

    #[test]
    fn accepts_multiple_track_only_lines() {
        // Several lines may legitimately have gtfsRouteId: null (Orange,
        // Purple Phase 2) — null is not a duplicate.
        let lines = vec![
            ("a".to_string(), None),
            ("b".to_string(), None),
            ("c".to_string(), Some("1".to_string())),
        ];
        let map = build_route_idx_by_gtfs_id(&lines).unwrap();
        assert_eq!(map.len(), 1);
        assert_eq!(map["1"], 2);
    }

    #[test]
    fn parse_hex_color_accepts_six_digits_and_rejects_short_forms() {
        assert_eq!(parse_hex_color("#00FF80").unwrap(), 0x00FF80);
        assert_eq!(parse_hex_color("112233").unwrap(), 0x112233);
        assert!(parse_hex_color("#FFF").is_err(), "3-digit shorthand must not silently parse");
        assert!(parse_hex_color("#GGGGGG").is_err());
        assert!(parse_hex_color("#1234567").is_err(), "7 digits must not silently truncate");
    }

    #[test]
    fn route_order_follows_network_json_line_order() {
        let file: TrackFile = serde_json::from_str(track_json()).unwrap();
        assert_eq!(file.lines[0].key, "a");
        assert_eq!(file.lines[1].key, "b");
        // The invariant the whole plan rests on: routes[i] is lines[i].
        let ids: Vec<&str> = file.lines.iter().map(|l| l.gtfs_route_id.as_deref().unwrap()).collect();
        assert_eq!(ids, vec!["1", "9"]);
    }

    #[test]
    fn accepts_a_four_element_track_vertex() {
        let json = r#"[[100.5,13.7,15.0,"elevated"],[100.51,13.7,-18.0,"underground"]]"#;
        let track: Vec<TrackVertex> = serde_json::from_str(json).unwrap();
        assert_eq!(track.len(), 2);
        assert_eq!(track[1].2, -18.0);
        assert_eq!(track[1].3, "underground");
    }

    #[test]
    fn rejects_a_network_file_with_no_lines() {
        let file: TrackFile = serde_json::from_str(r#"{"lines":[]}"#).unwrap();
        assert!(file.lines.is_empty(), "empty networks must be caught by run(), not silently encoded");
    }

    #[test]
    fn frequency_trips_expand_by_headway() {
        let freqs = vec![gtfs::FrequencyRow {
            trip_id: "t1".into(),
            start_sec: 21_600, // 06:00
            end_sec: 21_600 + 900,
            headway_secs: 300,
        }];
        let runs = runs_for_pattern("t1", &freqs, 25_000, 0, 0);
        assert_eq!(runs.len(), 3, "06:00, 06:05, 06:10 — end_time is exclusive");
        assert_eq!(runs[0].start_sec, 21_600);
        assert_eq!(runs[2].start_sec, 22_200);
    }

    #[test]
    fn scheduled_trips_become_one_run_at_their_first_arrival() {
        // No frequencies row: the trip's own stop_times ARE the schedule.
        let runs = runs_for_pattern("t2", &[], 25_200, 7, 1);
        assert_eq!(runs.len(), 1);
        assert_eq!(runs[0].start_sec, 25_200, "07:00 departure keeps its absolute time");
        assert_eq!(runs[0].pattern_idx, 7);
        assert_eq!(runs[0].service_idx, 1);
    }

    #[test]
    fn a_frequency_trip_ignores_its_own_first_arrival() {
        let freqs = vec![gtfs::FrequencyRow {
            trip_id: "t3".into(),
            start_sec: 36_000,
            end_sec: 36_600,
            headway_secs: 600,
        }];
        let runs = runs_for_pattern("t3", &freqs, 99_999, 0, 0);
        assert_eq!(runs.len(), 1);
        assert_eq!(runs[0].start_sec, 36_000);
    }

    fn route_with_stations(key: &str, stations: &[(&str, f32)]) -> RouteDoc {
        RouteDoc {
            gtfs_route_id: key.into(),
            line_key: key.into(),
            simulated: true,
            name_en: key.into(),
            color_rgb: 0,
            // Straight east-west track so arc_m == x metres.
            track_xyz: vec![[0.0, 0.0, 15.0], [5000.0, 0.0, 15.0]],
            track_arc_m: vec![0.0, 5000.0],
            stations: stations
                .iter()
                .map(|(id, arc)| StationDoc {
                    gtfs_stop_id: (*id).into(),
                    code: (*id).into(),
                    name_en: (*id).into(),
                    name_th: (*id).into(),
                    arc_m: *arc,
                    interchanges: Vec::new(),
                })
                .collect(),
        }
    }

    #[test]
    fn links_stations_that_are_physically_close_across_routes() {
        let mut routes = vec![
            route_with_stations("a", &[("a1", 0.0), ("a2", 1000.0)]),
            route_with_stations("b", &[("b1", 1050.0)]),
        ];
        link_interchanges(&mut routes, 300.0, &[]).unwrap();
        assert_eq!(routes[0].stations[1].interchanges.len(), 1, "a2 <-> b1 is 50 m");
        assert_eq!(routes[0].stations[1].interchanges[0].route_idx, 1);
        assert!(routes[1].stations[0].interchanges.iter().any(|i| i.route_idx == 0),
                "the link must be symmetric");
        assert!(routes[0].stations[0].interchanges.is_empty(), "a1 is 1050 m away");
    }

    #[test]
    fn never_links_two_stations_on_the_same_route() {
        // Sukhumvit and Silom cross at Siam with stations metres apart; a
        // self-link would make the inspector advertise a transfer to itself.
        let mut routes = vec![route_with_stations("a", &[("a1", 0.0), ("a2", 20.0)])];
        link_interchanges(&mut routes, 300.0, &[]).unwrap();
        assert!(routes[0].stations.iter().all(|s| s.interchanges.is_empty()));
    }

    #[test]
    fn honours_a_manual_override_beyond_the_radius() {
        // Asok <-> Sukhumvit is a ~200 m walkway; Phaya Thai <-> ARL is longer.
        let mut routes = vec![
            route_with_stations("a", &[("a1", 0.0)]),
            route_with_stations("b", &[("b1", 2000.0)]),
        ];
        link_interchanges(
            &mut routes,
            100.0,
            &[InterchangeOverride {
                a_line: "a".into(),
                a_stop: "a1".into(),
                b_line: "b".into(),
                b_stop: "b1".into(),
            }],
        )
        .unwrap();
        assert_eq!(routes[0].stations[0].interchanges.len(), 1);
        assert_eq!(routes[1].stations[0].interchanges.len(), 1);
    }

    #[test]
    fn an_override_only_links_the_two_named_lines() {
        // Three routes share stop id "x". A bare stop-id override would link all
        // three pairwise; a line-qualified one links exactly the named pair.
        let mut routes = vec![
            route_with_stations("a", &[("x", 0.0)]),
            route_with_stations("b", &[("x", 4000.0)]),
            route_with_stations("c", &[("x", 4500.0)]),
        ];
        link_interchanges(
            &mut routes,
            100.0,
            &[InterchangeOverride {
                a_line: "a".into(),
                a_stop: "x".into(),
                b_line: "b".into(),
                b_stop: "x".into(),
            }],
        )
        .unwrap();
        assert_eq!(routes[0].stations[0].interchanges.len(), 1);
        assert_eq!(routes[0].stations[0].interchanges[0].route_idx, 1);
        assert!(
            routes[2].stations[0].interchanges.is_empty(),
            "route 'c' shares the stop id but was not named in the override"
        );
    }

    #[test]
    fn errors_when_an_override_matches_zero_pairs() {
        // Finding 2: link_interchanges regressed from Result<(), String> to
        // (), silently dropping validation — `overrides.iter().any(...)`
        // just never matches on a typo'd line key or stop id, and the
        // interchange it was meant to add silently never appears. This PR
        // added two hand-derived overrides (Silom "10" <-> Blue "329", ARL
        // "324" <-> Blue "345") read off a since-reverted debug print;
        // nothing would have caught a transposed digit without this check.
        let mut routes = vec![
            route_with_stations("a", &[("a1", 0.0)]),
            route_with_stations("b", &[("b1", 2000.0)]),
        ];
        let err = link_interchanges(
            &mut routes,
            100.0,
            &[InterchangeOverride {
                a_line: "a".into(),
                a_stop: "typo-d-stop-id".into(),
                b_line: "b".into(),
                b_stop: "b1".into(),
            }],
        )
        .unwrap_err();
        assert!(err.contains("typo-d-stop-id"), "got: {err}");
        assert!(
            routes[1].stations[0].interchanges.is_empty(),
            "an unmatched override must not silently link anything either"
        );
    }

    #[test]
    fn one_bad_override_among_several_is_still_caught() {
        // A real, matching override elsewhere in the list must not mask an
        // unrelated broken one — every override is checked independently.
        let mut routes = vec![
            route_with_stations("a", &[("a1", 0.0)]),
            route_with_stations("b", &[("b1", 2000.0)]),
            route_with_stations("c", &[("c1", 5000.0)]),
        ];
        let err = link_interchanges(
            &mut routes,
            100.0,
            &[
                InterchangeOverride {
                    a_line: "a".into(),
                    a_stop: "a1".into(),
                    b_line: "b".into(),
                    b_stop: "b1".into(),
                },
                InterchangeOverride {
                    a_line: "a".into(),
                    a_stop: "a1".into(),
                    b_line: "c".into(),
                    b_stop: "wrong-id".into(),
                },
            ],
        )
        .unwrap_err();
        assert!(err.contains("wrong-id"), "got: {err}");
    }

    // --- resolve_pattern_arcs (task 5: MRT Blue self-approaching track) ----

    #[test]
    fn resolve_pattern_arcs_is_a_no_op_for_an_ordinary_single_candidate_stop() {
        // The overwhelmingly common case: every stop has exactly one
        // candidate (snap_candidates found no self-approach), so the
        // per-pattern solver must reproduce the plain global-nearest answer
        // for all nine pre-Blue lines exactly.
        let lists = vec![vec![(0.0, 3.0)], vec![(500.0, 8.0)], vec![(1200.0, 2.0)]];
        let (arcs, fallback) = resolve_pattern_arcs(&lists);
        assert_eq!(arcs, vec![0.0, 500.0, 1200.0]);
        assert_eq!(fallback, vec![false, false, false]);
    }

    /// The real bug's shape, minimized but with enough surrounding
    /// unambiguous stops to give the direction vote real signal (a real
    /// Blue pattern is 8-30 stops long with at most one or two ambiguous
    /// self-approach joints — a bare 2-stop pattern would be genuinely
    /// underdetermined and isn't representative).
    fn tao_poon_to_tha_phra_pattern() -> Vec<Vec<(f64, f64)>> {
        vec![
            vec![(1_000.0, 2.0)],  // Tao Poon
            vec![(5_000.0, 2.0)],  // Bang Pho
            vec![(15_000.0, 2.0)], // ...several ordinary stops...
            vec![(30_000.0, 2.0)], // Fai Chai
            vec![(45_000.0, 5.0)], // Charan 13: one pass only
            vec![(7_400.0, 38.9), (46_900.0, 45.0)], // Tha Phra: two passes
        ]
    }

    #[test]
    fn resolve_pattern_arcs_picks_the_second_pass_when_the_pattern_needs_it() {
        let (arcs, fallback) = resolve_pattern_arcs(&tao_poon_to_tha_phra_pattern());
        assert_eq!(
            arcs,
            vec![1_000.0, 5_000.0, 15_000.0, 30_000.0, 45_000.0, 46_900.0],
            "must pick Tha Phra's second pass (46,900), consistent with the whole pattern's \
             increasing trend, not its nearer-by-itself but topologically wrong first pass (7,400)"
        );
        assert_eq!(fallback, vec![false; 6]);
    }

    #[test]
    fn resolve_pattern_arcs_handles_a_reverse_direction_pattern() {
        // The opposite-direction trip: same stops, schedule order reversed.
        // A naive ">=" monotonic rule would wrongly reject this whole
        // pattern; the solver must recognise the descending trend and pick
        // Tha Phra's second pass again — now as the FIRST stop, which is
        // exactly the boundary case a naive "no prior constraint" walk gets
        // wrong (it would just grab Tha Phra's globally-nearest candidate,
        // 7,400, ignoring where the rest of the pattern needs it to be).
        let mut lists = tao_poon_to_tha_phra_pattern();
        lists.reverse();
        let (arcs, fallback) = resolve_pattern_arcs(&lists);
        assert_eq!(
            arcs,
            vec![46_900.0, 45_000.0, 30_000.0, 15_000.0, 5_000.0, 1_000.0],
            "reverse-direction pattern: Tha Phra's second pass again, now first in the list"
        );
        assert_eq!(fallback, vec![false; 6]);
    }

    #[test]
    fn resolve_pattern_arcs_tolerates_a_flat_step_with_a_tied_vote() {
        // Two consecutive stops at the exact same arc position (a real,
        // if unusual, possibility — e.g. two very close-together stops that
        // snap to the same resampled point) contribute a zero (tied) vote;
        // the pattern must still resolve cleanly with no fallback.
        let lists = vec![vec![(100.0, 1.0)], vec![(100.0, 1.0)], vec![(200.0, 1.0)]];
        let (arcs, fallback) = resolve_pattern_arcs(&lists);
        assert_eq!(arcs, vec![100.0, 100.0, 200.0]);
        assert_eq!(fallback, vec![false, false, false], "single-candidate stops never fall back");
    }

    #[test]
    fn resolve_pattern_arcs_resolves_an_ambiguous_first_stop_from_later_context() {
        // Finding 1a: the prior greedy walk anchored the FIRST stop to its
        // own plain-nearest candidate unconditionally (no "prev" to check
        // against), with no visibility into the rest of the pattern. Tha
        // Phra is the Bang Wa/Lak Song branch terminus, so a real pattern
        // can begin (not just end) there — exactly the case the earlier
        // "second pass" test doesn't cover, since a reverse-direction
        // pattern gets internally reversed and Tha Phra lands last anyway.
        //
        // Tha Phra's nearer-by-raw-distance candidate (46,900, dist 3.0) is
        // the WRONG one here: the very next real stop (15,000) sits between
        // Tha Phra's two candidate arcs, so starting from 46,900 breaks
        // monotonicity immediately (a forced fallback), while starting from
        // the farther-but-correct candidate (7,400, dist 40.0) keeps the
        // whole pattern clean. A greedy first pick can't see this; the DP,
        // which judges stop 0 by its effect on the WHOLE pattern, must.
        let lists = vec![
            vec![(46_900.0, 3.0), (7_400.0, 40.0)], // Tha Phra: ambiguous, and FIRST
            vec![(15_000.0, 2.0)],
            vec![(30_000.0, 2.0)],
            vec![(45_000.0, 2.0)],
        ];
        let (arcs, fallback) = resolve_pattern_arcs(&lists);
        assert_eq!(
            arcs,
            vec![7_400.0, 15_000.0, 30_000.0, 45_000.0],
            "must pick Tha Phra's farther-but-topologically-correct candidate (7,400), not its \
             merely-nearest-by-distance one (46,900), because only 7,400 keeps stop 15,000 \
             (which the greedy walk couldn't see coming) monotonic"
        );
        assert_eq!(fallback, vec![false; 4], "the correct resolution needs no fallback at all");
    }

    #[test]
    fn resolve_pattern_arcs_falls_back_and_reports_when_no_candidate_fits() {
        // Stop 1's only candidate (50) is LESS than stop 0's (100), breaking
        // the forward trend the other 2 stops establish (100 -> 300 votes
        // forward). No candidate keeps it consistent — must not invent a
        // position: fall back to stop 1's nearest candidate overall (its
        // only one) and flag it, then resume the constrained walk normally.
        let lists = vec![vec![(100.0, 1.0)], vec![(50.0, 1.0)], vec![(300.0, 1.0)]];
        let (arcs, fallback) = resolve_pattern_arcs(&lists);
        assert_eq!(arcs, vec![100.0, 50.0, 300.0], "fallback still uses the real (only) position");
        assert_eq!(fallback, vec![false, true, false], "only the inconsistent stop is flagged");
    }

    #[test]
    fn gradient_gate_rejects_a_portal_wall() {
        let proj = EnuProjector::new(ORIGIN_LNG_LAT.0, ORIGIN_LNG_LAT.1);
        // Two points ~13.4 m apart horizontally with a 14.5 m altitude step —
        // the real red-dark idx 103 defect, a 108% grade.
        let track = vec![
            TrackVertex(100.5000000, 13.8000000, -3.0, "underground".into()),
            TrackVertex(100.5001235, 13.8000000, 11.5, "elevated".into()),
        ];
        let err = check_track_gradient("red-dark", &track, &proj)
            .expect_err("a 108% grade must fail the gate");
        assert!(err.contains("red-dark"), "error names the line: {err}");
        assert!(err.contains("gradient"), "error names the failure: {err}");
    }

    #[test]
    fn gradient_gate_accepts_a_ruling_grade_ramp() {
        let proj = EnuProjector::new(ORIGIN_LNG_LAT.0, ORIGIN_LNG_LAT.1);
        // ~107 m apart horizontally, 4.0 m rise = exactly the 4% ruling gradient
        // limitTrackGradient converges to (blue idx 347 is exactly 4.00% today).
        let track = vec![
            TrackVertex(100.5000000, 13.8000000, -18.0, "underground".into()),
            TrackVertex(100.5009880, 13.8000000, -14.0, "underground".into()),
        ];
        assert!(check_track_gradient("blue", &track, &proj).is_ok());
    }

    #[test]
    fn gradient_gate_rejects_a_vertical_step_at_a_duplicated_point() {
        let proj = EnuProjector::new(ORIGIN_LNG_LAT.0, ORIGIN_LNG_LAT.1);
        // Coincident lng/lat with a real altitude jump: an infinite gradient that
        // a naive delta/distance would divide by zero on.
        let track = vec![
            TrackVertex(100.5000000, 13.8000000, -18.0, "underground".into()),
            TrackVertex(100.5000000, 13.8000000, 12.0, "elevated".into()),
        ];
        assert!(check_track_gradient("blue", &track, &proj).is_err());
    }

    #[test]
    fn gradient_gate_tolerates_a_duplicated_point_at_the_same_altitude() {
        let proj = EnuProjector::new(ORIGIN_LNG_LAT.0, ORIGIN_LNG_LAT.1);
        let track = vec![
            TrackVertex(100.5000000, 13.8000000, 12.0, "elevated".into()),
            TrackVertex(100.5000000, 13.8000000, 12.0, "elevated".into()),
        ];
        assert!(check_track_gradient("blue", &track, &proj).is_ok());
    }

    #[test]
    fn snap_band_flags_an_undisclosed_stop_over_the_warn_limit() {
        let exempt: Vec<String> = vec![];
        let verdict = classify_snap("blue", "99999", 88.0, &exempt, &[]);
        assert!(
            matches!(verdict, SnapVerdict::Undisclosed { .. }),
            "an 88 m snap with no exemption must be undisclosed, got {verdict:?}"
        );
    }

    #[test]
    fn snap_band_accepts_a_disclosed_stop_over_the_warn_limit() {
        let exempt = vec!["13627".to_string()];
        let verdict = classify_snap("blue", "13627", 109.5, &exempt, &[]);
        assert!(
            matches!(verdict, SnapVerdict::Disclosed { .. }),
            "a disclosed 109.5 m snap must pass, got {verdict:?}"
        );
    }

    #[test]
    fn snap_band_ignores_a_stop_under_the_warn_limit() {
        let exempt: Vec<String> = vec![];
        assert!(matches!(classify_snap("blue", "1", 12.0, &exempt, &[]), SnapVerdict::Ok));
    }

    #[test]
    fn snap_band_defers_to_the_existing_large_snap_allowance_above_the_hard_limit() {
        // Pink stop 359: 554.7 m, already disclosed via allowLargeSnapStopIds.
        // It must not ALSO need a snapWarnExemptStopIds entry — one disclosure
        // mechanism per stop, or every future exemption has to be written twice.
        let allow = vec!["359".to_string()];
        let verdict = classify_snap("pink", "359", 554.7, &[], &allow);
        assert!(
            matches!(verdict, SnapVerdict::Disclosed { .. }),
            "allowLargeSnapStopIds must also satisfy the warn band, got {verdict:?}"
        );
    }
}
