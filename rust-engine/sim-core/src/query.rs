//! Schedule queries for the MVP 4 UI (inspector, station board, follow-cam).
//!
//! The stride-8 vehicle buffer deliberately carries pose only — everything a
//! human wants to read (headsign, origin/destination, next-station ETA, a
//! station's upcoming departures) lives in the cache and is derived here.
//!
//! These are UI-rate calls (on selection, or ~1 Hz), NOT frame-path calls, so
//! returning owned structs / JSON across the wasm boundary is fine. Nothing in
//! this module may be called per frame — see §3A.2 on boundary-crossing cost.

use serde::Serialize;

use crate::calendar::{Frame, previous_date, service_active_on, service_day_frames};
use crate::model::{InterchangeRef, PatternDoc, RouteDoc};
use crate::world::{STATE_DWELL, STATE_TRANSIT, SimWorld};

/// One scheduled call, in seconds since the run's own service-day midnight.
#[derive(Debug, Clone, Serialize)]
pub struct StopCall {
    pub station_idx: u16,
    pub code: String,
    pub name_en: String,
    pub name_th: String,
    /// Absolute seconds after service-day midnight (may exceed 86400).
    pub arrival_sec: u32,
    pub departure_sec: u32,
}

/// Everything the train inspector shows for one active run.
#[derive(Debug, Clone, Serialize)]
pub struct RunDetail {
    pub run_idx: u32,
    pub route_idx: u8,
    pub route_name: String,
    pub color_rgb: u32,
    pub headsign: String,
    pub direction: u8,
    pub origin: String,
    pub destination: String,
    /// 0 = dwelling, 1 = in transit — matches vehicle lane 4.
    pub state: u8,
    /// Set while dwelling.
    pub at_station: Option<String>,
    pub prev_station: Option<String>,
    pub next_station: Option<String>,
    /// Seconds until the next scheduled arrival (0 if already there).
    pub next_arrival_in_s: Option<i64>,
    /// Index into `stops` of the next call; None once terminated.
    pub next_stop_ordinal: Option<usize>,
    /// Index into `stops` of the call the train is sitting at; None in transit.
    /// Emitted explicitly so the UI never has to re-derive "which stop is this
    /// train at" from `next_stop_ordinal - 1`.
    pub current_stop_ordinal: Option<usize>,
    pub stops: Vec<StopCall>,
}

/// One upcoming departure on a station board.
#[derive(Debug, Clone, Serialize)]
pub struct BoardEntry {
    pub run_idx: u32,
    pub route_idx: u8,
    pub headsign: String,
    pub destination: String,
    pub direction: u8,
    /// Seconds after the *queried* day's midnight (spillover runs go negative-
    /// adjusted into this frame, so it is directly comparable to sec_of_day).
    pub arrival_sec: i64,
    pub departure_sec: i64,
    /// Seconds from the query time until arrival; may be slightly negative for
    /// a train currently dwelling.
    pub in_s: i64,
}

/// Upcoming departures at one station.
#[derive(Debug, Clone, Serialize)]
pub struct StationBoard {
    pub route_idx: u8,
    pub station_idx: u16,
    pub code: String,
    pub name_en: String,
    pub name_th: String,
    pub entries: Vec<BoardEntry>,
}

/// A station with its position in the local ENU meter frame, so the frontend
/// can hit-test clicks against the same indices the board query expects.
#[derive(Debug, Clone, Serialize)]
pub struct StationInfo {
    pub route_idx: u8,
    pub station_idx: u16,
    pub code: String,
    pub name_en: String,
    pub name_th: String,
    pub arc_m: f32,
    pub x: f32,
    pub y: f32,
    pub z: f32,
    pub interchanges: Vec<InterchangeRef>,
}

/// The two frames `evaluate()` uses — today, then the previous service day.
///
/// `run_detail` deliberately keeps this two-frame rule rather than the
/// three-frame one `station_board` moved to: it must match `evaluate()`'s
/// liveness EXACTLY, so a selected train that vanishes from the vehicle
/// buffer also stops returning detail. A D+1 frame would resurrect a run
/// `evaluate()` no longer emits, and the inspector would show a train the
/// map does not.
fn live_frames(
    date_yyyymmdd: u32,
    sec_of_day: f64,
    active_today: bool,
    active_prev: bool,
) -> [Option<Frame>; 2] {
    let all = service_day_frames(date_yyyymmdd, sec_of_day);
    [
        active_today.then_some(all[1]),
        active_prev.then_some(all[0]),
    ]
}

impl SimWorld {
    /// Service-activity flags for one run's calendar, for both frames.
    fn run_frames(
        &self,
        run_idx: usize,
        date_yyyymmdd: u32,
        sec_of_day: f64,
    ) -> [Option<Frame>; 2] {
        let run = &self.doc().runs[run_idx];
        let svc = &self.doc().services[run.service_idx as usize];
        live_frames(
            date_yyyymmdd,
            sec_of_day,
            service_active_on(svc, date_yyyymmdd),
            service_active_on(svc, previous_date(date_yyyymmdd)),
        )
    }

    fn stop_calls(&self, pattern: &PatternDoc, route: &RouteDoc, start_sec: u32) -> Vec<StopCall> {
        pattern
            .stops
            .iter()
            .map(|s| {
                let st = &route.stations[s.station_idx as usize];
                StopCall {
                    station_idx: s.station_idx,
                    code: st.code.clone(),
                    name_en: st.name_en.clone(),
                    name_th: st.name_th.clone(),
                    arrival_sec: start_sec + s.arrival_s,
                    departure_sec: start_sec + s.departure_s,
                }
            })
            .collect()
    }

    /// Detail for one run at a local Bangkok date/time. `None` when the run is
    /// not active then (never started, already finished, service inactive) —
    /// the same liveness rule `evaluate` applies, so a selected train that
    /// vanishes from the buffer also returns None here.
    pub fn run_detail(
        &self,
        run_idx: u32,
        date_yyyymmdd: u32,
        sec_of_day: f64,
    ) -> Option<RunDetail> {
        let idx = run_idx as usize;
        let doc = self.doc();
        let run = doc.runs.get(idx)?;
        let pattern = &doc.patterns[run.pattern_idx as usize];
        let route = &doc.routes[pattern.route_idx as usize];
        let last = pattern.stops.last()?;
        let dur = last.arrival_s as f64;

        // First frame in which the run is live.
        let frame = self
            .run_frames(idx, date_yyyymmdd, sec_of_day)
            .into_iter()
            .flatten()
            .find(|f| {
                let t = f.t_abs - run.start_sec as f64;
                t >= 0.0 && t <= dur
            })?;
        let t = frame.t_abs - run.start_sec as f64;

        let stops = self.stop_calls(pattern, route, run.start_sec);
        let name_of = |i: usize| stops[i].name_en.clone();

        // Last stop whose arrival is <= t (mirrors eval_pattern).
        let i = pattern.stops.partition_point(|s| (s.arrival_s as f64) <= t);
        let cur = i.saturating_sub(1);
        let dwelling = t <= pattern.stops[cur].departure_s as f64;

        let (at_station, prev_station, next_stop_ordinal, current_stop_ordinal) = if dwelling {
            (
                Some(name_of(cur)),
                if cur > 0 {
                    Some(name_of(cur - 1))
                } else {
                    None
                },
                if cur + 1 < stops.len() {
                    Some(cur + 1)
                } else {
                    None
                },
                Some(cur),
            )
        } else {
            (
                None,
                Some(name_of(cur)),
                Some(cur + 1).filter(|&n| n < stops.len()),
                None,
            )
        };

        let next_arrival_in_s = next_stop_ordinal
            .map(|n| stops[n].arrival_sec as i64 - (run.start_sec as i64 + t as i64));

        Some(RunDetail {
            run_idx,
            route_idx: pattern.route_idx,
            route_name: route.name_en.clone(),
            color_rgb: route.color_rgb,
            headsign: pattern.headsign_en.clone(),
            direction: pattern.direction,
            origin: stops.first().map(|s| s.name_en.clone()).unwrap_or_default(),
            destination: stops.last().map(|s| s.name_en.clone()).unwrap_or_default(),
            state: if dwelling {
                STATE_DWELL as u8
            } else {
                STATE_TRANSIT as u8
            },
            at_station,
            prev_station,
            next_station: next_stop_ordinal.map(name_of),
            next_arrival_in_s,
            next_stop_ordinal,
            current_stop_ordinal,
            stops,
        })
    }

    /// Upcoming calls at one station, soonest first, at most `limit` entries.
    /// Includes a train currently dwelling there (`in_s` slightly negative).
    ///
    /// Resolves THREE service-day frames (yesterday/today/tomorrow, via
    /// `calendar::service_day_frames`), not the two frames `run_detail`/
    /// `evaluate` use — a departure filed on the query day's own NEXT service
    /// day (e.g. a 00:10 run, seen from 23:00) is otherwise structurally
    /// invisible no matter how large `HORIZON_S` is.
    ///
    /// Scans every run, so it stays allocation-light on purpose: service
    /// activity is resolved once per service rather than once per run, frames
    /// come back in a fixed array, and the candidate list holds plain indices —
    /// strings are cloned only for the handful of entries that survive
    /// truncation. That matters at MVP 5 scale, where run count grows ~10×.
    pub fn station_board(
        &self,
        route_idx: u8,
        station_idx: u16,
        date_yyyymmdd: u32,
        sec_of_day: f64,
        limit: usize,
    ) -> Option<StationBoard> {
        let doc = self.doc();
        let route = doc.routes.get(route_idx as usize)?;
        let station = route.stations.get(station_idx as usize)?;

        /// Keep a call visible for this long after it is due, so a dwelling
        /// train does not disappear off the top of the board.
        const GRACE_S: i64 = 90;
        /// Don't advertise calls further out than this. Without it, a quiet
        /// late-night board fills with tomorrow morning's runs shown as
        /// "23h 14m", which reads as a bug.
        const HORIZON_S: i64 = 2 * 3600;

        // Three frames (D-1, D, D+1): the previous day catches post-midnight
        // spillover, and the NEXT day is what lets a 23:00 board advertise a
        // 00:10 departure — that run is filed on its own service day, so the
        // old two-frame set structurally could not see it no matter how large
        // HORIZON_S was.
        let frames = service_day_frames(date_yyyymmdd, sec_of_day);
        // Resolve each service once for all three frames, not once per run.
        let active: Vec<[bool; 3]> = doc
            .services
            .iter()
            .map(|s| {
                [
                    service_active_on(s, frames[0].date_yyyymmdd),
                    service_active_on(s, frames[1].date_yyyymmdd),
                    service_active_on(s, frames[2].date_yyyymmdd),
                ]
            })
            .collect();

        let now = sec_of_day as i64;
        // (run_idx, arrival, departure, in_s) — no strings until after sorting.
        let mut candidates: Vec<(usize, i64, i64, i64)> = Vec::new();
        for (idx, run) in doc.runs.iter().enumerate() {
            let pattern = &doc.patterns[run.pattern_idx as usize];
            if pattern.route_idx != route_idx {
                continue;
            }
            // NB: takes the FIRST call at this station. Correct for the Green
            // Line, where no pattern visits a station twice; a future loop or
            // branching pattern would need every matching call emitted.
            let Some(stop) = pattern.stops.iter().find(|s| s.station_idx == station_idx) else {
                continue;
            };
            let flags = active[run.service_idx as usize];
            for (fi, frame) in frames.iter().enumerate() {
                if !flags[fi] {
                    continue;
                }
                // Into the queried day's frame so times are comparable.
                let arrival = (run.start_sec + stop.arrival_s) as i64 + frame.to_query_frame;
                let in_s = arrival - now;
                if !(-GRACE_S..=HORIZON_S).contains(&in_s) {
                    continue;
                }
                let departure = (run.start_sec + stop.departure_s) as i64 + frame.to_query_frame;
                candidates.push((idx, arrival, departure, in_s));
            }
        }
        candidates.sort_by_key(|c| c.3);
        candidates.truncate(limit);

        let entries = candidates
            .into_iter()
            .map(|(idx, arrival, departure, in_s)| {
                let pattern = &doc.patterns[doc.runs[idx].pattern_idx as usize];
                BoardEntry {
                    run_idx: idx as u32,
                    route_idx,
                    headsign: pattern.headsign_en.clone(),
                    destination: pattern
                        .stops
                        .last()
                        .map(|s| route.stations[s.station_idx as usize].name_en.clone())
                        .unwrap_or_default(),
                    direction: pattern.direction,
                    arrival_sec: arrival,
                    departure_sec: departure,
                    in_s,
                }
            })
            .collect();

        Some(StationBoard {
            route_idx,
            station_idx,
            code: station.code.clone(),
            name_en: station.name_en.clone(),
            name_th: station.name_th.clone(),
            entries,
        })
    }

    /// Every station with its ENU position, for click hit-testing. Indices
    /// match those `station_board` expects.
    pub fn stations(&self) -> Vec<StationInfo> {
        let mut out = Vec::new();
        for (route_idx, route) in self.doc().routes.iter().enumerate() {
            for (station_idx, st) in route.stations.iter().enumerate() {
                let [x, y, z] = crate::world::position_at_arc(route, st.arc_m);
                out.push(StationInfo {
                    route_idx: route_idx as u8,
                    station_idx: station_idx as u16,
                    code: st.code.clone(),
                    name_en: st.name_en.clone(),
                    name_th: st.name_th.clone(),
                    arc_m: st.arc_m,
                    x,
                    y,
                    z,
                    interchanges: st.interchanges.clone(),
                });
            }
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use crate::model::{RouteDoc, StationDoc};
    use crate::world::SimWorld;

    /// Same synthetic feed the world tests use (A→B→C, plus a reverse run and
    /// a run that spills past midnight).
    fn world() -> SimWorld {
        SimWorld::from_doc(crate::world::tests_support::synthetic_doc()).unwrap()
    }

    /// Two routes: [0] normal, [1] geometry only (no patterns reference it).
    fn world_with_track_only_route() -> SimWorld {
        let mut doc = crate::world::tests_support::synthetic_doc();
        doc.routes.push(RouteDoc {
            gtfs_route_id: String::new(),
            line_key: "orange".into(),
            simulated: false,
            name_en: "Orange".into(),
            color_rgb: 0xF57C00,
            track_xyz: vec![[0.0, 0.0, 15.0], [1000.0, 0.0, 15.0]],
            track_arc_m: vec![0.0, 1000.0],
            stations: vec![StationDoc {
                gtfs_stop_id: "o1".into(),
                code: "OR1".into(),
                name_en: "Orange One".into(),
                name_th: "ส้ม 1".into(),
                arc_m: 0.0,
                interchanges: Vec::new(),
            }],
        });
        SimWorld::from_doc(doc).unwrap()
    }

    #[test]
    fn a_track_only_route_has_an_empty_board_not_a_missing_one() {
        // A rendered-but-unsimulated route must answer queries, or the UI
        // cannot tell "no service" from "bad index" and shows an error card.
        let world = world_with_track_only_route();
        let board = world.station_board(1, 0, 20_260_731, 43_200.0, 8);
        let board = board.expect("track-only routes must still resolve indices");
        assert!(board.entries.is_empty());
        assert_eq!(board.route_idx, 1);
    }

    #[test]
    fn a_track_only_route_still_reports_its_stations() {
        let world = world_with_track_only_route();
        let stations = world.stations();
        assert!(
            stations.iter().any(|s| s.route_idx == 1),
            "stations feed click picking"
        );
    }

    const WED: u32 = 20260722;
    const THU_HOLIDAY: u32 = 20260730;

    #[test]
    fn run_detail_dwelling_and_transit() {
        let w = world();
        // Run 0 starts 36000: A arr 0 dep 30, B arr 100 dep 130, C arr 200.
        let d = w.run_detail(0, WED, 36_010.0).expect("dwelling at A");
        assert_eq!(d.state, 0);
        assert_eq!(d.at_station.as_deref(), Some("A"));
        assert_eq!(d.prev_station, None, "first stop has no previous");
        assert_eq!(d.next_station.as_deref(), Some("B"));
        assert_eq!(d.next_arrival_in_s, Some(90));
        assert_eq!(d.origin, "A");
        assert_eq!(d.destination, "C");
        assert_eq!(d.stops.len(), 3);
        assert_eq!(d.stops[1].arrival_sec, 36_100);

        let d = w.run_detail(0, WED, 36_065.0).expect("in transit A->B");
        assert_eq!(d.state, 1);
        assert_eq!(d.at_station, None);
        assert_eq!(d.prev_station.as_deref(), Some("A"));
        assert_eq!(d.next_station.as_deref(), Some("B"));
        assert_eq!(d.next_arrival_in_s, Some(35));
    }

    #[test]
    fn current_stop_ordinal_marks_the_dwelling_stop() {
        let w = world();
        // Dwelling at A (ordinal 0) — the UI must not have to infer this from
        // next_stop_ordinal - 1.
        let d = w.run_detail(0, WED, 36_010.0).unwrap();
        assert_eq!(d.current_stop_ordinal, Some(0));
        assert_eq!(d.next_stop_ordinal, Some(1));
        // In transit: no current stop at all.
        let d = w.run_detail(0, WED, 36_065.0).unwrap();
        assert_eq!(d.current_stop_ordinal, None);
        assert_eq!(d.next_stop_ordinal, Some(1));
        // Dwelling at B (ordinal 1).
        let d = w.run_detail(0, WED, 36_110.0).unwrap();
        assert_eq!(d.current_stop_ordinal, Some(1));
        // Terminus: sitting at the last stop, nothing next.
        let d = w.run_detail(0, WED, 36_200.0).unwrap();
        assert_eq!(d.current_stop_ordinal, Some(2));
        assert_eq!(d.next_stop_ordinal, None);
    }

    #[test]
    fn run_detail_matches_evaluate_liveness() {
        let w = world();
        // Before start, after final arrival, and on a removed holiday: no
        // detail — exactly when evaluate() emits no vehicle.
        assert!(w.run_detail(0, WED, 35_999.0).is_none());
        assert!(w.run_detail(0, WED, 36_200.1).is_none());
        assert!(w.run_detail(0, THU_HOLIDAY, 36_010.0).is_none());
        // Terminus: at the final arrival there is no next station.
        let d = w.run_detail(0, WED, 36_200.0).expect("at final arrival");
        assert_eq!(d.next_station, None);
        assert_eq!(d.next_arrival_in_s, None);
        assert_eq!(d.at_station.as_deref(), Some("C"));
    }

    #[test]
    fn run_detail_follows_post_midnight_spillover() {
        let w = world();
        // Run 2 starts Wed 23:59:10 and runs 200 s into Thursday.
        let d = w.run_detail(2, 20260723, 40.0).expect("spillover run");
        assert_eq!(d.state, 1);
        assert_eq!(d.run_idx, 2);
        // Previous day is the removed holiday -> not live.
        assert!(w.run_detail(2, 20260731, 40.0).is_none());
    }

    #[test]
    fn station_board_orders_by_time_and_limits() {
        let w = world();
        // At B (station_idx 1) just before 10:00: run 0 calls at 36100,
        // run 1 (reverse, starts at B) calls at 36000.
        let b = w.station_board(0, 1, WED, 35_900.0, 10).expect("board");
        assert_eq!(b.name_en, "B");
        let times: Vec<i64> = b.entries.iter().map(|e| e.in_s).collect();
        assert!(times.windows(2).all(|w| w[0] <= w[1]), "sorted: {times:?}");
        assert!(b.entries.iter().any(|e| e.run_idx == 0));
        assert!(b.entries.iter().any(|e| e.run_idx == 1));
        // in_s is relative to the query time.
        let e0 = b.entries.iter().find(|e| e.run_idx == 0).unwrap();
        assert_eq!(e0.in_s, 200);
        assert_eq!(e0.destination, "C");

        // limit truncates to the soonest.
        let b = w.station_board(0, 1, WED, 35_900.0, 1).unwrap();
        assert_eq!(b.entries.len(), 1);
        assert_eq!(b.entries[0].run_idx, 1, "soonest first");
    }

    #[test]
    fn station_board_drops_departed_but_keeps_dwelling() {
        let w = world();
        // Run 0 arrives B at 36100, departs 36130. Query at 36120: still shown
        // (in_s = -20, inside the grace window) because it is sitting there.
        let b = w.station_board(0, 1, WED, 36_120.0, 10).unwrap();
        assert!(
            b.entries.iter().any(|e| e.run_idx == 0),
            "dwelling train kept"
        );
        // Long past: gone.
        let b = w.station_board(0, 1, WED, 40_000.0, 10).unwrap();
        assert!(!b.entries.iter().any(|e| e.run_idx == 0));
        // Inactive service day -> empty board, not an error.
        let b = w.station_board(0, 1, THU_HOLIDAY, 35_900.0, 10).unwrap();
        assert!(b.entries.is_empty());
    }

    #[test]
    fn station_board_drops_calls_beyond_the_horizon() {
        let w = world();
        // Run 0 calls at B at 36100. Query 3 h earlier (in_s = 10800 > 2 h
        // horizon): must not be advertised as "3h 00m" on a quiet board.
        let b = w.station_board(0, 1, WED, 25_300.0, 10).unwrap();
        assert!(
            !b.entries.iter().any(|e| e.run_idx == 0),
            "call beyond the 2 h horizon must be dropped, got {:?}",
            b.entries.iter().map(|e| e.in_s).collect::<Vec<_>>()
        );
        // Just inside the horizon it comes back.
        let b = w.station_board(0, 1, WED, 29_500.0, 10).unwrap();
        assert!(b.entries.iter().any(|e| e.run_idx == 0));
        assert!(b.entries.iter().all(|e| e.in_s <= 2 * 3600));
    }

    #[test]
    fn stations_positions_match_track() {
        let w = world();
        let s = w.stations();
        assert_eq!(s.len(), 3);
        assert_eq!(s[0].name_en, "A");
        // Station B sits at arc 100 -> (100, 0, 15) on the synthetic track.
        let b = &s[1];
        assert!((b.x - 100.0).abs() < 1e-3 && b.y.abs() < 1e-3 && (b.z - 15.0).abs() < 1e-3);
        assert_eq!(b.station_idx, 1);
        assert_eq!(b.route_idx, 0);
    }

    #[test]
    fn out_of_range_indices_return_none() {
        let w = world();
        assert!(w.run_detail(9_999, WED, 36_010.0).is_none());
        assert!(w.station_board(9, 0, WED, 36_010.0, 5).is_none());
        assert!(w.station_board(0, 999, WED, 36_010.0, 5).is_none());
    }

    /// The world fixture plus one early-morning run (00:10) — the shape the
    /// two-frame rule structurally could not show on a late-night board.
    fn world_with_early_run() -> SimWorld {
        let mut doc = crate::world::tests_support::synthetic_doc();
        doc.runs.push(crate::model::RunDoc {
            pattern_idx: 0,
            service_idx: 0,
            start_sec: 600, // 00:10, filed on its own service day
        });
        SimWorld::from_doc(doc).unwrap()
    }

    #[test]
    fn station_board_shows_a_post_midnight_departure_when_queried_late() {
        // Tuesday 2026-07-21 at 23:00. The 00:10 run belongs to WEDNESDAY's
        // service day, so only a D+1 frame can find it — this is the concrete
        // gap the shared three-frame helper closes.
        let w = world_with_early_run();
        let b = w
            .station_board(0, 0, 20260721, 82_800.0, 10)
            .expect("board");
        let late = b
            .entries
            .iter()
            .find(|e| e.run_idx == 3)
            .expect("the 00:10 departure must be on a 23:00 board");
        // 600 + 86400 = 87000 in the queried day's frame; 70 minutes out.
        assert_eq!(late.arrival_sec, 87_000);
        assert_eq!(late.in_s, 4_200);
        assert!(late.in_s <= 2 * 3600, "inside the existing 2 h horizon");
    }

    #[test]
    fn the_third_frame_never_duplicates_an_entry() {
        // Every run is now read in three frames. Only one can land inside the
        // grace/horizon window, so a board must never show the same run twice.
        let w = world_with_early_run();
        for sec in [0.0, 35_900.0, 36_120.0, 82_800.0, 86_000.0] {
            let b = w.station_board(0, 1, 20260721, sec, 20).unwrap();
            let mut seen: Vec<(u32, i64)> = b
                .entries
                .iter()
                .map(|e| (e.run_idx, e.arrival_sec))
                .collect();
            let before = seen.len();
            seen.sort_unstable();
            seen.dedup();
            assert_eq!(seen.len(), before, "duplicate entry at sec={sec}");
        }
    }

    #[test]
    fn run_detail_deliberately_keeps_the_two_frame_liveness_rule() {
        // run_detail must match evaluate() EXACTLY, so a selected train that
        // vanishes from the vehicle buffer also stops returning detail. A D+1
        // frame would resurrect a run evaluate() no longer emits — so this is
        // a difference between the two queries on purpose, not an oversight.
        let w = world_with_early_run();
        // The 00:10 run is not live at 23:00 the previous evening.
        assert!(w.run_detail(3, 20260721, 82_800.0).is_none());
        // It IS live on its own service day.
        assert!(w.run_detail(3, 20260722, 700.0).is_some());
    }
}
