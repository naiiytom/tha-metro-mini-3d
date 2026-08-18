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

use std::collections::HashMap;

use serde::Serialize;

use crate::calendar::{Frame, service_active_on, service_day_frames};
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

/// A planning request. The three routing parameters are REQUEST parameters,
/// not compiled constants: their defaults live in the TS caller
/// (`src/sim/protocol.ts`), so they can be re-tuned against the real network
/// without a Rust change or a cache regeneration.
#[derive(Debug, Clone)]
pub struct PlanRequest {
    /// `(route_idx, station_idx)` — the same pair `station_board` takes.
    pub from: (u8, u16),
    pub to: (u8, u16),
    pub date_yyyymmdd: u32,
    pub sec_of_day: f64,
    /// Boardings are capped at `max_transfers + 1`, i.e. RAPTOR rounds.
    pub max_transfers: u8,
    /// Give up rather than propose an unreasonable overnight wait. Enforced
    /// PER BOARDING, not as a whole-journey budget.
    pub max_wait_s: u32,
    /// FLAT cost charged at every footpath, regardless of real walking
    /// distance. Distance-derived transfer times were considered during
    /// brainstorming and explicitly declined; `walk_m` is surfaced for
    /// display context and never feeds this.
    pub transfer_buffer_s: u32,
}

/// The answer. Times are seconds in the QUERIED day's frame — directly
/// comparable to `sec_of_day`, and possibly past 86400 for a journey that
/// crosses midnight, exactly like `BoardEntry::arrival_sec`.
///
/// NOTE the camelCase serde renaming here and on `PlanLeg`: it deviates from
/// contract §7's "snake_case verbatim" convention, deliberately, because
/// these structures are consumed by a React component rather than mirrored
/// field-for-field into a raw TS interface. It is documented in the contract
/// and in CLAUDE.md rather than left for a reader to discover.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoutePlan {
    /// The FIRST boarding, not the query instant — the initial wait is not
    /// part of the journey the user is being quoted.
    pub depart_sec: i64,
    pub arrive_sec: i64,
    pub duration_s: i64,
    /// Ride legs minus one: a same-platform pattern change counts, because
    /// the user still changes trains.
    pub transfers: usize,
    /// Always true today. The disclosure hook — never silently dropped, per
    /// the Pink/APM precedent.
    pub transfer_times_estimated: bool,
    pub legs: Vec<PlanLeg>,
    /// `true` with empty legs when the request is well-formed but nothing
    /// connects — mirrors query.rs's "empty board, not a missing one."
    pub unreachable: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum PlanLeg {
    #[serde(rename_all = "camelCase")]
    Ride {
        route_idx: u8,
        route_name: String,
        /// `#RRGGBB`, formatted here rather than crossed as the `u32`
        /// `RunDetail` uses — the UI wants a CSS colour.
        color_rgb: String,
        headsign: String,
        direction: u8,
        run_idx: u32,
        board_station_idx: u16,
        board_name: String,
        board_sec: i64,
        /// From `PatternStop::arc_m`, NEVER `StationDoc::arc_m` — the two
        /// legitimately diverge on a self-approaching alignment (MRT Blue at
        /// Tha Phra), and the map highlight draws on this.
        board_arc_m: f64,
        alight_station_idx: u16,
        alight_name: String,
        alight_sec: i64,
        alight_arc_m: f64,
        intermediate_stops: Vec<String>,
    },
    #[serde(rename_all = "camelCase")]
    Transfer {
        from_route_idx: u8,
        from_station_idx: u16,
        to_route_idx: u8,
        to_station_idx: u16,
        /// Display-only context, from `position_at_arc`. Does NOT feed
        /// `transfer_s`.
        walk_m: f64,
        /// The flat buffer actually charged (0 for a same-stop change).
        transfer_s: u32,
        wait_s: u32,
    },
}

/// Sentinel "not reached yet." `i64::MAX / 4` leaves headroom for the
/// `+ transfer_buffer_s` in footpath relaxation without overflowing.
const UNREACHED: i64 = i64::MAX / 4;

#[derive(Clone)]
enum Via {
    Origin,
    Ride {
        pattern_idx: u16,
        run_idx: u32,
        offset: i64,
        board_stop: usize,
        board_pos: usize,
        alight_pos: usize,
    },
    /// Not constructed until Task 4's transfer relaxation — this task only
    /// ever builds `Via::Ride` labels. `reconstruct` already matches on it,
    /// so the shape is final now; only its construction site is deferred.
    #[allow(dead_code)]
    Walk {
        from_stop: usize,
        walk_m: f64,
    },
}

#[derive(Clone)]
struct Label {
    arrival: i64,
    via: Via,
}

/// One reconstructed hop, in travel order.
enum Step {
    Ride {
        pattern_idx: u16,
        run_idx: u32,
        offset: i64,
        board_pos: usize,
        alight_pos: usize,
    },
    Walk {
        from_stop: usize,
        to_stop: usize,
        walk_m: f64,
        transfer_s: u32,
    },
}

/// The first run of `pattern_idx` departing position `pos` at or after
/// `ready`, as `(run_idx, frame offset)`. `None` when the only candidates
/// would mean waiting longer than `max_wait_s`.
///
/// Frames are searched in offset order and each frame's departures occupy a
/// disjoint ascending window (`RunDoc::start_sec < 86400`), so the first hit
/// is globally the earliest — three binary searches, no merging.
///
/// Every run of a pattern shares this position's `departure_s`, so ordering
/// by `start_sec` orders departures here identically: the FIFO property that
/// makes the binary search legal.
#[allow(clippy::too_many_arguments)]
fn earliest_trip(
    doc: &CacheDoc,
    idx: &RouteIndex,
    active: &[[bool; 3]],
    frames: &[Frame; 3],
    pattern_idx: u16,
    pos: usize,
    ready: i64,
    max_wait_s: u32,
) -> Option<(u32, i64)> {
    let dep_off = doc.patterns[pattern_idx as usize].stops[pos].departure_s as i64;
    let runs = idx.runs_of(pattern_idx);
    let deadline = ready.saturating_add(max_wait_s as i64);
    for (fi, frame) in frames.iter().enumerate() {
        let offset = frame.to_query_frame;
        let lower = ready - dep_off - offset;
        let start = runs.partition_point(|&r| (doc.runs[r as usize].start_sec as i64) < lower);
        for &r in &runs[start..] {
            let run = &doc.runs[r as usize];
            let dep = run.start_sec as i64 + dep_off + offset;
            if dep > deadline {
                break; // sorted: nothing later in this frame can qualify
            }
            if active[run.service_idx as usize][fi] {
                return Some((r, offset));
            }
        }
    }
    None
}

/// Walk the label chain back from `(k, stop)` and emit legs in travel order.
fn reconstruct(
    doc: &CacheDoc,
    idx: &RouteIndex,
    rounds: &[Vec<Option<Label>>],
    k: usize,
    stop: usize,
    buffer_s: u32,
) -> Vec<PlanLeg> {
    let mut steps: Vec<Step> = Vec::new();
    let mut k = k;
    let mut stop = stop;
    while let Some(label) = rounds[k][stop].as_ref() {
        match &label.via {
            Via::Origin => break,
            Via::Walk { from_stop, walk_m } => {
                // Chained footpaths collapse into ONE transfer leg; the
                // buffer accumulates so the leg reports what was charged.
                match steps.last_mut() {
                    Some(Step::Walk {
                        from_stop: f,
                        walk_m: w,
                        transfer_s,
                        ..
                    }) if *f == stop => {
                        *w += *walk_m;
                        *transfer_s += buffer_s;
                        *f = *from_stop;
                    }
                    _ => steps.push(Step::Walk {
                        from_stop: *from_stop,
                        to_stop: stop,
                        walk_m: *walk_m,
                        transfer_s: buffer_s,
                    }),
                }
                stop = *from_stop;
            }
            Via::Ride {
                pattern_idx,
                run_idx,
                offset,
                board_stop,
                board_pos,
                alight_pos,
            } => {
                steps.push(Step::Ride {
                    pattern_idx: *pattern_idx,
                    run_idx: *run_idx,
                    offset: *offset,
                    board_pos: *board_pos,
                    alight_pos: *alight_pos,
                });
                stop = *board_stop;
                k -= 1; // a boarding is exactly one round
            }
        }
    }
    steps.reverse();

    let mut legs: Vec<PlanLeg> = Vec::new();
    let mut prev_alight: Option<i64> = None;
    let mut pending: Option<(usize, usize, f64, u32)> = None;
    for step in steps {
        match step {
            Step::Walk {
                from_stop,
                to_stop,
                walk_m,
                transfer_s,
            } => pending = Some((from_stop, to_stop, walk_m, transfer_s)),
            Step::Ride {
                pattern_idx,
                run_idx,
                offset,
                board_pos,
                alight_pos,
            } => {
                let pattern = &doc.patterns[pattern_idx as usize];
                let route = &doc.routes[pattern.route_idx as usize];
                let run = &doc.runs[run_idx as usize];
                let board = &pattern.stops[board_pos];
                let alight = &pattern.stops[alight_pos];
                let board_sec = run.start_sec as i64 + board.departure_s as i64 + offset;
                let alight_sec = run.start_sec as i64 + alight.arrival_s as i64 + offset;

                if let Some(prev_sec) = prev_alight {
                    // A same-stop pattern change has no footpath, so it costs
                    // nothing (already on the platform) — but it is still a
                    // transfer the user has to make, so it still gets a leg.
                    let here = idx.stop_of(pattern.route_idx as usize, board.station_idx as usize);
                    let (from_stop, to_stop, walk_m, transfer_s) =
                        pending.take().unwrap_or((here, here, 0.0, 0));
                    let (from_route_idx, from_station_idx) = idx.unpack(from_stop);
                    let (to_route_idx, to_station_idx) = idx.unpack(to_stop);
                    legs.push(PlanLeg::Transfer {
                        from_route_idx,
                        from_station_idx,
                        to_route_idx,
                        to_station_idx,
                        walk_m,
                        transfer_s,
                        wait_s: (board_sec - prev_sec - transfer_s as i64).max(0) as u32,
                    });
                }

                legs.push(PlanLeg::Ride {
                    route_idx: pattern.route_idx,
                    route_name: route.name_en.clone(),
                    color_rgb: format!("#{:06X}", route.color_rgb & 0x00FF_FFFF),
                    headsign: pattern.headsign_en.clone(),
                    direction: pattern.direction,
                    run_idx,
                    board_station_idx: board.station_idx,
                    board_name: route.stations[board.station_idx as usize].name_en.clone(),
                    board_sec,
                    board_arc_m: board.arc_m as f64,
                    alight_station_idx: alight.station_idx,
                    alight_name: route.stations[alight.station_idx as usize].name_en.clone(),
                    alight_sec,
                    alight_arc_m: alight.arc_m as f64,
                    intermediate_stops: pattern.stops[board_pos + 1..alight_pos]
                        .iter()
                        .map(|s| route.stations[s.station_idx as usize].name_en.clone())
                        .collect(),
                });
                prev_alight = Some(alight_sec);
            }
        }
    }
    legs
}

/// Plan a journey. `None` ONLY for a structurally invalid request (a bad
/// route or station index); a well-formed request that simply does not
/// connect returns `Some(RoutePlan { unreachable: true, .. })`.
pub fn plan(doc: &CacheDoc, idx: &RouteIndex, req: &PlanRequest) -> Option<RoutePlan> {
    let origin = idx.stop_id(doc, req.from.0, req.from.1)?;
    let target = idx.stop_id(doc, req.to.0, req.to.1)?;

    let frames = service_day_frames(req.date_yyyymmdd, req.sec_of_day);
    // Resolve each service once for all three frames, not once per run —
    // the same discipline station_board already applies at this scale.
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

    let t0 = req.sec_of_day as i64;
    let n = idx.stop_count();
    let origin_stops = vec![origin];
    let target_stops = vec![target];

    let mut best = vec![UNREACHED; n];
    let mut rounds: Vec<Vec<Option<Label>>> = Vec::new();
    let mut round0: Vec<Option<Label>> = vec![None; n];
    for &s in &origin_stops {
        round0[s] = Some(Label {
            arrival: t0,
            via: Via::Origin,
        });
        best[s] = t0;
    }
    rounds.push(round0);

    let mut marked: Vec<usize> = origin_stops.clone();
    for k in 1..=(req.max_transfers as usize + 1) {
        let prev = rounds[k - 1].clone();
        let mut cur = prev.clone();
        let mut next_marked: Vec<usize> = Vec::new();

        // Each pattern is scanned once, from the EARLIEST marked position it
        // calls — the round's whole cost, and why RAPTOR is linear in stops
        // per round rather than quadratic.
        let mut queue: HashMap<u16, usize> = HashMap::new();
        for &stop in &marked {
            for &(pattern_idx, pos) in idx.patterns_at(stop) {
                let pos = pos as usize;
                queue
                    .entry(pattern_idx)
                    .and_modify(|p| {
                        if pos < *p {
                            *p = pos;
                        }
                    })
                    .or_insert(pos);
            }
        }
        // Sorted before use: a HashMap's iteration order is seeded per
        // process, so an arrival-time tie would otherwise resolve differently
        // run to run.
        let mut scan: Vec<(u16, usize)> = queue.into_iter().collect();
        scan.sort_unstable();

        for (pattern_idx, start_pos) in scan {
            let pattern = &doc.patterns[pattern_idx as usize];
            // The run currently being ridden: (run, frame offset, boarding
            // position, boarding stop). None until we board.
            let mut trip: Option<(u32, i64, usize, usize)> = None;

            for pos in start_pos..pattern.stops.len() {
                let pstop = &pattern.stops[pos];
                let stop = idx.stop_of(pattern.route_idx as usize, pstop.station_idx as usize);

                if let Some((run_idx, offset, board_pos, board_stop)) = trip {
                    let run = &doc.runs[run_idx as usize];
                    let arrival = run.start_sec as i64 + pstop.arrival_s as i64 + offset;
                    if arrival < best[stop] {
                        best[stop] = arrival;
                        cur[stop] = Some(Label {
                            arrival,
                            via: Via::Ride {
                                pattern_idx,
                                run_idx,
                                offset,
                                board_stop,
                                board_pos,
                                alight_pos: pos,
                            },
                        });
                        next_marked.push(stop);
                    }
                }

                // Can we board something earlier here than what we are on?
                // A same-stop pattern change costs nothing extra — we are
                // already on the platform — which is why `ready` carries no
                // buffer; only footpaths below add one.
                let Some(ready) = prev[stop].as_ref().map(|l| l.arrival) else {
                    continue;
                };
                let current_dep = trip.map(|(run_idx, offset, _, _)| {
                    doc.runs[run_idx as usize].start_sec as i64 + pstop.departure_s as i64 + offset
                });
                if current_dep.is_some_and(|d| ready > d) {
                    continue; // cannot improve on the trip we are riding
                }
                if let Some((run_idx, offset)) = earliest_trip(
                    doc,
                    idx,
                    &active,
                    &frames,
                    pattern_idx,
                    pos,
                    ready,
                    req.max_wait_s,
                ) {
                    let dep = doc.runs[run_idx as usize].start_sec as i64
                        + pstop.departure_s as i64
                        + offset;
                    if current_dep.is_none_or(|d| dep < d) {
                        trip = Some((run_idx, offset, pos, stop));
                    }
                }
            }
        }

        // Footpaths, relaxed to a fixed point INSIDE the round: walking is
        // not a boarding, so it must not consume a round. `transfer_buffer_s`
        // makes each hop strictly later, and `best` only accepts strict
        // improvements, so this terminates even at a buffer of zero.
        let mut work: Vec<usize> = next_marked.clone();
        while let Some(stop) = work.pop() {
            let Some(from) = cur[stop].as_ref().map(|l| l.arrival) else {
                continue;
            };
            for &(to, walk_m) in idx.transfers_at(stop) {
                let arrival = from + req.transfer_buffer_s as i64;
                if arrival < best[to] {
                    best[to] = arrival;
                    cur[to] = Some(Label {
                        arrival,
                        via: Via::Walk {
                            from_stop: stop,
                            walk_m,
                        },
                    });
                    next_marked.push(to);
                    work.push(to);
                }
            }
        }

        rounds.push(cur);
        next_marked.sort_unstable();
        next_marked.dedup();
        if next_marked.is_empty() {
            break; // nothing improved: no later round can improve either
        }
        marked = next_marked;
    }

    finish(doc, idx, &rounds, &target_stops, t0, req)
}

/// Pick the best target label across rounds and turn it into a `RoutePlan`.
/// Rounds are scanned ascending with a STRICT improvement test, so the
/// earliest arrival wins and ties go to the lowest round — which is exactly
/// "fewest transfers", RAPTOR's native tie-break.
fn finish(
    doc: &CacheDoc,
    idx: &RouteIndex,
    rounds: &[Vec<Option<Label>>],
    target_stops: &[usize],
    t0: i64,
    req: &PlanRequest,
) -> Option<RoutePlan> {
    let mut chosen: Option<(usize, usize, i64)> = None;
    for (k, labels) in rounds.iter().enumerate() {
        for &s in target_stops {
            if let Some(l) = &labels[s]
                && chosen.is_none_or(|(_, _, a)| l.arrival < a)
            {
                chosen = Some((k, s, l.arrival));
            }
        }
    }

    let Some((k, stop, arrive)) = chosen else {
        return Some(RoutePlan {
            depart_sec: t0,
            arrive_sec: t0,
            duration_s: 0,
            transfers: 0,
            transfer_times_estimated: true,
            legs: Vec::new(),
            unreachable: true,
        });
    };

    let legs = reconstruct(doc, idx, rounds, k, stop, req.transfer_buffer_s);
    let ride_count = legs
        .iter()
        .filter(|l| matches!(l, PlanLeg::Ride { .. }))
        .count();
    let depart_sec = legs
        .iter()
        .find_map(|l| match l {
            PlanLeg::Ride { board_sec, .. } => Some(*board_sec),
            _ => None,
        })
        .unwrap_or(t0);
    let arrive_sec = if ride_count == 0 { t0 } else { arrive };
    Some(RoutePlan {
        depart_sec,
        arrive_sec,
        duration_s: arrive_sec - depart_sec,
        transfers: ride_count.saturating_sub(1),
        transfer_times_estimated: true,
        legs,
        unreachable: false,
    })
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

#[cfg(test)]
mod plan_tests {
    use super::tests_support::routing_doc;
    use super::{PlanLeg, PlanRequest, RouteIndex, plan};
    use crate::model::CacheDoc;

    const WED: u32 = 20260722;

    fn request(from: (u8, u16), to: (u8, u16), sec: f64) -> PlanRequest {
        PlanRequest {
            from,
            to,
            date_yyyymmdd: WED,
            sec_of_day: sec,
            max_transfers: 4,
            max_wait_s: 5_400,
            transfer_buffer_s: 180,
        }
    }

    fn planned(doc: &CacheDoc, req: &PlanRequest) -> super::RoutePlan {
        let idx = RouteIndex::build(doc);
        plan(doc, &idx, req).expect("a well-formed request never returns None")
    }

    #[test]
    fn a_single_leg_plan_boards_the_next_departure_and_rides_to_the_target() {
        let doc = routing_doc();
        // 09:43:20. Pattern 0's next run starts 36000 and departs A0 at 36030.
        let p = planned(&doc, &request((0, 0), (0, 2), 35_000.0));
        assert!(!p.unreachable);
        assert_eq!(p.transfers, 0);
        assert_eq!(p.depart_sec, 36_030, "depart_sec is the first BOARDING");
        assert_eq!(p.arrive_sec, 36_600);
        assert_eq!(p.duration_s, 570, "the initial wait is excluded");
        assert_eq!(p.legs.len(), 1);
        let PlanLeg::Ride {
            route_idx,
            ref route_name,
            ref color_rgb,
            ref headsign,
            direction,
            run_idx,
            board_station_idx,
            ref board_name,
            board_sec,
            alight_station_idx,
            ref alight_name,
            alight_sec,
            ref intermediate_stops,
            ..
        } = p.legs[0]
        else {
            panic!("expected a ride leg, got {:?}", p.legs[0]);
        };
        assert_eq!(route_idx, 0);
        assert_eq!(route_name, "Line A");
        assert_eq!(
            color_rgb, "#65B724",
            "a #RRGGBB string, not RunDetail's u32"
        );
        assert_eq!(headsign, "A2");
        assert_eq!(direction, 0);
        assert_eq!(run_idx, 0);
        assert_eq!(
            (board_station_idx, board_name.as_str(), board_sec),
            (0, "A0", 36_030)
        );
        assert_eq!(
            (alight_station_idx, alight_name.as_str(), alight_sec),
            (2, "A2", 36_600)
        );
        assert_eq!(intermediate_stops, &vec!["A1".to_string()]);
    }

    #[test]
    fn ride_arcs_come_from_the_pattern_not_the_station() {
        // The fixture gives A1 a PatternStop::arc_m of 5000 and a
        // StationDoc::arc_m of 1000 — the MRT-Blue-at-Tha-Phra divergence.
        // The map highlight draws on these, so reading the wrong field would
        // sweep the overlay kilometres across the map.
        let doc = routing_doc();
        let p = planned(&doc, &request((0, 1), (0, 2), 35_000.0));
        let PlanLeg::Ride {
            board_arc_m,
            alight_arc_m,
            ..
        } = p.legs[0]
        else {
            panic!("expected a ride leg");
        };
        assert_eq!(
            board_arc_m, 5000.0,
            "PatternStop::arc_m, not StationDoc's 1000"
        );
        assert_eq!(alight_arc_m, 2000.0);
    }

    #[test]
    fn a_structurally_invalid_request_is_none_not_an_empty_plan() {
        // None means "bad indices"; Some(unreachable) means "nothing
        // connects" — the UI says different things for each, so the two must
        // never collapse into one value.
        let doc = routing_doc();
        let idx = RouteIndex::build(&doc);
        assert!(plan(&doc, &idx, &request((9, 0), (0, 2), 35_000.0)).is_none());
        assert!(plan(&doc, &idx, &request((0, 0), (0, 99), 35_000.0)).is_none());
    }

    #[test]
    fn a_later_query_boards_the_later_run_of_the_same_pattern() {
        let doc = routing_doc();
        // After 36030 has gone, the 36600 run departs A0 at 36630.
        let p = planned(&doc, &request((0, 0), (0, 2), 36_100.0));
        assert_eq!(p.depart_sec, 36_630);
        assert_eq!(p.arrive_sec, 37_200);
        let PlanLeg::Ride { run_idx, .. } = p.legs[0] else {
            panic!("expected a ride leg");
        };
        assert_eq!(run_idx, 1);
    }

    #[test]
    fn a_journey_spanning_midnight_uses_the_tomorrow_frame() {
        let doc = routing_doc();
        // 23:53:20. The only boardable run is pattern 0's 00:08:20 start,
        // filed on the NEXT service day: departs A0 at 500 + 30 + 86400.
        let p = planned(&doc, &request((0, 0), (0, 2), 86_000.0));
        assert!(!p.unreachable, "the D+1 frame must find it");
        assert_eq!(p.depart_sec, 86_930);
        assert_eq!(p.arrive_sec, 87_500);
        assert_eq!(p.duration_s, 570);
    }

    #[test]
    fn origin_equals_destination_is_a_trivial_zero_leg_plan_not_an_error() {
        let doc = routing_doc();
        let p = planned(&doc, &request((0, 1), (0, 1), 35_000.0));
        assert!(!p.unreachable);
        assert!(p.legs.is_empty());
        assert_eq!(p.transfers, 0);
        assert_eq!(
            (p.depart_sec, p.arrive_sec, p.duration_s),
            (35_000, 35_000, 0)
        );
    }

    #[test]
    fn transfer_times_estimated_is_always_true() {
        // The disclosure hook. It is a property of the MODEL (one flat buffer
        // for every interchange), not of a particular plan, so it must not
        // start varying with whether a plan happens to contain a transfer —
        // the UI decides when to SHOW the note, the engine states the fact.
        let doc = routing_doc();
        assert!(planned(&doc, &request((0, 0), (0, 2), 35_000.0)).transfer_times_estimated);
        assert!(planned(&doc, &request((0, 1), (0, 1), 35_000.0)).transfer_times_estimated);
    }

    #[test]
    fn a_two_leg_plan_transfers_across_the_interchange() {
        let doc = routing_doc();
        // A0 -> B1. Ride pattern 0 (36030 -> A2 at 36600), walk to B0 with the
        // 180 s buffer (ready 36780), so pattern 1's 36600 run — departing B0
        // at 36630 — is NOT catchable; the 37200 run is.
        let p = planned(&doc, &request((0, 0), (1, 1), 35_000.0));
        assert!(!p.unreachable);
        assert_eq!(p.transfers, 1);
        assert_eq!(p.legs.len(), 3, "ride, transfer, ride");
        assert_eq!(p.depart_sec, 36_030);
        assert_eq!(p.arrive_sec, 37_500);
        assert_eq!(p.duration_s, 1_470);

        let PlanLeg::Transfer {
            from_route_idx,
            from_station_idx,
            to_route_idx,
            to_station_idx,
            walk_m,
            transfer_s,
            wait_s,
        } = p.legs[1]
        else {
            panic!("leg 1 must be the transfer, got {:?}", p.legs[1]);
        };
        assert_eq!((from_route_idx, from_station_idx), (0, 2));
        assert_eq!((to_route_idx, to_station_idx), (1, 0));
        assert_eq!(transfer_s, 180, "the flat buffer, charged as routing cost");
        assert!((walk_m - 100.0).abs() < 1e-3, "display-only context");
        // 37230 (board) - 36600 (alight) - 180 (buffer) = 450.
        assert_eq!(wait_s, 450);

        let PlanLeg::Ride {
            run_idx, route_idx, ..
        } = p.legs[2]
        else {
            panic!("leg 2 must be a ride");
        };
        assert_eq!((route_idx, run_idx), (1, 3));
    }

    #[test]
    fn walking_distance_never_changes_the_routing_cost() {
        // Distance-derived transfer time was considered and declined. Blow the
        // walk up 40x by moving Line B's track: the plan must be identical.
        let mut doc = routing_doc();
        doc.routes[1].track_xyz = vec![[6000.0, 0.0, 15.0], [7000.0, 0.0, 15.0]];
        let p = planned(&doc, &request((0, 0), (1, 1), 35_000.0));
        let PlanLeg::Transfer {
            walk_m,
            transfer_s,
            wait_s,
            ..
        } = p.legs[1]
        else {
            panic!("expected a transfer leg");
        };
        assert!((walk_m - 4000.0).abs() < 1e-3, "distance really did change");
        assert_eq!(transfer_s, 180, "the cost did not");
        assert_eq!(wait_s, 450);
        assert_eq!(p.arrive_sec, 37_500);
    }

    #[test]
    fn max_transfers_caps_the_number_of_boardings() {
        let doc = routing_doc();
        let mut req = request((0, 0), (1, 1), 35_000.0);
        req.max_transfers = 0; // one boarding only
        let p = planned(&doc, &req);
        assert!(p.unreachable, "B1 needs a second boarding");
        assert!(p.legs.is_empty());
        req.max_transfers = 1;
        assert!(!planned(&doc, &req).unreachable);
    }

    #[test]
    fn a_saturday_query_never_boards_a_sunday_only_run() {
        // The fixture's run 5 (pattern 1, start 36800) is on a Sunday-only
        // service — exactly the MRT Blue split-service shape. It departs B0 at
        // 36830, which clears the 36780 transfer-ready time, so a
        // calendar-blind search WOULD take it and arrive 400 s early.
        let doc = routing_doc();
        const SAT: u32 = 20260725;
        const SUN: u32 = 20260726;

        let mut req = request((0, 0), (1, 1), 35_000.0);
        req.date_yyyymmdd = SAT;
        assert_eq!(
            planned(&doc, &req).arrive_sec,
            37_500,
            "Saturday takes the all-days run"
        );

        req.date_yyyymmdd = SUN;
        assert_eq!(
            planned(&doc, &req).arrive_sec,
            37_100,
            "Sunday may take the Sunday run"
        );
    }

    #[test]
    fn one_plan_can_span_a_frequency_shaped_and_a_concrete_departure_pattern() {
        // Pattern 0 is the frequency-expanded shape (one pattern, several
        // starts a headway apart); pattern 1 is the concrete-departure shape.
        // Both reach sim-core as plain RunDocs — expand_frequency only ever
        // runs in the preprocessor — so a single plan crossing both is the
        // real mixed-shape journey, not a special case.
        let doc = routing_doc();
        let p = planned(&doc, &request((0, 0), (1, 1), 35_000.0));
        let rides: Vec<u32> = p
            .legs
            .iter()
            .filter_map(|l| match l {
                PlanLeg::Ride { run_idx, .. } => Some(*run_idx),
                _ => None,
            })
            .collect();
        assert_eq!(rides, vec![0, 3]);
    }

    #[test]
    fn the_result_is_deterministic_across_repeated_builds() {
        // Pattern scanning is driven off a HashMap whose iteration order is
        // seeded per process; the scan list is sorted before use so a tie can
        // never resolve differently run to run (the same nondeterminism
        // sort_snap_warnings closed in the preprocessor).
        let doc = routing_doc();
        let first = planned(&doc, &request((0, 0), (1, 1), 35_000.0));
        for _ in 0..25 {
            let again = planned(&doc, &request((0, 0), (1, 1), 35_000.0));
            assert_eq!(again.arrive_sec, first.arrive_sec);
            assert_eq!(again.legs.len(), first.legs.len());
            assert_eq!(
                format!("{:?}", again.legs),
                format!("{:?}", first.legs),
                "leg-for-leg identical"
            );
        }
    }
}
