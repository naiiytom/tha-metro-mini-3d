//! Repair of degenerate ("dwell and teleport") stop-time rows.
//!
//! The Namtang feed publishes some patterns with `arrival[i] ==
//! departure[i-1]` at every stop — zero seconds of transit, the whole
//! inter-station minute parked in the dwell column. A vehicle on such a
//! pattern never moves along track: the engine correctly reports it dwelling
//! forever and jumps it between stations. Measured 2026-08-15 against
//! feed_version 20260807: MRT Pink 732/732 runs, MRT Blue 928/3712.
//!
//! Two tiers, deliberately separated so invented data stays confined to the
//! one line that genuinely has none:
//!
//!   * **Recovery** — the same unordered station pair usually appears with
//!     real times in another pattern of the SAME line. All 29 of MRT Blue's
//!     degenerate pairs do. Nothing is invented; these are the operator's own
//!     published times, so this tier needs no user-facing disclosure.
//!   * **Estimation** — MRT Pink has no healthy pattern anywhere, so its legs
//!     are derived from track arc length at a speed calibrated from a
//!     declared basis line (`estimatedRunTimes.basisLine` in the registry —
//!     MRT Yellow, the same Alstom straddle-beam monorail). The calibration
//!     is computed here from the basis line's own feed rows, so no invented
//!     numeric constant exists anywhere in the tree. This tier IS disclosed,
//!     via `LineGeometry.estimatedRunTimes` and the UI note.
//!
//! Everything here is pure: plain structs in, plain structs out, no GTFS and
//! no file I/O — same discipline as `synthetic.rs`, and the reason both are
//! testable without a feed directory.

use sim_core::model::PatternDoc;
use std::collections::HashMap;

/// Real transit times per unordered station pair, keyed `(min_idx, max_idx)`.
pub type SiblingTimes = HashMap<(u16, u16), Vec<u32>>;

/// Speed and dwell calibrated from a basis line's own healthy rows.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct BasisProfile {
    pub speed_mps: f64,
    pub dwell_s: u32,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct RepairOutcome {
    pub recovered_legs: usize,
    pub estimated_legs: usize,
}

/// Seconds of movement between stop `i-1` and stop `i`. Signed so a
/// non-monotonic row reads as negative rather than wrapping a u32.
fn transit(p: &PatternDoc, i: usize) -> i64 {
    p.stops[i].arrival_s as i64 - p.stops[i - 1].departure_s as i64
}

/// Seconds a vehicle sits at stop `i`. Signed like `transit()`, and for the
/// same reason: `PatternStop::departure_s`'s `>= arrival_s` invariant is
/// only ASSUMED by the feed's schema, not verified before it reaches this
/// module — a malformed row (`departure_s < arrival_s`) must read as
/// negative here rather than silently wrapping to a huge garbage `u32` in
/// release or panicking in debug.
fn dwell(p: &PatternDoc, i: usize) -> i64 {
    p.stops[i].departure_s as i64 - p.stops[i].arrival_s as i64
}

fn pair_key(a: u16, b: u16) -> (u16, u16) {
    if a <= b { (a, b) } else { (b, a) }
}

fn median(values: &mut [u32]) -> u32 {
    values.sort_unstable();
    values[values.len() / 2]
}

pub fn is_degenerate(p: &PatternDoc) -> bool {
    (1..p.stops.len()).any(|i| transit(p, i) <= 0)
}

/// True when EVERY leg is degenerate — the "one minute per station"
/// placeholder shape. Both affected lines are like this today (verified:
/// Blue 25/25 and 4/4 legs, Pink 29/29 and 2/2). Only in this case is the
/// dwell column also placeholder and safe to replace; a pattern with any real
/// leg keeps its own dwells.
fn is_fully_degenerate(p: &PatternDoc) -> bool {
    p.stops.len() > 1 && (1..p.stops.len()).all(|i| transit(p, i) <= 0)
}

/// Index every healthy pattern's real leg times by station pair.
pub fn sibling_times(patterns: &[&PatternDoc]) -> SiblingTimes {
    let mut out: SiblingTimes = HashMap::new();
    for p in patterns.iter().filter(|p| !is_degenerate(p)) {
        for i in 1..p.stops.len() {
            let t = transit(p, i);
            if t > 0 {
                let key = pair_key(p.stops[i - 1].station_idx, p.stops[i].station_idx);
                out.entry(key).or_default().push(t as u32);
            }
        }
    }
    out
}

/// A line's own median dwell, from its healthy patterns only.
///
/// A malformed stop (`departure_s < arrival_s`) is skipped rather than
/// erroring: this function only ever reads HEALTHY patterns — never one
/// `repair_pattern` is about to rewrite — so a bad row here has no trip to
/// blame and no corruption path to guard against. It just doesn't get a
/// vote in the median.
pub fn sibling_dwell(patterns: &[&PatternDoc]) -> Option<u32> {
    let mut dwells: Vec<u32> = Vec::new();
    for p in patterns.iter().filter(|p| !is_degenerate(p)) {
        let last = p.stops.len().saturating_sub(1);
        for i in 0..last {
            let d = dwell(p, i);
            if d >= 0 {
                dwells.push(d as u32);
            }
        }
    }
    if dwells.is_empty() {
        None
    } else {
        Some(median(&mut dwells))
    }
}

/// Speed and dwell implied by a basis line's own healthy rows.
pub fn basis_profile(patterns: &[&PatternDoc]) -> Result<BasisProfile, String> {
    let mut arc_m = 0f64;
    let mut secs = 0f64;
    for p in patterns.iter().filter(|p| !is_degenerate(p)) {
        for i in 1..p.stops.len() {
            let t = transit(p, i);
            if t > 0 {
                arc_m += (p.stops[i].arc_m - p.stops[i - 1].arc_m).abs() as f64;
                secs += t as f64;
            }
        }
    }
    if secs <= 0.0 || arc_m <= 0.0 {
        return Err(
            "basis line has no healthy legs to calibrate from — every one of its patterns \
             is degenerate, so it cannot serve as anyone's basis"
                .to_string(),
        );
    }
    let dwell_s = sibling_dwell(patterns)
        .ok_or_else(|| "basis line has no healthy legs to calibrate a dwell from".to_string())?;
    Ok(BasisProfile {
        speed_mps: arc_m / secs,
        dwell_s,
    })
}

/// Rewrite one pattern's degenerate legs in place.
///
/// Every leg's replacement is decided BEFORE anything is written, so a lookup
/// can never read a value this same pass has already rewritten.
pub fn repair_pattern(
    p: &mut PatternDoc,
    siblings: &SiblingTimes,
    sibling_dwell: Option<u32>,
    basis: Option<BasisProfile>,
) -> Result<RepairOutcome, String> {
    if !is_degenerate(p) {
        return Ok(RepairOutcome::default());
    }
    let n = p.stops.len();
    let mut out = RepairOutcome::default();
    let mut legs: Vec<u32> = Vec::with_capacity(n - 1);
    for i in 1..n {
        let existing = transit(p, i);
        if existing > 0 {
            legs.push(existing as u32); // real data — never overwritten
            continue;
        }
        let key = pair_key(p.stops[i - 1].station_idx, p.stops[i].station_idx);
        if let Some(times) = siblings.get(&key) {
            let mut times = times.clone();
            legs.push(median(&mut times));
            out.recovered_legs += 1;
            continue;
        }
        let basis = basis.ok_or_else(|| {
            format!(
                "pattern {} leg {} -> {} has zero transit, no healthy sibling on its own \
                 line, and the line declares no estimatedRunTimes basis — add \
                 `estimatedRunTimes: {{ basisLine: \"<key>\" }}` to its entry in \
                 tools/lines.config.mjs (and sync src/data/network.json)",
                p.gtfs_trip_id,
                p.stops[i - 1].station_idx,
                p.stops[i].station_idx,
            )
        })?;
        let leg_m = (p.stops[i].arc_m - p.stops[i - 1].arc_m).abs() as f64;
        // Floored at 1 s: a leg rounding to 0 would reintroduce exactly the
        // defect this module exists to remove.
        legs.push(((leg_m / basis.speed_mps).round() as u32).max(1));
        out.estimated_legs += 1;
    }

    let replacement_dwell = sibling_dwell
        .or_else(|| basis.map(|b| b.dwell_s))
        .unwrap_or(0);
    let dwells: Vec<u32> = if is_fully_degenerate(p) {
        vec![replacement_dwell; n]
    } else {
        // Real dwells, kept verbatim — but a malformed row here is a hard
        // error, not a wrapped/panicking u32 subtraction. This is this
        // project's own disclosure convention (`check_track_gradient`, the
        // snap gate): stop the build with a named line/trip rather than
        // silently absorb a bad row.
        let mut own_dwells = Vec::with_capacity(n);
        for i in 0..n {
            let d = dwell(p, i);
            if d < 0 {
                return Err(format!(
                    "pattern {} stop {} (station_idx {}) has departure_s {} before arrival_s \
                     {} — a malformed row, not one this repair can trust; fix the upstream \
                     feed data",
                    p.gtfs_trip_id,
                    i,
                    p.stops[i].station_idx,
                    p.stops[i].departure_s,
                    p.stops[i].arrival_s,
                ));
            }
            own_dwells.push(d as u32);
        }
        own_dwells
    };

    let mut clock = 0u32;
    for i in 0..n {
        if i > 0 {
            clock += legs[i - 1];
        }
        p.stops[i].arrival_s = clock;
        p.stops[i].departure_s = if i + 1 == n { clock } else { clock + dwells[i] };
        clock = p.stops[i].departure_s;
    }
    Ok(out)
}

/// Hard gate: no leg anywhere may still have zero transit after the repair.
///
/// A build failure is this defect's disclosure mechanism — the same precedent
/// as `check_track_gradient` and the snap-distance check. Silence is what let
/// it sit undetected on MRT Blue for two MVPs.
pub fn assert_no_zero_transit(patterns: &[PatternDoc], line_keys: &[String]) -> Result<(), String> {
    for p in patterns {
        for i in 1..p.stops.len() {
            if transit(p, i) <= 0 {
                let key = line_keys
                    .get(p.route_idx as usize)
                    .map(String::as_str)
                    .unwrap_or("<unknown line>");
                return Err(format!(
                    "line '{key}': pattern {} has zero transit between station_idx {} and \
                     {} — a vehicle on this leg would teleport rather than move. The repair \
                     pass did not resolve it; check the line's estimatedRunTimes basis.",
                    p.gtfs_trip_id,
                    p.stops[i - 1].station_idx,
                    p.stops[i].station_idx,
                ));
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use sim_core::model::PatternStop;

    fn stop(station_idx: u16, arrival_s: u32, departure_s: u32, arc_m: f32) -> PatternStop {
        PatternStop {
            station_idx,
            arrival_s,
            departure_s,
            arc_m,
        }
    }

    fn pattern(id: &str, stops: Vec<PatternStop>) -> PatternDoc {
        PatternDoc {
            gtfs_trip_id: id.to_string(),
            route_idx: 0,
            direction: 0,
            headsign_en: "T".to_string(),
            stops,
        }
    }

    /// Three stops, real times: 0 -> 120 s transit -> 30 s dwell -> 90 s transit.
    fn healthy() -> PatternDoc {
        pattern(
            "healthy",
            vec![
                stop(0, 0, 30, 0.0),
                stop(1, 150, 180, 1000.0),
                stop(2, 270, 270, 2000.0),
            ],
        )
    }

    /// The real defect shape: one minute per station, zero transit everywhere.
    fn degenerate() -> PatternDoc {
        pattern(
            "degenerate",
            vec![
                stop(0, 0, 60, 0.0),
                stop(1, 60, 120, 1000.0),
                stop(2, 120, 120, 2000.0),
            ],
        )
    }

    #[test]
    fn recognises_the_zero_transit_shape() {
        assert!(is_degenerate(&degenerate()));
        assert!(!is_degenerate(&healthy()));
    }

    #[test]
    fn a_degenerate_leg_adopts_its_healthy_siblings_time() {
        let h = healthy();
        let siblings = sibling_times(&[&h]);
        let dwell = sibling_dwell(&[&h]);
        let mut d = degenerate();
        let out = repair_pattern(&mut d, &siblings, dwell, None).unwrap();
        assert_eq!(out.recovered_legs, 2);
        assert_eq!(out.estimated_legs, 0);
        // 120 s and 90 s transit recovered, 30 s dwell recovered.
        assert_eq!(d.stops[0].arrival_s, 0);
        assert_eq!(d.stops[0].departure_s, 30);
        assert_eq!(d.stops[1].arrival_s, 150);
        assert_eq!(d.stops[1].departure_s, 180);
        assert_eq!(d.stops[2].arrival_s, 270);
        assert_eq!(d.stops[2].departure_s, 270);
    }

    #[test]
    fn several_healthy_siblings_contribute_their_median() {
        let a = pattern("a", vec![stop(0, 0, 30, 0.0), stop(1, 130, 130, 1000.0)]);
        let b = pattern("b", vec![stop(0, 0, 30, 0.0), stop(1, 230, 230, 1000.0)]);
        let c = pattern("c", vec![stop(0, 0, 30, 0.0), stop(1, 330, 330, 1000.0)]);
        let siblings = sibling_times(&[&a, &b, &c]);
        let mut d = pattern("d", vec![stop(0, 0, 60, 0.0), stop(1, 60, 60, 1000.0)]);
        repair_pattern(&mut d, &siblings, sibling_dwell(&[&a, &b, &c]), None).unwrap();
        // transits are 100 / 200 / 300; the median is 200.
        assert_eq!(d.stops[1].arrival_s - d.stops[0].departure_s, 200);
    }

    #[test]
    fn a_leg_with_no_sibling_is_estimated_from_arc_length() {
        let basis = BasisProfile {
            speed_mps: 10.0,
            dwell_s: 18,
        };
        let mut d = degenerate();
        let out = repair_pattern(&mut d, &SiblingTimes::new(), None, Some(basis)).unwrap();
        assert_eq!(out.recovered_legs, 0);
        assert_eq!(out.estimated_legs, 2);
        // 1000 m at 10 m/s = 100 s per leg, 18 s dwell from the basis.
        assert_eq!(d.stops[0].departure_s, 18);
        assert_eq!(d.stops[1].arrival_s, 118);
        assert_eq!(d.stops[1].departure_s, 136);
        assert_eq!(d.stops[2].arrival_s, 236);
        assert_eq!(d.stops[2].departure_s, 236);
    }

    #[test]
    fn estimated_legs_scale_with_arc_length() {
        let basis = BasisProfile {
            speed_mps: 10.0,
            dwell_s: 0,
        };
        let mut d = pattern(
            "uneven",
            vec![
                stop(0, 0, 60, 0.0),
                stop(1, 60, 120, 500.0),
                stop(2, 120, 120, 2500.0),
            ],
        );
        repair_pattern(&mut d, &SiblingTimes::new(), None, Some(basis)).unwrap();
        let first = d.stops[1].arrival_s - d.stops[0].departure_s;
        let second = d.stops[2].arrival_s - d.stops[1].departure_s;
        assert_eq!(first, 50);
        assert_eq!(second, 200);
    }

    #[test]
    fn a_leg_too_short_to_round_up_still_gets_a_second_of_transit() {
        // The floor that stops a repair from reintroducing the very defect
        // it exists to remove.
        let basis = BasisProfile {
            speed_mps: 100.0,
            dwell_s: 0,
        };
        let mut d = pattern("tiny", vec![stop(0, 0, 60, 0.0), stop(1, 60, 60, 1.0)]);
        repair_pattern(&mut d, &SiblingTimes::new(), None, Some(basis)).unwrap();
        assert_eq!(d.stops[1].arrival_s - d.stops[0].departure_s, 1);
    }

    #[test]
    fn a_healthy_pattern_is_left_untouched() {
        let mut h = healthy();
        let before: Vec<(u32, u32)> = h
            .stops
            .iter()
            .map(|s| (s.arrival_s, s.departure_s))
            .collect();
        let out = repair_pattern(&mut h, &SiblingTimes::new(), None, None).unwrap();
        let after: Vec<(u32, u32)> = h
            .stops
            .iter()
            .map(|s| (s.arrival_s, s.departure_s))
            .collect();
        assert_eq!(before, after);
        assert_eq!(out, RepairOutcome::default());
    }

    #[test]
    fn a_partially_degenerate_pattern_keeps_its_real_legs_and_its_own_dwell() {
        // Only the zero leg is rewritten. Its dwells are real data (the
        // pattern is not the "one minute per station" placeholder shape),
        // so they must survive verbatim.
        let sib = pattern(
            "sib",
            vec![stop(1, 0, 20, 1000.0), stop(2, 200, 200, 2000.0)],
        );
        let siblings = sibling_times(&[&sib]);
        let mut p = pattern(
            "mixed",
            vec![
                stop(0, 0, 45, 0.0),
                stop(1, 165, 210, 1000.0), // real 120 s leg, real 45 s dwell
                stop(2, 210, 210, 2000.0), // zero leg
            ],
        );
        let out = repair_pattern(&mut p, &siblings, Some(999), None).unwrap();
        assert_eq!(out.recovered_legs, 1);
        assert_eq!(p.stops[0].departure_s, 45, "own dwell must survive");
        assert_eq!(
            p.stops[1].arrival_s - p.stops[0].departure_s,
            120,
            "real leg kept"
        );
        assert_eq!(
            p.stops[1].departure_s - p.stops[1].arrival_s,
            45,
            "own dwell kept"
        );
        // The sibling's leg is arr 200 - dep 20 = 180 s, not its raw arrival.
        assert_eq!(
            p.stops[2].arrival_s - p.stops[1].departure_s,
            180,
            "zero leg repaired"
        );
    }

    #[test]
    fn every_repaired_pattern_is_monotonic() {
        let basis = BasisProfile {
            speed_mps: 10.0,
            dwell_s: 18,
        };
        let mut d = degenerate();
        repair_pattern(&mut d, &SiblingTimes::new(), None, Some(basis)).unwrap();
        for i in 1..d.stops.len() {
            assert!(d.stops[i].arrival_s > d.stops[i - 1].departure_s);
            assert!(d.stops[i].departure_s >= d.stops[i].arrival_s);
        }
    }

    #[test]
    fn a_leg_with_neither_sibling_nor_basis_names_the_line_it_needs_configuring() {
        let mut d = degenerate();
        let err = repair_pattern(&mut d, &SiblingTimes::new(), None, None).unwrap_err();
        assert!(err.contains("estimatedRunTimes"), "got: {err}");
        assert!(err.contains("degenerate"), "must name the trip: {err}");
    }

    #[test]
    fn basis_calibration_uses_only_healthy_legs() {
        let h = healthy(); // 1000 m / 120 s and 1000 m / 90 s
        let d = degenerate();
        let profile = basis_profile(&[&h, &d]).unwrap();
        // 2000 m over 210 s — the degenerate pattern must contribute nothing.
        assert!((profile.speed_mps - 2000.0 / 210.0).abs() < 1e-9);
        assert_eq!(profile.dwell_s, 30);
    }

    #[test]
    fn a_basis_line_with_no_healthy_legs_is_a_hard_error() {
        let d = degenerate();
        let err = basis_profile(&[&d]).unwrap_err();
        assert!(err.contains("no healthy legs"), "got: {err}");
    }

    #[test]
    fn the_gate_names_the_line_and_stop_pair_of_a_surviving_zero_leg() {
        let keys = vec!["pink".to_string()];
        let bad = vec![degenerate()];
        let err = assert_no_zero_transit(&bad, &keys).unwrap_err();
        assert!(err.contains("pink"), "got: {err}");
        assert!(err.contains("degenerate"), "must name the trip: {err}");
        assert!(assert_no_zero_transit(&[healthy()], &keys).is_ok());
    }

    #[test]
    fn median_of_an_even_count_takes_the_upper_middle_element() {
        // `values[len / 2]` is a deliberate choice (the upper-middle
        // element, not an average) — pin it so a refactor can't silently
        // change it.
        let mut values = vec![100, 200];
        assert_eq!(median(&mut values), 200);
    }

    #[test]
    fn a_malformed_dwell_is_a_hard_error_naming_the_trip_and_stop() {
        // Not fully degenerate (legs 1->2 and 2->3 are real), so
        // repair_pattern takes the own-dwell branch — which must validate
        // each row instead of blindly subtracting into a wrapped/panicking
        // u32. The zero leg 0->1 is made recoverable via a sibling so the
        // legs loop completes cleanly and this error is really coming from
        // the dwell check, not the "no sibling or basis" one.
        let sib = pattern("sib", vec![stop(0, 0, 0, 0.0), stop(1, 50, 50, 1000.0)]);
        let siblings = sibling_times(&[&sib]);
        let mut p = pattern(
            "broken",
            vec![
                stop(0, 0, 10, 0.0),
                stop(1, 10, 10, 1000.0),  // zero leg, recoverable via sibling
                stop(2, 200, 50, 2000.0), // malformed: departure (50) before arrival (200)
                stop(3, 300, 300, 3000.0),
            ],
        );
        let err = repair_pattern(&mut p, &siblings, None, None).unwrap_err();
        assert!(err.contains("broken"), "must name the trip: {err}");
        assert!(err.contains("stop 2"), "must name the stop index: {err}");
    }

    #[test]
    fn a_malformed_sibling_stop_does_not_poison_the_median() {
        // sibling_dwell only ever reads healthy (non-degenerate) patterns,
        // but a malformed row's own dwell can still be negative independently
        // of its transit — it must be skipped, not turned into a wrapped u32
        // that becomes every leg's replacement dwell.
        let ok = pattern("ok", vec![stop(0, 0, 30, 0.0), stop(1, 130, 130, 1000.0)]);
        let malformed = pattern(
            "malformed",
            vec![stop(0, 50, 10, 0.0), stop(1, 500, 500, 1000.0)], // dep(10) < arr(50)
        );
        assert!(
            !is_degenerate(&malformed),
            "must stay healthy to reach the dwell scan"
        );
        let dwell = sibling_dwell(&[&ok, &malformed]);
        assert_eq!(dwell, Some(30), "only the healthy row's dwell should count");
    }
}
