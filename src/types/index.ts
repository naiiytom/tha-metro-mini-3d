/** A 3D geographic coordinate: [longitude, latitude, altitude_meters] (SRS §F1.3). */
export type LngLatAlt = [number, number, number];

export interface Station {
  id: number | string;
  name: string;
  nameTh: string;
  code: string;
  position: LngLatAlt;
}

export type Structure = "elevated" | "atGrade" | "underground";
export type VehicleType = "heavy" | "monorail" | "apm" | "commuter";

/**
 * One track vertex: [lng, lat, altitudeMeters, structure].
 *
 * Structure is per-POINT, not per-line (MVP 6): MRT Blue, Orange and Purple
 * Phase 2 all dive underground and surface again within one relation, and
 * SRT Red is genuinely mixed at-grade/elevated. `LineGeometry.structure`
 * survives as the line's DEFAULT — what an untagged way falls back to.
 */
export type TrackPoint = [number, number, number, Structure];

/**
 * Headway parameters for a line whose timetable is synthesized rather than
 * published. Mirrors `syntheticSchedule` in tools/lines.config.mjs and the
 * Rust `synthetic::SyntheticSchedule` — all three must move together.
 */
export interface SyntheticSchedule {
  headwaySec: number;
  runtimeSec: number;
  dwellSec: number;
  startSec: number;
  endSec: number;
}

/**
 * Shown wherever a synthetic-schedule line's times appear. Deliberately
 * short enough to fit a bottom sheet on a phone, and deliberately not
 * optional: presenting invented departure times as if they came from an
 * operator feed is the one thing this feature must never do.
 */
export const SYNTHETIC_SCHEDULE_NOTE =
  "Estimated timetable — this service runs continuously but publishes no schedule.";

/**
 * Points at the line whose real feed times calibrate this line's estimated
 * ones. Mirrors `estimatedRunTimes` in tools/lines.config.mjs and the Rust
 * `EstimatedRunTimes` — all three must move together.
 */
export interface EstimatedRunTimes {
  basisLine: string;
}

/**
 * Shown wherever an estimated-run-time line's times appear.
 *
 * Deliberately a WEAKER claim than SYNTHETIC_SCHEDULE_NOTE: this line's
 * departure times, calendars and headsigns are all real feed data — only the
 * travel time between stations is estimated, because the feed publishes zero
 * seconds of transit on every leg. Saying "estimated timetable" here would
 * overstate what is invented.
 */
export const ESTIMATED_RUN_TIMES_NOTE =
  "Estimated travel times — departures are from the operator feed, but it publishes no running time between stations.";

/**
 * Shown on any planned route that contains a transfer.
 *
 * A third, distinct claim from the two above: nothing about the TIMETABLE is
 * estimated here — the departures are real — but the time allowed to change
 * trains is one fixed buffer applied to every interchange, not a
 * distance-derived or publisher-supplied figure. Distance-derived transfer
 * times were considered during design and explicitly declined, so this note
 * is the whole disclosure of that decision to the user. If it is ever
 * dropped, the flat model must not silently present as published data.
 */
export const TRANSFER_TIMES_ESTIMATED_NOTE =
  "Transfer times are a fixed estimate — the same allowance is used at every interchange, not a measured walking time.";

/** Front-end profile of the leading car. See docs/.../custom-rolling-stock-design.md. */
export type NoseProfile = "raked" | "blunt" | "rounded";

/**
 * Roof equipment. `pantograph` is overhead-line stock only — on this network
 * that is the Airport Rail Link and both SRT Red lines (25 kV AC). BTS and
 * both MRT heavy lines take power from a third rail, and the monorails and
 * people movers from the beam, so all of those are `none`.
 */
export type RoofKit = "pantograph" | "none";

/** One horizontal livery band wrapping the car shell. */
export interface LiveryBand {
  /** Band centre, metres above the UNDERSIDE of the shell (0..heightM). */
  zM: number;
  heightM: number;
  /** `"route"` = this line's own registry colour; otherwise `"#RRGGBB"`. */
  tint: string;
}

/**
 * One line's rolling stock, as declared in tools/lines.config.mjs and carried
 * verbatim through network.json. Mirrors the registry shape exactly — the
 * sync test in tools/lines.config.test.mjs compares the two with `toEqual`.
 *
 * Linear dimensions are map-legibility-tuned, NOT spec-sheet accurate (the
 * same stance vehicleModels.ts always took). `cars`, `nose`, `roof` and the
 * livery ARE real, checkable facts about the operator's fleet.
 */
export interface RollingStock {
  cars: number;
  carLengthM: number;
  gapM: number;
  widthM: number;
  heightM: number;
  /** Clearance between the deck (vehicle z) and the car underside. */
  rideHeightM: number;
  /** Length of the tapered nose. Comes OUT of the leading car, never adds to it. */
  cabLengthM: number;
  nose: NoseProfile;
  roof: RoofKit;
  /** Shell colour, `"#RRGGBB"`. Never `"route"` — see the design doc's palette. */
  shell: string;
  /** The continuous dark glazing ribbon. */
  glazing: LiveryBand;
  /** Identity band first, then any detail bands (skirt). Order matters: the
   *  nose takes `bands[0]`'s colour, preserving the route-coloured cab cap
   *  that has marked direction of travel since MVP 3. */
  bands: LiveryBand[];
  /**
   * Optional `.glb` override. **No line sets this today** — see the design
   * doc's decision 1. The procedural build is the permanent fallback, not a
   * stopgap, so this staying empty is the expected steady state.
   */
  glbUrl?: string;
}

/** One line's rendered geometry, generated by tools/fetch-network.mjs. */
export interface LineGeometry {
  key: string;
  name: string;
  nameTh: string;
  color: string;
  /** Fallback for track points whose OSM way carries no tunnel/bridge/layer. */
  structure: Structure;
  vehicleType: VehicleType;
  /**
   * The GTFS `route_id` this line's trips come from, or null if it has none.
   *
   * **null does NOT mean "not simulated."** A line with a `syntheticSchedule`
   * (the Suvarnabhumi APM) is null here and still runs trains. Check
   * `syntheticSchedule` BEFORE branching on this — `LineSelector` depends on
   * that ordering, or the APM renders as "track only" while visibly moving.
   * Genuinely track-only lines are null here AND have no `syntheticSchedule`
   * (`orange`, `purple-ext`).
   *
   * Also **not unique across lines**: two entries may share one route id when
   * `claimGtfsStopIds` splits it per trip (the Pink trunk and its IMPACT Link
   * spur both carry "2436").
   */
  gtfsRouteId: string | null;
  /** Under construction / not yet in revenue service — rendered distinctly. */
  preRevenue: boolean;
  /**
   * Non-null = this line's trains run on an ESTIMATED timetable synthesized
   * from a declared headway, not on a published feed. The only line in this
   * position is the Suvarnabhumi APM, which runs but whose operator (AOT)
   * publishes no schedule. Every UI surface that shows its times must say so
   * — see `SYNTHETIC_SCHEDULE_NOTE`.
   */
  syntheticSchedule: SyntheticSchedule | null;
  /**
   * Non-null = this line's feed rows carry no usable transit times, so travel
   * time between its stations is estimated from a sibling line's calibration
   * (MRT Pink, calibrated from MRT Yellow). Departure times themselves are
   * real. Every UI surface that shows its times must say so — see
   * `ESTIMATED_RUN_TIMES_NOTE`.
   */
  estimatedRunTimes: EstimatedRunTimes | null;
  /**
   * Per-line rolling stock, or null to fall back to this line's vehicleType
   * default (`DEFAULT_STOCK` in src/map/rollingStock.ts). Null for every
   * pre-revenue line — a line that renders no trains has no stock to declare.
   */
  rollingStock: RollingStock | null;
  /** null for a line fetched by wayNamePattern instead of a route relation. */
  relationId: number | null;
  osmName: string;
  track: TrackPoint[];
  stations: Station[];
}

/**
 * One deliberate edit made to network.json AFTER the `generated` fetch.
 * This file is routinely hand-patched without a re-fetch (see CLAUDE.md), and
 * `generated` alone cannot tell a reader whether a difference against a fresh
 * fetch is a patch or upstream OSM vertex drift. `fetch-network.mjs` never
 * writes this field, so a real re-fetch clears it — which is correct: a patch
 * the registry now reproduces is no longer a patch.
 */
export interface HandPatch {
  /** YYYY-MM-DD. */
  date: string;
  /** Registry key of the line the patch touches, or "*" for a network-wide patch. */
  line: string;
  /** OSM node id of the station added or corrected, if it is a station patch. */
  stationId?: string;
  note: string;
}

export interface NetworkData {
  generated: string;
  source: string;
  /** Present only while the committed file carries edits made after `generated`. */
  handPatches?: HandPatch[];
  /** Order is load-bearing: index == cache route_idx == vehicle lane 6. */
  lines: LineGeometry[];
}
