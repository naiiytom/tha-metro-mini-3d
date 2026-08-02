import { ORIGIN_LNG_LAT } from "./coordinates";

/**
 * Solar position for the local ENU frame, driven by the simulated clock
 * (SRS §F3.3). NOAA's low-precision algorithm — accurate to a fraction of a
 * degree, which is far past what a stylized city model needs, and cheap
 * enough to evaluate at UI rate.
 *
 * Bangkok is UTC+7 with no DST, so local civil time is a fixed offset.
 * Everything here is pure: no Three, no DOM, no clock reads.
 */

const DEG = Math.PI / 180;
const BANGKOK_UTC_OFFSET_H = 7;

export interface SunDirection {
  /** Unit vector pointing FROM the scene TOWARD the sun, in local ENU. */
  east: number;
  north: number;
  up: number;
  /** Degrees above the horizon; negative at night. */
  elevationDeg: number;
}

export function sunDirection(simEpochMs: number): SunDirection {
  const [lng, lat] = ORIGIN_LNG_LAT;
  const local = new Date(simEpochMs + BANGKOK_UTC_OFFSET_H * 3_600_000);
  const startOfYear = Date.UTC(local.getUTCFullYear(), 0, 1);
  const dayOfYear = Math.floor((local.getTime() - startOfYear) / 86_400_000) + 1;
  const hours = local.getUTCHours() + local.getUTCMinutes() / 60 + local.getUTCSeconds() / 3600;

  // Fractional year, radians.
  const g = ((2 * Math.PI) / 365) * (dayOfYear - 1 + (hours - 12) / 24);

  const eqTimeMin =
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(g) -
      0.032077 * Math.sin(g) -
      0.014615 * Math.cos(2 * g) -
      0.040849 * Math.sin(2 * g));

  const declRad =
    0.006918 -
    0.399912 * Math.cos(g) +
    0.070257 * Math.sin(g) -
    0.006758 * Math.cos(2 * g) +
    0.000907 * Math.sin(2 * g) -
    0.002697 * Math.cos(3 * g) +
    0.00148 * Math.sin(3 * g);

  // True solar time, minutes. `local` is already the civil clock, so the
  // timezone term uses the same fixed +7 offset.
  const timeOffsetMin = eqTimeMin + 4 * lng - 60 * BANGKOK_UTC_OFFSET_H;
  const trueSolarMin = hours * 60 + timeOffsetMin;
  const hourAngleRad = (trueSolarMin / 4 - 180) * DEG;

  const latRad = lat * DEG;
  const cosZenith =
    Math.sin(latRad) * Math.sin(declRad) +
    Math.cos(latRad) * Math.cos(declRad) * Math.cos(hourAngleRad);
  const zenithRad = Math.acos(Math.max(-1, Math.min(1, cosZenith)));
  const elevationRad = Math.PI / 2 - zenithRad;

  // Azimuth measured clockwise from north.
  const sinZenith = Math.sin(zenithRad);
  let azimuthRad = Math.PI;
  if (Math.abs(sinZenith) > 1e-9) {
    const cosAz =
      (Math.sin(latRad) * cosZenith - Math.sin(declRad)) / (Math.cos(latRad) * sinZenith);
    azimuthRad = Math.acos(Math.max(-1, Math.min(1, cosAz)));
    // acos loses the sign; hour angle < 0 is morning (sun in the east).
    if (hourAngleRad > 0) azimuthRad = 2 * Math.PI - azimuthRad;
    azimuthRad = Math.PI - azimuthRad;
  }

  const cosEl = Math.cos(elevationRad);
  return {
    east: cosEl * Math.sin(azimuthRad),
    north: cosEl * Math.cos(azimuthRad),
    up: Math.sin(elevationRad),
    elevationDeg: elevationRad / DEG,
  };
}

export interface SkyPalette {
  sun: number;
  sunIntensity: number;
  ambient: number;
  ambientIntensity: number;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Blend two 0xRRGGBB colours per channel. */
function mixHex(a: number, b: number, t: number): number {
  const ch = (c: number, shift: number) => (c >> shift) & 0xff;
  const r = Math.round(lerp(ch(a, 16), ch(b, 16), t));
  const g = Math.round(lerp(ch(a, 8), ch(b, 8), t));
  const bl = Math.round(lerp(ch(a, 0), ch(b, 0), t));
  return (r << 16) | (g << 8) | bl;
}

const NIGHT_SUN = 0x3d5a8a;
const GOLDEN_SUN = 0xffb066;
const DAY_SUN = 0xffffff;
const NIGHT_AMBIENT = 0x2c3a55;
const DAY_AMBIENT = 0xffffff;

/**
 * Light colours and intensities for a given solar elevation.
 *
 * Deliberately never goes fully dark: at 03:00 the user still needs to read
 * the network. Night is a cool, dim wash rather than an accurate simulation
 * of an unlit city.
 *
 * The night floors here are a fix for a real reported defect, not just a
 * stylistic choice: Task 10b (`basemapTheme.ts`) independently darkens the
 * MapLibre basemap at night, and the two dimmings compound — every track
 * deck / station / vehicle in the Three.js scene is `MeshLambertMaterial`,
 * so its rendered colour is (roughly) `material.color * (ambient + diffuse)`.
 * With the old floors (sunIntensity 0.15, ambientIntensity 0.55) a dark line
 * colour like Blue's `#1964B7` rendered as near-black against the also-dark
 * basemap: "the night theme makes all the lines invisible". The Three scene
 * contains *only* the network (no basemap geometry), so raising these floors
 * brightens the network without touching the city's darkness at all — the
 * fix the human asked for (see `sun.test.ts`'s "keeps the deep-night
 * lighting floor..." test, and Task 14's report for the alternative
 * (emissive materials) that was considered and rejected).
 */
export function skyPalette(elevationDeg: number): SkyPalette {
  // 0 at deep night, 1 at full day, with a golden band around the horizon.
  const day = Math.max(0, Math.min(1, (elevationDeg + 6) / 18));
  const golden = Math.max(0, 1 - Math.abs(elevationDeg - 4) / 12);

  const base = mixHex(NIGHT_SUN, DAY_SUN, day);
  return {
    sun: mixHex(base, GOLDEN_SUN, golden * 0.8),
    sunIntensity: lerp(0.9, 2.2, day),
    ambient: mixHex(NIGHT_AMBIENT, DAY_AMBIENT, day),
    ambientIntensity: lerp(1.35, 1.6, day),
  };
}
