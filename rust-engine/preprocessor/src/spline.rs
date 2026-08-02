//! Centripetal Catmull-Rom resampling of the OSM track polyline.

type P3 = [f64; 3];

fn dist(a: P3, b: P3) -> f64 {
    let dx = a[0] - b[0];
    let dy = a[1] - b[1];
    let dz = a[2] - b[2];
    (dx * dx + dy * dy + dz * dz).sqrt()
}

fn lerp(a: P3, b: P3, t: f64) -> P3 {
    [
        a[0] + (b[0] - a[0]) * t,
        a[1] + (b[1] - a[1]) * t,
        a[2] + (b[2] - a[2]) * t,
    ]
}

/// Barry-Goldman recursive evaluation of one Catmull-Rom segment at knot `t`.
fn cr_point(p: [P3; 4], k: [f64; 4], t: f64) -> P3 {
    let a1 = lerp(p[0], p[1], (t - k[0]) / (k[1] - k[0]));
    let a2 = lerp(p[1], p[2], (t - k[1]) / (k[2] - k[1]));
    let a3 = lerp(p[2], p[3], (t - k[2]) / (k[3] - k[2]));
    let b1 = lerp(a1, a2, (t - k[0]) / (k[2] - k[0]));
    let b2 = lerp(a2, a3, (t - k[1]) / (k[3] - k[1]));
    lerp(b1, b2, (t - k[1]) / (k[2] - k[1]))
}

/// Resamples `pts` through a centripetal (alpha = 0.5) Catmull-Rom spline at
/// approximately `spacing` meters of arc length. Returns the resampled
/// polyline (first and last input points preserved).
pub fn catmull_rom_resample(pts: &[P3], spacing: f64) -> Result<Vec<P3>, String> {
    // Drop consecutive duplicates (would produce zero knot intervals).
    let mut ctrl: Vec<P3> = Vec::with_capacity(pts.len());
    for &p in pts {
        if ctrl.last().map_or(true, |&q| dist(p, q) > 1e-9) {
            ctrl.push(p);
        }
    }
    if ctrl.len() < 2 {
        return Err("track polyline has fewer than 2 distinct points".into());
    }

    // Dense sampling of the spline (max ~2 m chords), then uniform resample.
    let n = ctrl.len();
    let phantom_start = lerp(ctrl[0], ctrl[1], -1.0); // extrapolated end tangents
    let phantom_end = lerp(ctrl[n - 2], ctrl[n - 1], 2.0);
    let mut dense: Vec<P3> = vec![ctrl[0]];
    for i in 0..n - 1 {
        let p0 = if i == 0 { phantom_start } else { ctrl[i - 1] };
        let p1 = ctrl[i];
        let p2 = ctrl[i + 1];
        let p3 = if i + 2 < n { ctrl[i + 2] } else { phantom_end };
        let k0 = 0.0;
        let k1 = k0 + dist(p0, p1).sqrt(); // centripetal: alpha = 0.5
        let k2 = k1 + dist(p1, p2).sqrt();
        let k3 = k2 + dist(p2, p3).sqrt();
        let steps = ((dist(p1, p2) / 2.0).ceil() as usize).max(1);
        for s in 1..=steps {
            let t = k1 + (k2 - k1) * (s as f64) / (steps as f64);
            dense.push(cr_point([p0, p1, p2, p3], [k0, k1, k2, k3], t));
        }
    }

    // Cumulative arc of the dense polyline.
    let mut arc = vec![0.0f64; dense.len()];
    for i in 1..dense.len() {
        arc[i] = arc[i - 1] + dist(dense[i - 1], dense[i]);
    }
    let total = *arc.last().unwrap();
    if total <= spacing {
        return Ok(vec![dense[0], *dense.last().unwrap()]);
    }

    // Uniform resample at `spacing`, keeping the exact endpoint.
    let mut out: Vec<P3> = Vec::with_capacity((total / spacing) as usize + 2);
    let mut j = 0usize;
    let mut s = 0.0f64;
    while s < total - spacing * 0.5 {
        while j + 1 < arc.len() && arc[j + 1] < s {
            j += 1;
        }
        let seg = arc[j + 1] - arc[j];
        let u = if seg > 0.0 { (s - arc[j]) / seg } else { 0.0 };
        out.push(lerp(dense[j], dense[j + 1], u));
        s += spacing;
    }
    out.push(*dense.last().unwrap());
    Ok(out)
}

/// Nearest point on the polyline (2D, x/y) to `p`.
/// Returns (arc_m, distance_m).
pub fn snap_to_polyline(poly: &[P3], arc: &[f64], p: [f64; 2]) -> (f64, f64) {
    let mut best_arc = 0.0;
    let mut best_d2 = f64::INFINITY;
    for i in 0..poly.len() - 1 {
        let ax = poly[i][0];
        let ay = poly[i][1];
        let bx = poly[i + 1][0];
        let by = poly[i + 1][1];
        let abx = bx - ax;
        let aby = by - ay;
        let len2 = abx * abx + aby * aby;
        let t = if len2 > 0.0 {
            (((p[0] - ax) * abx + (p[1] - ay) * aby) / len2).clamp(0.0, 1.0)
        } else {
            0.0
        };
        let qx = ax + abx * t;
        let qy = ay + aby * t;
        let dx = p[0] - qx;
        let dy = p[1] - qy;
        let d2 = dx * dx + dy * dy;
        if d2 < best_d2 {
            best_d2 = d2;
            best_arc = arc[i] + (arc[i + 1] - arc[i]) * t;
        }
    }
    (best_arc, best_d2.sqrt())
}

/// All local minima of distance from `p` to the polyline (2D, x/y), each as
/// (arc_m, distance_m), in ascending arc order.
///
/// An ordinary stop, whose true position is close to the track at only one
/// place, yields exactly one candidate — identical to what `snap_to_polyline`
/// (global minimum only) would return, so a route that never approaches
/// itself sees no change in behaviour from switching to this function.
///
/// A route whose alignment passes near the same real-world point twice (a
/// loop joined to a branch, e.g. MRT Blue at Tha Phra) yields one candidate
/// per pass — the caller (main.rs's per-pattern monotonic snap) picks among
/// them; task 5's bug was treating the single global-nearest pass as the
/// only possible answer for every pattern, even ones whose neighboring stops
/// make the OTHER pass the correct one.
///
/// Implementation: walks the same per-segment (arc, distance) sequence
/// `snap_to_polyline` computes, but instead of tracking only the smallest
/// distance seen, finds every maximal non-increasing-then-rising run (a
/// "basin") and records its bottom. The segment sequence is already in arc
/// order, so basins are found in one linear pass.
pub fn snap_candidates(poly: &[P3], arc: &[f64], p: [f64; 2]) -> Vec<(f64, f64)> {
    if poly.len() < 2 {
        return Vec::new();
    }
    let n = poly.len() - 1;
    let mut seg_arc = Vec::with_capacity(n);
    let mut seg_d = Vec::with_capacity(n);
    for i in 0..n {
        let ax = poly[i][0];
        let ay = poly[i][1];
        let bx = poly[i + 1][0];
        let by = poly[i + 1][1];
        let abx = bx - ax;
        let aby = by - ay;
        let len2 = abx * abx + aby * aby;
        let t = if len2 > 0.0 {
            (((p[0] - ax) * abx + (p[1] - ay) * aby) / len2).clamp(0.0, 1.0)
        } else {
            0.0
        };
        let qx = ax + abx * t;
        let qy = ay + aby * t;
        let dx = p[0] - qx;
        let dy = p[1] - qy;
        seg_d.push((dx * dx + dy * dy).sqrt());
        seg_arc.push(arc[i] + (arc[i + 1] - arc[i]) * t);
    }

    let mut candidates = Vec::new();
    let mut i = 0;
    while i < n {
        let is_basin_start = i == 0 || seg_d[i] <= seg_d[i - 1];
        if !is_basin_start {
            i += 1;
            continue;
        }
        // Walk forward through the non-increasing run, tracking its bottom.
        let mut j = i;
        let mut best = i;
        while j + 1 < n && seg_d[j + 1] <= seg_d[j] {
            j += 1;
            if seg_d[j] < seg_d[best] {
                best = j;
            }
        }
        candidates.push((seg_arc[best], seg_d[best]));
        i = j + 1; // resume scanning past this basin
    }
    candidates
}

pub fn cumulative_arc(poly: &[P3]) -> Vec<f64> {
    let mut arc = vec![0.0f64; poly.len()];
    for i in 1..poly.len() {
        arc[i] = arc[i - 1] + dist(poly[i - 1], poly[i]);
    }
    arc
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resample_straight_line_spacing() {
        let pts = vec![[0.0, 0.0, 15.0], [50.0, 0.0, 15.0], [100.0, 0.0, 15.0]];
        let out = catmull_rom_resample(&pts, 10.0).unwrap();
        let arc = cumulative_arc(&out);
        let total = *arc.last().unwrap();
        assert!((total - 100.0).abs() < 0.5, "total {total}");
        // Spacing approximately 10 m everywhere except possibly the last step.
        for w in arc.windows(2).take(arc.len() - 2) {
            assert!((w[1] - w[0] - 10.0).abs() < 0.5);
        }
        assert_eq!(out.first().unwrap()[0], 0.0);
        assert!((out.last().unwrap()[0] - 100.0).abs() < 1e-9);
    }

    #[test]
    fn snap_projects_onto_segment() {
        let poly = vec![[0.0, 0.0, 0.0], [100.0, 0.0, 0.0], [100.0, 100.0, 0.0]];
        let arc = cumulative_arc(&poly);
        let (a, d) = snap_to_polyline(&poly, &arc, [30.0, 4.0]);
        assert!((a - 30.0).abs() < 1e-9);
        assert!((d - 4.0).abs() < 1e-9);
        let (a, d) = snap_to_polyline(&poly, &arc, [104.0, 60.0]);
        assert!((a - 160.0).abs() < 1e-9);
        assert!((d - 4.0).abs() < 1e-9);
    }

    // --- snap_candidates (task 5 fix: Blue Line self-approaching track) -----

    #[test]
    fn snap_candidates_single_dip_matches_the_old_global_min() {
        // An ordinary, non-self-approaching polyline: one dip, one candidate.
        let poly = vec![[0.0, 0.0, 0.0], [100.0, 0.0, 0.0], [100.0, 100.0, 0.0]];
        let arc = cumulative_arc(&poly);
        let cands = snap_candidates(&poly, &arc, [30.0, 4.0]);
        assert_eq!(cands.len(), 1, "a single-dip point must yield exactly one candidate");
        let (old_a, old_d) = snap_to_polyline(&poly, &arc, [30.0, 4.0]);
        assert!((cands[0].0 - old_a).abs() < 1e-6);
        assert!((cands[0].1 - old_d).abs() < 1e-6);
    }

    #[test]
    fn snap_candidates_finds_both_passes_of_a_self_approaching_track() {
        // A track that goes east, loops far north and comes back to pass
        // close by its own start again (the Blue Line loop-plus-branch
        // shape near Tha Phra, minimized): two distinct arc positions are
        // both close to the query point.
        let poly = vec![
            [0.0, 0.0, 0.0],
            [1000.0, 0.0, 0.0],
            [1000.0, 1000.0, 0.0],
            [0.0, 1000.0, 0.0],
            [0.0, 10.0, 0.0], // back down near the start...
            [5.0, 0.0, 0.0],  // ...passing within 5 m of (0,0) a second time
        ];
        let arc = cumulative_arc(&poly);
        let cands = snap_candidates(&poly, &arc, [0.0, 0.0]);
        assert!(
            cands.len() >= 2,
            "a track passing near itself twice must yield >= 2 candidates, got {}",
            cands.len()
        );
        // One candidate near arc 0 (the start), one near the end of the polyline.
        let total = *arc.last().unwrap();
        assert!(cands.iter().any(|&(a, d)| a < 50.0 && d < 1.0), "expected a near-start candidate");
        assert!(
            cands.iter().any(|&(a, d)| a > total - 50.0 && d < 10.0),
            "expected a near-end candidate"
        );
    }
}
