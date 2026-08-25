#!/usr/bin/env node
/**
 * Dev-time visual check: open the app in headless Edge, wait for the map to
 * go idle, then capture screenshots from a few camera poses to verify the
 * 3D track stays glued to the map through pan/zoom/tilt (MVP 1 DoD).
 *
 * Usage: node tools/screenshot.mjs [url] [outDir]
 */
import puppeteer from "puppeteer-core";
import { mkdir } from "node:fs/promises";

const URL = process.argv[2] ?? "http://localhost:5173/";
const OUT_DIR = process.argv[3] ?? process.env.TEMP ?? ".";
const EDGE =
  process.env.EDGE_PATH ??
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";

await mkdir(OUT_DIR, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: true,
  args: ["--enable-unsafe-swiftshader", "--window-size=1600,1000", "--no-first-run"],
  defaultViewport: { width: 1600, height: 1000 },
});

const page = await browser.newPage();
page.on("console", (msg) => {
  if (["error", "warn"].includes(msg.type())) console.log(`[console.${msg.type()}] ${msg.text()}`);
});
page.on("pageerror", (err) => console.log(`[pageerror] ${err.message}`));

await page.goto(URL, { waitUntil: "networkidle2", timeout: 60_000 });

// Expose the map instance? Instead poll: wait until tiles + layer settled.
await new Promise((r) => setTimeout(r, 12_000));
await page.screenshot({ path: `${OUT_DIR}/overview.png` });
console.log(`wrote ${OUT_DIR}/overview.png`);

// Camera poses: [center, zoom, pitch, bearing, name]
//
// These filenames used to carry an "mvp1_" prefix baked in here — a holdover
// from when this script only had the Green-Line-only MVP 1 network to shoot.
// The registry has grown to 14 lines since, so a "mvp1_" screenshot of
// today's full network is a wrong claim about what it shows, not a
// versioned label — dropped in the final whole-branch review of the UX
// Defects and Interaction work (2026-08-24) alongside renaming the
// already-committed docs/media/*.png files this script had produced.
const poses = [
  [[100.5332, 13.7456], 14.5, 65, 30, "siam_closeup"],
  [[100.5698, 13.7304], 13.5, 70, -120, "sukhumvit_tilt"],
  [[100.5332, 13.7456], 11, 0, 0, "topdown_wide"],
  [[100.5347, 13.7455], 16.5, 60, 140, "siam_station"],
];
for (const [center, zoom, pitch, bearing, name] of poses) {
  await page.evaluate(
    ([c, z, p, b]) => {
      const map = window.__map;
      if (map) map.jumpTo({ center: c, zoom: z, pitch: p, bearing: b });
    },
    [center, zoom, pitch, bearing],
  );
  await new Promise((r) => setTimeout(r, 6_000));
  await page.screenshot({ path: `${OUT_DIR}/${name}.png` });
  console.log(`wrote ${OUT_DIR}/${name}.png`);
}

await browser.close();
