/**
 * Pure track-polyline helpers shared by the OSM fetch pipeline, kept here
 * (rather than inline in fetch-network.mjs) so they're importable by tests
 * with synthetic fixtures instead of only exercisable via a live Overpass
 * fetch.
 *
 * `limitTrackGradient` (MVP 6 Task 13, defect A): `STRUCTURE_ALTITUDE_M`
 * (lines.config.mjs) is a per-point STEP function — the instant an OSM way's
 * tunnel/bridge/layer tag flips, the committed altitude teleports (e.g.
 * red-dark idx 103: +14.5 m over 13.4 m of track, a 108% grade / 47° wall).
 * Real rail ramps at a few percent. This turns that step function into a
 * physically plausible ramp by capping the altitude change allowed between
 * consecutive points to `MAX_TRACK_GRADIENT` per meter of along-track
 * distance — without ever touching a point's lon, lat, or structure tag.
 *
 * `stitchWays`/`truncateAtFold`: greedy way-segment stitching, and detection
 * of an out-and-back fold that stitching two nearly-parallel tracks can
 * produce (see `truncateAtFold`'s own comment).
 */

import { structureOfWay } from "./lines.config.mjs";

/** MapLibre's mean earth radius (src/geo/lng_lat.ts, rust-engine/sim-core/src/geo.rs
 *  — 6371008.8 m, NOT the WGS84 circumference). Reused here for consistency;
 *  gradient-limiting only needs meter-level accuracy, not mercator precision,
 *  so a plain haversine (rather than the project's ENU/mercator machinery,
 *  which needs a floating origin) is enough. */
const EARTH_RADIUS_M = 6_371_008.8;

/** Great-circle distance in meters between two `[lon, lat, ...]` points. */
export function haversineMeters(a, b) {
  const toRad = Math.PI / 180;
  const [lon1, lat1] = a;
  const [lon2, lat2] = b;
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(s)));
}

/**
 * 4% is the standard heavy/commuter-rail maximum ruling gradient (steeper
 * grades exist on real systems only as short exceptional pinches, not as a
 * design target). At 4%, MRT Blue's 33 m elevated<->underground portal
 * spreads over ~825 m of track (33 / 0.04) — the right order of magnitude
 * for a real portal ramp, matching the brief's worked example.
 *
 * Not special-cased by vehicleType: monorail/APM CAN climb steeper in
 * reality, but every line in this registry that actually has a mid-line
 * structure transition (red-dark, red-light, blue, arl) is heavy-rail or
 * commuter-rail — none of the monorail (pink, yellow) or APM (gold) lines
 * have any structure change at all (verified: zero transitions in their
 * per-point structure arrays). A vehicleType branch would be untested,
 * unused code for this registry; one conservative constant is simpler and
 * still correct everywhere it actually fires.
 */
export const MAX_TRACK_GRADIENT = 0.04;

/**
 * Returns a new point array with altitudes (index 2) adjusted so no two
 * consecutive points differ in altitude by more than
 * `maxGradient * (along-track distance between them)`. lon/lat/structure
 * (indices 0, 1, 3) are copied through unchanged — this only ever moves the
 * altitude channel, never the horizontal position or the structure tag (a
 * point tagged `underground` may legitimately sit above nominal underground
 * depth mid-ramp; that is intentional, not a bug — see the Task 13 report).
 *
 * Algorithm: the standard slope-limiting relaxation sweep. A forward pass
 * clamps each point into the band [prev - g*ds, prev + g*ds] around its
 * predecessor; a backward pass does the same against its successor. This
 * single two-sided clamp already covers both the brief's "ascending" and
 * "mirrored descending" cases (min-clamping a peak that's too high AND
 * max-clamping a valley that's too low are the same operation once the
 * clamp has both a floor and a ceiling). Passes repeat until a full
 * forward+backward sweep makes no further change (a compliant profile
 * converges in one no-op pass; a single steep step converges once its ramp
 * reaches nominal altitude on both sides, which needs multiple sweeps to
 * propagate point-by-point — bounded above by the point count, which is
 * only ever reached in pathological inputs, not real track data).
 */
export function limitTrackGradient(points, maxGradient = MAX_TRACK_GRADIENT) {
  if (points.length < 2) return points.map((p) => [...p]);

  const alt = points.map((p) => p[2]);
  const ds = new Array(points.length).fill(0);
  for (let i = 1; i < points.length; i++) {
    ds[i] = haversineMeters(points[i - 1], points[i]);
  }

  const maxIterations = points.length + 2; // safety bound; real profiles converge far sooner
  for (let iter = 0; iter < maxIterations; iter++) {
    let changed = false;

    // Forward pass: clamp each point into a band around its predecessor.
    for (let i = 1; i < alt.length; i++) {
      const band = maxGradient * ds[i];
      const lo = alt[i - 1] - band;
      const hi = alt[i - 1] + band;
      if (alt[i] < lo) {
        alt[i] = lo;
        changed = true;
      } else if (alt[i] > hi) {
        alt[i] = hi;
        changed = true;
      }
    }

    // Backward pass: clamp each point into a band around its successor.
    for (let i = alt.length - 2; i >= 0; i--) {
      const band = maxGradient * ds[i + 1];
      const lo = alt[i + 1] - band;
      const hi = alt[i + 1] + band;
      if (alt[i] < lo) {
        alt[i] = lo;
        changed = true;
      } else if (alt[i] > hi) {
        alt[i] = hi;
        changed = true;
      }
    }

    if (!changed) break;
  }

  return points.map((p, i) => [p[0], p[1], alt[i], p[3]]);
}

/**
 * Finds the nearest point (by 2D lon/lat distance) on a track polyline to a
 * given `[lon, lat]` position, and its altitude. Used to resample a
 * station's altitude so its pole reaches the ramped deck instead of a stale
 * nominal value, when the station happens to sit inside a ramp zone —
 * callers compare this against the same lookup on the pre-ramp track (same
 * `index`, since limitTrackGradient never moves lon/lat) to tell whether a
 * station is actually ramp-affected before overwriting its altitude; see
 * fetch-network.mjs's `fetchBranch` and the Task 13 report for why that
 * distinction matters (a blanket resample would also silently "fix" a much
 * larger, separate pre-existing issue — every station on a mixed-structure
 * line defaulting to the line's single nominal altitude — which is real but
 * out of this task's scope).
 */
export function nearestTrackAltitude(lon, lat, track) {
  let bestDist = Infinity;
  let bestAlt = null;
  let bestIndex = -1;
  for (let i = 0; i < track.length; i++) {
    const d = haversineMeters([lon, lat], track[i]);
    if (d < bestDist) {
      bestDist = d;
      bestAlt = track[i][2];
      bestIndex = i;
    }
  }
  return { altitude: bestAlt, distanceM: bestDist, index: bestIndex };
}

/**
 * Greedily stitch unordered way segments into one continuous polyline. Each
 * point carries the structure classification of the way it came from.
 *
 * Returns `{ path, consumed, total }`, not just the path: `consumed` is how
 * many of the input ways actually got merged in. A non-touching segment
 * (parallel track of the opposite direction, depot spur, etc.) breaks the
 * loop and is silently dropped — the caller decides whether `consumed <
 * total` deserves a warning. A relation's member list is ordered and curated
 * so this rarely bites a relation-based fetch; a raw name-based way query has
 * no such curation and hits it far more often (fetch-network.mjs's
 * `fetchBranch` vs `fetchBranchFromWayName`).
 */
export function stitchWays(ways, tagsByWay, defaultStructure) {
  const segments = ways.map((w) => {
    const structure = structureOfWay(tagsByWay.get(String(w.ref)) ?? {}, defaultStructure);
    return w.geometry.map((p) => [p.lon, p.lat, structure]);
  });
  const total = segments.length;
  if (total === 0) return { path: [], consumed: 0, total };
  const path = segments.shift();
  let consumed = 1;
  const near = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-4; // ~10 m

  while (segments.length > 0) {
    const head = path[0];
    const tail = path[path.length - 1];
    let bestIdx = -1;
    let bestMode = null;
    for (let i = 0; i < segments.length; i++) {
      const s = segments[i];
      if (near(tail, s[0])) { bestIdx = i; bestMode = "append"; break; }
      if (near(tail, s[s.length - 1])) { bestIdx = i; bestMode = "appendRev"; break; }
      if (near(head, s[s.length - 1])) { bestIdx = i; bestMode = "prepend"; break; }
      if (near(head, s[0])) { bestIdx = i; bestMode = "prependRev"; break; }
    }
    if (bestIdx === -1) {
      // No touching segment (parallel track of the opposite direction,
      // depot spur, etc.) — drop the remainder rather than jumping gaps.
      break;
    }
    const seg = segments.splice(bestIdx, 1)[0];
    consumed++;
    if (bestMode === "append") path.push(...seg.slice(1));
    else if (bestMode === "appendRev") path.push(...seg.reverse().slice(1));
    else if (bestMode === "prepend") path.unshift(...seg.slice(0, -1));
    else path.unshift(...seg.reverse().slice(0, -1));
  }
  return { path, consumed, total };
}

/**
 * Detect and cut off an out-and-back fold in a stitched polyline.
 *
 * A way-name-based fetch has no relation-level direction to separate up/down
 * track the way a PTv2 route relation does: two nearly-parallel tracks
 * running the same corridor a few metres apart can get greedily stitched
 * end-to-end into one loop — walk out on one track, U-turn at the terminus,
 * walk back on the other. Found on MRT Orange: a stitched length of 43.6 km
 * for a real ~22 km alignment, with the second half running a mean 30 m
 * (max 458 m) from the first half.
 *
 * A genuine single traverse's distance from its own earlier trace only
 * grows; a fold bends back close to it. Requires a SUSTAINED run of close
 * points, not one coincidence, so real self-proximity (e.g. the
 * loop-plus-branch pattern CLAUDE.md documents for MRT Blue at Tha Phra)
 * doesn't false-positive on a single near-miss — and once a fold's onset is
 * found, the cut point is refined backward to the local distance maximum
 * (the true turnaround) rather than the fuzzy detection threshold itself.
 */
export const FOLD_DISTANCE_M = 60; // twin-track separation is typically 10-30 m
export const FOLD_MIN_RUN = 10; // consecutive close points required before calling it a fold
export const FOLD_MIN_GAP = 20; // ignore comparisons against recently-visited points (normal curvature)
export const FOLD_REFINE_WINDOW = 40; // how far back to search for the true turnaround once a fold is found

export function truncateAtFold(path) {
  let run = 0;
  let foldStart = -1;
  for (let i = 0; i < path.length; i++) {
    let nearest = Infinity;
    for (let j = 0; j < i - FOLD_MIN_GAP; j++) {
      const d = haversineMeters(path[i], path[j]);
      if (d < nearest) nearest = d;
    }
    run = nearest < FOLD_DISTANCE_M ? run + 1 : 0;
    if (run === FOLD_MIN_RUN) {
      foldStart = i - FOLD_MIN_RUN + 1;
      break;
    }
  }
  if (foldStart === -1) return path;

  let turnaroundIdx = foldStart;
  let maxD = -1;
  for (let k = Math.max(0, foldStart - FOLD_REFINE_WINDOW); k <= foldStart; k++) {
    const d = haversineMeters(path[0], path[k]);
    if (d > maxD) { maxD = d; turnaroundIdx = k; }
  }
  return path.slice(0, turnaroundIdx + 1);
}
