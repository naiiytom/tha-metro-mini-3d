//! Local ENU frame — bit-for-bit replication of `src/map/coordinates.ts`,
//! which delegates to MapLibre GL JS (v4.7.1) `MercatorCoordinate`.
//!
//! MapLibre's actual constants (node_modules/maplibre-gl/src/geo/):
//!   earthRadius = 6371008.8 m  (mean radius, NOT the WGS84 equatorial value)
//!   earthCircumference = 2π·earthRadius ≈ 40 030 228.884 m
//!   mercator x = (180 + lng) / 360
//!   mercator y = (180 − (180/π)·ln(tan(π/4 + lat·π/360))) / 360
//!   meterInMercatorCoordinateUnits = (1/earthCircumference) · 1/cos(latFromMercatorY(y))

use std::f64::consts::PI;

pub const EARTH_RADIUS_M: f64 = 6_371_008.8;
pub const EARTH_CIRCUMFERENCE_M: f64 = 2.0 * PI * EARTH_RADIUS_M;

/// Frontend `ORIGIN_LNG_LAT` (Siam interchange).
pub const ORIGIN_LNG_LAT: (f64, f64) = (100.5332, 13.7456);

pub fn mercator_x_from_lng(lng: f64) -> f64 {
    (180.0 + lng) / 360.0
}

pub fn mercator_y_from_lat(lat: f64) -> f64 {
    (180.0 - (180.0 / PI * ((PI / 4.0 + lat * PI / 360.0).tan()).ln())) / 360.0
}

pub fn lat_from_mercator_y(y: f64) -> f64 {
    let y2 = 180.0 - y * 360.0;
    360.0 / PI * ((y2 * PI / 180.0).exp()).atan() - 90.0
}

/// Projects lng/lat into the local ENU meter frame shared with the frontend.
pub struct EnuProjector {
    origin_x: f64,
    origin_y: f64,
    merc_per_meter: f64,
}

impl EnuProjector {
    pub fn new(origin_lng: f64, origin_lat: f64) -> Self {
        let origin_x = mercator_x_from_lng(origin_lng);
        let origin_y = mercator_y_from_lat(origin_lat);
        // Same round-trip MapLibre performs in meterInMercatorCoordinateUnits().
        let lat = lat_from_mercator_y(origin_y);
        let merc_per_meter = 1.0 / EARTH_CIRCUMFERENCE_M * (1.0 / (lat * PI / 180.0).cos());
        Self {
            origin_x,
            origin_y,
            merc_per_meter,
        }
    }

    /// [lng, lat, alt_m] -> [east_m, north_m, up_m]; mercator y grows
    /// southward, hence the sign flip (mirrors lngLatAltToLocal).
    pub fn project(&self, lng: f64, lat: f64, alt: f64) -> [f64; 3] {
        let mx = mercator_x_from_lng(lng);
        let my = mercator_y_from_lat(lat);
        [
            (mx - self.origin_x) / self.merc_per_meter,
            -(my - self.origin_y) / self.merc_per_meter,
            alt,
        ]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Cross-check against the TS implementation (src/map/coordinates.ts).
    /// Expected values computed by executing MapLibre 4.7.1's exact formulas
    /// (earthRadius 6371008.8) in Node for real Green Line stop coordinates.
    // These are MapLibre ENU parity constants (see CLAUDE.md: don't "fix"
    // this to fewer digits — sub-millimeter TS<->Rust parity is load-bearing).
    #[allow(clippy::excessive_precision)]
    #[test]
    fn enu_projection_matches_maplibre_ts() {
        let p = EnuProjector::new(ORIGIN_LNG_LAT.0, ORIGIN_LNG_LAT.1);

        // Origin projects to (0, 0).
        let o = p.project(100.5332, 13.7456, 15.0);
        assert!(o[0].abs() < 1e-9 && o[1].abs() < 1e-9);
        assert_eq!(o[2], 15.0);

        // (name, lng, lat, expected_east_m, expected_north_m)
        let cases = [
            // BTS National Stadium (stop 13)
            (
                100.529_085_657_300_13,
                13.746_497_916_783_781,
                -444.392_165_726_149_59,
                99.844_120_194_056_842,
            ),
            // BTS Bang Wa (stop 1)
            (
                100.457_835_725_914_78,
                13.720_766_616_303_294,
                -8_140.132_075_113_429_9,
                -2_761.203_806_139_251_8,
            ),
            // BTS Khu Khot (stop 13843)
            (
                100.646_563_321_352,
                13.932_335_994_196_62,
                12_244.427_740_867_382,
                20_772.442_108_851_621,
            ),
            // BTS Kheha (stop 13608)
            (
                100.607_927_441_597,
                13.567_164_985_131_8,
                8_071.347_486_839_203_2,
                -19_833.574_143_376_823,
            ),
        ];
        for (lng, lat, ex, ey) in cases {
            let v = p.project(lng, lat, 15.0);
            // "within centimeters" — we are in fact within nanometers, since
            // this is the identical f64 computation.
            assert!((v[0] - ex).abs() < 0.01, "east {} vs {}", v[0], ex);
            assert!((v[1] - ey).abs() < 0.01, "north {} vs {}", v[1], ey);
        }
    }

    #[test]
    fn merc_per_meter_matches_maplibre() {
        let p = EnuProjector::new(ORIGIN_LNG_LAT.0, ORIGIN_LNG_LAT.1);
        // MERC_PER_METER printed by the TS formula at the origin latitude.
        assert!((p.merc_per_meter - 2.571_766_696_909_169_7e-8).abs() < 1e-20);
    }
}
