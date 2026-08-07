//! SimWorld — schedule evaluation (contract §3). Pure Rust, no wasm deps.

use serde::Serialize;

use crate::calendar::{previous_date, service_active_on};
use crate::model::{CacheDoc, PatternDoc, RouteDoc, TMB_MAGIC, TMB_VERSION};

pub const VEHICLE_STRIDE: usize = 8; // f32 lanes per vehicle
/// Frame-buffer capacity. Sized well above SRS NF1's 300-concurrent target so
/// a network peak is never silently clipped; the cost is buffer memory only
/// (1024 * 8 * 4 = 32 KB per frame buffer, 3 in the pool).
pub const MAX_VEHICLES: usize = 1024;

pub const STATE_DWELL: f32 = 0.0;
pub const STATE_TRANSIT: f32 = 1.0;

#[derive(Debug)]
pub enum CacheError {
    Decode(String),
    BadMagic(u32),
    BadVersion(u16),
    Invalid(String),
}

impl std::fmt::Display for CacheError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            CacheError::Decode(e) => write!(f, "cache decode failed: {e}"),
            CacheError::BadMagic(m) => write!(f, "bad cache magic 0x{m:08X}"),
            CacheError::BadVersion(v) => write!(f, "unsupported cache version {v}"),
            CacheError::Invalid(e) => write!(f, "invalid cache: {e}"),
        }
    }
}

impl std::error::Error for CacheError {}

/// Counts surfaced to the report and the UI (MVP 2 DoD artifact).
#[derive(Debug, Clone, Serialize)]
pub struct ValidationSummary {
    pub feed_version: String,
    pub routes: usize,
    pub stations: usize,
    pub patterns: usize,
    pub runs: usize,
    pub services: usize,
}

pub struct SimWorld {
    doc: CacheDoc,
    /// Per pattern: relative time of the final arrival (run duration).
    pattern_dur: Vec<f64>,
    /// True if the last evaluate() hit MAX_VEHICLES and dropped vehicles.
    /// `evaluate` takes `&self` (it's called from a shared reference on the
    /// frame path), so recording this needs interior mutability. `Cell` is
    /// safe here — not `Mutex`/`Atomic` — because SimWorld lives inside a
    /// single Web Worker and `evaluate` is never called concurrently from
    /// more than one thread.
    truncated: std::cell::Cell<bool>,
}

/// `3p² − 2p³` easing used for inter-station legs (F2.2).
pub fn smoothstep(p: f64) -> f64 {
    let p = p.clamp(0.0, 1.0);
    p * p * (3.0 - 2.0 * p)
}

struct Pose {
    arc: f32,
    reverse: bool, // travelling toward decreasing arc
    state: f32,
    progress: f32,
}

impl SimWorld {
    pub fn from_bytes(bytes: &[u8]) -> Result<Self, CacheError> {
        let (doc, _len): (CacheDoc, usize) =
            bincode::serde::decode_from_slice(bytes, bincode::config::standard())
                .map_err(|e| CacheError::Decode(e.to_string()))?;
        Self::from_doc(doc)
    }

    pub fn from_doc(doc: CacheDoc) -> Result<Self, CacheError> {
        if doc.magic != TMB_MAGIC {
            return Err(CacheError::BadMagic(doc.magic));
        }
        if doc.version != TMB_VERSION {
            return Err(CacheError::BadVersion(doc.version));
        }
        for (i, p) in doc.patterns.iter().enumerate() {
            if p.stops.is_empty() {
                return Err(CacheError::Invalid(format!("pattern {i} has no stops")));
            }
            if (p.route_idx as usize) >= doc.routes.len() {
                return Err(CacheError::Invalid(format!("pattern {i} bad route_idx")));
            }
        }
        for (i, r) in doc.runs.iter().enumerate() {
            if (r.pattern_idx as usize) >= doc.patterns.len() {
                return Err(CacheError::Invalid(format!("run {i} bad pattern_idx")));
            }
            if (r.service_idx as usize) >= doc.services.len() {
                return Err(CacheError::Invalid(format!("run {i} bad service_idx")));
            }
        }
        let pattern_dur = doc
            .patterns
            .iter()
            .map(|p| p.stops.last().map(|s| s.arrival_s as f64).unwrap_or(0.0))
            .collect();
        Ok(Self {
            doc,
            pattern_dur,
            truncated: std::cell::Cell::new(false),
        })
    }

    pub fn doc(&self) -> &CacheDoc {
        &self.doc
    }

    pub fn validation(&self) -> ValidationSummary {
        ValidationSummary {
            feed_version: self.doc.feed_version.clone(),
            routes: self.doc.routes.len(),
            stations: self.doc.routes.iter().map(|r| r.stations.len()).sum(),
            patterns: self.doc.patterns.len(),
            runs: self.doc.runs.len(),
            services: self.doc.services.len(),
        }
    }

    /// Evaluate scheduled vehicle states at an absolute Bangkok local time.
    /// Also evaluates the PREVIOUS service day's runs at `sec_of_day + 86400`
    /// to catch post-midnight spillover. Writes stride-8 records into `out`,
    /// returns the vehicle count.
    pub fn evaluate(&self, date_yyyymmdd: u32, sec_of_day: f64, out: &mut [f32]) -> usize {
        assert!(
            out.len() >= MAX_VEHICLES * VEHICLE_STRIDE,
            "out buffer too small"
        );
        self.truncated.set(false);
        let prev = previous_date(date_yyyymmdd);
        let active_today: Vec<bool> = self
            .doc
            .services
            .iter()
            .map(|s| service_active_on(s, date_yyyymmdd))
            .collect();
        let active_prev: Vec<bool> = self
            .doc
            .services
            .iter()
            .map(|s| service_active_on(s, prev))
            .collect();

        let mut count = 0usize;
        for (run_idx, run) in self.doc.runs.iter().enumerate() {
            if count >= MAX_VEHICLES {
                self.truncated.set(true);
                break;
            }
            let dur = self.pattern_dur[run.pattern_idx as usize];
            let pattern = &self.doc.patterns[run.pattern_idx as usize];
            let svc = run.service_idx as usize;

            for (active, t_abs) in [
                (active_today[svc], sec_of_day),
                (active_prev[svc], sec_of_day + 86_400.0),
            ] {
                if !active {
                    continue;
                }
                let t = t_abs - run.start_sec as f64;
                if t < 0.0 || t > dur {
                    continue; // inactive before first arrival / after last arrival
                }
                if let Some(pose) = eval_pattern(pattern, t) {
                    if count >= MAX_VEHICLES {
                        self.truncated.set(true);
                        break;
                    }
                    let route = &self.doc.routes[pattern.route_idx as usize];
                    let (pos, tangent_yaw) = sample_track(route, pose.arc, pose.reverse);
                    let yaw = if pose.reverse {
                        wrap_pi(tangent_yaw + std::f32::consts::PI)
                    } else {
                        tangent_yaw
                    };
                    let o = count * VEHICLE_STRIDE;
                    out[o] = pos[0];
                    out[o + 1] = pos[1];
                    out[o + 2] = pos[2];
                    out[o + 3] = yaw;
                    out[o + 4] = pose.state;
                    out[o + 5] = run_idx as f32;
                    out[o + 6] = pattern.route_idx as f32;
                    out[o + 7] = pose.progress;
                    count += 1;
                }
            }
        }
        count
    }

    /// True if the most recent `evaluate()` call hit `MAX_VEHICLES` and
    /// dropped one or more vehicles (biased toward high run indices — see
    /// `evaluate`'s run-order iteration). Cheap to poll after every frame;
    /// callers that care (the worker, the preprocessor's peak scan) can
    /// surface it instead of the failure silently looking like a data bug.
    pub fn last_truncated(&self) -> bool {
        self.truncated.get()
    }
}

/// Motion math (F2.1/F2.2): dwell/transit classification + eased arc.
fn eval_pattern(pattern: &PatternDoc, t: f64) -> Option<Pose> {
    let stops = &pattern.stops;
    let last = stops.last()?;
    if t < 0.0 || t > last.arrival_s as f64 {
        return None;
    }
    // Index of the last stop whose arrival time is <= t (t >= 0 = arr of stop 0).
    let i = stops.partition_point(|s| (s.arrival_s as f64) <= t);
    let cur = i.saturating_sub(1);
    let a = &stops[cur];

    // Direction helper: reverse = travelling toward decreasing arc.
    let leg_reverse = |from: usize, to: usize| stops[to].arc_m < stops[from].arc_m;

    if t <= a.departure_s as f64 {
        // Dwelling at station `cur` (arr_A <= t <= dep_A).
        let reverse = if cur + 1 < stops.len() {
            leg_reverse(cur, cur + 1)
        } else if cur > 0 {
            leg_reverse(cur - 1, cur)
        } else {
            false
        };
        return Some(Pose {
            arc: a.arc_m,
            reverse,
            state: STATE_DWELL,
            progress: 0.0,
        });
    }

    // In transit toward stop cur+1 (must exist: t <= last arrival).
    let b = stops.get(cur + 1)?;
    let denom = b.arrival_s as f64 - a.departure_s as f64;
    let p = if denom > 0.0 {
        (t - a.departure_s as f64) / denom
    } else {
        1.0
    };
    let s = smoothstep(p);
    let arc = a.arc_m as f64 + (b.arc_m as f64 - a.arc_m as f64) * s;
    Some(Pose {
        arc: arc as f32,
        reverse: b.arc_m < a.arc_m,
        state: STATE_TRANSIT,
        progress: s as f32,
    })
}

/// Binary-search `track_arc_m`, lerp the two bracketing polyline points.
/// Returns ([x, y, z], tangent yaw radians CCW from +x).
///
/// When `arc` falls exactly on a polyline vertex the tangent is ambiguous;
/// `reverse` selects the segment lying in the direction of travel (the
/// preceding one for reverse travel), so dwell headings at stations are
/// correct in both directions.
fn sample_track(route: &RouteDoc, arc: f32, reverse: bool) -> ([f32; 3], f32) {
    let arcs = &route.track_arc_m;
    let pts = &route.track_xyz;
    debug_assert!(arcs.len() == pts.len() && arcs.len() >= 2);
    let total = *arcs.last().unwrap();
    let arc = arc.clamp(0.0, total);
    // Segment j bracketing `arc` (vertex ties resolved by travel direction).
    let k = if reverse {
        arcs.partition_point(|&a| a < arc)
    } else {
        arcs.partition_point(|&a| a <= arc)
    };
    let j = k.saturating_sub(1).min(arcs.len() - 2);
    let seg = arcs[j + 1] - arcs[j];
    let u = if seg > 0.0 {
        (arc - arcs[j]) / seg
    } else {
        0.0
    };
    let p0 = pts[j];
    let p1 = pts[j + 1];
    let pos = [
        p0[0] + (p1[0] - p0[0]) * u,
        p0[1] + (p1[1] - p0[1]) * u,
        p0[2] + (p1[2] - p0[2]) * u,
    ];
    let yaw = (p1[1] - p0[1]).atan2(p1[0] - p0[0]);
    (pos, yaw)
}

/// Position on a route's track at an arc-length offset, in the local ENU meter
/// frame. Used by `query::stations` so station hit-test targets sit exactly on
/// the rendered track.
pub fn position_at_arc(route: &RouteDoc, arc: f32) -> [f32; 3] {
    sample_track(route, arc, false).0
}

fn wrap_pi(a: f32) -> f32 {
    let mut a = a;
    while a > std::f32::consts::PI {
        a -= 2.0 * std::f32::consts::PI;
    }
    while a < -std::f32::consts::PI {
        a += 2.0 * std::f32::consts::PI;
    }
    a
}

/// Synthetic fixture shared by the world and query test modules.
#[cfg(test)]
pub(crate) mod tests_support {
    use crate::model::*;

    pub(crate) fn synthetic_doc() -> CacheDoc {
        // Straight track along +x: 3 points, 100 m apart, then a corner north.
        let route = RouteDoc {
            gtfs_route_id: "1".into(),
            line_key: "test".into(),
            simulated: true,
            name_en: "Test".into(),
            color_rgb: 0x65B724,
            track_xyz: vec![[0.0, 0.0, 15.0], [100.0, 0.0, 15.0], [100.0, 100.0, 15.0]],
            track_arc_m: vec![0.0, 100.0, 200.0],
            stations: vec![
                StationDoc {
                    gtfs_stop_id: "A".into(),
                    code: "".into(),
                    name_en: "A".into(),
                    name_th: "".into(),
                    arc_m: 0.0,
                    interchanges: Vec::new(),
                },
                StationDoc {
                    gtfs_stop_id: "B".into(),
                    code: "".into(),
                    name_en: "B".into(),
                    name_th: "".into(),
                    arc_m: 100.0,
                    interchanges: Vec::new(),
                },
                StationDoc {
                    gtfs_stop_id: "C".into(),
                    code: "".into(),
                    name_en: "C".into(),
                    name_th: "".into(),
                    arc_m: 200.0,
                    interchanges: Vec::new(),
                },
            ],
        };
        // Pattern 0 (direction 0, increasing arc): A(0,30) -> B(100,130) -> C(200,200)
        let pat0 = PatternDoc {
            gtfs_trip_id: "t0".into(),
            route_idx: 0,
            direction: 0,
            headsign_en: "C".into(),
            stops: vec![
                PatternStop {
                    station_idx: 0,
                    arrival_s: 0,
                    departure_s: 30,
                    arc_m: 0.0,
                },
                PatternStop {
                    station_idx: 1,
                    arrival_s: 100,
                    departure_s: 130,
                    arc_m: 100.0,
                },
                PatternStop {
                    station_idx: 2,
                    arrival_s: 200,
                    departure_s: 200,
                    arc_m: 200.0,
                },
            ],
        };
        // Pattern 1 (direction_id 1, DEcreasing arc): B(0,10) -> A(100,100)
        let pat1 = PatternDoc {
            gtfs_trip_id: "t1".into(),
            route_idx: 0,
            direction: 1,
            headsign_en: "A".into(),
            stops: vec![
                PatternStop {
                    station_idx: 1,
                    arrival_s: 0,
                    departure_s: 10,
                    arc_m: 100.0,
                },
                PatternStop {
                    station_idx: 0,
                    arrival_s: 100,
                    departure_s: 100,
                    arc_m: 0.0,
                },
            ],
        };
        let weekday = ServiceDoc {
            gtfs_service_id: "1".into(),
            weekday_mask: 0b0001_1111,
            start_date: 20230101,
            end_date: 20261231,
            added_dates: vec![],
            removed_dates: vec![20260730],
        };
        CacheDoc {
            magic: TMB_MAGIC,
            version: TMB_VERSION,
            feed_version: "test".into(),
            generated_unix: 0,
            origin_lng: 100.5332,
            origin_lat: 13.7456,
            routes: vec![route],
            services: vec![weekday],
            patterns: vec![pat0, pat1],
            runs: vec![
                RunDoc {
                    pattern_idx: 0,
                    service_idx: 0,
                    start_sec: 36_000,
                }, // 10:00
                RunDoc {
                    pattern_idx: 1,
                    service_idx: 0,
                    start_sec: 36_000,
                },
                RunDoc {
                    pattern_idx: 0,
                    service_idx: 0,
                    start_sec: 86_350,
                }, // 23:59:10, spills past midnight
            ],
        }
    }

    /// A synthetic world with `n + 1` runs that are all simultaneously active
    /// (one shared pattern with a very long duration, every run starting at
    /// t=0) — used to exercise `MAX_VEHICLES` truncation without depending on
    /// real GTFS data.
    pub(crate) fn world_with_more_runs_than(n: usize) -> super::SimWorld {
        let route = RouteDoc {
            gtfs_route_id: "1".into(),
            line_key: "test".into(),
            simulated: true,
            name_en: "Test".into(),
            color_rgb: 0x65B724,
            track_xyz: vec![[0.0, 0.0, 15.0], [1000.0, 0.0, 15.0]],
            track_arc_m: vec![0.0, 1000.0],
            stations: vec![
                StationDoc {
                    gtfs_stop_id: "A".into(),
                    code: "".into(),
                    name_en: "A".into(),
                    name_th: "".into(),
                    arc_m: 0.0,
                    interchanges: Vec::new(),
                },
                StationDoc {
                    gtfs_stop_id: "B".into(),
                    code: "".into(),
                    name_en: "B".into(),
                    name_th: "".into(),
                    arc_m: 1000.0,
                    interchanges: Vec::new(),
                },
            ],
        };
        let pattern = PatternDoc {
            gtfs_trip_id: "t".into(),
            route_idx: 0,
            direction: 0,
            headsign_en: "B".into(),
            stops: vec![
                PatternStop {
                    station_idx: 0,
                    arrival_s: 0,
                    departure_s: 0,
                    arc_m: 0.0,
                },
                PatternStop {
                    station_idx: 1,
                    arrival_s: 100_000,
                    departure_s: 100_000,
                    arc_m: 1000.0,
                },
            ],
        };
        let service = ServiceDoc {
            gtfs_service_id: "s".into(),
            weekday_mask: 0b0111_1111,
            start_date: 20_200_101,
            end_date: 20_301_231,
            added_dates: vec![],
            removed_dates: vec![],
        };
        let runs = (0..=n)
            .map(|_| RunDoc {
                pattern_idx: 0,
                service_idx: 0,
                start_sec: 0,
            })
            .collect();
        let doc = CacheDoc {
            magic: TMB_MAGIC,
            version: TMB_VERSION,
            feed_version: "test".into(),
            generated_unix: 0,
            origin_lng: 100.5332,
            origin_lat: 13.7456,
            routes: vec![route],
            services: vec![service],
            patterns: vec![pattern],
            runs,
        };
        super::SimWorld::from_doc(doc).unwrap()
    }
}

#[cfg(test)]
mod tests {
    use super::tests_support::{synthetic_doc, world_with_more_runs_than};
    use super::*;

    fn world() -> SimWorld {
        SimWorld::from_doc(synthetic_doc()).unwrap()
    }

    fn eval(w: &SimWorld, date: u32, sec: f64) -> Vec<[f32; 8]> {
        let mut buf = vec![0.0f32; MAX_VEHICLES * VEHICLE_STRIDE];
        let n = w.evaluate(date, sec, &mut buf);
        (0..n)
            .map(|i| {
                let mut r = [0.0f32; 8];
                r.copy_from_slice(&buf[i * 8..i * 8 + 8]);
                r
            })
            .collect()
    }

    fn find_run(v: &[[f32; 8]], run_idx: usize) -> Option<[f32; 8]> {
        v.iter().copied().find(|r| r[5] == run_idx as f32)
    }

    const WED: u32 = 20260722; // ordinary Wednesday (weekday service active)
    const THU_HOLIDAY: u32 = 20260730; // removed date

    #[test]
    fn smoothstep_endpoints_midpoint() {
        assert_eq!(smoothstep(0.0), 0.0);
        assert_eq!(smoothstep(1.0), 1.0);
        assert_eq!(smoothstep(0.5), 0.5);
        assert!(smoothstep(-0.5) == 0.0 && smoothstep(1.5) == 1.0); // clamped
        assert!(smoothstep(0.25) < 0.25); // ease-in
        assert!(smoothstep(0.75) > 0.75); // ease-out
    }

    #[test]
    fn dwell_vs_transit_at_boundaries() {
        let w = world();
        // Run 0 starts 36000. Stop A: arr 0 dep 30; leg A->B (30,100); stop B arr 100 dep 130.
        for (dt, want_state) in [
            (0.0, STATE_DWELL),    // exactly at first arrival
            (30.0, STATE_DWELL),   // exactly at departure -> still dwell
            (30.5, STATE_TRANSIT), // just departed
            (99.5, STATE_TRANSIT),
            (100.0, STATE_DWELL), // exactly at arrival -> dwell
            (130.0, STATE_DWELL),
            (131.0, STATE_TRANSIT),
            (200.0, STATE_DWELL), // final arrival instant (arr==dep)
        ] {
            let v = eval(&w, WED, 36_000.0 + dt);
            let r = find_run(&v, 0).unwrap_or_else(|| panic!("no vehicle at dt={dt}"));
            assert_eq!(r[4], want_state, "state at dt={dt}");
            if want_state == STATE_DWELL {
                assert_eq!(r[7], 0.0, "progress must be 0 while dwelling (dt={dt})");
            } else {
                assert!(
                    r[7] > 0.0 && r[7] < 1.0,
                    "transit progress in (0,1) at dt={dt}"
                );
            }
        }
        // Mid-leg position: dt=65 -> p=0.5 -> s=0.5 -> arc 50 -> x=50.
        let v = eval(&w, WED, 36_065.0);
        let r = find_run(&v, 0).unwrap();
        assert!((r[0] - 50.0).abs() < 1e-3, "x={} at mid-leg", r[0]);
        assert!((r[1] - 0.0).abs() < 1e-3);
        assert_eq!(r[2], 15.0);
    }

    #[test]
    fn no_overshoot_after_final_arrival() {
        let w = world();
        // Run 0 duration 200 s. One instant after the last arrival: gone.
        let v = eval(&w, WED, 36_000.0 + 200.1);
        assert!(find_run(&v, 0).is_none(), "finished run must emit nothing");
        // And before the run starts: nothing either.
        let v = eval(&w, WED, 35_999.0);
        assert!(find_run(&v, 0).is_none());
        // Long after: nothing.
        let v = eval(&w, WED, 50_000.0);
        assert!(find_run(&v, 0).is_none());
    }

    #[test]
    fn yaw_flips_for_direction_1_run() {
        let w = world();
        // Run 0 (dir 0) mid first leg: heading east, yaw ~ 0.
        let v = eval(&w, WED, 36_065.0);
        let r0 = find_run(&v, 0).unwrap();
        assert!(r0[3].abs() < 1e-3, "dir0 yaw={} expected ~0", r0[3]);
        // Run 1 (direction_id 1, arc decreasing) mid leg (dt=55 -> p=0.5, arc 50):
        // same track segment, opposite travel -> yaw ~ pi.
        let r1 = find_run(&v, 1).unwrap();
        assert!(
            (r1[3].abs() - std::f32::consts::PI).abs() < 1e-3,
            "dir1 yaw={} expected ±pi",
            r1[3]
        );
        // While dwelling the yaw also faces direction of travel.
        let v = eval(&w, WED, 36_005.0);
        let r1 = find_run(&v, 1).unwrap();
        assert_eq!(r1[4], STATE_DWELL);
        assert!((r1[3].abs() - std::f32::consts::PI).abs() < 1e-3);
    }

    #[test]
    fn arc_sampling_on_three_point_track() {
        let doc = synthetic_doc();
        let route = &doc.routes[0];
        let cases = [
            (0.0, [0.0, 0.0, 15.0], 0.0),
            (50.0, [50.0, 0.0, 15.0], 0.0),
            (100.0, [100.0, 0.0, 15.0], std::f32::consts::FRAC_PI_2), // vertex -> second segment (north)
            (150.0, [100.0, 50.0, 15.0], std::f32::consts::FRAC_PI_2),
            (200.0, [100.0, 100.0, 15.0], std::f32::consts::FRAC_PI_2),
            (250.0, [100.0, 100.0, 15.0], std::f32::consts::FRAC_PI_2), // clamped past end
            (-10.0, [0.0, 0.0, 15.0], 0.0),                             // clamped before start
        ];
        for (arc, want_pos, want_yaw) in cases {
            let (pos, yaw) = sample_track(route, arc, false);
            for k in 0..3 {
                assert!(
                    (pos[k] - want_pos[k]).abs() < 1e-4,
                    "arc={arc} lane{k} {} vs {}",
                    pos[k],
                    want_pos[k]
                );
            }
            assert!(
                (yaw - want_yaw).abs() < 1e-5,
                "arc={arc} yaw {yaw} vs {want_yaw}"
            );
        }
        // Vertex tangent is direction-aware: at arc=100 travelling in reverse,
        // the preceding (east) segment applies.
        let (pos, yaw) = sample_track(route, 100.0, true);
        assert!((pos[0] - 100.0).abs() < 1e-4 && pos[1].abs() < 1e-4);
        assert!(yaw.abs() < 1e-5, "reverse vertex tangent yaw={yaw}");
    }

    #[test]
    fn service_day_and_post_midnight_spillover() {
        let w = world();
        // Removed holiday (Thursday 2026-07-30): no weekday runs at 10:01.
        assert_eq!(eval(&w, THU_HOLIDAY, 36_060.0).len(), 0);
        // Ordinary Wednesday at 10:01: runs 0 and 1 active.
        assert_eq!(eval(&w, WED, 36_060.0).len(), 2);
        // Saturday: weekday-only service inactive.
        assert_eq!(eval(&w, 20260725, 36_060.0).len(), 0);
        // Spillover: run 2 starts Wed 23:59:10 (86350), lasts 200 s -> ends 00:02:30 Thu.
        // Thu (2026-07-23) 00:00:40 local = sec 40 -> t_rel = 40+86400-86350 = 90.
        let v = eval(&w, 20260723, 40.0);
        let r = find_run(&v, 2).unwrap_or_else(|| panic!("expected spillover vehicle"));
        assert_eq!(r[4], STATE_TRANSIT); // t_rel = 90 -> mid leg A->B
        // Same wall clock but previous day is the removed holiday -> nothing.
        let v = eval(&w, 20260731, 40.0);
        assert!(find_run(&v, 2).is_none());
        // Late Wed evening, run 2 dwelling at its first stop right at start.
        let v = eval(&w, WED, 86_350.0);
        let r = find_run(&v, 2).unwrap();
        assert_eq!(r[4], STATE_DWELL);
    }

    #[test]
    fn max_vehicles_has_headroom_over_the_nf1_target() {
        // SRS NF1 targets 300 concurrent; the buffer must not be the thing
        // that clips a network peak.
        const { assert!(MAX_VEHICLES >= 1024) };
    }

    #[test]
    fn evaluate_reports_when_it_truncates() {
        let world = world_with_more_runs_than(MAX_VEHICLES);
        let mut out = vec![0.0f32; MAX_VEHICLES * VEHICLE_STRIDE];
        let n = world.evaluate(20_260_731, 43_200.0, &mut out);
        assert_eq!(n, MAX_VEHICLES);
        assert!(world.last_truncated(), "a clipped frame must be observable");
    }

    #[test]
    fn from_bytes_roundtrip_and_magic_check() {
        let bytes =
            bincode::serde::encode_to_vec(synthetic_doc(), bincode::config::standard()).unwrap();
        let w = SimWorld::from_bytes(&bytes).unwrap();
        let v = w.validation();
        assert_eq!(v.routes, 1);
        assert_eq!(v.stations, 3);
        assert_eq!(v.patterns, 2);
        assert_eq!(v.runs, 3);
        assert_eq!(v.services, 1);
        assert_eq!(v.feed_version, "test");

        let mut bad = synthetic_doc();
        bad.magic = 0xDEAD_BEEF;
        let bytes = bincode::serde::encode_to_vec(&bad, bincode::config::standard()).unwrap();
        assert!(matches!(
            SimWorld::from_bytes(&bytes),
            Err(CacheError::BadMagic(_))
        ));
    }
}
