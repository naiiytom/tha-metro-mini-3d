//! Debug helper: evaluate a .tmb cache at a Bangkok-local date/time.
//! Usage: cargo run -p sim-core --example inspect -- <path.tmb> <YYYYMMDD> <sec_of_day>

use sim_core::{MAX_VEHICLES, SimWorld, VEHICLE_STRIDE};

fn main() {
    let mut args = std::env::args().skip(1);
    let path = args
        .next()
        .expect("usage: inspect <path.tmb> <YYYYMMDD> <sec_of_day>");
    let date: u32 = args.next().expect("date").parse().unwrap();
    let sec: f64 = args.next().expect("sec").parse().unwrap();

    let bytes = std::fs::read(&path).expect("read cache");
    let world = SimWorld::from_bytes(&bytes).expect("parse cache");
    println!("{:?}", world.validation());

    let mut buf = vec![0.0f32; MAX_VEHICLES * VEHICLE_STRIDE];
    let n = world.evaluate(date, sec, &mut buf);
    let mut per_route = [0usize; 8];
    let mut dwell = 0usize;
    for i in 0..n {
        let r = &buf[i * 8..i * 8 + 8];
        per_route[r[6] as usize] += 1;
        if r[4] == 0.0 {
            dwell += 1;
        }
    }
    println!(
        "date={date} sec={sec}: {n} vehicles (route0={}, route1={}, dwelling={dwell})",
        per_route[0], per_route[1]
    );
    for i in 0..n.min(5) {
        let r = &buf[i * 8..i * 8 + 8];
        println!(
            "  run={} route={} x={:.1} y={:.1} z={:.1} yaw={:.2} state={} progress={:.2}",
            r[5], r[6], r[0], r[1], r[2], r[3], r[4], r[7]
        );
    }
}
