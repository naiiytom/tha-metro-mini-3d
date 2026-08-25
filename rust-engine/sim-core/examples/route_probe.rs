//! Diagnostic tool for routing/interchange issues (issue #27) — NOT a test
//! or a gate. It prints to stdout, asserts nothing, and reads the
//! already-committed `public/data/network.tmb` directly rather than
//! synthetic fixtures, so it reflects real cache data. Run manually with
//! `cargo run -p sim-core --example route_probe` (from the repo root — it
//! looks for `public/data/network.tmb` relative to the cwd) whenever
//! investigating a routing or interchange defect; it is not part of
//! `cargo test` or CI.
//!
//! Three sections, in order:
//! 1. Interchange dump — every currently-LINKED interchange pair with its
//!    walking distance.
//! 2. Gap detection — every pair of stations on DIFFERENT lines within
//!    800 m that is NOT linked, the diagnostic that originally justified
//!    this file's existence (finding real interchange gaps like the ones
//!    later closed via `INTERCHANGE_OVERRIDES`).
//! 3. Named-pair probes (`PROBES` below) — a small fixed set of real
//!    origin/destination pairs run through the actual route planner
//!    (`world.plan_route`), for a manual sanity check of specific
//!    known-interesting routes (cross-city pairs, an APM-involving pair).

use sim_core::{PlanRequest, SimWorld};

const PROBES: &[(&str, &str)] = &[
    ("Siam", "Asok"),
    ("Siam", "Chatuchak Park"),
    ("Mo Chit", "Suvarnabhumi"),
    ("Bang Wa", "Tao Poon"),
    ("Siam", "Suvarnabhumi Main Terminal"),
];

const DATE: u32 = 20260824;
const SEC_OF_DAY: f64 = 17.0 * 3600.0;

fn main() {
    let bytes = std::fs::read("public/data/network.tmb")
        .expect("run from the repo root — public/data/network.tmb not found");
    let world = SimWorld::from_bytes(&bytes).expect("cache failed to decode");
    let doc = world.doc();

    let find = |name: &str| -> Option<(u8, u16)> {
        for (r, route) in doc.routes.iter().enumerate() {
            for (s, station) in route.stations.iter().enumerate() {
                if station.name_en == name {
                    return Some((r as u8, s as u16));
                }
            }
        }
        None
    };

    println!("=== Station Interchanges Dump ===");
    let mut total_interchanges = 0;
    for (r_idx, route) in doc.routes.iter().enumerate() {
        for station in &route.stations {
            for ix in &station.interchanges {
                // Avoid double printing by only showing when r_idx < ix.route_idx
                if (r_idx as u16) < ix.route_idx {
                    let other_route = &doc.routes[ix.route_idx as usize];
                    let other_station = &other_route.stations[ix.station_idx as usize];
                    let [ax, ay, _] = sim_core::world::position_at_arc(route, station.arc_m);
                    let [bx, by, _] =
                        sim_core::world::position_at_arc(other_route, other_station.arc_m);
                    let walk_m = ((bx - ax) as f64).hypot((by - ay) as f64);
                    println!(
                        "  [{}] {} ({}) <-> [{}] {} ({}): {:.1} m",
                        route.line_key,
                        station.name_en,
                        station.gtfs_stop_id,
                        other_route.line_key,
                        other_station.name_en,
                        other_station.gtfs_stop_id,
                        walk_m
                    );
                    total_interchanges += 1;
                }
            }
        }
    }
    println!("Total linked interchange pairs: {total_interchanges}");

    println!("\n=== All UNLINKED Inter-Line Station Pairs within 800m ===");
    for r1 in 0..doc.routes.len() {
        for r2 in (r1 + 1)..doc.routes.len() {
            let route1 = &doc.routes[r1];
            let route2 = &doc.routes[r2];
            for st1 in &route1.stations {
                for (s2, st2) in route2.stations.iter().enumerate() {
                    let is_linked = st1
                        .interchanges
                        .iter()
                        .any(|ix| ix.route_idx == r2 as u16 && ix.station_idx == s2 as u16);
                    let [ax, ay, _] = sim_core::world::position_at_arc(route1, st1.arc_m);
                    let [bx, by, _] = sim_core::world::position_at_arc(route2, st2.arc_m);
                    let walk_m = ((bx - ax) as f64).hypot((by - ay) as f64);

                    if !is_linked && walk_m <= 800.0 {
                        println!(
                            "  UNLINKED ({:.1}m): [{}] {} ({}) <-> [{}] {} ({})",
                            walk_m,
                            route1.line_key,
                            st1.name_en,
                            st1.gtfs_stop_id,
                            route2.line_key,
                            st2.name_en,
                            st2.gtfs_stop_id
                        );
                    }
                }
            }
        }
    }

    // Section 3: named-pair probes — run each fixed origin/destination
    // through the real planner and print the resulting plan (or why there
    // isn't one) for manual inspection.
    for (from_name, to_name) in PROBES {
        println!("\n=== {from_name} -> {to_name} ===");
        let (Some(from), Some(to)) = (find(from_name), find(to_name)) else {
            println!("  SKIP: station name not found in the cache");
            continue;
        };
        let req = PlanRequest {
            from,
            to,
            date_yyyymmdd: DATE,
            sec_of_day: SEC_OF_DAY,
            max_transfers: 4,
            max_wait_s: 5400,
            transfer_buffer_s: 180,
        };
        match world.plan_route(&req) {
            None => println!("  NO PLAN — structurally invalid request (bad index)"),
            Some(plan) if plan.unreachable => {
                println!("  UNREACHABLE — well-formed, but no path exists in the graph")
            }
            Some(plan) => println!(
                "{}",
                serde_json::to_string_pretty(&plan).expect("RoutePlan is Serialize")
            ),
        }
    }
}
