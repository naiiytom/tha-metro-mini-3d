// Decisive MVP 3 check, data-level: sample interpolated vehicle states twice
// and assert (a) vehicles exist, (b) in-transit vehicles moved plausibly,
// (c) yaw matches direction of motion, (d) dwellers sit still.
import puppeteer from "puppeteer-core";

// Max plausible displacement in one sample window (task 5, MRT Blue).
// Verified against the raw Namtang GTFS feed (not a preprocessor or app
// bug): trip_ids 5285 ("Toa Poon" [sic], service_id 1/weekday, 88
// frequency.txt windows), 7869 ("Tao Poon (Saturday)", 26 windows), and 7870
// ("Tao Poon (Sunday and Public Holiday)", 1 window) — ~473 of Blue's 3712
// runs — carry LITERAL 0-second transit + uniform 60-second dwell for every
// single one of their ~26 stops in stop_times.txt itself (confirmed by
// reading the raw CSV rows directly; sibling trips on the same route/day,
// e.g. 257/263/7862, have realistic 90-240s transit times). With a
// zero-width transit window, eval_pattern (rust-engine/sim-core/src/
// world.rs) reports these runs as continuously "dwelling", jumping instantly
// from one station's exact position to the next's — a real, disclosed data
// quality defect in a small subset of Blue's schedule, not a coordinate or
// engine bug. These known degenerate runs are excluded from maxD and
// dwellMovedUnknown so the strict <900 m displacement and 1 m dwell-drift
// thresholds remain fully binding for all other ~3,239 Blue runs and all nine
// other lines.

const browser = await puppeteer.launch({
  executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  headless: true,
  args: ["--enable-unsafe-swiftshader", "--no-first-run"],
  defaultViewport: { width: 1200, height: 800 },
});
const page = await browser.newPage();
page.on("pageerror", (e) => console.log(`[pageerror] ${e.message}`));
await page.goto("http://localhost:5173/", { waitUntil: "networkidle2", timeout: 60_000 });
await page.waitForFunction(() => document.body.innerText.includes("runs"), { timeout: 30_000 });
await new Promise((r) => setTimeout(r, 2_000));

const sample = () =>
  page.evaluate(() => {
    const client = window.__sim?.current;
    if (!client) return null;
    const { vehicles, count } = client.getInterpolated(performance.now());
    const out = [];
    for (let i = 0; i < count; i++) {
      const b = i * 8;
      out.push({
        x: vehicles[b], y: vehicles[b + 1], z: vehicles[b + 2],
        yaw: vehicles[b + 3], state: vehicles[b + 4],
        run: vehicles[b + 5], route: vehicles[b + 6], prog: vehicles[b + 7],
      });
    }
    return { count, simNow: client.getSimNow(), out };
  });

const A = await sample();
await new Promise((r) => setTimeout(r, 4_000));
const B = await sample();
if (!A || !B) { console.log("FAIL: __sim handle missing"); process.exit(1); }

console.log(`count A=${A.count} B=${B.count}; sim dt = ${(B.simNow - A.simNow) / 1000}s`);
const byRunB = new Map(B.out.map((v) => [v.run, v]));
let moved = 0, still = 0, badYaw = 0, dwellMovedKnown = 0, dwellMovedUnknown = 0, matched = 0;
let maxD = 0, minZ = Infinity, maxZ = -Infinity;

// Identifies a run as one of the 3 known-degenerate trips (5285/7869/7870,
// see top comment) by its OWN schedule, not by a hardcoded
// run index (which shifts on every regeneration) — a run is degenerate iff
// EVERY consecutive stop pair has literal 0-second transit
// (stops[i].arrival_sec === stops[i-1].departure_sec), the exact signature
// read directly off those 3 trips' raw stop_times.txt rows. A real dwell-
// drift bug on any other run does not have this shape and is not excused.
const degenerateCache = new Map();
async function isKnownDegenerateRun(runIdx) {
  if (degenerateCache.has(runIdx)) return degenerateCache.get(runIdx);
  const detail = await page.evaluate(
    (idx, simEpochMs) => window.__sim.current.getRunDetail(idx, simEpochMs),
    runIdx,
    A.simNow,
  );
  const stops = detail?.stops ?? [];
  const isDegenerate =
    stops.length >= 2 && stops.slice(1).every((s, i) => s.arrival_sec === stops[i].departure_sec);
  degenerateCache.set(runIdx, isDegenerate);
  return isDegenerate;
}

for (const a of A.out) {
  const b = byRunB.get(a.run);
  if (!b) continue;
  matched++;
  const dx = b.x - a.x, dy = b.y - a.y;
  const d = Math.hypot(dx, dy);
  minZ = Math.min(minZ, a.z); maxZ = Math.max(maxZ, a.z);
  const isDegenerate = await isKnownDegenerateRun(a.run);
  if (!isDegenerate) {
    maxD = Math.max(maxD, d);
  }
  const inTransitEither = a.state === 1 || b.state === 1;
  if (inTransitEither && d > 5) {
    moved++;
    // heading vs displacement (use B's yaw; generous tolerance for curves)
    const headErr = Math.abs(((Math.atan2(dy, dx) - b.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
    if (b.state === 1 && d > 30 && headErr > 0.6) {
      badYaw++;
      console.log("  offender:", JSON.stringify({ ...b, dispHeading: Math.atan2(dy, dx).toFixed(2), d: d.toFixed(1), headErr: headErr.toFixed(2) }));
    }
  } else if (a.state === 0 && b.state === 0) {
    still++;
    // Strict 1 m threshold, same as the original check — a genuine dwell-
    // drift bug of ANY size must still fail. The only tolerated exception is
    // a run whose OWN schedule is independently confirmed degenerate.
    if (d > 1) {
      if (isDegenerate) {
        dwellMovedKnown++;
      } else {
        dwellMovedUnknown++;
        console.log(
          "  dwell-drift offender:",
          JSON.stringify({ run: a.run, route: a.route, d: d.toFixed(1) }),
        );
      }
    }
  }
}
console.log(`matched=${matched} movedInTransit=${moved} dwellStill=${still}`);
console.log(`maxDisplacement=${maxD.toFixed(1)}m (non-degenerate)  z range=[${minZ.toFixed(1)}, ${maxZ.toFixed(1)}]m`);
console.log(
  `violations: badYaw=${badYaw} dwellMovedKnown(degenerate-schedule trip, tolerated)=` +
    `${dwellMovedKnown} dwellMovedUnknown(must be 0)=${dwellMovedUnknown}`,
);
// z-bounds were originally minZ > 10 && maxZ < 20, from the MVP 1-3 era when
// the whole network was Green Line (elevated only, altitude 15 m). Since
// task 2 of MVP 6, track structure is per-point (underground/atGrade/
// elevated), and MRT Blue (task 5) put ~260 of its 494 track points
// underground (STRUCTURE_ALTITUDE_M.underground = -18) — a Blue train is now
// reliably in-frame underground on almost any sample, whereas ARL's 2
// genuine pre-existing underground points rarely were.
//
// The true per-point altitudes are exactly one of {-18, 0.5, 15}
// (STRUCTURE_ALTITUDE_M), so an un-extrapolated sample can never leave
// [-18, 15]. But SimClient.getInterpolated (src/sim/SimClient.ts) clamps its
// render-side alpha to 1.25, not 1.0 — a deliberate pre-existing design (it
// lets rendering run slightly ahead of the latest 10 Hz worker frame) that
// can EXTRAPOLATE up to 25% past a transition. Blue is the first line with
// frequent adjacent-point transitions across the full elevated<->underground
// span (33 m, e.g. near Tha Phra), so this overshoot is now visible where it
// almost never was before (observed live: z=22.9 on one sample). Worst case
// over the full 33 m span: 15 + 0.25*33 = 23.25 going up, -18 - 0.25*33 =
// -26.25 going down. Bounds below add a small safety margin over that
// theoretical ceiling so this still catches a real altitude bug (e.g. an
// inverted sign or a wildly wrong classification) without false-failing on
// this legitimate, pre-existing render-side extrapolation.
const pass =
  A.count > 20 &&
  moved > 5 &&
  badYaw === 0 &&
  dwellMovedUnknown === 0 &&
  maxD < 900 &&
  minZ >= -27 &&
  maxZ <= 24;
console.log(pass ? "PASS" : "FAIL");
await browser.close();
process.exit(pass ? 0 : 1);
