#!/usr/bin/env node
/**
 * NF2 gate: total gzip size of the whole `dist/` build output (every file
 * under it, however deep — plus the binary timetable) must stay ≤ 5 MB.
 * Run after `npm run build`.
 *
 * This is NOT (necessarily) "what a first-time visitor's browser actually
 * downloads before interaction" — it would also include sourcemaps or
 * lazily-loaded chunks if either existed in the build (today's build has
 * neither: no `build.sourcemap`, no code-splitting, so the two happen to be
 * the same number right now). Summing the whole tree is deliberately
 * conservative — it can never produce a false PASS by excluding something
 * that ships — but call it what it measures rather than "initial payload",
 * which implies a narrower, load-time-specific claim this script doesn't
 * actually verify (review finding, PR #8).
 */
import { gzipSync } from "node:zlib";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const BUDGET_BYTES = 5 * 1024 * 1024;

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

function fail(message) {
  console.error(`check:bundle: ${message}`);
  console.log("FAIL");
  process.exit(1);
}

function main() {
  if (!existsSync("dist")) {
    fail('"dist" does not exist — run `npm run build` first.');
  }

  const distFiles = walk("dist");

  // A missing `dist` throws ENOENT above and is already safe. The dangerous
  // case is a `dist` that *exists* but is empty or partial (a half-written
  // build, a wrong output dir, CI racing a build against a stale checkout):
  // that would silently compute a total from whatever little is there and
  // still print PASS. Assert the shape of a real production build before
  // trusting the number at all.
  if (distFiles.length === 0) {
    fail('"dist" exists but contains no files — build likely failed or was interrupted.');
  }
  if (!existsSync(join("dist", "index.html"))) {
    fail('"dist/index.html" is missing — this is not a complete Vite build output.');
  }
  const assetsDir = join("dist", "assets");
  const hasJs = distFiles.some((f) => f.startsWith(assetsDir) && f.endsWith(".js"));
  if (!hasJs) {
    fail('no "dist/assets/*.js" file found — this is not a complete Vite build output.');
  }

  // Vite's default `publicDir` behaviour copies `public/` verbatim into
  // `dist/` on every build, so `dist/data/network.tmb` is normally a
  // byte-identical copy of `public/data/network.tmb` already. Appending the
  // public/ path unconditionally would double-count it (~300 KB gzip on the
  // current network). Only fall back to the public/ source if the expected
  // dist/ copy isn't there (e.g. copyPublicDir was ever turned off) — and in
  // that fallback case the file must actually exist, or fail loudly rather
  // than crash on a raw ENOENT.
  const distTmbCopy = join("dist", "data", "network.tmb");
  let files = distFiles;
  if (!distFiles.includes(distTmbCopy)) {
    const fallback = join("public", "data", "network.tmb");
    if (!existsSync(fallback)) {
      fail(`neither "${distTmbCopy}" nor "${fallback}" exists — cannot measure the timetable cache.`);
    }
    files = [...distFiles, fallback];
  }

  let total = 0;
  const rows = [];
  for (const f of files) {
    const gz = gzipSync(readFileSync(f)).length;
    total += gz;
    rows.push([f, gz]);
  }
  rows.sort((a, b) => b[1] - a[1]);
  for (const [f, gz] of rows.slice(0, 12)) {
    console.log(`${(gz / 1024).toFixed(1).padStart(9)} KB  ${f}`);
  }
  const mb = (total / 1024 / 1024).toFixed(2);
  console.log(`\ntotal gzip: ${mb} MB / 5.00 MB budget (NF2)`);
  if (total > BUDGET_BYTES) {
    console.log("FAIL");
    process.exit(1);
  }
  console.log("PASS");
}

try {
  main();
} catch (err) {
  // Any other missing/unreadable path (e.g. a file listed by walk() but
  // deleted mid-run) should surface as a short diagnostic, not a raw Node
  // stack trace.
  console.error(`check:bundle: ${err.code ?? "ERROR"}: ${err.message}`);
  console.log("FAIL");
  process.exit(1);
}
