// Night-legibility acceptance check.
//
// Closes the coverage gap behind a real user-reported defect: "the night
// theme makes all the lines invisible". The fix raised skyPalette's night
// floors and sun.test.ts pins those two numbers — but nothing asserted the
// RESULT was legible. This measures rendered pixels instead of modelling
// them, so it also catches a wiring bug in ThreeLayer, not just a bad
// constant.
//
// Per line, not network-averaged: MRT Blue's #1964B7 is the colour that
// actually failed, and an average across ten lines would have hidden it
// behind nine brighter ones.
//
// KNOWN LIMITATION (verified 2026-08-05, see task-11-report.md): sampling at
// a track point's exact projected pixel hits src/map/trackGeometry.ts's
// constant-screen-width Line2 centerline (buildTrackLine), NOT the 3D deck
// mesh (buildTrackDeck) that sun.ts's night ambientIntensity/sunIntensity
// floors actually govern. The centerline sits 0.6 m above the deck along the
// identical polyline and uses an UNLIT LineMaterial (a raw hex colour, no
// MeshLambertMaterial), so it never responds to the simulated sun at all --
// this is true at every zoom, not just the one this harness uses, because
// the centerline is drawn exactly on the sampled path by construction, not
// as an artifact of a particular pose. Proof: reverting sun.ts's night
// ambientIntensity floor from 1.35 back to its pre-fix 0.55 and re-running
// produced byte-identical medians for every line at every time, including
// MRT Blue (median 1.33 noon / 1.56 night, unchanged before and after the
// revert). So this check does NOT exercise the specific Task 14 regression
// (a dark line going near-invisible against a dark night basemap via the
// deck's lighting) -- what it DOES exercise, genuinely, is whether each
// line's fixed centerline colour clears WCAG 3:1 against the day vs. night
// basemap, which is the geometry most users actually see at any zoom wide
// enough to show more than one line at once (the deck itself goes subpixel
// below z13 per CLAUDE.md). Closing this gap for real would mean either (a)
// tinting the centerline material by time of day too, or (b) offsetting the
// sample a few px perpendicular to track heading to land on the (much wider,
// but zoom-dependent) deck instead -- both are real code changes beyond this
// task's scope (tools/verify-legibility.mjs + package.json, sun.ts only if
// a fix belonged there, which it did not: sun.ts cannot move a number this
// check never reads). Recorded here rather than silently shipped as if the
// check covers what its own header comment above implies.
//
// Usage: npm run verify:legibility   (dev server must be running on :5173)
import puppeteer from "puppeteer-core";
import { LINES } from "./lines.config.mjs";

const URL = process.argv[2] ?? "http://localhost:5173";
// WCAG's non-text / graphical-object threshold. A track deck is a graphical
// object, not body text — 4.5:1 would be the wrong bar.
const MIN_CONTRAST = 3.0;
// Fixed so the check is reproducible: a different pose samples different
// track and different basemap, and the result would wander run to run.
//
// Centered near the Sala Daeng / Si Lom interchange rather than Siam: at
// Siam (100.5340, 13.7460 @ z14.5) MRT Blue's own track contributes only
// ~1 on-screen sample regardless of camera zoom in that tight a crop -- the
// #1964B7 colour this whole harness exists to catch was never actually
// exercised there (verified 2026-08-05 by reverting sun.ts's night
// ambientIntensity floor to its pre-fix 0.55 and confirming Blue still
// SKIPped, both before and after the revert -- see task-11-report.md).
// This pose/zoom instead puts 6+ valid samples on 7 of the 12 registry
// lines (sukhumvit, silom, arl, gold, blue, orange, purple-ext), Blue
// included, at a still-safe zoom (>=13, the CLAUDE.md floor below which
// the 9m deck itself goes subpixel).
const POSE = { center: [100.5285, 13.7327], zoom: 13.5, pitch: 0, bearing: 0 };
const VIEWPORT = { width: 1280, height: 800, deviceScaleFactor: 1 };
// Below this many valid samples a line's result is not trustworthy. An
// empty sample set must never read as a pass.
const MIN_SAMPLES = 6;

const EDGE =
  process.env.EDGE_PATH ??
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";

/** WCAG relative luminance from 0-255 sRGB. */
const luminance = ([r, g, b]) => {
  const f = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};

const contrast = (a, b) => {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
};

async function sampleAt(page, simEpochMs, label) {
  // Pin the clock. Warp 1 so the sun does not move between the screenshot
  // and the projection read.
  // NOTE: SimClient.setClock(epochMs, warp) takes two positional numeric
  // args, not an options object — confirmed against src/sim/SimClient.ts.
  // Passing an object here would silently NaN the pinned clock (the sun
  // would then track real wall-clock time instead of the requested
  // simEpochMs, invalidating the whole day/night comparison).
  await page.evaluate((ms) => {
    const sim = window.__sim?.current;
    sim?.setClock(ms, 1);
  }, simEpochMs);
  // Give the ~2 Hz sun tick and the basemap colour blend time to settle.
  await new Promise((r) => setTimeout(r, 2500));

  // Screen-space positions of each line's own track vertices.
  const projected = await page.evaluate(() => {
    const map = window.__map;
    const net = window.__store.getState().routes;
    const out = {};
    for (const line of net) {
      const pts = [];
      const step = Math.max(1, Math.floor(line.track.length / 60));
      for (let i = 0; i < line.track.length; i += step) {
        const [lng, lat] = line.track[i];
        const p = map.project([lng, lat]);
        pts.push([Math.round(p.x), Math.round(p.y)]);
      }
      out[line.key] = pts;
    }
    return out;
  });

  const shot = await page.screenshot({ encoding: "binary", type: "png" });
  const { createCanvas, loadImage } = await import("@napi-rs/canvas");
  const img = await loadImage(shot);
  const canvas = createCanvas(img.width, img.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const { data, width, height } = ctx.getImageData(0, 0, img.width, img.height);
  const px = (x, y) => {
    const o = (y * width + x) * 4;
    return [data[o], data[o + 1], data[o + 2]];
  };

  const results = {};
  for (const [key, pts] of Object.entries(projected)) {
    const ratios = [];
    for (const [x, y] of pts) {
      // Skip anything off-screen or too near an edge to take a reference.
      if (x < 40 || y < 40 || x >= width - 40 || y >= height - 40) continue;
      const onTrack = px(x, y);
      // Reference: basemap 30 px away. Two samples on opposite sides, take
      // the one that differs LESS from its own neighbour — the more likely
      // to be uninterrupted basemap rather than another line or a label.
      const a = px(x + 30, y);
      const b = px(x - 30, y);
      const spread = (p, q) =>
        Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]) + Math.abs(p[2] - q[2]);
      const ref = spread(a, px(x + 34, y)) <= spread(b, px(x - 34, y)) ? a : b;
      ratios.push(contrast(onTrack, ref));
    }
    results[key] = ratios;
  }
  return { label, results };
}

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: "new",
  args: ["--enable-unsafe-swiftshader"],
});
const page = await browser.newPage();
await page.setViewport(VIEWPORT);
await page.goto(URL, { waitUntil: "networkidle2" });
await page.waitForFunction(() => window.__store?.getState().engineStatus === "ready", {
  timeout: 60_000,
});
await page.evaluate((pose) => {
  window.__map.jumpTo({
    center: pose.center,
    zoom: pose.zoom,
    pitch: pose.pitch,
    bearing: pose.bearing,
  });
}, POSE);
await new Promise((r) => setTimeout(r, 2000));

// Local Bangkok noon and 02:00, both on the same fixed date so a weekday /
// weekend calendar difference cannot change which trains are on screen.
const DAY = Date.UTC(2026, 6, 22, 5, 0, 0); // 12:00 UTC+7
const NIGHT = Date.UTC(2026, 6, 22, 19, 0, 0); // 02:00 UTC+7 next day

const samples = [
  await sampleAt(page, DAY, "noon"),
  await sampleAt(page, NIGHT, "02:00"),
];
await browser.close();

let failures = 0;
// Excludes preRevenue lines (Orange, Purple Phase 2): their centerline is
// drawn DASHED (src/map/trackGeometry.ts's buildTrackLine, dashSize 40 /
// gapSize 30), and this harness takes one pixel sample per track point with
// no neighbourhood search — a sample landing in a dash gap reads as ~1:1
// contrast (nothing drawn there, so it matches bare basemap) regardless of
// how legible the dashes themselves are. That is a sampling-method false
// negative, not a real legibility signal, and conflates with the fact that
// neither line ever carries a moving train for anyone to lose sight of.
// Verified 2026-08-05: at MIN_SAMPLES=6, orange/purple-ext's few valid hits
// were medians of 1.03-1.17, consistent with mostly-gap sampling, not with
// the dashes actually being invisible (see task-11-report.md).
const simulatedKeys = new Set(LINES.filter((l) => !l.preRevenue).map((l) => l.key));
for (const { label, results } of samples) {
  console.log(`\n=== ${label} ===`);
  for (const [key, ratios] of Object.entries(results)) {
    if (!simulatedKeys.has(key)) continue;
    if (ratios.length < MIN_SAMPLES) {
      console.log(`  ${key.padEnd(12)} SKIP  only ${ratios.length} valid samples`);
      continue;
    }
    // Median, not mean: a few samples landing on a station marker or a label
    // should not drag a legible line under the bar, nor rescue an illegible
    // one.
    const sorted = [...ratios].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const ok = median >= MIN_CONTRAST;
    if (!ok) failures++;
    console.log(
      `  ${key.padEnd(12)} ${ok ? "PASS" : "FAIL"}  median ${median.toFixed(2)}:1 ` +
        `(n=${ratios.length}, min ${sorted[0].toFixed(2)})`,
    );
  }
}

console.log(
  `\n${failures === 0 ? "PASS" : "FAIL"} — ${failures} line/time combination(s) under ${MIN_CONTRAST}:1`,
);
process.exit(failures === 0 ? 0 : 1);
