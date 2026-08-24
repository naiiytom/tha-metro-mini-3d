//! Timetable synthesis for operational lines that publish no schedule.
//!
//! Every other line in this project is placed on track by interpolating a
//! REAL published GTFS timetable — that is the whole premise (SRS §1). This
//! module is the one deliberate exception, and it exists for a specific,
//! narrow case: a service that genuinely runs but whose operator publishes no
//! feed at all.
//!
//! Its only user today is the Suvarnabhumi Airport APM (Main Terminal ↔
//! Midfield Satellite Concourse 1). It has been in service since 2023-09-28
//! and runs around the clock, but AOT publishes nothing machine-readable, and
//! the Namtang feed does not carry it (verified 2026-08-09 against all 2,077
//! routes). The alternatives were to render it as dead track with no vehicles,
//! or to describe its observed service pattern explicitly and label it as
//! estimated. This is the second — with the label treated as part of the
//! feature, not an afterthought:
//!
//!   * the parameters live in `tools/lines.config.mjs`, declared per line, so
//!     there are no invented constants buried in Rust;
//!   * every generated id is prefixed `synthetic:` so nothing here can ever be
//!     mistaken for a real feed id while debugging;
//!   * `network.json` carries the `syntheticSchedule` object through to the
//!     frontend, which surfaces an "estimated timetable" marker to the user.
//!
//! Deliberately a separate pass, run after routes, station tables and
//! interchange linking are complete: it needs nothing from GTFS, and keeping
//! it out of the trip loop is what lets it be tested on its own.

use sim_core::model::{PatternDoc, PatternStop, ServiceDoc, StationDoc};

/// Per-line synthesis parameters, straight from the registry via network.json.
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyntheticSchedule {
    /// Seconds between successive departures, per direction.
    pub headway_sec: u32,
    /// End-to-end MOVING time, excluding dwells. Apportioned across legs by
    /// arc length, so an uneven multi-station line still gets sane per-leg
    /// speeds rather than an equal split.
    pub runtime_sec: u32,
    /// Dwell at every stop except the last of each direction.
    pub dwell_sec: u32,
    /// Service span, seconds after midnight. `end_sec` may exceed 86400 for a
    /// span that crosses midnight; the APM's 0..86400 is a full 24 h day.
    pub start_sec: u32,
    pub end_sec: u32,
}

/// One line's synthesized timetable.
#[derive(Debug)]
pub struct Synthesized {
    pub patterns: Vec<PatternDoc>,
    /// Parallel to `patterns`: run start times (seconds after service-day
    /// midnight). Kept separate from the patterns so the caller can assign
    /// real global `pattern_idx` values when it appends them.
    pub starts: Vec<Vec<u32>>,
}

/// An all-days `ServiceDoc` for a synthesized line.
///
/// Mirrors `day_qualified_service_split()` in main.rs, which already
/// synthesizes services — same discipline: a plainly-labelled id, and no
/// `added_dates`/`removed_dates`, because a 24/7 service has no exceptions to
/// claim and inventing some would be inventing data twice over.
pub fn all_days_service(line_key: &str, start_date: u32, end_date: u32) -> ServiceDoc {
    ServiceDoc {
        gtfs_service_id: format!("synthetic:{line_key}:daily"),
        weekday_mask: 0b111_1111,
        start_date,
        end_date,
        added_dates: Vec::new(),
        removed_dates: Vec::new(),
    }
}

/// Build both directions' patterns and their run start times.
///
/// `stations` must be the route's own station list, already sorted ascending
/// by `arc_m` (the preprocessor guarantees this, and asserts strict increase,
/// before this is called). Because the stops come from that list rather than
/// from GTFS stop_times, a synthetic pattern is monotonic in arc by
/// construction — none of the per-pattern candidate resolution that real
/// patterns need (`resolve_pattern_arcs_full`) applies here.
pub fn synthesize(
    line_key: &str,
    route_idx: usize,
    stations: &[StationDoc],
    sched: &SyntheticSchedule,
) -> Result<Synthesized, String> {
    // Re-checked here, not trusted from `assertRegistryValid`. That validator
    // lives in fetch-network.mjs and only runs on a re-fetch, while the
    // preprocessor is explicitly built to run against a committed, sometimes
    // hand-edited `network.json` (the Mo Chit patch, the gradient-limit pass
    // and the interchangeOverrides sync are all established precedent for
    // editing that file directly). Same reason `TripRouter` duplicates its own
    // contract in Rust. Without the headway check the run loop below never
    // terminates and grows `dir_starts` until the process is killed —
    // `sim_core::calendar::expand_frequency` guards exactly this case.
    if sched.headway_sec == 0 {
        return Err(format!(
            "line '{line_key}': syntheticSchedule.headwaySec must be > 0 (got 0) — \
             a zero headway cannot be expanded into runs"
        ));
    }
    if sched.runtime_sec == 0 {
        return Err(format!(
            "line '{line_key}': syntheticSchedule.runtimeSec must be > 0 (got 0) — \
             every run would arrive at its terminus the second it departs"
        ));
    }
    if sched.end_sec <= sched.start_sec {
        return Err(format!(
            "line '{line_key}': syntheticSchedule endSec ({}) must be after startSec ({})",
            sched.end_sec, sched.start_sec
        ));
    }
    if stations.len() < 2 {
        return Err(format!(
            "line '{line_key}': a syntheticSchedule needs at least 2 stations, found {} — \
             a single-station route would generate runs that never move",
            stations.len()
        ));
    }
    let total_arc = (stations[stations.len() - 1].arc_m - stations[0].arc_m) as f64;
    if total_arc <= 0.0 {
        return Err(format!(
            "line '{line_key}': stations span zero arc length; cannot apportion runtime"
        ));
    }

    let mut patterns = Vec::with_capacity(2);
    let mut starts = Vec::with_capacity(2);

    for direction in 0u8..2 {
        // Direction 1 walks the same stations backwards, so its arc values
        // descend. The engine handles that natively (world.rs derives leg
        // direction from `b.arc_m < a.arc_m`), which is also how real
        // reverse-direction GTFS patterns already look.
        let ordered: Vec<(u16, &StationDoc)> = if direction == 0 {
            stations
                .iter()
                .enumerate()
                .map(|(i, s)| (i as u16, s))
                .collect()
        } else {
            stations
                .iter()
                .enumerate()
                .rev()
                .map(|(i, s)| (i as u16, s))
                .collect()
        };

        let mut stops = Vec::with_capacity(ordered.len());
        let mut clock = 0u32;
        for (i, (station_idx, st)) in ordered.iter().enumerate() {
            if i > 0 {
                let leg = (ordered[i].1.arc_m - ordered[i - 1].1.arc_m).abs() as f64;
                // Rounded per leg rather than accumulated as a float, so the
                // last stop lands on a whole second — but floored at 1 s.
                //
                // A leg short enough to round to 0 would give `arrival_s ==
                // the previous `departure_s`: zero transit time, which is
                // exactly the "dwell 60 s then teleport" defect this project
                // already documents for MRT Pink's real GTFS data (CLAUDE.md,
                // "Known unfixed issues"). Unreachable at 2 stations, but a
                // future synthetic line with one very short leg would
                // reproduce it, and nothing downstream detects it. Better a
                // 1 s leg than a teleport.
                let travel = ((leg / total_arc) * sched.runtime_sec as f64).round() as u32;
                clock += travel.max(1);
            }
            let arrival_s = clock;
            let is_last = i == ordered.len() - 1;
            let departure_s = if is_last {
                arrival_s
            } else {
                arrival_s + sched.dwell_sec
            };
            clock = departure_s;
            stops.push(PatternStop {
                station_idx: *station_idx,
                arrival_s,
                departure_s,
                arc_m: st.arc_m,
            });
        }

        let headsign_en = ordered
            .last()
            .map(|(_, s)| s.name_en.clone())
            .unwrap_or_default();
        patterns.push(PatternDoc {
            // `synthetic:` prefix so this can never be mistaken for a feed
            // trip id in a log line, a report file, or the train inspector.
            gtfs_trip_id: format!("synthetic:{line_key}:{direction}"),
            route_idx: u8::try_from(route_idx)
                .map_err(|_| format!("route_idx {route_idx} exceeds PatternDoc's u8"))?,
            direction,
            headsign_en,
            stops,
        });

        // Both directions depart on the SAME offsets. That is the plainest
        // reading of "a train every `headway_sec` in each direction", and it
        // deliberately does not invent a stagger the source doesn't state.
        //
        // Known consequence, so it isn't later mistaken for a defect: when a
        // run occupies less than a full headway (the APM's 40 s dwell + 120 s
        // runtime = 160 s of each 180 s), both directions are idle during the
        // same leftover window, so the line has ~20 s per cycle with zero
        // vehicles anywhere. Real shuttles usually stagger; if that ever
        // matters visually, offset direction 1 by headway/2 here rather than
        // by changing the declared parameters.
        let mut dir_starts = Vec::new();
        let mut t = sched.start_sec;
        while t < sched.end_sec {
            dir_starts.push(t);
            t += sched.headway_sec;
        }
        starts.push(dir_starts);
    }

    Ok(Synthesized { patterns, starts })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn station(name: &str, arc_m: f32) -> StationDoc {
        StationDoc {
            gtfs_stop_id: name.to_string(),
            code: String::new(),
            name_en: name.to_string(),
            name_th: name.to_string(),
            arc_m,
            interchanges: Vec::new(),
        }
    }

    fn apm_like() -> SyntheticSchedule {
        SyntheticSchedule {
            headway_sec: 180,
            runtime_sec: 120,
            dwell_sec: 40,
            start_sec: 0,
            end_sec: 86400,
        }
    }

    #[test]
    fn generates_both_directions_over_the_full_span() {
        let stations = [station("A", 0.0), station("B", 1000.0)];
        let out = synthesize("apm", 3, &stations, &apm_like()).unwrap();
        assert_eq!(out.patterns.len(), 2);
        assert_eq!(out.patterns[0].direction, 0);
        assert_eq!(out.patterns[1].direction, 1);
        // 86400 / 180 = 480 departures per direction.
        assert_eq!(out.starts[0].len(), 480);
        assert_eq!(out.starts[1].len(), 480);
        assert_eq!(*out.starts[0].first().unwrap(), 0);
        assert_eq!(*out.starts[0].last().unwrap(), 86400 - 180);
    }

    #[test]
    fn the_two_directions_traverse_opposite_arc_order() {
        let stations = [station("A", 0.0), station("B", 400.0), station("C", 1000.0)];
        let out = synthesize("apm", 0, &stations, &apm_like()).unwrap();
        let fwd: Vec<f32> = out.patterns[0].stops.iter().map(|s| s.arc_m).collect();
        let rev: Vec<f32> = out.patterns[1].stops.iter().map(|s| s.arc_m).collect();
        assert_eq!(fwd, vec![0.0, 400.0, 1000.0]);
        assert_eq!(rev, vec![1000.0, 400.0, 0.0]);
        // Station indices still point back into the arc-sorted station list.
        assert_eq!(
            out.patterns[1]
                .stops
                .iter()
                .map(|s| s.station_idx)
                .collect::<Vec<_>>(),
            vec![2, 1, 0]
        );
    }

    #[test]
    fn stop_times_are_monotonic_and_spend_exactly_the_declared_runtime_moving() {
        let stations = [station("A", 0.0), station("B", 400.0), station("C", 1000.0)];
        let sched = apm_like();
        let out = synthesize("apm", 0, &stations, &sched).unwrap();
        for p in &out.patterns {
            let mut prev = 0u32;
            let mut moving = 0u32;
            for (i, s) in p.stops.iter().enumerate() {
                assert!(s.arrival_s >= prev, "arrival went backwards at stop {i}");
                assert!(s.departure_s >= s.arrival_s, "departure before arrival");
                if i > 0 {
                    moving += s.arrival_s - p.stops[i - 1].departure_s;
                }
                prev = s.departure_s;
            }
            assert_eq!(
                moving, sched.runtime_sec,
                "moving time must equal runtimeSec"
            );
            // Dwell at every stop but the last.
            let last = p.stops.last().unwrap();
            assert_eq!(last.departure_s, last.arrival_s);
            assert_eq!(
                p.stops[0].departure_s - p.stops[0].arrival_s,
                sched.dwell_sec
            );
        }
    }

    #[test]
    fn ids_are_visibly_synthetic() {
        let stations = [station("A", 0.0), station("B", 1000.0)];
        let out = synthesize("apm", 0, &stations, &apm_like()).unwrap();
        assert!(out.patterns[0].gtfs_trip_id.starts_with("synthetic:"));
        assert!(
            all_days_service("apm", 20260101, 20261231)
                .gtfs_service_id
                .starts_with("synthetic:")
        );
    }

    #[test]
    fn all_days_service_runs_every_weekday_with_no_invented_exceptions() {
        let s = all_days_service("apm", 20260101, 20261231);
        assert_eq!(s.gtfs_service_id, "synthetic:apm:daily");
        assert_eq!(s.start_date, 20260101);
        assert_eq!(s.end_date, 20261231);
        assert_eq!(s.weekday_mask, 0b111_1111);
        assert!(s.added_dates.is_empty());
        assert!(s.removed_dates.is_empty());
    }

    #[test]
    fn all_days_service_active_on_all_days_within_date_range_and_inactive_outside() {
        use sim_core::calendar::service_active_on;

        let s = all_days_service("line-x", 20260101, 20260107);
        assert_eq!(s.gtfs_service_id, "synthetic:line-x:daily");

        // 20260101 (Thursday) to 20260107 (Wednesday) spans all 7 weekdays.
        for date in 20260101..=20260107 {
            assert!(
                service_active_on(&s, date),
                "expected service to be active on date {date}"
            );
        }

        // Dates outside range must be inactive.
        assert!(!service_active_on(&s, 20251231), "day before start_date");
        assert!(!service_active_on(&s, 20260108), "day after end_date");
    }

    #[test]
    fn all_days_service_handles_single_day_span() {
        use sim_core::calendar::service_active_on;

        let s = all_days_service("test-line", 20260515, 20260515);
        assert_eq!(s.gtfs_service_id, "synthetic:test-line:daily");
        assert_eq!(s.start_date, 20260515);
        assert_eq!(s.end_date, 20260515);

        assert!(service_active_on(&s, 20260515));
        assert!(!service_active_on(&s, 20260514));
        assert!(!service_active_on(&s, 20260516));
    }

    #[test]
    fn a_route_with_fewer_than_two_stations_is_rejected() {
        // Would otherwise emit runs that never move — a vehicle parked on the
        // map forever, which reads as a rendering bug rather than bad input.
        let one = [station("A", 0.0)];
        let err = synthesize("apm", 0, &one, &apm_like()).unwrap_err();
        assert!(err.contains("at least 2 stations"), "got: {err}");
    }

    #[test]
    fn a_zero_headway_is_rejected_rather_than_looping_forever() {
        // `while t < end_sec { t += headway_sec }` never terminates at 0.
        // assertRegistryValid rejects it, but only runs on a re-fetch — the
        // preprocessor consumes a committed, hand-editable network.json.
        let stations = [station("A", 0.0), station("B", 1000.0)];
        let sched = SyntheticSchedule {
            headway_sec: 0,
            ..apm_like()
        };
        let err = synthesize("apm", 0, &stations, &sched).unwrap_err();
        assert!(err.contains("headwaySec must be > 0"), "got: {err}");
    }

    #[test]
    fn a_zero_runtime_or_inverted_span_is_rejected() {
        let stations = [station("A", 0.0), station("B", 1000.0)];
        let zero_runtime = SyntheticSchedule {
            runtime_sec: 0,
            ..apm_like()
        };
        assert!(
            synthesize("apm", 0, &stations, &zero_runtime)
                .unwrap_err()
                .contains("runtimeSec must be > 0")
        );
        let inverted = SyntheticSchedule {
            start_sec: 500,
            end_sec: 500,
            ..apm_like()
        };
        assert!(
            synthesize("apm", 0, &stations, &inverted)
                .unwrap_err()
                .contains("must be after startSec")
        );
    }

    #[test]
    fn a_leg_too_short_to_round_up_still_gets_a_second_of_transit() {
        // 1 m of a 10 km route at 120 s runtime rounds to 0 s, which would
        // make arrival_s == the previous departure_s — zero transit, the exact
        // "dwell and teleport" shape documented as a known defect for MRT
        // Pink's real feed data. Floored at 1 s instead.
        let stations = [
            station("A", 0.0),
            station("B", 1.0), // 1 m from A
            station("C", 10_000.0),
        ];
        let out = synthesize("apm", 0, &stations, &apm_like()).unwrap();
        for p in &out.patterns {
            for i in 1..p.stops.len() {
                let transit = p.stops[i].arrival_s - p.stops[i - 1].departure_s;
                assert!(
                    transit >= 1,
                    "leg {i} has {transit} s of transit — a teleport between stations"
                );
            }
        }
    }

    #[test]
    fn a_zero_length_route_is_rejected() {
        let flat = [station("A", 50.0), station("B", 50.0)];
        let err = synthesize("apm", 0, &flat, &apm_like()).unwrap_err();
        assert!(err.contains("zero arc length"), "got: {err}");
    }
}
