import * as THREE from "three";
import { Line2 } from "three/addons/lines/Line2.js";
import { LineGeometry as ThreeLineGeometry } from "three/addons/lines/LineGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import type { PlanLegRide, RoutePlan } from "../sim/protocol";
import type { LineGeometry, TrackPoint } from "../types";
import { lngLatAltToLocal } from "./coordinates";

/**
 * Map highlight for a planned route's ride legs.
 *
 * Each span is drawn along the SAME centripetal Catmull-Rom curve
 * `buildTrackDeck`/`buildTrackLine` already sweep, between the two arc-length
 * offsets the engine reported — and those come from `PatternStop::arc_m`, the
 * pattern's own resolved arc, never `StationDoc::arc_m`. That distinction is
 * load-bearing on a self-approaching alignment (MRT Blue at Tha Phra), where
 * the two genuinely differ.
 *
 * DISCLOSED APPROXIMATION: the cache's `track_arc_m` is cumulative arc over
 * the preprocessor's own ~10 m resample of these same control points, while
 * this samples Three's arc-length parameterisation of the same curve. The two
 * agree to well inside a station's own snapping tolerance, but they are not
 * bit-identical, so a highlight endpoint can sit a metre or two off the
 * vehicle's own position at that stop. This is a visual aid, not a
 * measurement.
 */

/** Matches `buildTrackLine`'s own spacing, so the two read as one line. */
const SAMPLE_SPACING_M = 12;
/** Above the centerline's +0.6 m so the highlight is never z-fought by it. */
const HOVER_M = 1.2;

export interface RouteHighlightSpan {
  routeIdx: number;
  fromArcM: number;
  toArcM: number;
}

function toLocalVec3(points: TrackPoint[]): THREE.Vector3[] {
  return points.map((p) => new THREE.Vector3(...lngLatAltToLocal([p[0], p[1], p[2]])));
}

/** Flat `[x, y, z, …]` in local ENU meters along `line` between two arc
 *  offsets. Empty when there is nothing drawable. */
export function arcSpanPositions(
  line: LineGeometry,
  fromArcM: number,
  toArcM: number,
): number[] {
  const controlPoints = toLocalVec3(line.track);
  if (controlPoints.length < 2) return [];

  const curve = new THREE.CatmullRomCurve3(controlPoints, false, "centripetal");
  const total = curve.getLength();
  if (total <= 0) return [];

  // A leg riding toward decreasing arc covers the same physical span.
  const lo = Math.max(0, Math.min(fromArcM, toArcM));
  const hi = Math.min(total, Math.max(fromArcM, toArcM));
  if (hi - lo < 1) return [];

  const segments = Math.max(1, Math.round((hi - lo) / SAMPLE_SPACING_M));
  const out: number[] = [];
  for (let i = 0; i <= segments; i++) {
    const arc = lo + ((hi - lo) * i) / segments;
    const p = curve.getPointAt(Math.min(Math.max(arc / total, 0), 1));
    out.push(p.x, p.y, p.z + HOVER_M);
  }
  return out;
}

/**
 * The ride legs of a plan as drawable spans. Walking legs have no track.
 *
 * `hiddenRoutes` filters here rather than in the layer because it is a
 * DRAWING concern only: the plan itself stays factual regardless of what is
 * currently shown, exactly as `RoutePlanner`'s own `visibleStations` filters
 * what can be PICKED without filtering what the engine may route through.
 * Without it a leg on a hidden line drew its white highlight over invisible
 * track, and hiding a line after planning left that span stranded on the map.
 */
export function highlightSpans(
  plan: RoutePlan | null,
  hiddenRoutes: readonly number[] = [],
): RouteHighlightSpan[] {
  if (!plan || plan.unreachable) return [];
  return plan.legs
    .filter((l): l is PlanLegRide => l.kind === "ride")
    .filter((l) => !hiddenRoutes.includes(l.routeIdx))
    .map((l) => ({ routeIdx: l.routeIdx, fromArcM: l.boardArcM, toArcM: l.alightArcM }));
}

/** One highlight line, or null when the span is not drawable. Its material is
 *  returned so the layer can keep `resolution` current per frame, the same way
 *  it already does for every track centerline. */
export function buildHighlightLine(
  line: LineGeometry,
  fromArcM: number,
  toArcM: number,
): { line: Line2; material: LineMaterial } | null {
  const positions = arcSpanPositions(line, fromArcM, toArcM);
  if (positions.length < 6) return null;

  const geometry = new ThreeLineGeometry();
  geometry.setPositions(positions);
  const material = new LineMaterial({
    color: 0xffffff,
    linewidth: 9, // pixels — wider than the 3 px centerline it sits over
    transparent: true,
    opacity: 0.85,
    // The highlight answers "which way did I just plan", so it must stay
    // readable through the deck it traces rather than fighting it for depth.
    depthTest: false,
  });
  const line2 = new Line2(geometry, material);
  line2.computeLineDistances();
  line2.renderOrder = 2;
  line2.name = `route-highlight-${line.key}`;
  return { line: line2, material };
}
