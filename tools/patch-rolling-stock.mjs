/**
 * Deterministically add each registry line's `rollingStock` to the COMMITTED
 * src/data/network.json, without a re-fetch.
 *
 * Why not just run `npm run data:fetch`: a full registry fetch takes 20+
 * minutes against a rate-limited Overpass and silently folds unrelated
 * upstream OSM vertex drift into this change's diff (the 2026-08-09 fetch
 * moved silom 278 -> 277 and orange 275 -> 259 vertices with no alignment
 * change at all). Same precedent as preRevenue, interchangeOverrides and the
 * gradient limiter: fetch-network.mjs is updated so a future real fetch
 * reproduces this as a no-op diff, and the committed file is patched here.
 *
 * That no-op-diff claim is only true if the patched file's KEY ORDER matches
 * what fetch-network.mjs writes. Assigning `line.rollingStock` appends it as
 * each line's last key, whereas the fetch emits it between `syntheticSchedule`
 * and `allowLargeSnapStopIds` — so the whole file would re-serialize on the
 * next real fetch, burying this change's diff (and, worse, any upstream OSM
 * drift alongside it). Every line is therefore reordered through the shared
 * NETWORK_LINE_FIELD_ORDER, which also repairs `estimatedRunTimes` — appended
 * out of order by an earlier patch and never noticed. Found in code review
 * 2026-08-23.
 *
 * Idempotent: running it twice produces a byte-identical file, including the
 * handPatches date stamp (an existing entry keeps its original date rather
 * than being restamped with today's).
 *
 * Run: node tools/patch-rolling-stock.mjs
 */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  LINES,
  assertLineFieldOrder,
  assertRegistryValid,
  orderLineFields,
} from "./lines.config.mjs";

const OUT_PATH = fileURLToPath(new URL("../src/data/network.json", import.meta.url));
const NOTE =
  "rollingStock added per line from tools/lines.config.mjs without a re-fetch " +
  "(tools/patch-rolling-stock.mjs); geometry and stations untouched";

assertRegistryValid();

const doc = JSON.parse(await readFile(OUT_PATH, "utf8"));

if (doc.lines.length !== LINES.length) {
  throw new Error(
    `network.json has ${doc.lines.length} lines, registry has ${LINES.length} — ` +
      `re-fetch before patching, do not guess the mapping`,
  );
}

let changed = 0;
doc.lines = doc.lines.map((line, i) => {
  if (line.key !== LINES[i].key) {
    throw new Error(`lines[${i}] is '${line.key}' but registry index ${i} is '${LINES[i].key}'`);
  }
  const next = LINES[i].rollingStock ?? null;
  if (JSON.stringify(line.rollingStock ?? null) !== JSON.stringify(next)) changed++;
  const ordered = orderLineFields({ ...line, rollingStock: next });
  assertLineFieldOrder(ordered, `patch-rolling-stock.mjs (${line.key})`);
  return ordered;
});

const priorPatches = doc.handPatches ?? [];
// Reuse the original date when this patch is already recorded, so a re-run is
// byte-identical rather than merely semantically equal.
const existing = priorPatches.find((p) => p.note === NOTE);
doc.handPatches = [
  ...priorPatches.filter((p) => p.note !== NOTE),
  {
    date: existing?.date ?? new Date().toISOString().slice(0, 10),
    line: "*",
    note: NOTE,
  },
];

await writeFile(OUT_PATH, JSON.stringify(doc));
console.log(`Patched ${OUT_PATH}: ${changed} of ${doc.lines.length} lines changed`);
