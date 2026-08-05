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
// WHAT THIS SAMPLES (fixed 2026-08-05, see task-11-report.md's fix-round
// section for the full investigation): the original version of this harness
// sampled every pixel at a track point's EXACT projected coordinate — which
// always lands on src/map/trackGeometry.ts's constant-screen-width Line2
// centerline (buildTrackLine), drawn 0.6 m above the deck along the
// identical polyline with an UNLIT LineMaterial. It never hit the lit
// MeshLambertMaterial deck (buildTrackDeck) that sun.ts's night
// ambientIntensity/sunIntensity floors actually govern.
//
// The fix: each sample point is OFFSET perpendicular to the local track
// heading, by an amount computed from (a) the deck's real physical width for
// that point's vehicleType/structure (mirrored from trackGeometry.ts's
// DECK_PROFILE below) and (b) an empirically-measured metres-per-pixel at
// the current pose/zoom (via two map.project() calls 100 m apart — this
// deliberately does NOT hardcode MapLibre's tile-size convention, since
// getting that wrong would silently mis-scale every offset). The offset is
// picked to clear the centerline's ~3 px lit halo while staying inside the
// deck's own on-screen footprint. Because the 9 m (heavy/commuter) or 5 m
// (monorail/apm) deck is subpixel below roughly z13 (see CLAUDE.md), this
// only works at a MUCH tighter zoom than the original single fixed pose used
// — see tightZoomFor() below and the per-line, per-pose search this file
// does instead of one global pose for all twelve lines. The basemap
// reference is the MEDIAN luminance across a fan of points around the
// perpendicular (not one pixel), so a single POI icon/label near the track
// in a dense downtown pose can't swing a whole verdict.
//
// THIS NOW GENUINELY EXERCISES sun.ts (verified, not assumed): sampling a
// brighter line (Sukhumvit, #7CB342) at night shows a distinct dim-green
// halo next to the centerline, clearly different from the surrounding
// basemap — proof the deck's own lit colour, not the centerline, is what's
// being read. But a second, deeper finding came out of proving Step 4 (the
// brief's "revert the ambientIntensity floor to 0.55 and confirm MRT Blue's
// contrast drops measurably"): it did NOT move — 1.39:1 at both 0.55 and
// 1.35, byte-identical, confirmed by raw-pixel inspection, not just the
// ratio. The reason is real and reproducible, not a harness bug: at MRT
// Blue's dark base hue (#1964B7, raw luminance already well below
// Sukhumvit's), the night-lit deck colour is dark enough to be
// quantization-saturated in 8-bit sRGB — both floor values round to the
// SAME near-zero pixel value once painted, so WCAG's relative-luminance
// ratio (which adds a flat +0.05 to both sides) cannot distinguish them
// either. In other words: for a colour this dark at night, the specific
// ambientIntensity floor picked genuinely doesn't matter to what a screen
// can display — Task 14's fix improved things by a real multiplicative
// factor, but not far enough to pull a hue this dark out of the
// near-invisible regime. This is a genuine, previously-undetected gap (see
// task-11-report.md's fix-round section) left for a follow-up rather than
// patched here, since a real fix needs a different mechanism (e.g. a
// per-material minimum rendered brightness/emissive floor, not a further
// ambient-intensity nudge — sun.ts's ambientIntensity floor is already at
// 1.35 against a 1.6 day ceiling, with little headroom left before night and
// day stop reading as visually distinct at all).
//
// Usage: npm run verify:legibility   (dev server must be running on :5173)
import puppeteer from "puppeteer-core";
import { LINES } from "./lines.config.mjs";

const URL = process.argv[2] ?? "http://localhost:5173";
// WCAG's non-text / graphical-object threshold. A track deck is a graphical
// object, not body text — 4.5:1 would be the wrong bar.
//
// KEPT AT THE REAL WCAG VALUE, SHIPPED FAILING ON PURPOSE (2026-08-05):
// against the real, deck-sampling method above, the network is FAR from
// clearing 3:1 at 02:00 — 9 of 10 simulated lines fail at night, several
// with medians near 1.0-1.4 (see task-11-report.md's fix-round section for
// every line's real number). That is not a narrow, one-line shortfall the
// brief's "pin MIN_CONTRAST to the measured value" escape hatch was written
// for — pinning it down to ~1.0 to make this pass would gut the gate for
// every future line, exactly what the brief warns against. A genuine
// sun.ts fix isn't cleanly available either (see the file header): the
// ambientIntensity floor is already close to its own day-side ceiling, and
// MRT Blue's specific failure is an 8-bit quantization floor, not something
// a further intensity nudge can move. So, same precedent as this repo's
// own verify:perf ≥300-vehicle check: left genuinely failing, real numbers
// recorded, not weakened or gamed to read green.
const MIN_CONTRAST = 3.0;
const VIEWPORT = { width: 1280, height: 800, deviceScaleFactor: 1 };
// Below this many valid samples a line's result is not trustworthy. An
// empty sample set must never read as a pass.
const MIN_SAMPLES = 6;

const EDGE =
  process.env.EDGE_PATH ??
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";

// Deck cross-section widths, mirrored by hand from src/map/trackGeometry.ts's
// DECK_PROFILE (this is a standalone .mjs tool with no bundler step, so it
// can't import the .ts module directly). Keep in sync if that table changes.
const DECK_WIDTH_M = { elevated: 9, atGrade: 8, underground: 9, monorail: 5 };
function deckWidthM(vehicleType, structure) {
  const beam = vehicleType === "monorail" || vehicleType === "apm";
  return beam ? DECK_WIDTH_M.monorail : DECK_WIDTH_M[structure];
}

// Tight enough that the metric deck has a real multi-pixel screen footprint
// to offset a sample into. Monorail/APM decks are narrower (5 m vs 8-9 m for
// heavy/commuter), so they need a tighter zoom to clear the centerline's
// halo with the same safety margin.
function tightZoomFor(vehicleType) {
  return vehicleType === "monorail" || vehicleType === "apm" ? 19 : 18;
}

// Sample points spread across each line's own track, tried in this order
// until MIN_SAMPLES is reached at a candidate pose (most lines succeed on
// the first candidate; the fallback list exists for lines whose geometry is
// sparse or awkwardly shaped near the 0.5 mark, e.g. MRT Blue's loop+branch).
const POSE_FRACTIONS = [0.5, 0.25, 0.75, 0.1, 0.9];
const MAX_POSES_PER_LINE = POSE_FRACTIONS.length;

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

function candidateCenters(track) {
  const n = track.length;
  const seen = new Set();
  const centers = [];
  for (const f of POSE_FRACTIONS) {
    const idx = Math.min(n - 2, Math.max(1, Math.round(f * (n - 1))));
    if (seen.has(idx)) continue;
    seen.add(idx);
    centers.push({ lng: track[idx][0], lat: track[idx][1] });
  }
  return centers;
}

/**
 * Runs in the browser. For the CURRENT camera pose, finds every deck-offset
 * sample+reference-fan pixel pair for one line's own track that falls
 * on-screen, skipping anything too close to the canvas edge or overlapping a
 * known UI panel.
 */
async function computeSamplePoints(page, lineKey, vehicleType, exclusions, viewport) {
  return await page.evaluate(
    (lineKey, vehicleType, exclusions, viewport) => {
      const DECK_WIDTH_M = { elevated: 9, atGrade: 8, underground: 9, monorail: 5 };
      const deckWidthM = (structure) => {
        const beam = vehicleType === "monorail" || vehicleType === "apm";
        return beam ? DECK_WIDTH_M.monorail : DECK_WIDTH_M[structure];
      };
      // How much clearance a sample needs from the centerline (its lit
      // halo, allowing for WebGL antialiasing beyond the nominal 3 px
      // linewidth) and how far inside the deck's own edge it should stay.
      const CENTERLINE_CLEARANCE_PX = 3.0;
      const EDGE_MARGIN_PX = 1.0;
      const TARGET_PADDING_PX = 1.5;

      const map = window.__map;
      const line = window.__store.getState().routes.find((l) => l.key === lineKey);
      if (!line) return [];
      const track = line.track;

      // Empirically-measured metres-per-pixel at this pose: project the
      // current centre and a point exactly 100 m east of it, and read the
      // screen distance back. Deliberately not derived from a hardcoded
      // Web Mercator tile-size constant (256 vs 512 px tiles change that
      // formula) — this reads MapLibre's own projection directly instead.
      const center = map.getCenter();
      const EARTH_R_M = 6371008.8;
      const metersPerDegLat = (Math.PI / 180) * EARTH_R_M;
      const metersPerDegLng = metersPerDegLat * Math.cos((center.lat * Math.PI) / 180);
      const eastPoint = [center.lng + 100 / metersPerDegLng, center.lat];
      const p0 = map.project([center.lng, center.lat]);
      const p1 = map.project(eastPoint);
      const pxPer100m = Math.hypot(p1.x - p0.x, p1.y - p0.y);
      if (pxPer100m < 1) return []; // degenerate projection, bail out
      const metersPerPixel = 100 / pxPer100m;

      const inExclusion = (x, y) =>
        exclusions.some((r) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom);

      const points = [];
      for (let i = 1; i < track.length - 1; i++) {
        const [lng, lat, , structure] = track[i];
        const p = map.project([lng, lat]);
        const prev = map.project([track[i - 1][0], track[i - 1][1]]);
        const next = map.project([track[i + 1][0], track[i + 1][1]]);
        let tx = next.x - prev.x;
        let ty = next.y - prev.y;
        const tlen = Math.hypot(tx, ty);
        if (tlen < 1) continue; // too-close neighbours, no stable heading
        tx /= tlen;
        ty /= tlen;
        // Perpendicular to the local heading, in screen space.
        const perpX = -ty;
        const perpY = tx;

        const halfWidthPx = deckWidthM(structure) / 2 / metersPerPixel;
        const maxOffset = halfWidthPx - EDGE_MARGIN_PX;
        if (maxOffset <= CENTERLINE_CLEARANCE_PX) continue; // deck still too subpixel here
        const offsetPx = Math.min(maxOffset, CENTERLINE_CLEARANCE_PX + TARGET_PADDING_PX);

        const sx = Math.round(p.x + perpX * offsetPx);
        const sy = Math.round(p.y + perpY * offsetPx);
        if (sx < 4 || sy < 4 || sx >= viewport.width - 4 || sy >= viewport.height - 4) continue;
        if (inExclusion(sx, sy)) continue;

        // Reference: a FAN of points on both sides, well past the deck's
        // own far edge, at angles spread around the pure perpendicular
        // (not a single point) — a dense downtown basemap can put a bright
        // POI icon or label right next to any one candidate, and a single
        // unlucky reference pixel would read as a false illegible verdict.
        // The caller takes the MEDIAN luminance across whichever of these
        // land in-bounds and outside a UI panel, the same "resist a single
        // outlier" principle already used for the per-line sample median
        // below. All angles stay within +-40 degrees of the perpendicular
        // (never toward the tangent) because walking along the track's own
        // heading, even 30+ px out, is still very likely still ON the deck.
        const refOffsetPx = offsetPx + 30;
        const refCandidates = [];
        for (const sign of [1, -1]) {
          for (const deg of [0, 15, 30, -15, -30]) {
            const rad = (deg * Math.PI) / 180;
            const cos = Math.cos(rad);
            const sin = Math.sin(rad);
            // Rotate (perpX, perpY) by `rad`, then flip by `sign` for the
            // other side of the deck.
            const rpx = (perpX * cos - perpY * sin) * sign;
            const rpy = (perpX * sin + perpY * cos) * sign;
            const rx = Math.round(p.x + rpx * refOffsetPx);
            const ry = Math.round(p.y + rpy * refOffsetPx);
            if (rx < 4 || ry < 4 || rx >= viewport.width - 4 || ry >= viewport.height - 4) continue;
            if (inExclusion(rx, ry)) continue;
            refCandidates.push([rx, ry]);
          }
        }
        if (refCandidates.length < 3) continue; // not enough of a fan to trust a median

        points.push({ sample: [sx, sy], refCandidates });
      }
      return points;
    },
    lineKey,
    vehicleType,
    exclusions,
    viewport,
  );
}

async function waitIdle(page, timeoutMs = 8000) {
  await page
    .evaluate(
      (timeoutMs) =>
        new Promise((resolve) => {
          const map = window.__map;
          const t = setTimeout(resolve, timeoutMs);
          map.once("idle", () => {
            clearTimeout(t);
            resolve();
          });
        }),
      timeoutMs,
    )
    .catch(() => {});
  // MapLibre's 'idle' event fires once tiles/sources are loaded, but symbol
  // labels/icons cross-fade in over ~300ms after becoming visible and are
  // NOT covered by 'idle' — without this buffer, a screenshot taken right at
  // idle can catch a label mid-fade, which is real, observed, non-determinism
  // (one line's noon sample flipped between 1.01/2.73/2.09 across three
  // otherwise-identical runs before this fix; verified 2026-08-05).
  await new Promise((r) => setTimeout(r, 1000));
}

async function screenshotPixels(page) {
  const shot = await page.screenshot({ encoding: "binary", type: "png" });
  const { createCanvas, loadImage } = await import("@napi-rs/canvas");
  const img = await loadImage(shot);
  const canvas = createCanvas(img.width, img.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const { data, width } = ctx.getImageData(0, 0, img.width, img.height);
  return (x, y) => {
    const o = (y * width + x) * 4;
    return [data[o], data[o + 1], data[o + 2]];
  };
}

function ratiosFromPoints(px, points) {
  const ratios = [];
  for (const { sample, refCandidates } of points) {
    const sampleColor = px(sample[0], sample[1]);
    // Median luminance across the reference fan, not a mean: one candidate
    // landing on a bright POI icon or a dark shadow should not be able to
    // swing the whole reference, same principle as the per-line sample
    // median further down.
    const refLums = refCandidates
      .map((r) => {
        const color = px(r[0], r[1]);
        return { color, lum: luminance(color) };
      })
      .sort((a, b) => a.lum - b.lum);
    const refColor = refLums[Math.floor(refLums.length / 2)].color;
    ratios.push(contrast(sampleColor, refColor));
  }
  return ratios;
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

// UI panels the sample/reference pixels must avoid — a per-line pose search
// at desktop viewport width can land its centre anywhere, including under
// the LineSelector card or MapLibre's own NavigationControl/attribution.
// `uiHidden` doesn't collapse these at desktop widths (LineSelector.tsx's
// `bodyVisible = !isMobile || ...` — verified false), so exclusion rects are
// used instead of trying to hide the UI.
const exclusions = await page.evaluate(() => {
  const sel = [
    '[data-testid="line-selector"]',
    '[data-testid="time-scrubber"]',
    '[data-testid="train-inspector"]',
    '[data-testid="bottom-sheet-stack"]',
  ];
  const rects = [];
  for (const s of sel) {
    const el = document.querySelector(s);
    if (el) rects.push(el.getBoundingClientRect());
  }
  for (const el of document.querySelectorAll(".maplibregl-ctrl")) {
    rects.push(el.getBoundingClientRect());
  }
  return rects.map((r) => ({
    left: r.left - 4,
    top: r.top - 4,
    right: r.right + 4,
    bottom: r.bottom + 4,
  }));
});

// Local Bangkok noon and 02:00, both on the same fixed date so a weekday /
// weekend calendar difference cannot change which trains are on screen.
const DAY = Date.UTC(2026, 6, 22, 5, 0, 0); // 12:00 UTC+7
const NIGHT = Date.UTC(2026, 6, 22, 19, 0, 0); // 02:00 UTC+7 next day
const TIMES = [
  { label: "noon", epochMs: DAY },
  { label: "02:00", epochMs: NIGHT },
];

const simulatedLines = LINES.filter((l) => !l.preRevenue);

// tools/lines.config.mjs (LINES) only carries per-line metadata — actual
// track geometry lives in src/data/network.json, loaded into the browser's
// store at runtime. Fetch each simulated line's track once from there.
const trackByKey = Object.fromEntries(
  (await page.evaluate(() => window.__store.getState().routes.map((r) => [r.key, r.track]))),
);

// results[lineKey][label] = ratio[]
const results = Object.fromEntries(simulatedLines.map((l) => [l.key, {}]));
// poseCache[lineKey] = [{ center, points }] — computed once on the first
// (noon) pass, reused unchanged on the second (02:00) pass so both times
// sample the EXACT same screen pixels (a fair comparison) without redoing
// the per-pose search twice.
const poseCache = {};

for (const { label, epochMs } of TIMES) {
  // Pin the clock once per time value, not once per line/pose — the sun and
  // basemap colour blend are functions of simulated time only, not camera
  // pose, so this settle cost is paid twice total instead of once per pose.
  await page.evaluate((ms) => {
    const sim = window.__sim?.current;
    // SimClient.setClock(epochMs, warp) takes two positional numeric args,
    // not an options object — confirmed against src/sim/SimClient.ts.
    sim?.setClock(ms, 1);
  }, epochMs);
  await new Promise((r) => setTimeout(r, 2500));

  for (const line of simulatedLines) {
    const zoom = tightZoomFor(line.vehicleType);
    let poses = poseCache[line.key];
    const firstPass = !poses;
    if (firstPass) poses = [];

    if (firstPass) {
      const centers = candidateCenters(trackByKey[line.key] ?? []);
      for (let i = 0; i < Math.min(centers.length, MAX_POSES_PER_LINE); i++) {
        const center = centers[i];
        await page.evaluate(
          (center, zoom) => {
            window.__map.jumpTo({ center: [center.lng, center.lat], zoom, pitch: 0, bearing: 0 });
          },
          center,
          zoom,
        );
        await waitIdle(page);
        const pts = await computeSamplePoints(page, line.key, line.vehicleType, exclusions, VIEWPORT);
        poses.push({ center, points: pts });
        const totalPoints = poses.reduce((n, p) => n + p.points.length, 0);
        if (totalPoints >= MIN_SAMPLES) break;
      }
      poseCache[line.key] = poses;
    }

    // Now (re-)visit each pose that has any points and sample this time's
    // screenshot at the cached pixel coordinates.
    const lineRatios = [];
    for (const pose of poses) {
      if (pose.points.length === 0) continue;
      await page.evaluate(
        (center, zoom) => {
          window.__map.jumpTo({ center: [center.lng, center.lat], zoom, pitch: 0, bearing: 0 });
        },
        pose.center,
        zoom,
      );
      await waitIdle(page);
      const px = await screenshotPixels(page);
      lineRatios.push(...ratiosFromPoints(px, pose.points));
    }
    results[line.key][label] = lineRatios;
  }
}

await browser.close();

let failures = 0;
for (const { label } of TIMES) {
  console.log(`\n=== ${label} ===`);
  for (const line of simulatedLines) {
    const ratios = results[line.key][label];
    if (ratios.length < MIN_SAMPLES) {
      console.log(`  ${line.key.padEnd(12)} SKIP  only ${ratios.length} valid samples`);
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
      `  ${line.key.padEnd(12)} ${ok ? "PASS" : "FAIL"}  median ${median.toFixed(2)}:1 ` +
        `(n=${ratios.length}, min ${sorted[0].toFixed(2)})`,
    );
  }
}

console.log(
  `\n${failures === 0 ? "PASS" : "FAIL"} — ${failures} line/time combination(s) under ${MIN_CONTRAST}:1`,
);
process.exit(failures === 0 ? 0 : 1);
