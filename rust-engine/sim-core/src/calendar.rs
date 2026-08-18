//! Civil-date helpers (GTFS service-day resolution) and frequency expansion.

use crate::model::ServiceDoc;

/// Days since 1970-01-01 for a proleptic-Gregorian civil date.
/// Howard Hinnant's `days_from_civil` algorithm.
pub fn days_from_civil(y: i64, m: u32, d: u32) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = (y - era * 400) as u64; // [0, 399]
    let mp = (m as i64 + 9) % 12; // Mar=0 … Feb=11
    let doy = (153 * mp + 2) / 5 + d as i64 - 1; // [0, 365]
    let doe = yoe as i64 * 365 + yoe as i64 / 4 - yoe as i64 / 100 + doy; // [0, 146096]
    era * 146_097 + doe - 719_468
}

/// Inverse of `days_from_civil`.
pub fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097; // [0, 146096]
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365; // [0, 399]
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100); // [0, 365]
    let mp = (5 * doy + 2) / 153; // [0, 11]
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32; // [1, 31]
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32; // [1, 12]
    (if m <= 2 { y + 1 } else { y }, m, d)
}

pub fn split_yyyymmdd(date: u32) -> (i64, u32, u32) {
    ((date / 10_000) as i64, date / 100 % 100, date % 100)
}

pub fn join_yyyymmdd(y: i64, m: u32, d: u32) -> u32 {
    y as u32 * 10_000 + m * 100 + d
}

/// Weekday index for a YYYYMMDD date: 0=Monday … 6=Sunday.
pub fn weekday_mon0(date_yyyymmdd: u32) -> u8 {
    let (y, m, d) = split_yyyymmdd(date_yyyymmdd);
    let days = days_from_civil(y, m, d);
    // 1970-01-01 was a Thursday (Mon0 index 3).
    ((days + 3).rem_euclid(7)) as u8
}

/// The civil date one day before `date_yyyymmdd`.
pub fn previous_date(date_yyyymmdd: u32) -> u32 {
    let (y, m, d) = split_yyyymmdd(date_yyyymmdd);
    let (py, pm, pd) = civil_from_days(days_from_civil(y, m, d) - 1);
    join_yyyymmdd(py, pm, pd)
}

/// The civil date one day after `date_yyyymmdd`.
pub fn next_date(date_yyyymmdd: u32) -> u32 {
    let (y, m, d) = split_yyyymmdd(date_yyyymmdd);
    let (ny, nm, nd) = civil_from_days(days_from_civil(y, m, d) + 1);
    join_yyyymmdd(ny, nm, nd)
}

/// Which service-day frame a run falls in for a given local date/time.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Frame {
    /// The service day whose calendar decides whether a run is active here.
    pub date_yyyymmdd: u32,
    /// The query instant, in seconds since THIS frame's service-day midnight.
    pub t_abs: f64,
    /// Add to a run-frame second to express it in the QUERIED day's frame.
    pub to_query_frame: i64,
}

/// The three service-day frames a forward search must consider, ordered
/// yesterday -> today -> tomorrow.
///
/// `evaluate()` and `run_detail` use only the first two (today at
/// `sec_of_day`, the previous service day at `sec_of_day + 86400`) because
/// they only ever answer "what is live right now." A forward search needs the
/// third: a 00:10 departure is filed on its OWN service day, so at 23:55 the
/// next train exists only in the D+1 frame.
///
/// This is the same structural gap `station_board` had until this helper
/// landed — its two-frame set meant a 23:00 board could not show a 00:10
/// departure no matter how large `HORIZON_S` was.
///
/// Ordering is load-bearing. `RunDoc::start_sec` is always < 86400, so each
/// frame's departures occupy a disjoint ascending window; searching frames in
/// this order and taking the first hit is globally the earliest, which is
/// what `route::earliest_trip` relies on instead of merging three lists.
pub fn service_day_frames(date_yyyymmdd: u32, sec_of_day: f64) -> [Frame; 3] {
    [
        Frame {
            date_yyyymmdd: previous_date(date_yyyymmdd),
            t_abs: sec_of_day + 86_400.0,
            to_query_frame: -86_400,
        },
        Frame {
            date_yyyymmdd,
            t_abs: sec_of_day,
            to_query_frame: 0,
        },
        Frame {
            date_yyyymmdd: next_date(date_yyyymmdd),
            t_abs: sec_of_day - 86_400.0,
            to_query_frame: 86_400,
        },
    ]
}

/// GTFS service-day resolution: calendar_dates exceptions override the
/// weekday mask + date range.
pub fn service_active_on(svc: &ServiceDoc, date_yyyymmdd: u32) -> bool {
    if svc.removed_dates.contains(&date_yyyymmdd) {
        return false;
    }
    if svc.added_dates.contains(&date_yyyymmdd) {
        return true;
    }
    if date_yyyymmdd < svc.start_date || date_yyyymmdd > svc.end_date {
        return false;
    }
    (svc.weekday_mask >> weekday_mon0(date_yyyymmdd)) & 1 == 1
}

/// Frequency expansion: run starts at `start + k*headway` while strictly
/// `< end` (contract §0/§2).
pub fn expand_frequency(start_sec: u32, end_sec: u32, headway_secs: u32) -> Vec<u32> {
    let mut out = Vec::new();
    if headway_secs == 0 {
        return out;
    }
    let mut t = start_sec;
    while t < end_sec {
        out.push(t);
        t += headway_secs;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn weekday_known_dates() {
        assert_eq!(weekday_mon0(20260730), 3); // 2026-07-30 is a Thursday
        assert_eq!(weekday_mon0(19700101), 3); // 1970-01-01 Thursday
        assert_eq!(weekday_mon0(20000101), 5); // 2000-01-01 Saturday
        assert_eq!(weekday_mon0(20260101), 3); // 2026-01-01 Thursday
        assert_eq!(weekday_mon0(20261231), 3); // 2026-12-31 Thursday
        assert_eq!(weekday_mon0(20240229), 3); // 2024-02-29 Thursday (leap)
    }

    #[test]
    fn previous_date_rollovers() {
        assert_eq!(previous_date(20260730), 20260729);
        assert_eq!(previous_date(20260101), 20251231);
        assert_eq!(previous_date(20260301), 20260228);
        assert_eq!(previous_date(20240301), 20240229);
    }

    fn weekday_service() -> ServiceDoc {
        ServiceDoc {
            gtfs_service_id: "1".into(),
            weekday_mask: 0b0001_1111, // Mon–Fri
            start_date: 20230101,
            end_date: 20261231,
            added_dates: vec![],
            removed_dates: vec![20260730], // Thai holiday (real feed data)
        }
    }

    fn weekend_service() -> ServiceDoc {
        ServiceDoc {
            gtfs_service_id: "2".into(),
            weekday_mask: 0b0110_0000, // Sat–Sun
            start_date: 20230101,
            end_date: 20261231,
            added_dates: vec![20260730], // holiday runs weekend service
            removed_dates: vec![],
        }
    }

    #[test]
    fn service_day_resolution() {
        let wd = weekday_service();
        let we = weekend_service();
        // Ordinary Wednesday.
        assert!(service_active_on(&wd, 20260722));
        assert!(!service_active_on(&we, 20260722));
        // Ordinary Saturday.
        assert!(!service_active_on(&wd, 20260725));
        assert!(service_active_on(&we, 20260725));
        // Removed holiday (Thursday): weekday service off, weekend added on.
        assert!(!service_active_on(&wd, 20260730));
        assert!(service_active_on(&we, 20260730));
        // Outside date range.
        assert!(!service_active_on(&wd, 20270101));
        assert!(!service_active_on(&wd, 20221230));
    }

    #[test]
    fn frequency_expansion_counts() {
        // 06:00–07:00 @360 s -> 10 runs (last at 06:54, 07:00 excluded).
        assert_eq!(expand_frequency(21600, 25200, 360).len(), 10);
        // 07:00–09:00 @207 s -> ceil(7200/207)=35 runs, strictly < end.
        let v = expand_frequency(25200, 32400, 207);
        assert_eq!(v.len(), 35);
        assert_eq!(v[0], 25200);
        assert!(*v.last().unwrap() < 32400);
        // Exact multiple boundary excluded: 22:00–24:00 @480 -> 15 runs.
        let v = expand_frequency(79200, 86400, 480);
        assert_eq!(v.len(), 15);
        assert_eq!(*v.last().unwrap(), 86400 - 480);
        // Degenerate inputs.
        assert!(expand_frequency(100, 100, 60).is_empty());
        assert!(expand_frequency(100, 90, 60).is_empty());
        assert!(expand_frequency(0, 100, 0).is_empty());
    }

    #[test]
    fn next_date_rollovers() {
        assert_eq!(next_date(20260729), 20260730);
        assert_eq!(next_date(20251231), 20260101);
        assert_eq!(next_date(20260228), 20260301);
        assert_eq!(next_date(20240228), 20240229); // leap year
        assert_eq!(next_date(20240229), 20240301);
    }

    #[test]
    fn previous_and_next_date_are_inverses() {
        for d in [20260101, 20260301, 20261231, 20240229] {
            assert_eq!(previous_date(next_date(d)), d);
            assert_eq!(next_date(previous_date(d)), d);
        }
    }

    #[test]
    fn service_day_frames_span_yesterday_today_and_tomorrow() {
        // 2026-07-22 at 23:00 (82800 s).
        let f = service_day_frames(20260722, 82_800.0);
        assert_eq!(f[0].date_yyyymmdd, 20260721);
        assert_eq!(f[1].date_yyyymmdd, 20260722);
        assert_eq!(f[2].date_yyyymmdd, 20260723);

        // t_abs is the query instant expressed in each frame's OWN service day.
        assert_eq!(f[0].t_abs, 82_800.0 + 86_400.0);
        assert_eq!(f[1].t_abs, 82_800.0);
        assert_eq!(f[2].t_abs, 82_800.0 - 86_400.0);

        // to_query_frame converts a run-frame second back into the queried day.
        assert_eq!(f[0].to_query_frame, -86_400);
        assert_eq!(f[1].to_query_frame, 0);
        assert_eq!(f[2].to_query_frame, 86_400);
    }

    #[test]
    fn frames_are_ordered_so_the_first_hit_is_the_earliest() {
        // RunDoc::start_sec is always < 86400, so each frame's departures
        // occupy a disjoint ascending window: yesterday [-86400, 0), today
        // [0, 86400), tomorrow [86400, 172800). Searching frames in this
        // order and taking the first hit is therefore globally earliest —
        // the property route::earliest_trip depends on.
        let f = service_day_frames(20260722, 0.0);
        assert!(f[0].to_query_frame < f[1].to_query_frame);
        assert!(f[1].to_query_frame < f[2].to_query_frame);
    }

    #[test]
    fn a_post_midnight_departure_is_only_findable_in_the_tomorrow_frame() {
        // The concrete gap this helper closes: at 23:00 on the 22nd, a 00:10
        // departure is filed on the 23rd's service day at sec 600. Only the
        // D+1 frame puts it ahead of the query instant.
        let f = service_day_frames(20260722, 82_800.0);
        let departure_in_query_frame = 600i64 + f[2].to_query_frame;
        assert_eq!(departure_in_query_frame, 87_000);
        assert!(departure_in_query_frame > 82_800, "still in the future");
        // The same run read in TODAY's frame is already 22h50m in the past —
        // which is exactly why the two-frame rule could never see it.
        assert!(600i64 + f[1].to_query_frame < 82_800);
    }
}
