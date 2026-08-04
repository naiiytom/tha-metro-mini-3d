#!/usr/bin/env node
/**
 * Download and extract the Namtang/OTP GTFS feed for local preprocessing.
 *
 * Not committed to the repo: the extracted feed is ~230 MB, dominated by
 * shapes.txt (155 MB) and fare_attributes.txt/fare_rules.txt (65 MB
 * combined, unused by rust-engine/preprocessor — it only reads stops,
 * routes, trips, stop_times, frequencies and calendar/calendar_dates). Data
 * © Namtang / OTP open-data programme, CC-BY 4.0 — re-download rather than
 * trust a stale local copy; the feed changes over time.
 *
 * Usage: node tools/fetch-gtfs.mjs
 * Output: .gtfs-cache/ (gitignored). Then:
 *   npm run data:preprocess -- --gtfs .gtfs-cache
 */

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import AdmZip from "adm-zip";

const FEED_URL = "https://namtang-api.otp.go.th/download/namtang-gtfs.zip";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = resolve(ROOT, ".gtfs-cache");

async function main() {
  console.log(`Downloading ${FEED_URL} ...`);
  const res = await fetch(FEED_URL, {
    headers: { "User-Agent": "tha-metro-mini-3d/0.1 (data preprocessing)" },
  });
  if (!res.ok) throw new Error(`GTFS download failed: HTTP ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());

  // Written to the OS temp dir, never the repo tree — an interrupted
  // extraction can't leave a stray large archive for `git status` to notice.
  const scratchDir = await mkdtemp(join(tmpdir(), "tha-metro-gtfs-"));
  const zipPath = join(scratchDir, "namtang-gtfs.zip");
  await writeFile(zipPath, buffer);
  console.log(`Downloaded ${(buffer.length / 1e6).toFixed(1)} MB -> ${zipPath}`);

  await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(OUT_DIR, { recursive: true });
  new AdmZip(zipPath).extractAllTo(OUT_DIR, true);
  await rm(scratchDir, { recursive: true, force: true });

  console.log(`Extracted to ${OUT_DIR}`);
  console.log(`Run: npm run data:preprocess -- --gtfs ${OUT_DIR}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
