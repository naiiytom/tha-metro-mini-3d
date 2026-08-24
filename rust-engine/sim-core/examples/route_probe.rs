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
