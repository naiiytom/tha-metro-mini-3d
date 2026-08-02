/**
 * Gradient-limiting for track altitude profiles (MVP 6 Task 13, defect A).
 *
 * `STRUCTURE_ALTITUDE_M` (lines.config.mjs) is a per-point STEP function —
 * the instant an OSM way's tunnel/bridge/layer tag flips, the committed
 * altitude teleports (e.g. red-dark idx 103: +14.5 m over 13.4 m of track,
 * a 108% grade / 47° wall). Real rail ramps at a few percent. This module's
 * `limitTrackGradient` turns that step function into a physically plausible
 * ramp by capping the altitude change allowed between consecutive points to
 * `MAX_TRACK_GRADIENT` per meter of along-track distance — without ever
 * touching a point's lon, lat, or structure tag.
 */

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
