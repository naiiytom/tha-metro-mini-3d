//! Binary cache model — `network.tmb` (TMB = Thai Metro Binary).
//!
//! Serialized with bincode 2 (serde integration, standard config). Exact
//! field order matters; see docs/ENGINE_CONTRACT.md §2.

use serde::{Deserialize, Serialize};

pub const TMB_MAGIC: u32 = 0x544D_4231; // "TMB1"
pub const TMB_VERSION: u16 = 3;

#[derive(Debug, Serialize, Deserialize)]
pub struct CacheDoc {
    pub magic: u32,           // TMB_MAGIC
    pub version: u16,         // 2
    pub feed_version: String, // "20260729"
    pub generated_unix: i64,
    pub origin_lng: f64, // MUST equal frontend ORIGIN_LNG_LAT
    pub origin_lat: f64, // (100.5332, 13.7456)
    pub routes: Vec<RouteDoc>, // order == src/data/network.json `lines` order
    pub services: Vec<ServiceDoc>,
    pub patterns: Vec<PatternDoc>,
    pub runs: Vec<RunDoc>, // sorted by (service_idx, start_sec)
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RouteDoc {
    pub gtfs_route_id: String, // "1" / "2" / "" for a track-only (unsimulated) line
    /// Registry key from tools/lines.config.mjs; ties a cache route back to
    /// its network.json geometry and its UI colour.
    pub line_key: String,
    /// false = track geometry only (no patterns, no runs, no trains).
    pub simulated: bool,
    pub name_en: String,
    pub color_rgb: u32, // always parse_hex_color(line.color) from the registry, e.g. 0x7CB342 (Sukhumvit)
    /// Track polyline in LOCAL ENU METERS relative to (origin_lng, origin_lat),
    /// Catmull-Rom resampled at ~10 m spacing by the preprocessor.
    /// x=east, y=north, z=up(+15.0). Same frame as src/map/coordinates.ts.
    pub track_xyz: Vec<[f32; 3]>,
    /// Cumulative arc length in meters, same length as track_xyz, [0]=0.
    pub track_arc_m: Vec<f32>,
    pub stations: Vec<StationDoc>, // ordered by arc_m ascending
}

#[derive(Debug, Serialize, Deserialize)]
pub struct StationDoc {
    pub gtfs_stop_id: String,
    pub code: String, // e.g. "N8"
    pub name_en: String,
    pub name_th: String,
    /// Station snapped ONTO the track polyline: arc-length position in
    /// meters, using the STATION-LEVEL globally-nearest candidate (picked
    /// once per stop_id per route, independent of any specific pattern —
    /// the preprocessor's per-stop snapping loop in main.rs). This is
    /// authoritative for station-level queries: interchange linking
    /// (`link_interchanges` -> `position_at_arc`), station markers, and the
    /// station board's own position.
    ///
    /// For the rare stop where a route's alignment passes near itself twice
    /// (MRT Blue at Tha Phra — see `PatternStop::arc_m` below), this can
    /// legitimately DIFFER from the arc a specific pattern resolves for the
    /// same stop_id: both values are real, on-polyline positions (never
    /// invented), just two different basins of the same self-approaching
    /// alignment. As of MVP 6 this divergence is confirmed harmless for
    /// interchange linking (Tha Phra is Blue<->Blue only, not a cross-route
    /// interchange) — but this is a documented boundary, not a proof it can
    /// never matter: a future self-approaching line whose ambiguous stop IS
    /// an interchange would need this actually reconciled, not just noted.
    pub arc_m: f32,
    /// Other routes' stations within walking distance. Symmetric, never
    /// self-referential, computed by the preprocessor (contract §2).
    pub interchanges: Vec<InterchangeRef>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct InterchangeRef {
    /// u16, not u8: `rj as u8` in link_interchanges was an unchecked
    /// narrowing that would silently wrap past 256 routes.
    pub route_idx: u16,
    pub station_idx: u16,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ServiceDoc {
    pub gtfs_service_id: String,
    pub weekday_mask: u8, // bit0=Monday … bit6=Sunday
    pub start_date: u32,  // YYYYMMDD inclusive
    pub end_date: u32,    // YYYYMMDD inclusive
    pub added_dates: Vec<u32>,   // calendar_dates exception_type 1
    pub removed_dates: Vec<u32>, // calendar_dates exception_type 2
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PatternDoc {
    pub gtfs_trip_id: String,
    pub route_idx: u8, // index into routes
    pub direction: u8, // GTFS direction_id
    pub headsign_en: String,
    /// Per stop of this pattern, in sequence order:
    pub stops: Vec<PatternStop>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PatternStop {
    pub station_idx: u16, // index into routes[route_idx].stations
    pub arrival_s: u32,   // offset from run start (first stop = 0)
    pub departure_s: u32, // >= arrival_s (dwell)
    /// This pattern's RESOLVED arc-length position for this stop
    /// (denormalized for speed) — chosen per-pattern by the preprocessor's
    /// monotonic DP solver (main.rs's `resolve_pattern_arcs_full`) from the
    /// stop's full candidate list. NOT guaranteed equal to the station's own
    /// `StationDoc::arc_m` (see that field's doc comment for why, and when
    /// the two are allowed to diverge). This field is authoritative for THIS
    /// run's kinematics — interpolation walks a pattern's own arc sequence,
    /// never the station doc's. They agree for every ordinary
    /// (non-self-approaching) stop, which today is all but one (Tha Phra).
    pub arc_m: f32,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RunDoc {
    pub pattern_idx: u16,
    pub service_idx: u8,
    /// Seconds after service-day midnight (< 86400; arrivals may exceed 86400).
    pub start_sec: u32,
}
