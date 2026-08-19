//! sim-core — cache model + schedule evaluation for Greater Bangkok Metro Mini 3D.
//! Pure Rust; NO wasm / JS dependencies (contract §3).

pub mod calendar;
pub mod geo;
pub mod model;
pub mod query;
pub mod route;
pub mod world;

pub use calendar::{Frame, next_date, service_day_frames};
pub use model::{
    CacheDoc, PatternDoc, PatternStop, RouteDoc, RunDoc, ServiceDoc, StationDoc, TMB_MAGIC,
    TMB_VERSION,
};
pub use query::{BoardEntry, RunDetail, StationBoard, StationInfo, StopCall};
pub use route::{PlanLeg, PlanRequest, RouteIndex, RoutePlan, plan};
pub use world::{CacheError, MAX_VEHICLES, SimWorld, VEHICLE_STRIDE, ValidationSummary};
