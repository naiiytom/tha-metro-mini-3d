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
mod runtimes;
mod spline;
mod synthetic;

use std::collections::{HashMap, HashSet};
use std::io::Write as _;
use std::path::{Path, PathBuf};
use std::process::ExitCode;

use serde::Deserialize;
use sim_core::SimWorld;
use sim_core::calendar::expand_frequency;
#[cfg(test)]
use sim_core::calendar::service_active_on;
use sim_core::geo::{EnuProjector, ORIGIN_LNG_LAT};
use sim_core::model::*;

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
    Disclosed {
        snap_m: f64,
    },
    /// Over SNAP_WARN_M with no disclosure — fatal.
    Undisclosed {
        snap_m: f64,
    },
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
    let disclosed =
        warn_exempt.iter().any(|s| s == stop_id) || allow_large.iter().any(|s| s == stop_id);
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
    /// GTFS stop_ids that identify which of a SHARED `gtfs_route_id`'s trips
    /// belong to this line. Empty = this line is the route's default claimant
    /// (the ordinary case: it takes every trip). Non-empty = it takes exactly
    /// the trips serving one of these stops, and some other line is the
    /// default. See `TripRouter` for the full contract.
    ///
    /// Needed for the MRT Pink spur (issue #15): the Namtang feed files the
    /// Muang Thong Thani spur's 4 shuttle trips under the SAME route_id
    /// "2436" as the 30-station trunk, so the two lines are separated by
    /// which trips serve the spur's own stops (16936/16937), not by route id.
    #[serde(default)]
    claim_gtfs_stop_ids: Vec<String>,
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
    /// Present only for an operational line that publishes no timetable at
    /// all (the Suvarnabhumi APM). Mutually exclusive with `gtfs_route_id`.
    /// See the `synthetic` module for why this exists and how it is disclosed.
    #[serde(default)]
    synthetic_schedule: Option<synthetic::SyntheticSchedule>,
    /// Present when this line's feed rows carry no usable transit times and
    /// must be estimated from a sibling line's calibration. Only MRT Pink is
    /// in this position — see `runtimes.rs`. Its presence is what the UI
    /// discloses; it is NOT a speed, only a pointer to the basis line whose
    /// own real rows the speed is derived from.
    #[serde(default)]
    estimated_run_times: Option<EstimatedRunTimes>,
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct EstimatedRunTimes {
    basis_line: String,
}

/// One track vertex from network.json: [lng, lat, altitude_m, structure].
/// The structure tag is a rendering concern (src/map/structure.ts); the
/// preprocessor needs only the altitude, but must tolerate the 4th element.
// Field 3 is tolerated so serde accepts 4-element arrays; never read outside tests.
#[derive(Deserialize)]
#[allow(dead_code)]
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

/// One registry line's claim on a GTFS route, as seen by `TripRouter`.
#[derive(Debug)]
struct LineClaim {
    line_idx: usize,
    line_key: String,
    /// Empty = this line is the route's DEFAULT claimant (takes every trip no
    /// other line claims). Non-empty = it takes exactly the trips serving one
    /// of these stop ids.
    claimed_stop_ids: HashSet<String>,
}

/// Assigns every GTFS trip to exactly one registry line.
///
/// A line normally owns a whole `route_id`, and for nine of the ten simulated
/// lines it still does. But the Namtang feed bundles physically separate
/// branches into one route: MRT Pink's `route_id` "2436" carries both the
/// 30-station trunk AND the Muang Thong Thani spur ("IMPACT Link"), whose
/// stations sit ~1.2 km off the trunk alignment. Separating those is a
/// per-TRIP decision, not a per-route one, so route identity can no longer be
/// a plain `route_id -> line` map.
///
/// Contract, per `route_id`:
///   - at most one line may omit `claimGtfsStopIds` — the DEFAULT claimant
///   - every other line sharing that id must declare a non-empty claim set
///   - a trip goes to the line whose claim set it serves, else to the default
///
/// Every ambiguity is a hard error rather than a silent pick. That discipline
/// is inherited from the duplicate-`route_id` check this replaces, and the
/// reason for it is unchanged: a mis-assigned trip stamps the wrong
/// `route_idx`, which desyncs track, colour, station table and vehicle-buffer
/// lane 6 all at once. `assertRegistryValid()` enforces the same contract, but
/// it only runs inside `fetch-network.mjs` — the preprocessor is routinely run
/// against a committed `network.json` with no re-fetch, so it must re-check.
#[derive(Debug)]
struct TripRouter {
    by_route: HashMap<String, Vec<LineClaim>>,
}

impl TripRouter {
    /// `lines` is (line_key, gtfs_route_id, claim_gtfs_stop_ids) in registry order.
    fn build(lines: &[(String, Option<String>, Vec<String>)]) -> Result<Self, String> {
        let mut by_route: HashMap<String, Vec<LineClaim>> = HashMap::new();
        for (line_idx, (line_key, route_id, claimed)) in lines.iter().enumerate() {
            let Some(id) = route_id else { continue };
            by_route.entry(id.clone()).or_default().push(LineClaim {
                line_idx,
                line_key: line_key.clone(),
                claimed_stop_ids: claimed.iter().cloned().collect(),
            });
        }

        // Sorted, not raw HashMap order: with two bad routes, whichever error
        // surfaced first would otherwise vary per process (HashMap's
        // RandomState is seeded per run). Same class of nondeterminism as the
        // snap_warnings ordering bug PR #14 review caught.
        let mut route_ids: Vec<&String> = by_route.keys().collect();
        route_ids.sort_unstable();
        for route_id in route_ids {
            let claims = &by_route[route_id];
            let defaults: Vec<&str> = claims
                .iter()
                .filter(|c| c.claimed_stop_ids.is_empty())
                .map(|c| c.line_key.as_str())
                .collect();
            if defaults.len() > 1 {
                return Err(format!(
                    "duplicate gtfsRouteId '{route_id}': lines {} all claim it with no \
                     claimGtfsStopIds. At most one line per route may be the default \
                     claimant; the others must declare which trips they take.",
                    defaults.join(", ")
                ));
            }
            // Two claim sets sharing a stop id would make a trip serving that
            // stop ambiguous at resolve time. Reject it here, where the message
            // can name both lines, rather than at the first trip that hits it.
            for (i, a) in claims.iter().enumerate() {
                for b in claims.iter().skip(i + 1) {
                    let mut shared: Vec<&str> = a
                        .claimed_stop_ids
                        .intersection(&b.claimed_stop_ids)
                        .map(String::as_str)
                        .collect();
                    if !shared.is_empty() {
                        shared.sort_unstable();
                        return Err(format!(
                            "gtfsRouteId '{route_id}': lines '{}' and '{}' both claim stop(s) {}",
                            a.line_key,
                            b.line_key,
                            shared.join(", ")
                        ));
                    }
                }
            }
        }
        Ok(Self { by_route })
    }

    /// Resolve one trip to its registry line index.
    fn resolve<'a>(
        &self,
        route_id: &str,
        trip_id: &str,
        stop_ids: impl Iterator<Item = &'a str>,
    ) -> Result<usize, String> {
        let claims = self
            .by_route
            .get(route_id)
            .ok_or_else(|| format!("trip {trip_id}: no registry line claims route {route_id}"))?;
        let served: HashSet<&str> = stop_ids.collect();

        let mut matched: Vec<&LineClaim> = claims
            .iter()
            .filter(|c| {
                !c.claimed_stop_ids.is_empty()
                    && c.claimed_stop_ids
                        .iter()
                        .any(|s| served.contains(s.as_str()))
            })
            .collect();
        if matched.len() > 1 {
            matched.sort_by(|a, b| a.line_idx.cmp(&b.line_idx));
            return Err(format!(
                "trip {trip_id} (route {route_id}) is claimed by more than one line: {} — \
                 their claimGtfsStopIds must not both match one trip",
                matched
                    .iter()
                    .map(|c| c.line_key.as_str())
                    .collect::<Vec<_>>()
                    .join(", ")
            ));
        }
        if let Some(c) = matched.first() {
            return Ok(c.line_idx);
        }
        claims
            .iter()
            .find(|c| c.claimed_stop_ids.is_empty())
            .map(|c| c.line_idx)
            .ok_or_else(|| {
                format!(
                    "trip {trip_id} (route {route_id}) matches no line's claimGtfsStopIds and \
                     that route has no default claimant — every trip must land somewhere"
                )
            })
    }
}

/// Sorts `network.report.json`'s `snap_warnings` by (line, gtfs_stop_id) so
/// the committed file is reproducible across regenerations, independent of
/// HashSet iteration order (see the call site's own comment).
fn sort_snap_warnings(warnings: &mut [serde_json::Value]) {
    let key = |v: &serde_json::Value| {
        (
            v["line"].as_str().unwrap_or("").to_string(),
            v["gtfs_stop_id"].as_str().unwrap_or("").to_string(),
        )
    };
    warnings.sort_by_key(|a| key(a));
}

/// The known MRT Blue day-qualifier headsign suffixes (English, post
/// gtfs::split_th_en), the single weekday bit each one means (per
/// ServiceDoc's own bit0=Monday..bit6=Sunday convention), and whether that
/// variant keeps the shared service's `added_dates` (calendar_dates
/// exception_type=1 rows). The real feed's added_dates on this shared
/// service are almost entirely Thai public holidays that fall on a WEEKDAY
/// (19 of 21, verified against the feed) — `service_active_on()` checks
/// added_dates before weekday_mask, so cloning them into a split that has no
/// real claim to them would make it active on every one of those holidays
/// too, reproducing the exact reported bug on holiday dates instead of every
/// weekend. Only the headsign that says "and Public Holiday" has a stated
/// claim to them.
const DAY_QUALIFIERS: [(&str, u8, bool); 2] = [
    (" (Saturday)", 1 << 5, false),
    (" (Sunday and Public Holiday)", 1 << 6, true),
];

/// The Namtang feed has no Saturday-only or Sunday-only calendar anywhere
/// (verified against the whole feed, 2026-08) — every service is weekday,
/// all-7-days, or one combined Saturday+Sunday block. MRT Blue nonetheless
/// publishes genuinely different Saturday vs. Sunday trip variants (distinct
/// headsigns, sometimes distinct destinations — see CLAUDE.md's "MRT Blue
/// weekend calendar split" note), all sharing that one combined calendar, so
/// by strict GTFS semantics both variants are "scheduled" on every weekend
/// day. This synthesizes a single-day ServiceDoc from the trip's own
/// headsign when — and only when — its underlying service is exactly that
/// ambiguous Saturday+Sunday combination; every other trip (including one
/// with a day-qualified headsign on an unrelated calendar — the feed has two
/// of those, real trips 5272/7865, most likely a separate upstream labelling
/// slip) is left untouched rather than guessed at.
fn day_qualified_service_split(headsign_en: &str, original: &ServiceDoc) -> Option<ServiceDoc> {
    const WEEKEND_MASK: u8 = (1 << 5) | (1 << 6); // Saturday | Sunday
    if original.weekday_mask & WEEKEND_MASK != WEEKEND_MASK {
        return None;
    }
    let (_, bit, keep_added_dates) = DAY_QUALIFIERS
        .iter()
        .find(|(suffix, _, _)| headsign_en.ends_with(suffix))?;
    Some(ServiceDoc {
        gtfs_service_id: format!("{}+{bit:#04x}", original.gtfs_service_id),
        weekday_mask: *bit,
        start_date: original.start_date,
        end_date: original.end_date,
        added_dates: if *keep_added_dates {
            original.added_dates.clone()
        } else {
            Vec::new()
        },
        removed_dates: original.removed_dates.clone(),
    })
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

/// Resolve one line's `estimatedRunTimes` basis, if it declares one.
///
/// Pure and independent of iteration order: `patterns_snapshot` must be a
/// snapshot taken BEFORE any in-place repair mutation, so a basis line that
/// itself needed repair is always read in its pre-repair state regardless of
/// where it falls in registry order relative to `line_idx` (see the repair
/// loop's own comment on `patterns_snapshot` in `run()` for the failure mode
/// this avoids).
///
/// Also hard-errors if the resolved basis line itself carries
/// `estimatedRunTimes` — calibrating an estimate from an estimate compounds
/// it. `assertRegistryValid` (`tools/lines.config.mjs`) enforces the same
/// contract, but only on a re-fetch; the preprocessor is routinely run
/// against a committed, hand-edited `network.json` that never re-invokes it,
/// so this is re-checked Rust-side — same precedent as `TripRouter`'s and
/// `synthetic.rs`'s own duplicated contract checks.
fn resolve_repair_basis(
    lines: &[LineGeometry],
    patterns_snapshot: &[PatternDoc],
    line_idx: usize,
) -> Result<Option<runtimes::BasisProfile>, String> {
    let line = &lines[line_idx];
    let cfg = match &line.estimated_run_times {
        None => return Ok(None),
        Some(cfg) => cfg,
    };
    let basis_idx = lines
        .iter()
        .position(|l| l.key == cfg.basis_line)
        .ok_or(format!(
            "line '{}': estimatedRunTimes.basisLine '{}' is not a registry line",
            line.key, cfg.basis_line
        ))?;
    if basis_idx == line_idx {
        return Err(format!(
            "line '{}': estimatedRunTimes.basisLine points at itself",
            line.key
        ));
    }
    if let Some(basis_cfg) = &lines[basis_idx].estimated_run_times {
        return Err(format!(
            "line '{}': estimatedRunTimes.basisLine '{}' itself has estimatedRunTimes \
             (basisLine '{}') — a basis line must calibrate from its own real rows, not \
             another line's estimate",
            line.key, cfg.basis_line, basis_cfg.basis_line
        ));
    }
    let basis_patterns: Vec<&PatternDoc> = patterns_snapshot
        .iter()
        .filter(|p| p.route_idx as usize == basis_idx)
        .collect();
    let profile = runtimes::basis_profile(&basis_patterns)
        .map_err(|e| format!("line '{}': {e}", line.key))?;
    Ok(Some(profile))
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

    // Deduped: two lines may legitimately share one route_id now (the Pink
    // trunk and its IMPACT Link spur both sit on "2436"), and the reads below
    // — routes.txt membership, read_trips — must see that id once, not twice.
    let simulated_route_ids: Vec<&str> = {
        let mut seen = HashSet::new();
        track_file
            .lines
            .iter()
            .filter_map(|l| l.gtfs_route_id.as_deref())
            .filter(|id| seen.insert(*id))
            .collect()
    };
    if simulated_route_ids.is_empty() {
        return Err("network.json has no simulated lines (every gtfsRouteId is null)".into());
    }

    let feed_version = gtfs::read_feed_version(gtfs_dir)?;
    let route_ids_found = gtfs::read_routes(gtfs_dir, &simulated_route_ids)?;
    for id in &simulated_route_ids {
        if !route_ids_found.contains(*id) {
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

    // ---- Trip -> registry line ---------------------------------------------
    // Resolved up front, BEFORE the exclude filter below, because exclusion is
    // a per-LINE rule and a shared route_id no longer identifies the line on
    // its own (see TripRouter).
    let trip_router = TripRouter::build(
        &track_file
            .lines
            .iter()
            .map(|l| {
                (
                    l.key.clone(),
                    l.gtfs_route_id.clone(),
                    l.claim_gtfs_stop_ids.clone(),
                )
            })
            .collect::<Vec<_>>(),
    )?;
    let mut route_idx_by_trip: HashMap<String, usize> = HashMap::new();
    for t in &trips {
        let idx = trip_router.resolve(
            &t.route_id,
            &t.trip_id,
            stop_times
                .get(&t.trip_id)
                .into_iter()
                .flatten()
                .map(|r| r.stop_id.as_str()),
        )?;
        route_idx_by_trip.insert(t.trip_id.clone(), idx);
    }

    // Drop any trip (i.e. its whole pattern) that touches ITS OWN line's
    // exclude_gtfs_stop_ids — see the field's doc comment on LineGeometry.
    // stop_times/frequencies/calendar above were loaded from the full trip
    // set and may now carry a few unused entries; harmless, since everything
    // downstream is driven by (the now-filtered) `trips`, not those maps.
    if track_file
        .lines
        .iter()
        .any(|l| !l.exclude_gtfs_stop_ids.is_empty())
    {
        let before = trips.len();
        trips.retain(|t| {
            let line = &track_file.lines[route_idx_by_trip[&t.trip_id]];
            if line.exclude_gtfs_stop_ids.is_empty() {
                return true;
            }
            let touches_excluded = stop_times.get(&t.trip_id).is_some_and(|rows| {
                rows.iter()
                    .any(|r| line.exclude_gtfs_stop_ids.contains(&r.stop_id))
            });
            if touches_excluded {
                eprintln!(
                    "note: dropping trip {} (line {}) — serves an excluded stop",
                    t.trip_id, line.key
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

    let all_stop_ids: HashSet<String> = stop_times
        .values()
        .flat_map(|rows| rows.iter().map(|r| r.stop_id.clone()))
        .collect();
    let stop_rows = gtfs::read_stops(gtfs_dir, &all_stop_ids)?;
    for id in &all_stop_ids {
        if !stop_rows.contains_key(id) {
            return Err(format!(
                "unknown stop id '{id}' (in stop_times but not stops.txt)"
            ));
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

    for (line_idx, line) in track_file.lines.iter().enumerate() {
        // Re-checked in Rust, not trusted from assertRegistryValid, for the
        // same reason TripRouter re-checks its own contract: that validator
        // only runs inside fetch-network.mjs, and the preprocessor is designed
        // to consume a committed network.json with no re-fetch. A line with
        // BOTH a gtfs_route_id and a synthetic_schedule would get GTFS-expanded
        // patterns AND synthesized ones on the same track — two overlapping
        // fleets on one route, with nothing downstream detecting it.
        if line.gtfs_route_id.is_some() && line.synthetic_schedule.is_some() {
            return Err(format!(
                "line '{}' has both a gtfsRouteId and a syntheticSchedule — these are \
                 mutually exclusive; a synthetic schedule exists only for a line with no \
                 feed route, and running both would put two fleets on one track",
                line.key
            ));
        }
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
                // Stop ids served by THIS LINE's patterns. Filtered by the
                // resolved trip -> line assignment, not by route_id: when two
                // lines share a route id (Pink trunk + IMPACT Link spur), a
                // route_id filter would pull the other line's stops in here
                // and try to snap them onto this line's track.
                let route_stop_ids: HashSet<&String> = trips
                    .iter()
                    .filter(|t| route_idx_by_trip[&t.trip_id] == line_idx)
                    .flat_map(|t| {
                        stop_times
                            .get(&t.trip_id)
                            .map(|rows| rows.iter().map(|s| &s.stop_id))
                            .into_iter()
                            .flatten()
                    })
                    .collect();
                if route_stop_ids.is_empty() {
                    return Err(format!(
                        "line '{}' (route {route_id}): no stop_times rows — no trip resolved \
                         to this line. Check its claimGtfsStopIds against the feed.",
                        line.key
                    ));
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
            // A synthetic-schedule line has no gtfs_route_id but IS simulated:
            // it is the first route where `simulated` is true while
            // `gtfs_route_id` is empty (see the `synthetic` module).
            simulated: line.gtfs_route_id.is_some() || line.synthetic_schedule.is_some(),
            name_en,
            color_rgb,
            track_xyz: poly
                .iter()
                .map(|p| [p[0] as f32, p[1] as f32, p[2] as f32])
                .collect(),
            track_arc_m: arcs.iter().map(|&a| a as f32).collect(),
            stations: snapped.into_iter().map(|(_, _, s)| s).collect(),
        });
        station_maps.push(map);
        candidate_maps.push(stop_candidates);
    }

    link_interchanges(
        &mut routes,
        INTERCHANGE_RADIUS_M,
        &track_file.interchange_overrides,
    )?;

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
    let mut patterns = Vec::new();
    let mut pattern_idx_by_trip: HashMap<String, u16> = HashMap::new();
    // Total per-stop fallbacks (finding 1d): the resolver found no candidate
    // consistent with the running arc and fell back to the plain-nearest
    // position instead. Previously stderr-only, so a future regression here
    // was invisible in committed data; now gateable via --report.
    let mut pattern_arc_fallback_count: usize = 0;
    for trip in &trips {
        let route_idx = route_idx_by_trip[&trip.trip_id];
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
            let station_idx = *station_maps[route_idx].get(&row.stop_id).ok_or(format!(
                "trip {}: unknown stop id {}",
                trip.trip_id, row.stop_id
            ))?;
            station_idxs.push(station_idx);
            candidate_lists.push(candidate_maps[route_idx].get(&row.stop_id).cloned().ok_or(
                format!(
                    "trip {}: stop {} has no snap candidates recorded",
                    trip.trip_id, row.stop_id
                ),
            )?);
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
            // Looked up on the RESOLVED line, not on the route id: two lines
            // sharing a route id have independent allow-lists, and keying this
            // by route_id would silently apply one line's exception to the other.
            let large_snap_allowed = track_file.lines[route_idx]
                .allow_large_snap_stop_ids
                .contains(&row.stop_id);
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

    // ---- Repair degenerate ("dwell and teleport") stop times ---------------
    // Must run AFTER the loop above (it needs every pattern's resolved arc_m)
    // and BEFORE run expansion. See runtimes.rs for the two tiers.
    //
    // `patterns_snapshot` is taken ONCE, before this loop mutates anything,
    // and every basis-line lookup reads from it rather than from the live
    // `patterns`. Without this, `is_degenerate`/`basis_profile` can't tell a
    // genuinely real leg from one an EARLIER iteration of this same loop
    // already repaired (a repaired leg has transit > 0 too) — so a basis
    // line that itself needed repair and sorts before its dependent in
    // registry order would silently calibrate speed/dwell from
    // recovered-or-invented numbers instead of real rows. Snapshotting makes
    // the result independent of registry order, which is the actual
    // invariant wanted, not "basis lines happen to sort later." A full clone
    // is affordable here — on the order of 40 patterns of at most 47 stops,
    // computed once at build time.
    let patterns_snapshot: Vec<PatternDoc> = patterns.clone();
    let line_keys: Vec<String> = track_file.lines.iter().map(|l| l.key.clone()).collect();
    let mut run_time_repairs = serde_json::Map::new();
    for (line_idx, line) in track_file.lines.iter().enumerate() {
        let of_this_route: Vec<&PatternDoc> = patterns_snapshot
            .iter()
            .filter(|p| p.route_idx as usize == line_idx)
            .collect();
        if !of_this_route.iter().any(|p| runtimes::is_degenerate(p)) {
            continue;
        }
        let siblings = runtimes::sibling_times(&of_this_route);
        let own_dwell = runtimes::sibling_dwell(&of_this_route);

        let basis = resolve_repair_basis(&track_file.lines, &patterns_snapshot, line_idx)?;

        let mut total = runtimes::RepairOutcome::default();
        for p in patterns
            .iter_mut()
            .filter(|p| p.route_idx as usize == line_idx)
        {
            let out = runtimes::repair_pattern(p, &siblings, own_dwell, basis)
                .map_err(|e| format!("line '{}': {e}", line.key))?;
            total.recovered_legs += out.recovered_legs;
            total.estimated_legs += out.estimated_legs;
        }
        eprintln!(
            "note: line '{}' — repaired zero-transit stop times: {} legs recovered from its \
             own healthy patterns, {} legs ESTIMATED{}",
            line.key,
            total.recovered_legs,
            total.estimated_legs,
            basis
                .map(|b| format!(" at {:.2} m/s / {} s dwell", b.speed_mps, b.dwell_s))
                .unwrap_or_default(),
        );
        run_time_repairs.insert(
            line.key.clone(),
            serde_json::json!({
                "recovered_legs": total.recovered_legs,
                "estimated_legs": total.estimated_legs,
                "basis_line": line.estimated_run_times.as_ref().map(|c| c.basis_line.clone()),
                "basis_speed_mps": basis.map(|b| b.speed_mps),
                "basis_dwell_s": basis.map(|b| b.dwell_s),
            }),
        );
    }

    // ---- Runs (frequency expansion, or one run per scheduled trip) --------
    // (original_service_idx, single-day bit) -> synthetic service_idx, so
    // every trip sharing the same split (e.g. all of MRT Blue's Saturday
    // variants) reuses one ServiceDoc instead of minting a duplicate per trip.
    let mut synthetic_service_idx: HashMap<(u8, u8), u8> = HashMap::new();
    let mut runs = Vec::new();
    for trip in &trips {
        let pattern_idx = pattern_idx_by_trip[&trip.trip_id];
        let mut service_idx = service_idx_by_id[&trip.service_id];
        let headsign_en = &patterns[pattern_idx as usize].headsign_en;
        if let Some(split) =
            day_qualified_service_split(headsign_en, &services[service_idx as usize])
        {
            let key = (service_idx, split.weekday_mask);
            service_idx = *synthetic_service_idx.entry(key).or_insert_with(|| {
                services.push(split);
                (services.len() - 1) as u8
            });
        }
        let first_arrival_s = stop_times[&trip.trip_id]
            .first()
            .map(|r| r.arrival_s)
            .unwrap_or(0);
        runs.extend(runs_for_pattern(
            &trip.trip_id,
            &frequencies,
            first_arrival_s,
            pattern_idx,
            service_idx,
        ));
    }
    // ---- Synthetic runs (operational lines with no published timetable) ----
    // Runs after the GTFS expansion above and after the station tables are
    // final: it reads each route's own arc-sorted station list, never any
    // stop_times rows. See the `synthetic` module for why this exists.
    let synthetic_span = services
        .iter()
        .fold(None::<(u32, u32)>, |acc, s| match acc {
            None => Some((s.start_date, s.end_date)),
            Some((lo, hi)) => Some((lo.min(s.start_date), hi.max(s.end_date))),
        })
        .ok_or("no services to take a synthetic line's date range from")?;
    for (line_idx, line) in track_file.lines.iter().enumerate() {
        let Some(sched) = &line.synthetic_schedule else {
            continue;
        };
        let out = synthetic::synthesize(&line.key, line_idx, &routes[line_idx].stations, sched)?;
        let service_idx = u8::try_from(services.len())
            .map_err(|_| "too many services for RunDoc's u8 service_idx".to_string())?;
        services.push(synthetic::all_days_service(
            &line.key,
            synthetic_span.0,
            synthetic_span.1,
        ));
        let mut added = 0usize;
        for (pattern, starts) in out.patterns.into_iter().zip(out.starts) {
            let pattern_idx = u16::try_from(patterns.len())
                .map_err(|_| "too many patterns for RunDoc's u16 pattern_idx".to_string())?;
            patterns.push(pattern);
            added += starts.len();
            runs.extend(starts.into_iter().map(|start_sec| RunDoc {
                pattern_idx,
                service_idx,
                start_sec,
            }));
        }
        eprintln!(
            "note: line '{}' — ESTIMATED timetable synthesized (no published feed): \
             {added} runs over 2 directions at {} s headway",
            line.key, sched.headway_sec
        );
    }

    // Must run AFTER the synthetic pass above, not just after the GTFS
    // repair loop: a synthetic pattern's legs are appended to `patterns` by
    // that pass, and a future synthetic line whose stations resolve to the
    // same arc (or whose declared speed/runtime yields a sub-second leg)
    // would otherwise ship in network.tmb with the exact defect this gate
    // exists to close, unchecked. Found in code review — the gate call used
    // to sit right after the GTFS repair loop, before this pass ran.
    runtimes::assert_no_zero_transit(&patterns, &line_keys)?;

    if runs.is_empty() {
        return Err("expansion produced zero runs".into());
    }
    runs.sort_by_key(|r| (r.service_idx, r.start_sec, r.pattern_idx));

    for (idx, route) in routes.iter().enumerate() {
        if !route.simulated {
            continue;
        }
        let has_runs = runs
            .iter()
            .any(|r| patterns[r.pattern_idx as usize].route_idx as usize == idx);
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
    std::fs::write(&args.out, &bytes).map_err(|e| format!("write {}: {e}", args.out.display()))?;

    let gzip_bytes = {
        let mut gz = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
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
                    .filter(move |link| {
                        (ri, si) < (link.route_idx as usize, link.station_idx as usize)
                    })
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

    // Deterministic order for a committed data file: the loop above sources
    // stop ids from a HashSet, whose default RandomState is seeded per
    // process, so unsorted output churns this line in `git diff` on every
    // regeneration even when nothing actually changed (found reviewing
    // PR #14 — it was undermining that PR's own "byte-identical" diff claim).
    sort_snap_warnings(&mut snap_warnings);

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
        "run_time_repairs": run_time_repairs,
    });
    let report_str = serde_json::to_string_pretty(&report).unwrap();
    if let Some(path) = &args.report {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir).map_err(|e| format!("mkdir {}: {e}", dir.display()))?;
        }
        std::fs::write(path, &report_str).map_err(|e| format!("write {}: {e}", path.display()))?;
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
            pts.push((
                ri,
                si,
                x,
                y,
                route.line_key.clone(),
                st.gtfs_stop_id.clone(),
            ));
        }
    }

    let r2 = (radius_m * radius_m) as f32;
    let mut links: Vec<(usize, usize, usize, usize)> = Vec::new();
    let mut override_matched = vec![false; overrides.len()];
    for i in 0..pts.len() {
        for j in (i + 1)..pts.len() {
            let (ri, si, xi, yi, li, idi) =
                (pts[i].0, pts[i].1, pts[i].2, pts[i].3, &pts[i].4, &pts[i].5);
            let (rj, sj, xj, yj, lj, idj) =
                (pts[j].0, pts[j].1, pts[j].2, pts[j].3, &pts[j].4, &pts[j].5);
            if ri == rj {
                continue; // same line: adjacent stations are not an interchange
            }
            let near = (xi - xj).powi(2) + (yi - yj).powi(2) <= r2;
            let mut forced = false;
            for (oi, o) in overrides.iter().enumerate() {
                let hit = (o.a_line == *li
                    && o.a_stop == *idi
                    && o.b_line == *lj
                    && o.b_stop == *idj)
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
        routes[ri].stations[si].interchanges.push(InterchangeRef {
            route_idx: rj as u16,
            station_idx: sj as u16,
        });
        routes[rj].stations[sj].interchanges.push(InterchangeRef {
            route_idx: ri as u16,
            station_idx: si as u16,
        });
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
            runs.push(RunDoc {
                pattern_idx,
                service_idx,
                start_sec,
            });
        }
    }
    if !had_freq {
        runs.push(RunDoc {
            pattern_idx,
            service_idx,
            start_sec: first_arrival_s,
        });
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
fn resolve_pattern_arcs_full(
    candidate_lists: &[Vec<(f64, f64)>],
) -> (Vec<f64>, Vec<f64>, Vec<bool>) {
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

    /// (key, route_id, claimed_stop_ids) tuples in the shape TripRouter::build wants.
    fn router_lines(
        spec: &[(&str, Option<&str>, &[&str])],
    ) -> Vec<(String, Option<String>, Vec<String>)> {
        spec.iter()
            .map(|(k, r, c)| {
                (
                    k.to_string(),
                    r.map(str::to_string),
                    c.iter().map(|s| s.to_string()).collect(),
                )
            })
            .collect()
    }

    #[test]
    fn rejects_two_default_claimants_for_one_gtfs_route_id() {
        // The pre-claim behaviour: two lines owning one route id with nothing
        // to tell their trips apart. Used to be silent misrouting (HashMap
        // collect kept the LAST duplicate, stamping every trip on the shared
        // id with the wrong route_idx and rendering it on the wrong track).
        let lines = router_lines(&[("a", Some("1"), &[]), ("b", Some("1"), &[])]);
        let err = TripRouter::build(&lines).unwrap_err();
        assert!(err.contains("duplicate gtfsRouteId '1'"), "got: {err}");
        assert!(err.contains("a") && err.contains("b"), "got: {err}");
    }

    #[test]
    fn accepts_multiple_track_only_lines() {
        // Several lines may legitimately have gtfsRouteId: null (Orange,
        // Purple Phase 2) — null is not a duplicate.
        let lines = router_lines(&[("a", None, &[]), ("b", None, &[]), ("c", Some("1"), &[])]);
        let router = TripRouter::build(&lines).unwrap();
        assert_eq!(router.resolve("1", "t", ["s1"].into_iter()).unwrap(), 2);
    }

    #[test]
    fn two_lines_split_one_gtfs_route_by_claimed_stops() {
        // The real MRT Pink shape (issue #15): trunk is the default claimant,
        // the IMPACT Link spur claims its own two stops. A spur trip also
        // serves the shared junction stop (14630), which must NOT pull it back
        // to the trunk — a claim match wins over the default.
        let lines = router_lines(&[
            ("pink", Some("2436"), &[]),
            ("pink-spur", Some("2436"), &["16936", "16937"]),
        ]);
        let router = TripRouter::build(&lines).unwrap();
        let trunk = router
            .resolve("2436", "trunk-trip", ["14630", "100", "101"].into_iter())
            .unwrap();
        let spur = router
            .resolve("2436", "spur-trip", ["14630", "16936", "16937"].into_iter())
            .unwrap();
        assert_eq!(
            trunk, 0,
            "a trip touching no claimed stop goes to the default"
        );
        assert_eq!(
            spur, 1,
            "a trip touching a claimed stop goes to the claimant"
        );
    }

    #[test]
    fn a_trip_claimed_by_two_lines_is_an_error() {
        // Disjoint claim sets are enforced at build time, so construct the
        // ambiguity the only other way it can arise: two claimants whose sets
        // differ but whose stops are both served by one trip.
        let lines = router_lines(&[
            ("trunk", Some("9"), &[]),
            ("spur-a", Some("9"), &["A"]),
            ("spur-b", Some("9"), &["B"]),
        ]);
        let router = TripRouter::build(&lines).unwrap();
        let err = router
            .resolve("9", "both", ["A", "B"].into_iter())
            .unwrap_err();
        assert!(err.contains("claimed by more than one line"), "got: {err}");
        assert!(
            err.contains("spur-a") && err.contains("spur-b"),
            "got: {err}"
        );
    }

    #[test]
    fn overlapping_claim_sets_are_rejected_at_build_time() {
        let lines = router_lines(&[
            ("trunk", Some("9"), &[]),
            ("spur-a", Some("9"), &["A", "X"]),
            ("spur-b", Some("9"), &["X"]),
        ]);
        let err = TripRouter::build(&lines).unwrap_err();
        assert!(err.contains("both claim stop(s) X"), "got: {err}");
    }

    #[test]
    fn an_unclaimed_trip_with_no_default_claimant_is_an_error() {
        // A route whose every line declares a claim set has nowhere to put a
        // trip matching none of them. Dropping it silently would lose real
        // scheduled service with no signal.
        let lines = router_lines(&[("spur", Some("9"), &["A"])]);
        let router = TripRouter::build(&lines).unwrap();
        let err = router
            .resolve("9", "orphan", ["Z"].into_iter())
            .unwrap_err();
        assert!(err.contains("no default claimant"), "got: {err}");
    }

    #[test]
    fn parse_hex_color_accepts_six_digits_and_rejects_short_forms() {
        assert_eq!(parse_hex_color("#00FF80").unwrap(), 0x00FF80);
        assert_eq!(parse_hex_color("112233").unwrap(), 0x112233);
        assert!(
            parse_hex_color("#FFF").is_err(),
            "3-digit shorthand must not silently parse"
        );
        assert!(parse_hex_color("#GGGGGG").is_err());
        assert!(
            parse_hex_color("#1234567").is_err(),
            "7 digits must not silently truncate"
        );
    }

    #[test]
    fn route_order_follows_network_json_line_order() {
        let file: TrackFile = serde_json::from_str(track_json()).unwrap();
        assert_eq!(file.lines[0].key, "a");
        assert_eq!(file.lines[1].key, "b");
        // The invariant the whole plan rests on: routes[i] is lines[i].
        let ids: Vec<&str> = file
            .lines
            .iter()
            .map(|l| l.gtfs_route_id.as_deref().unwrap())
            .collect();
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
        assert!(
            file.lines.is_empty(),
            "empty networks must be caught by run(), not silently encoded"
        );
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
        assert_eq!(
            runs[0].start_sec, 25_200,
            "07:00 departure keeps its absolute time"
        );
        assert_eq!(runs[0].pattern_idx, 7);
        assert_eq!(runs[0].service_idx, 1);
    }

    #[test]
    fn sort_snap_warnings_orders_by_line_then_stop_id_regardless_of_input_order() {
        let mut warnings = vec![
            serde_json::json!({"gtfs_stop_id": "13627", "line": "blue", "snap_m": 109.5}),
            serde_json::json!({"gtfs_stop_id": "359", "line": "pink", "snap_m": 554.7}),
            serde_json::json!({"gtfs_stop_id": "352", "line": "blue", "snap_m": 61.1}),
        ];
        sort_snap_warnings(&mut warnings);
        let order: Vec<(&str, &str)> = warnings
            .iter()
            .map(|w| {
                (
                    w["line"].as_str().unwrap(),
                    w["gtfs_stop_id"].as_str().unwrap(),
                )
            })
            .collect();
        // Lexicographic string comparison, not numeric: "13627" < "352"
        // (as strings) since '1' < '3'. The point is determinism, not a
        // numerically-sorted stop id.
        assert_eq!(
            order,
            vec![("blue", "13627"), ("blue", "352"), ("pink", "359")]
        );
    }

    fn weekend_service() -> ServiceDoc {
        // Mirrors the real Namtang feed's service_id "2": Saturday+Sunday
        // combined, nothing else — the exact shape that makes MRT Blue's
        // day-qualified headsigns ambiguous (see day_qualified_service_split's
        // own doc comment).
        ServiceDoc {
            gtfs_service_id: "2".into(),
            weekday_mask: 0b0110_0000, // bit5=Saturday, bit6=Sunday
            start_date: 20230101,
            end_date: 20261231,
            added_dates: vec![20260101],
            removed_dates: vec![],
        }
    }

    #[test]
    fn splits_a_saturday_qualified_headsign_off_an_ambiguous_weekend_service() {
        let split = day_qualified_service_split("Tao Poon (Saturday)", &weekend_service())
            .expect("a Saturday-qualified headsign on a Sat+Sun service must split");
        assert_eq!(split.weekday_mask, 0b0010_0000, "Saturday bit only");
        assert_eq!(split.start_date, 20230101);
        assert_eq!(split.end_date, 20261231);
        // NOT carried over: the real feed's added_dates on this shared
        // service are almost entirely Thai public holidays that fall on a
        // WEEKDAY (verified: 19 of 21, e.g. 20260101 is a Thursday).
        // service_active_on() checks added_dates before weekday_mask, so
        // cloning them into the Saturday split would make it active on
        // every one of those weekday holidays too — the exact reported bug,
        // just narrowed to holiday dates instead of every weekend. Only the
        // "(Sunday and Public Holiday)" variant has a real claim to them;
        // any date that's genuinely a Saturday is already covered by
        // weekday_mask, so dropping added_dates here loses nothing.
        assert!(
            split.added_dates.is_empty(),
            "Saturday split must not inherit the shared service's (mostly weekday) holiday exceptions"
        );
    }

    #[test]
    fn splits_a_sunday_qualified_headsign_off_an_ambiguous_weekend_service() {
        let split =
            day_qualified_service_split("Tao Poon (Sunday and Public Holiday)", &weekend_service())
                .expect("a Sunday-qualified headsign on a Sat+Sun service must split");
        assert_eq!(split.weekday_mask, 0b0100_0000, "Sunday bit only");
        assert_eq!(
            split.added_dates,
            vec![20260101],
            "the headsign's own \"and Public Holiday\" names this as the holiday variant — keep the exceptions"
        );
    }

    #[test]
    fn a_weekday_holiday_exception_activates_only_the_sunday_split_not_the_saturday_one() {
        // Regression test for the bug found in PR #14 review: exercises the
        // split through the real resolver (sim_core::calendar::service_active_on),
        // not just field inspection, on 20260101 — a Thursday that's one of
        // the shared service's real added_dates.
        let original = weekend_service();
        let sat_split = day_qualified_service_split("Tao Poon (Saturday)", &original).unwrap();
        let sun_split =
            day_qualified_service_split("Tao Poon (Sunday and Public Holiday)", &original).unwrap();
        assert!(
            !service_active_on(&sat_split, 20260101),
            "Saturday split must stay inactive on a Thursday holiday it has no claim to"
        );
        assert!(
            service_active_on(&sun_split, 20260101),
            "Sunday split must stay active on its own stated public-holiday exception"
        );
    }

    #[test]
    fn leaves_an_unqualified_headsign_on_the_shared_weekend_service() {
        assert!(
            day_qualified_service_split("Tao Poon", &weekend_service()).is_none(),
            "no day qualifier — nothing to disambiguate"
        );
    }

    #[test]
    fn ignores_a_day_qualified_headsign_whose_service_is_not_the_ambiguous_weekend_combo() {
        // The real feed's trips 5272/7865: a headsign literally saying
        // "(Saturday)" but assigned to a plain Mon-Fri service. Rewriting it
        // would be guessing intent the data doesn't support — leave it be.
        let weekday_only = ServiceDoc {
            gtfs_service_id: "1".into(),
            weekday_mask: 0b0001_1111, // Mon-Fri only
            start_date: 20230101,
            end_date: 20261231,
            added_dates: vec![],
            removed_dates: vec![],
        };
        assert!(day_qualified_service_split("MRT Tha Phra (Saturday)", &weekday_only).is_none());
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
        assert_eq!(
            routes[0].stations[1].interchanges.len(),
            1,
            "a2 <-> b1 is 50 m"
        );
        assert_eq!(routes[0].stations[1].interchanges[0].route_idx, 1);
        assert!(
            routes[1].stations[0]
                .interchanges
                .iter()
                .any(|i| i.route_idx == 0),
            "the link must be symmetric"
        );
        assert!(
            routes[0].stations[0].interchanges.is_empty(),
            "a1 is 1050 m away"
        );
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
            vec![(1_000.0, 2.0)],                    // Tao Poon
            vec![(5_000.0, 2.0)],                    // Bang Pho
            vec![(15_000.0, 2.0)],                   // ...several ordinary stops...
            vec![(30_000.0, 2.0)],                   // Fai Chai
            vec![(45_000.0, 5.0)],                   // Charan 13: one pass only
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
        assert_eq!(
            fallback,
            vec![false, false, false],
            "single-candidate stops never fall back"
        );
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
        assert_eq!(
            fallback,
            vec![false; 4],
            "the correct resolution needs no fallback at all"
        );
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
        assert_eq!(
            arcs,
            vec![100.0, 50.0, 300.0],
            "fallback still uses the real (only) position"
        );
        assert_eq!(
            fallback,
            vec![false, true, false],
            "only the inconsistent stop is flagged"
        );
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
        assert!(matches!(
            classify_snap("blue", "1", 12.0, &exempt, &[]),
            SnapVerdict::Ok
        ));
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

    #[test]
    fn estimated_run_times_deserialises_from_a_network_json_line() {
        // Double-hash delimiter: the JSON contains `"#CD4692"` (a `"`
        // immediately followed by `#`), which would close a single-hash
        // r#"..."# raw string early — same gotcha as track_json() above.
        let json = r##"{
            "key": "pink",
            "name": "MRT Pink Line",
            "color": "#CD4692",
            "gtfsRouteId": "2436",
            "track": [],
            "stations": [],
            "estimatedRunTimes": { "basisLine": "yellow" }
        }"##;
        let line: LineGeometry = serde_json::from_str(json).unwrap();
        assert_eq!(
            line.estimated_run_times.map(|e| e.basis_line),
            Some("yellow".to_string())
        );
    }

    #[test]
    fn a_line_without_estimated_run_times_deserialises_to_none() {
        let json = r##"{
            "key": "blue",
            "name": "MRT Blue Line",
            "color": "#1964B7",
            "gtfsRouteId": "3",
            "track": [],
            "stations": []
        }"##;
        let line: LineGeometry = serde_json::from_str(json).unwrap();
        assert!(line.estimated_run_times.is_none());
    }

    /// A minimal `LineGeometry` naming a basis line (or not), for
    /// `resolve_repair_basis` tests — reuses the deserialization path rather
    /// than a struct literal, since `EstimatedRunTimes` has no public
    /// constructor and this exercises the real parsing route besides.
    fn line_with_basis(key: &str, basis_line: Option<&str>) -> LineGeometry {
        let basis_json = basis_line
            .map(|b| format!(r#","estimatedRunTimes":{{"basisLine":"{b}"}}"#))
            .unwrap_or_default();
        let json = format!(
            r##"{{"key":"{key}","name":"{key}","color":"#111111","gtfsRouteId":"1",
                 "track":[],"stations":[]{basis_json}}}"##
        );
        serde_json::from_str(&json).unwrap()
    }

    fn basis_stop(station_idx: u16, arrival_s: u32, departure_s: u32, arc_m: f32) -> PatternStop {
        PatternStop {
            station_idx,
            arrival_s,
            departure_s,
            arc_m,
        }
    }

    /// A healthy (non-degenerate) two-stop pattern on `route_idx`: 1000 m in
    /// 100 s, real times throughout — enough for `basis_profile` to
    /// calibrate from.
    fn healthy_pattern_doc(route_idx: u8) -> PatternDoc {
        PatternDoc {
            gtfs_trip_id: format!("t{route_idx}"),
            route_idx,
            direction: 0,
            headsign_en: "T".to_string(),
            stops: vec![basis_stop(0, 0, 0, 0.0), basis_stop(1, 100, 100, 1000.0)],
        }
    }

    #[test]
    fn a_basis_line_that_itself_has_estimated_run_times_is_rejected_naming_both_lines() {
        // pink -> yellow -> gold: yellow is a legal-looking basis for pink,
        // but yellow itself is only estimated (from gold), so it must not
        // be usable as anyone else's basis.
        let lines = vec![
            line_with_basis("pink", Some("yellow")),
            line_with_basis("yellow", Some("gold")),
            line_with_basis("gold", None),
        ];
        // Content is irrelevant: the check fires before any pattern is read.
        let err = resolve_repair_basis(&lines, &[], 0).unwrap_err();
        assert!(err.contains("pink"), "must name the dependent line: {err}");
        assert!(err.contains("yellow"), "must name the basis line: {err}");
    }

    #[test]
    fn a_basis_line_with_no_estimated_run_times_of_its_own_is_accepted() {
        let lines = vec![
            line_with_basis("pink", Some("yellow")),
            line_with_basis("yellow", None),
        ];
        let snapshot = vec![healthy_pattern_doc(1)];
        let basis = resolve_repair_basis(&lines, &snapshot, 0).unwrap();
        assert!(basis.is_some());
    }

    #[test]
    fn resolve_repair_basis_is_unaffected_by_a_later_mutation_of_a_separate_live_copy() {
        // Simulates the actual failure mode the snapshot defends against:
        // a caller (the repair loop in `run()`) takes one snapshot up
        // front, then mutates its own separate live `patterns` vec as it
        // repairs each line in turn. resolve_repair_basis must only ever
        // see what was in the snapshot at the moment it was taken, not
        // whatever the live vec looks like by the time it's called for a
        // later line.
        let lines = vec![
            line_with_basis("pink", Some("yellow")),
            line_with_basis("yellow", None),
        ];
        let snapshot = vec![healthy_pattern_doc(1)];
        let before = resolve_repair_basis(&lines, &snapshot, 0).unwrap().unwrap();

        // A caller's own live copy, repaired (mutated) AFTER the snapshot
        // was taken — resolve_repair_basis is never given this one.
        let mut mutated_after_snapshot = snapshot.clone();
        mutated_after_snapshot[0].stops[1].arrival_s = 999_999;

        let after = resolve_repair_basis(&lines, &snapshot, 0).unwrap().unwrap();
        assert_eq!(
            before.speed_mps, after.speed_mps,
            "resolving from the same untouched snapshot twice must agree"
        );
        assert_eq!(before.dwell_s, after.dwell_s);

        // Not vacuous: resolving from the mutated copy really would have
        // produced a different number, so the equality above is meaningful.
        let from_mutated = resolve_repair_basis(&lines, &mutated_after_snapshot, 0)
            .unwrap()
            .unwrap();
        assert_ne!(before.speed_mps, from_mutated.speed_mps);
    }
}
