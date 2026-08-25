//! metro-sim-wasm — wasm-bindgen bindings over sim-core (contract §4).
//!
//! Regenerate the committed pkg with:
//!   wasm-pack build rust-engine/wasm --release --target web --out-dir ../../src/sim/pkg

use sim_core::{MAX_VEHICLES, PlanRequest, SimWorld, VEHICLE_STRIDE};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct Engine {
    world: SimWorld,
    buf: Vec<f32>, // MAX_VEHICLES * VEHICLE_STRIDE
}

#[wasm_bindgen]
impl Engine {
    #[wasm_bindgen(constructor)]
    pub fn new(cache_bytes: &[u8]) -> Result<Engine, JsError> {
        let world = SimWorld::from_bytes(cache_bytes).map_err(|e| JsError::new(&e.to_string()))?;
        Ok(Engine {
            world,
            buf: vec![0.0; MAX_VEHICLES * VEHICLE_STRIDE],
        })
    }

    /// ValidationSummary as JSON (stations/patterns/runs/services/feed_version).
    pub fn validation_json(&self) -> String {
        serde_json::to_string(&self.world.validation()).unwrap_or_else(|_| "{}".into())
    }

    /// Evaluates into the internal buffer and copies into `out` (a JS-owned
    /// Float32Array view of length >= MAX_VEHICLES*8). Returns vehicle count.
    pub fn evaluate(&mut self, date_yyyymmdd: u32, sec_of_day: f64, out: &mut [f32]) -> usize {
        let count = self
            .world
            .evaluate(date_yyyymmdd, sec_of_day, &mut self.buf);
        let n = count * VEHICLE_STRIDE;
        out[..n].copy_from_slice(&self.buf[..n]);
        count
    }

    // ---- UI-rate schedule queries (contract §7) ---------------------------
    // These return JSON, which is fine because they are called on selection or
    // at ~1 Hz — never on the frame path. Do not call them per frame.

    /// True if the most recent `evaluate()` call hit `MAX_VEHICLES` and
    /// dropped vehicles (contract §3) — call right after `evaluate()`, before
    /// any other call that might re-evaluate the world.
    pub fn last_truncated(&self) -> bool {
        self.world.last_truncated()
    }

    /// `RunDetail` as JSON, or `"null"` when the run is not live at that time.
    pub fn run_detail_json(&self, run_idx: u32, date_yyyymmdd: u32, sec_of_day: f64) -> String {
        match self.world.run_detail(run_idx, date_yyyymmdd, sec_of_day) {
            Some(d) => serde_json::to_string(&d).unwrap_or_else(|_| "null".into()),
            None => "null".into(),
        }
    }

    /// `StationBoard` as JSON, or `"null"` for unknown route/station indices.
    pub fn station_board_json(
        &self,
        route_idx: u8,
        station_idx: u16,
        date_yyyymmdd: u32,
        sec_of_day: f64,
        limit: usize,
    ) -> String {
        match self
            .world
            .station_board(route_idx, station_idx, date_yyyymmdd, sec_of_day, limit)
        {
            Some(b) => serde_json::to_string(&b).unwrap_or_else(|_| "null".into()),
            None => "null".into(),
        }
    }

    /// All stations with ENU positions, as JSON. Fetched once after init.
    pub fn stations_json(&self) -> String {
        serde_json::to_string(&self.world.stations()).unwrap_or_else(|_| "[]".into())
    }

    /// `RoutePlan` as JSON, or `"null"` for a structurally invalid request
    /// (bad route/station index). A well-formed request that simply does not
    /// connect comes back as a real plan with `unreachable: true` — the two
    /// are different answers and the UI says different things for each.
    ///
    /// Nine parameters is past clippy's threshold, and accepted here: this is
    /// ONE UI-rate call per submit, and introducing a second serialization
    /// boundary just to pack the arguments would cost more than it saves.
    /// NOTE this is the FIRST `too_many_arguments` allow in this crate — the
    /// design spec claimed an existing precedent, and there wasn't one.
    #[allow(clippy::too_many_arguments)]
    pub fn plan_route_json(
        &self,
        from_route_idx: u8,
        from_station_idx: u16,
        to_route_idx: u8,
        to_station_idx: u16,
        date_yyyymmdd: u32,
        sec_of_day: f64,
        max_transfers: u8,
        max_wait_s: u32,
        transfer_buffer_s: u32,
    ) -> String {
        let req = PlanRequest {
            from: (from_route_idx, from_station_idx),
            to: (to_route_idx, to_station_idx),
            date_yyyymmdd,
            sec_of_day,
            max_transfers,
            max_wait_s,
            transfer_buffer_s,
        };
        match self.world.plan_route(&req) {
            Some(p) => serde_json::to_string(&p).unwrap_or_else(|_| "null".into()),
            None => "null".into(),
        }
    }

    #[allow(clippy::too_many_arguments)]
    pub fn plan_alternatives_json(
        &self,
        from_route_idx: u8,
        from_station_idx: u16,
        to_route_idx: u8,
        to_station_idx: u16,
        date_yyyymmdd: u32,
        sec_of_day: f64,
        max_transfers: u8,
        max_wait_s: u32,
        transfer_buffer_s: u32,
    ) -> String {
        let req = PlanRequest {
            from: (from_route_idx, from_station_idx),
            to: (to_route_idx, to_station_idx),
            date_yyyymmdd,
            sec_of_day,
            max_transfers,
            max_wait_s,
            transfer_buffer_s,
        };
        let plans = self.world.plan_alternatives(&req);
        serde_json::to_string(&plans).unwrap_or_else(|_| "[]".into())
    }
}

/// Layout constants mirrored in src/sim/protocol.ts.
#[wasm_bindgen]
pub fn vehicle_stride() -> usize {
    VEHICLE_STRIDE
}

#[wasm_bindgen]
pub fn max_vehicles() -> usize {
    MAX_VEHICLES
}
