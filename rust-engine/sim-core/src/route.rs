//! Schedule-aware A -> B route search (roadmap item 8).
//!
//! Kept out of `query.rs` (already ~580 lines) but the same class of call:
//! UI-rate, on submit, never on the frame path (§3A.2).
//!
//! The algorithm is RAPTOR — round-based, round *k* = the best arrival using
//! at most *k* boardings. It fits this data model unusually well:
//!
//!   * **Each `PatternDoc` already IS a RAPTOR "route."** The preprocessor's
//!     own route/pattern split has already done RAPTOR's usual preprocessing.
//!   * **Runs within a pattern are FIFO by construction**, not merely assumed
//!     of the feed: every `RunDoc` of a pattern shares the same `PatternStop`
//!     offsets, so ordering by `start_sec` is a total order that holds
//!     identically at every stop of that pattern — exactly what the
//!     earliest-trip binary search needs.
//!   * **Earliest arrival tied-broken by fewest transfers is its native
//!     output** — the round index IS the boarding count, so the requested
//!     criterion falls out with no multi-criteria labels.
//!
//! Frequency expansion is a non-issue here: `expand_frequency` runs only in
//! the preprocessor, so `sim-core` sees nothing but concrete
//! `RunDoc { pattern_idx, service_idx, start_sec }`.
//!
//! Nothing in this module is baked into the cache — `TMB_VERSION` stays at 3.
//! Walking distances are re-derived from `position_at_arc`, the same call
//! `link_interchanges()` already used to create the links being walked.

use crate::model::CacheDoc;
use crate::world::position_at_arc;

/// Precomputed adjacency for `plan()`. Built once in `SimWorld::from_doc`,
/// held as a field beside the existing `pattern_dur` — same precedent, same
/// cost class (one pass over the runs plus one small sort per pattern,
/// invisible next to decoding the ~370 KB cache).
pub struct RouteIndex {
    /// Flat stop id = `stop_offsets[route_idx] + station_idx`.
    stop_offsets: Vec<usize>,
    /// Flat stop -> route index. Stored explicitly rather than reverse-derived
    /// from `stop_offsets`: a route with ZERO stations (a track-only line)
    /// shares its offset with the next route, so a binary search over offsets
    /// would attribute that route's first stop to the empty one.
    stop_route: Vec<u8>,
    /// Flat stop -> station index within its route.
    stop_station: Vec<u16>,
    /// Flat stop -> the `(pattern_idx, position)` pairs that call there. A
    /// pattern that calls one stop twice appears twice, once per position.
    patterns_at_stop: Vec<Vec<(u16, u16)>>,
    /// pattern_idx -> its run indices, sorted by `start_sec`.
    runs_by_pattern: Vec<Vec<u32>>,
    /// Flat stop -> `(flat stop, walking distance in meters)`.
    transfers: Vec<Vec<(usize, f64)>>,
}

impl RouteIndex {
    pub fn build(doc: &CacheDoc) -> RouteIndex {
        let mut stop_offsets = Vec::with_capacity(doc.routes.len());
        let mut stop_route = Vec::new();
        let mut stop_station = Vec::new();
        for (ri, route) in doc.routes.iter().enumerate() {
            stop_offsets.push(stop_route.len());
            for si in 0..route.stations.len() {
                stop_route.push(ri as u8);
                stop_station.push(si as u16);
            }
        }
        let stop_count = stop_route.len();

        let mut patterns_at_stop = vec![Vec::new(); stop_count];
        for (pi, pattern) in doc.patterns.iter().enumerate() {
            let base = stop_offsets[pattern.route_idx as usize];
            for (pos, stop) in pattern.stops.iter().enumerate() {
                patterns_at_stop[base + stop.station_idx as usize].push((pi as u16, pos as u16));
            }
        }

        let mut runs_by_pattern = vec![Vec::new(); doc.patterns.len()];
        for (ri, run) in doc.runs.iter().enumerate() {
            runs_by_pattern[run.pattern_idx as usize].push(ri as u32);
        }
        // `CacheDoc.runs` is sorted by (service_idx, start_sec), NOT by
        // start_sec within a pattern — a stable per-pattern re-sort is what
        // makes the earliest-trip binary search legal.
        for runs in &mut runs_by_pattern {
            runs.sort_by_key(|&r| doc.runs[r as usize].start_sec);
        }

        let mut transfers = vec![Vec::new(); stop_count];
        for (ri, route) in doc.routes.iter().enumerate() {
            for (si, station) in route.stations.iter().enumerate() {
                let from = stop_offsets[ri] + si;
                let [ax, ay, _] = position_at_arc(route, station.arc_m);
                for ix in &station.interchanges {
                    let Some(other) = doc.routes.get(ix.route_idx as usize) else {
                        continue;
                    };
                    let Some(other_station) = other.stations.get(ix.station_idx as usize) else {
                        continue;
                    };
                    let [bx, by, _] = position_at_arc(other, other_station.arc_m);
                    let to = stop_offsets[ix.route_idx as usize] + ix.station_idx as usize;
                    let walk_m = ((bx - ax) as f64).hypot((by - ay) as f64);
                    transfers[from].push((to, walk_m));
                }
            }
        }

        RouteIndex {
            stop_offsets,
            stop_route,
            stop_station,
            patterns_at_stop,
            runs_by_pattern,
            transfers,
        }
    }

    /// Flat stop id, or `None` for an out-of-range route/station index — the
    /// only source of `plan()`'s structurally-invalid-request `None`.
    pub fn stop_id(&self, doc: &CacheDoc, route_idx: u8, station_idx: u16) -> Option<usize> {
        let route = doc.routes.get(route_idx as usize)?;
        if (station_idx as usize) >= route.stations.len() {
            return None;
        }
        Some(self.stop_offsets[route_idx as usize] + station_idx as usize)
    }

    /// Inverse of `stop_id`, for building leg output.
    pub fn unpack(&self, stop: usize) -> (u8, u16) {
        (self.stop_route[stop], self.stop_station[stop])
    }

    /// Infallible flat id for an index pair already known to be in range
    /// (every `PatternStop::station_idx`, validated by `SimWorld::from_doc`).
    #[allow(dead_code)]
    pub(crate) fn stop_of(&self, route_idx: usize, station_idx: usize) -> usize {
        self.stop_offsets[route_idx] + station_idx
    }

    pub fn stop_count(&self) -> usize {
        self.stop_route.len()
    }

    pub fn patterns_at(&self, stop: usize) -> &[(u16, u16)] {
        &self.patterns_at_stop[stop]
    }

    pub fn runs_of(&self, pattern_idx: u16) -> &[u32] {
        &self.runs_by_pattern[pattern_idx as usize]
    }

    pub fn transfers_at(&self, stop: usize) -> &[(usize, f64)] {
        &self.transfers[stop]
    }
}

#[cfg(test)]
pub(crate) mod tests_support {
    use crate::model::*;

    /// Two routes plus one interchange — the smallest fixture that exercises
    /// every RAPTOR mechanism this feature needs.
    ///
    /// Route 0 "Line A": A0 @0 m, A1 @1000 m, A2 @2000 m, track 0..2000 m along +x.
    /// Route 1 "Line B": B0 @0 m, B1 @1000 m, track 2100..3100 m along +x.
    /// A2 <-> B0 are linked as an interchange, 100 m apart in the ENU frame.
    ///
    /// Pattern 0 (route 0): A0(arr 0, dep 30) -> A1(300, 330) -> A2(600, 600).
    ///   NOTE A1's PatternStop::arc_m is deliberately 5000.0 while its
    ///   StationDoc::arc_m is 1000.0 — the MRT-Blue-at-Tha-Phra divergence,
    ///   pinned so a leg's arcs can be proven to come from the pattern.
    /// Pattern 1 (route 1): B0(0, 30) -> B1(300, 300).
    ///
    /// Runs: pattern 0 at 36000 and 36600 (the frequency-expanded shape: one
    /// pattern, several starts a headway apart); pattern 1 at 36600 and 37200
    /// (the concrete-departure shape). Both reach sim-core as plain RunDocs —
    /// `expand_frequency` never runs at runtime — so one plan spanning both is
    /// a genuine mixed-shape journey. Plus pattern 0 at 500 (00:08:20, the
    /// near-midnight case) and a SUNDAY-ONLY pattern 1 run at 36800.
    pub(crate) fn routing_doc() -> CacheDoc {
        let route_a = RouteDoc {
            gtfs_route_id: "A".into(),
            line_key: "line-a".into(),
            simulated: true,
            name_en: "Line A".into(),
            color_rgb: 0x65B724,
            track_xyz: vec![[0.0, 0.0, 15.0], [2000.0, 0.0, 15.0]],
            track_arc_m: vec![0.0, 2000.0],
            stations: vec![
                station("a0", "A0", 0.0, vec![]),
                station("a1", "A1", 1000.0, vec![]),
                station(
                    "a2",
                    "A2",
                    2000.0,
                    vec![InterchangeRef {
                        route_idx: 1,
                        station_idx: 0,
                    }],
                ),
            ],
        };
        let route_b = RouteDoc {
            gtfs_route_id: "B".into(),
            line_key: "line-b".into(),
            simulated: true,
            name_en: "Line B".into(),
            color_rgb: 0x1964B7,
            track_xyz: vec![[2100.0, 0.0, 15.0], [3100.0, 0.0, 15.0]],
            track_arc_m: vec![0.0, 1000.0],
            stations: vec![
                station(
                    "b0",
                    "B0",
                    0.0,
                    vec![InterchangeRef {
                        route_idx: 0,
                        station_idx: 2,
                    }],
                ),
                station("b1", "B1", 1000.0, vec![]),
            ],
        };
        let pat_a = PatternDoc {
            gtfs_trip_id: "pa".into(),
            route_idx: 0,
            direction: 0,
            headsign_en: "A2".into(),
            stops: vec![
                pstop(0, 0, 30, 0.0),
                pstop(1, 300, 330, 5000.0),
                pstop(2, 600, 600, 2000.0),
            ],
        };
        let pat_b = PatternDoc {
            gtfs_trip_id: "pb".into(),
            route_idx: 1,
            direction: 0,
            headsign_en: "B1".into(),
            stops: vec![pstop(0, 0, 30, 0.0), pstop(1, 300, 300, 1000.0)],
        };
        CacheDoc {
            magic: TMB_MAGIC,
            version: TMB_VERSION,
            feed_version: "test".into(),
            generated_unix: 0,
            origin_lng: 100.5332,
            origin_lat: 13.7456,
            routes: vec![route_a, route_b],
            services: vec![all_days(), sunday_only()],
            patterns: vec![pat_a, pat_b],
            runs: vec![
                run(0, 0, 36_000),
                run(0, 0, 36_600),
                run(1, 0, 36_600),
                run(1, 0, 37_200),
                run(0, 0, 500),
                run(1, 1, 36_800),
            ],
        }
    }

    /// One pattern that calls the SAME stop twice (A0 -> A1 -> A0 -> A2). No
    /// such pattern exists in the current registry (verified) — this guards
    /// the index-by-(pattern, position) choice pre-emptively, so a future
    /// looping pattern can never collapse into a single boardable position.
    pub(crate) fn doc_with_repeated_stop() -> CacheDoc {
        let mut doc = routing_doc();
        doc.patterns.push(PatternDoc {
            gtfs_trip_id: "loop".into(),
            route_idx: 0,
            direction: 0,
            headsign_en: "A2 via A1".into(),
            stops: vec![
                pstop(0, 0, 30, 0.0),
                pstop(1, 300, 330, 1000.0),
                pstop(0, 600, 630, 0.0),
                pstop(2, 900, 900, 2000.0),
            ],
        });
        doc.runs.push(run(2, 0, 40_000));
        doc
    }

    pub(crate) fn station(
        id: &str,
        name: &str,
        arc_m: f32,
        interchanges: Vec<InterchangeRef>,
    ) -> StationDoc {
        StationDoc {
            gtfs_stop_id: id.into(),
            code: String::new(),
            name_en: name.into(),
            name_th: String::new(),
            arc_m,
            interchanges,
        }
    }

    pub(crate) fn pstop(
        station_idx: u16,
        arrival_s: u32,
        departure_s: u32,
        arc_m: f32,
    ) -> PatternStop {
        PatternStop {
            station_idx,
            arrival_s,
            departure_s,
            arc_m,
        }
    }

    pub(crate) fn run(pattern_idx: u16, service_idx: u8, start_sec: u32) -> RunDoc {
        RunDoc {
            pattern_idx,
            service_idx,
            start_sec,
        }
    }

    pub(crate) fn all_days() -> ServiceDoc {
        ServiceDoc {
            gtfs_service_id: "all".into(),
            weekday_mask: 0b0111_1111,
            start_date: 20_200_101,
            end_date: 20_301_231,
            added_dates: vec![],
            removed_dates: vec![],
        }
    }

    pub(crate) fn sunday_only() -> ServiceDoc {
        ServiceDoc {
            gtfs_service_id: "sun".into(),
            weekday_mask: 0b0100_0000, // bit6 = Sunday
            start_date: 20_200_101,
            end_date: 20_301_231,
            added_dates: vec![],
            removed_dates: vec![],
        }
    }
}

#[cfg(test)]
mod index_tests {
    use super::RouteIndex;
    use super::tests_support::{doc_with_repeated_stop, routing_doc};

    #[test]
    fn flat_stop_ids_round_trip_and_reject_bad_indices() {
        let doc = routing_doc();
        let idx = RouteIndex::build(&doc);
        assert_eq!(idx.stop_count(), 5); // 3 on Line A + 2 on Line B
        for (route_idx, station_idx) in [(0u8, 0u16), (0, 2), (1, 0), (1, 1)] {
            let flat = idx
                .stop_id(&doc, route_idx, station_idx)
                .expect("real stop");
            assert_eq!(idx.unpack(flat), (route_idx, station_idx));
        }
        assert!(idx.stop_id(&doc, 9, 0).is_none(), "bad route index");
        assert!(idx.stop_id(&doc, 0, 99).is_none(), "bad station index");
    }

    #[test]
    fn every_pattern_that_calls_a_stop_is_indexed_by_position() {
        let doc = routing_doc();
        let idx = RouteIndex::build(&doc);
        let a1 = idx.stop_id(&doc, 0, 1).unwrap();
        assert_eq!(idx.patterns_at(a1), &[(0u16, 1u16)]);
        let b0 = idx.stop_id(&doc, 1, 0).unwrap();
        assert_eq!(idx.patterns_at(b0), &[(1u16, 0u16)]);
    }

    #[test]
    fn a_pattern_calling_one_stop_twice_is_indexed_twice() {
        // No registry pattern does this today; the index must not silently
        // collapse the second call, or a future loop pattern becomes
        // unboardable at its own second visit.
        let doc = doc_with_repeated_stop();
        let idx = RouteIndex::build(&doc);
        let a0 = idx.stop_id(&doc, 0, 0).unwrap();
        let at = idx.patterns_at(a0);
        assert!(at.contains(&(2, 0)), "first call indexed: {at:?}");
        assert!(at.contains(&(2, 2)), "second call indexed: {at:?}");
    }

    #[test]
    fn runs_are_resorted_by_start_sec_within_each_pattern() {
        // CacheDoc.runs is sorted by (service_idx, start_sec) — NOT by
        // start_sec within a pattern. RAPTOR's earliest-trip binary search
        // needs a total order by departure, which only holds after this
        // per-pattern re-sort.
        let doc = routing_doc();
        let idx = RouteIndex::build(&doc);
        let starts: Vec<u32> = idx
            .runs_of(0)
            .iter()
            .map(|&r| doc.runs[r as usize].start_sec)
            .collect();
        assert_eq!(starts, vec![500, 36_000, 36_600]);
        let starts: Vec<u32> = idx
            .runs_of(1)
            .iter()
            .map(|&r| doc.runs[r as usize].start_sec)
            .collect();
        assert_eq!(starts, vec![36_600, 36_800, 37_200]);
    }

    #[test]
    fn transfer_adjacency_is_symmetric_and_carries_a_real_walk_distance() {
        let doc = routing_doc();
        let idx = RouteIndex::build(&doc);
        let a2 = idx.stop_id(&doc, 0, 2).unwrap();
        let b0 = idx.stop_id(&doc, 1, 0).unwrap();
        let fwd = idx.transfers_at(a2);
        assert_eq!(fwd.len(), 1);
        assert_eq!(fwd[0].0, b0);
        // A2 sits at (2000, 0); B0 at (2100, 0) — re-derived from
        // position_at_arc, the SAME call link_interchanges() used to make the
        // link, so nothing new is baked into the cache.
        assert!((fwd[0].1 - 100.0).abs() < 1e-3, "walk_m = {}", fwd[0].1);
        let back = idx.transfers_at(b0);
        assert_eq!(back.len(), 1);
        assert_eq!(back[0].0, a2);
        assert!((back[0].1 - 100.0).abs() < 1e-3);
        // A stop with no interchange has no adjacency at all.
        assert!(
            idx.transfers_at(idx.stop_id(&doc, 0, 0).unwrap())
                .is_empty()
        );
    }

    #[test]
    fn a_route_with_zero_stations_never_captures_a_flat_stop_id() {
        // orange / purple-ext are track-only: zero stations, so they must be
        // structurally absent from the routing graph. An offset-based reverse
        // lookup would have mis-attributed the next route's first stop to
        // them, which is why stop -> (route, station) is stored explicitly.
        let mut doc = routing_doc();
        let mut empty = crate::model::RouteDoc {
            gtfs_route_id: String::new(),
            line_key: "orange".into(),
            simulated: false,
            name_en: "Orange".into(),
            color_rgb: 0xF57C00,
            track_xyz: vec![[0.0, 0.0, 15.0], [1000.0, 0.0, 15.0]],
            track_arc_m: vec![0.0, 1000.0],
            stations: Vec::new(),
        };
        std::mem::swap(&mut doc.routes[0], &mut empty);
        doc.routes.push(empty);
        // Rebuild pattern route indices to match the swap.
        doc.patterns[0].route_idx = 2;
        let idx = RouteIndex::build(&doc);
        assert!(
            idx.stop_id(&doc, 0, 0).is_none(),
            "track-only route has no stops"
        );
        let b0 = idx.stop_id(&doc, 1, 0).unwrap();
        assert_eq!(idx.unpack(b0), (1, 0));
    }
}
