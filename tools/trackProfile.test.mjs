import { describe, expect, it } from "vitest";
import {
  MAX_TRACK_GRADIENT,
  haversineMeters,
  limitTrackGradient,
  nearestTrackAltitude,
} from "./trackProfile.mjs";

/** Build a synthetic point list: `n` points spaced `stepDeg` apart in
 *  longitude at a fixed latitude, each with the given altitude/structure. */
function mkRun(n, alt, structure, { startLon = 100.5, lat = 13.75, stepDeg = 0.0005 } = {}) {
  return Array.from({ length: n }, (_, i) => [startLon + i * stepDeg, lat, alt, structure]);
}

function gradients(points) {
  const out = [];
  for (let i = 1; i < points.length; i++) {
    const ds = haversineMeters(points[i - 1], points[i]);
    const dz = Math.abs(points[i][2] - points[i - 1][2]);
    out.push(ds === 0 ? 0 : dz / ds);
  }
  return out;
}

describe("haversineMeters", () => {
  it("returns ~0 for coincident points", () => {
    expect(haversineMeters([100.5, 13.75], [100.5, 13.75])).toBeCloseTo(0, 6);
  });

  it("is symmetric", () => {
    const a = [100.5, 13.75];
    const b = [100.51, 13.76];
    expect(haversineMeters(a, b)).toBeCloseTo(haversineMeters(b, a), 9);
  });

  it("matches a known ~11.1 m per 0.0001 degree longitude at low latitude", () => {
    // At the equator, 1 degree of longitude is ~111.32 km; 0.0001 deg ~11.1 m.
    const d = haversineMeters([100.5, 0], [100.5001, 0]);
    expect(d).toBeGreaterThan(10.5);
    expect(d).toBeLessThan(11.7);
  });
});

describe("limitTrackGradient", () => {
  it("spreads a steep step to within the max gradient", () => {
    // A 108%-grade step like the real red-dark idx 103 defect: a short run
    // at 0.5 m (atGrade) immediately followed by a run at 15 m (elevated).
    const low = mkRun(20, 0.5, "atGrade", { startLon: 100.5 });
    const highStart = 100.5 + 20 * 0.0005;
    const high = mkRun(20, 15, "elevated", { startLon: highStart });
    const points = [...low, ...high];

    const limited = limitTrackGradient(points, MAX_TRACK_GRADIENT);

    for (const g of gradients(limited)) {
      // Small epsilon for floating-point slack in the convergence loop.
      expect(g).toBeLessThanOrEqual(MAX_TRACK_GRADIENT + 1e-6);
    }
  });

  it("keeps a long uniform run's interior altitude unchanged (key regression)", () => {
    // A limiter that drags the whole line toward the mean is the failure
    // mode this guards against: a point deep inside a long run at nominal
    // altitude must stay at nominal altitude after limiting, not get
    // smoothed toward the other run's altitude.
    const elevated = mkRun(300, 15, "elevated", { startLon: 100.5 });
    const undergroundStart = 100.5 + 300 * 0.0005;
    const underground = mkRun(300, -18, "underground", { startLon: undergroundStart });
    const points = [...elevated, ...underground];

    const limited = limitTrackGradient(points, MAX_TRACK_GRADIENT);

    // Deep interior of the elevated run (far from the transition).
    expect(limited[10][2]).toBe(15);
    expect(limited[150][2]).toBe(15);
    // Deep interior of the underground run.
    expect(limited[300 + 150][2]).toBe(-18);
    expect(limited[300 + 290][2]).toBe(-18);
  });

  it("leaves an already-compliant profile unchanged", () => {
    // A gentle, already-legal ramp (well under 4%) plus flat runs on
    // either side — nothing here should move at all.
    const flat1 = mkRun(10, 0.5, "atGrade", { startLon: 100.5 });
    // Ramp gently over a long enough run that consecutive-point gradient
    // never exceeds MAX_TRACK_GRADIENT.
    const rampStart = 100.5 + 10 * 0.0005;
    const ramp = mkRun(50, 0.5, "elevated", { startLon: rampStart }).map((p, i) => [
      p[0],
      p[1],
      0.5 + (i / 49) * 10, // rises 10 m over the run, well within 4% given ~0.0005deg spacing
      p[3],
    ]);
    const points = [...flat1, ...ramp];

    // Sanity: this synthetic profile is actually already compliant.
    for (const g of gradients(points)) {
      expect(g).toBeLessThanOrEqual(MAX_TRACK_GRADIENT);
    }

    const limited = limitTrackGradient(points, MAX_TRACK_GRADIENT);
    expect(limited.map((p) => p[2])).toEqual(points.map((p) => p[2]));
    // Only the altitude channel may ever move — lon/lat/structure identical.
    expect(limited).toEqual(points);
  });

  it("is idempotent", () => {
    const low = mkRun(15, 0.5, "atGrade", { startLon: 100.5 });
    const highStart = 100.5 + 15 * 0.0005;
    const high = mkRun(15, 15, "elevated", { startLon: highStart });
    const points = [...low, ...high];

    const once = limitTrackGradient(points, MAX_TRACK_GRADIENT);
    const twice = limitTrackGradient(once, MAX_TRACK_GRADIENT);
    expect(twice).toEqual(once);
  });

  it("never changes lon, lat or structure — only the altitude channel", () => {
    const low = mkRun(10, 0.5, "atGrade", { startLon: 100.5 });
    const highStart = 100.5 + 10 * 0.0005;
    const high = mkRun(10, 15, "elevated", { startLon: highStart });
    const points = [...low, ...high];

    const limited = limitTrackGradient(points, MAX_TRACK_GRADIENT);
    for (let i = 0; i < points.length; i++) {
      expect(limited[i][0]).toBe(points[i][0]);
      expect(limited[i][1]).toBe(points[i][1]);
      expect(limited[i][3]).toBe(points[i][3]);
    }
  });

  it("handles a descending step the same way (mirrored direction)", () => {
    const high = mkRun(20, 15, "elevated", { startLon: 100.5 });
    const lowStart = 100.5 + 20 * 0.0005;
    const low = mkRun(20, 0.5, "atGrade", { startLon: lowStart });
    const points = [...high, ...low];

    const limited = limitTrackGradient(points, MAX_TRACK_GRADIENT);
    for (const g of gradients(limited)) {
      expect(g).toBeLessThanOrEqual(MAX_TRACK_GRADIENT + 1e-6);
    }
    // Interior of both runs, far from the transition, stays nominal.
    expect(limited[2][2]).toBe(15);
    expect(limited[37][2]).toBe(0.5);
  });

  it("handles fewer than 2 points without throwing", () => {
    expect(limitTrackGradient([], MAX_TRACK_GRADIENT)).toEqual([]);
    const single = [[100.5, 13.75, 15, "elevated"]];
    expect(limitTrackGradient(single, MAX_TRACK_GRADIENT)).toEqual(single);
  });
});

describe("nearestTrackAltitude", () => {
  it("finds the nearest point's altitude, distance and index", () => {
    const track = [
      [100.5, 13.75, 0.5, "atGrade"],
      [100.5005, 13.75, 15, "elevated"],
      [100.501, 13.75, 15, "elevated"],
    ];
    const { altitude, index, distanceM } = nearestTrackAltitude(100.5011, 13.75, track);
    expect(index).toBe(2);
    expect(altitude).toBe(15);
    expect(distanceM).toBeGreaterThanOrEqual(0);
    expect(distanceM).toBeLessThan(20);
  });

  it("returns the same index for raw and ramped tracks (lon/lat never move)", () => {
    // This is the property fetch-network.mjs relies on to tell whether a
    // station is actually ramp-affected: nearestTrackAltitude(raw) and
    // nearestTrackAltitude(ramped) must agree on `index` so their altitudes
    // are directly comparable.
    const low = [
      [100.5, 13.75, 0.5, "atGrade"],
      [100.5001, 13.75, 0.5, "atGrade"],
    ];
    const high = [
      [100.5002, 13.75, 15, "elevated"],
      [100.5003, 13.75, 15, "elevated"],
    ];
    const raw = [...low, ...high];
    const ramped = limitTrackGradient(raw, MAX_TRACK_GRADIENT);

    const pRaw = nearestTrackAltitude(100.50025, 13.75, raw);
    const pRamped = nearestTrackAltitude(100.50025, 13.75, ramped);
    expect(pRaw.index).toBe(pRamped.index);
  });
});
