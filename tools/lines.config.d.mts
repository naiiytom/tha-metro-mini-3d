/**
 * Ambient type declaration for lines.config.mjs — same pattern as
 * src/sim/pkg.d.ts: a plain .mjs has no types of its own, and `tsc -b`
 * type-checks everything under src/ (including src/data/network.registry.test.ts,
 * which imports LINES from here) strictly (noImplicitAny). Keep in sync with
 * the real exports by hand; there is no generator for this one.
 */

export interface LineOsmRef {
  relationId: number;
  match: RegExp;
}

export interface LineConfig {
  key: string;
  name: string;
  nameTh: string;
  color: string;
  structure: "elevated" | "atGrade" | "underground";
  vehicleType: "heavy" | "monorail" | "apm" | "commuter";
  gtfsRouteId: string | null;
  osm?: LineOsmRef;
  excludeGtfsStopIds?: string[];
  allowLargeSnapStopIds?: string[];
}

export interface InterchangeOverride {
  aLine: string;
  aStop: string;
  bLine: string;
  bStop: string;
}

export interface WayTags {
  tunnel?: string;
  bridge?: string;
  layer?: string;
}

export const STRUCTURE_ALTITUDE_M: Record<"elevated" | "atGrade" | "underground", number>;
export const VEHICLE_TYPES: string[];
export const LINES: LineConfig[];
export const INTERCHANGE_OVERRIDES: InterchangeOverride[];
export function assertRegistryValid(lines?: LineConfig[]): void;
export function structureOfWay(
  tags: WayTags,
  fallback?: "elevated" | "atGrade" | "underground",
): "elevated" | "atGrade" | "underground";
