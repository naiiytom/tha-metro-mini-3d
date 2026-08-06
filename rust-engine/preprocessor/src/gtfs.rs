//! Minimal streaming GTFS readers (csv + header-name column lookup), filtered
//! to the BTS Green Line routes. Handles quoted fields; Namtang bilingual
//! names are "ไทย;English".

use std::collections::{HashMap, HashSet};
use std::fs::File;
use std::path::Path;

pub struct Table {
    rdr: csv::Reader<File>,
    idx: HashMap<String, usize>,
}

impl Table {
    pub fn open(dir: &Path, name: &str) -> Result<Self, String> {
        let path = dir.join(name);
        let file = File::open(&path)
            .map_err(|e| format!("missing required GTFS file {}: {e}", path.display()))?;
        let mut rdr = csv::ReaderBuilder::new().flexible(true).from_reader(file);
        let idx = rdr
            .headers()
            .map_err(|e| format!("{name}: bad header: {e}"))?
            .iter()
            .enumerate()
            .map(|(i, h)| (h.trim().trim_start_matches('\u{feff}').to_string(), i))
            .collect();
        Ok(Self { rdr, idx })
    }

    pub fn col(&self, name: &str) -> Result<usize, String> {
        self.idx
            .get(name)
            .copied()
            .ok_or_else(|| format!("GTFS column '{name}' not found"))
    }

    pub fn rows(&mut self) -> csv::StringRecordsIter<'_, File> {
        self.rdr.records()
    }
}

/// "ไทย;English" -> (th, en). Single-part names land in both.
pub fn split_th_en(s: &str) -> (String, String) {
    match s.split_once(';') {
        Some((th, en)) => (th.trim().to_string(), en.trim().to_string()),
        None => (s.trim().to_string(), s.trim().to_string()),
    }
}

/// GTFS HH:MM:SS -> seconds; hours may exceed 24.
pub fn parse_gtfs_time(s: &str) -> Result<u32, String> {
    let mut it = s.trim().split(':');
    let (h, m, sec) = match (it.next(), it.next(), it.next()) {
        (Some(h), Some(m), Some(s)) => (h, m, s),
        _ => return Err(format!("bad GTFS time '{s}'")),
    };
    let p = |x: &str| x.parse::<u32>().map_err(|_| format!("bad GTFS time '{s}'"));
    Ok(p(h)? * 3600 + p(m)? * 60 + p(sec)?)
}

pub struct TripRow {
    pub route_id: String,
    pub service_id: String,
    pub trip_id: String,
    pub headsign: String,
    pub direction_id: u8,
}

pub fn read_trips(dir: &Path, route_ids: &[&str]) -> Result<Vec<TripRow>, String> {
    let mut t = Table::open(dir, "trips.txt")?;
    let (c_route, c_service, c_trip, c_head, c_dir) = (
        t.col("route_id")?,
        t.col("service_id")?,
        t.col("trip_id")?,
        t.col("trip_headsign")?,
        t.col("direction_id")?,
    );
    let wanted: HashSet<&str> = route_ids.iter().copied().collect();
    let mut out = Vec::new();
    for rec in t.rows() {
        let rec = rec.map_err(|e| format!("trips.txt: {e}"))?;
        let route_id = rec.get(c_route).unwrap_or("").to_string();
        if !wanted.contains(route_id.as_str()) {
            continue;
        }
        out.push(TripRow {
            route_id,
            service_id: rec.get(c_service).unwrap_or("").to_string(),
            trip_id: rec.get(c_trip).unwrap_or("").to_string(),
            headsign: rec.get(c_head).unwrap_or("").to_string(),
            direction_id: rec.get(c_dir).unwrap_or("0").trim().parse().unwrap_or(0),
        });
    }
    Ok(out)
}

pub struct StopTimeRow {
    pub arrival_s: u32,
    pub departure_s: u32,
    pub stop_id: String,
    pub stop_sequence: u32,
}

/// trip_id -> stop rows sorted by stop_sequence.
pub fn read_stop_times(
    dir: &Path,
    trip_ids: &HashSet<String>,
) -> Result<HashMap<String, Vec<StopTimeRow>>, String> {
    let mut t = Table::open(dir, "stop_times.txt")?;
    let (c_trip, c_arr, c_dep, c_stop, c_seq) = (
        t.col("trip_id")?,
        t.col("arrival_time")?,
        t.col("departure_time")?,
        t.col("stop_id")?,
        t.col("stop_sequence")?,
    );
    let mut out: HashMap<String, Vec<StopTimeRow>> = HashMap::new();
    for rec in t.rows() {
        let rec = rec.map_err(|e| format!("stop_times.txt: {e}"))?;
        let trip_id = rec.get(c_trip).unwrap_or("");
        if !trip_ids.contains(trip_id) {
            continue;
        }
        out.entry(trip_id.to_string())
            .or_default()
            .push(StopTimeRow {
                arrival_s: parse_gtfs_time(rec.get(c_arr).unwrap_or(""))?,
                departure_s: parse_gtfs_time(rec.get(c_dep).unwrap_or(""))?,
                stop_id: rec.get(c_stop).unwrap_or("").to_string(),
                stop_sequence: rec
                    .get(c_seq)
                    .unwrap_or("0")
                    .trim()
                    .parse()
                    .map_err(|_| "bad stop_sequence".to_string())?,
            });
    }
    for v in out.values_mut() {
        v.sort_by_key(|r| r.stop_sequence);
    }
    Ok(out)
}

pub struct FrequencyRow {
    pub trip_id: String,
    pub start_sec: u32,
    pub end_sec: u32,
    pub headway_secs: u32,
}

pub fn read_frequencies(
    dir: &Path,
    trip_ids: &HashSet<String>,
) -> Result<Vec<FrequencyRow>, String> {
    let mut t = Table::open(dir, "frequencies.txt")?;
    let (c_trip, c_start, c_end, c_head) = (
        t.col("trip_id")?,
        t.col("start_time")?,
        t.col("end_time")?,
        t.col("headway_secs")?,
    );
    let mut out = Vec::new();
    for rec in t.rows() {
        let rec = rec.map_err(|e| format!("frequencies.txt: {e}"))?;
        let trip_id = rec.get(c_trip).unwrap_or("");
        if !trip_ids.contains(trip_id) {
            continue;
        }
        out.push(FrequencyRow {
            trip_id: trip_id.to_string(),
            start_sec: parse_gtfs_time(rec.get(c_start).unwrap_or(""))?,
            end_sec: parse_gtfs_time(rec.get(c_end).unwrap_or(""))?,
            headway_secs: rec
                .get(c_head)
                .unwrap_or("0")
                .trim()
                .parse()
                .map_err(|_| "bad headway_secs".to_string())?,
        });
    }
    Ok(out)
}

pub struct StopRow {
    pub name: String,
    pub lat: f64,
    pub lon: f64,
}

pub fn read_stops(
    dir: &Path,
    stop_ids: &HashSet<String>,
) -> Result<HashMap<String, StopRow>, String> {
    let mut t = Table::open(dir, "stops.txt")?;
    let (c_id, c_name, c_lat, c_lon) = (
        t.col("stop_id")?,
        t.col("stop_name")?,
        t.col("stop_lat")?,
        t.col("stop_lon")?,
    );
    let mut out = HashMap::new();
    for rec in t.rows() {
        let rec = rec.map_err(|e| format!("stops.txt: {e}"))?;
        let id = rec.get(c_id).unwrap_or("");
        if !stop_ids.contains(id) {
            continue;
        }
        let parse = |s: &str, what: &str| -> Result<f64, String> {
            s.trim()
                .parse::<f64>()
                .map_err(|_| format!("stop {id}: bad {what} '{s}'"))
        };
        out.insert(
            id.to_string(),
            StopRow {
                name: rec.get(c_name).unwrap_or("").to_string(),
                lat: parse(rec.get(c_lat).unwrap_or(""), "stop_lat")?,
                lon: parse(rec.get(c_lon).unwrap_or(""), "stop_lon")?,
            },
        );
    }
    Ok(out)
}

pub struct CalendarRow {
    pub weekday_mask: u8,
    pub start_date: u32,
    pub end_date: u32,
}

pub fn read_calendar(
    dir: &Path,
    service_ids: &HashSet<String>,
) -> Result<HashMap<String, CalendarRow>, String> {
    let mut t = Table::open(dir, "calendar.txt")?;
    let days = [
        "monday",
        "tuesday",
        "wednesday",
        "thursday",
        "friday",
        "saturday",
        "sunday",
    ];
    let c_id = t.col("service_id")?;
    let c_days: Vec<usize> = days.iter().map(|d| t.col(d)).collect::<Result<_, _>>()?;
    let (c_start, c_end) = (t.col("start_date")?, t.col("end_date")?);
    let mut out = HashMap::new();
    for rec in t.rows() {
        let rec = rec.map_err(|e| format!("calendar.txt: {e}"))?;
        let id = rec.get(c_id).unwrap_or("");
        if !service_ids.contains(id) {
            continue;
        }
        let mut mask = 0u8;
        for (bit, &c) in c_days.iter().enumerate() {
            if rec.get(c).unwrap_or("0").trim() == "1" {
                mask |= 1 << bit;
            }
        }
        let pd = |s: &str| -> Result<u32, String> {
            s.trim()
                .parse()
                .map_err(|_| format!("calendar.txt: bad date '{s}'"))
        };
        out.insert(
            id.to_string(),
            CalendarRow {
                weekday_mask: mask,
                start_date: pd(rec.get(c_start).unwrap_or(""))?,
                end_date: pd(rec.get(c_end).unwrap_or(""))?,
            },
        );
    }
    Ok(out)
}

/// service_id -> (added_dates, removed_dates).
pub fn read_calendar_dates(
    dir: &Path,
    service_ids: &HashSet<String>,
) -> Result<HashMap<String, (Vec<u32>, Vec<u32>)>, String> {
    let mut t = Table::open(dir, "calendar_dates.txt")?;
    let (c_id, c_date, c_type) = (
        t.col("service_id")?,
        t.col("date")?,
        t.col("exception_type")?,
    );
    let mut out: HashMap<String, (Vec<u32>, Vec<u32>)> = HashMap::new();
    for rec in t.rows() {
        let rec = rec.map_err(|e| format!("calendar_dates.txt: {e}"))?;
        let id = rec.get(c_id).unwrap_or("");
        if !service_ids.contains(id) {
            continue;
        }
        let date: u32 = rec
            .get(c_date)
            .unwrap_or("")
            .trim()
            .parse()
            .map_err(|_| "calendar_dates.txt: bad date".to_string())?;
        let entry = out.entry(id.to_string()).or_default();
        match rec.get(c_type).unwrap_or("").trim() {
            "1" => entry.0.push(date), // added
            "2" => entry.1.push(date), // removed
            other => return Err(format!("calendar_dates.txt: bad exception_type '{other}'")),
        }
    }
    Ok(out)
}

pub struct RouteRow {
    pub short_name: String,
    pub color_rgb: u32,
}

pub fn read_routes(dir: &Path, route_ids: &[&str]) -> Result<HashMap<String, RouteRow>, String> {
    let mut t = Table::open(dir, "routes.txt")?;
    let (c_id, c_short, c_color) = (
        t.col("route_id")?,
        t.col("route_short_name")?,
        t.col("route_color")?,
    );
    let wanted: HashSet<&str> = route_ids.iter().copied().collect();
    let mut out = HashMap::new();
    for rec in t.rows() {
        let rec = rec.map_err(|e| format!("routes.txt: {e}"))?;
        let id = rec.get(c_id).unwrap_or("");
        if !wanted.contains(id) {
            continue;
        }
        let color = rec.get(c_color).unwrap_or("").trim();
        out.insert(
            id.to_string(),
            RouteRow {
                short_name: rec.get(c_short).unwrap_or("").trim().to_string(),
                color_rgb: u32::from_str_radix(color, 16)
                    .map_err(|_| format!("routes.txt: bad route_color '{color}'"))?,
            },
        );
    }
    Ok(out)
}

pub fn read_feed_version(dir: &Path) -> Result<String, String> {
    let mut t = Table::open(dir, "feed_info.txt")?;
    let c = t.col("feed_version")?;
    for rec in t.rows() {
        let rec = rec.map_err(|e| format!("feed_info.txt: {e}"))?;
        return Ok(rec.get(c).unwrap_or("").trim().to_string());
    }
    Err("feed_info.txt has no rows".into())
}
