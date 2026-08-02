// MVP 6 acceptance check (SRS §7 MVP 6 DoD): MRT Blue's mixed underground/
// elevated alignment actually renders as separate per-structure deck meshes
// (not a nominally-uniform track), the underground transparency mode
// re-weights the basemap into the SRS F3.2 band, and both the Three.js sun
// and the MapLibre basemap's own paint colours track the simulated clock
// (Task 10b, human-added scope beyond SRS F3.3).
//
// Assertions go through the store, the engine's own buffers, and the real
// rendered Three scene (via `network-3d`'s `.implementation` — MapLibre wraps
// every added layer, the NetworkLayer instance and its scene live on
// `.implementation`, not on the wrapper `getLayer()` returns) — same
// discipline as verify-mvp5.mjs.
//
// -----------------------------------------------------------------------
// KNOWN, DELIBERATE DEVIATION FROM THE ORIGINAL TASK-12 BRIEF
// -----------------------------------------------------------------------
// The brief's checks 3 and 4 asserted a `preRevenue: true` line renders but
// never simulates, and that a pre-revenue station's board resolves empty
// rather than erroring. Both are **deferred along with Task 6** (MRT Orange
// + MRT Purple Phase 2), which the human explicitly deferred out of this
// plan. The registry has exactly ten lines (sukhumvit, silom, purple, arl,
// pink, yellow, gold, red-dark, red-light, blue) and zero of them set
// `preRevenue: true` — `grep "preRevenue: true" tools/lines.config.mjs`
// returns nothing. The mechanism itself (dashed centerline, desaturated/
// translucent deck, registry validation, LineSelector badge) was built in
// Task 4 and is unit-tested (trackGeometry.test.ts, lines.config.test.mjs)
// — it simply has no real registry user yet, so brief-check-3's
// `preRevenue.idxs.length >= 2` would assert `0 >= 2` and can never pass
// honestly. Rather than delete the acceptance criteria or weaken them to
// something trivially true, they are replaced below with two checks that
// test what MVP 6 actually delivered:
//   - Replacement A: MRT Blue's track deck is genuinely split into separate
//     per-structure meshes in the rendered Three scene (Task 3's actual
//     deliverable — check 2 below only proves the *data* is mixed, not that
//     the deck was split).
//   - Replacement B: the basemap itself (not just the Three.js sun/sky) is
//     measurably darker at a midnight sim clock than at noon (Task 10b).
// When Task 6 lands, the original pre-revenue checks belong back in this
// file (or a follow-on), unmodified in spirit.
//
// Usage: npm run verify:mvp6   (dev server must be running on :5173)
import puppeteer from "puppeteer-core";
import { LINES } from "./lines.config.mjs";

const URL = process.argv[2] ?? "http://localhost:5173/";

const browser = await puppeteer.launch({
  executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  headless: true,
  args: ["--enable-unsafe-swiftshader", "--no-first-run"],
  defaultViewport: { width: 1400, height: 900 },
});
const page = await browser.newPage();
page.on("pageerror", (e) => console.log(`[pageerror] ${e.message}`));
page.on("console", (m) => {
  if (m.type() === "error") console.log(`[console.error] ${m.text().slice(0, 200)}`);
});

await page.goto(URL, { waitUntil: "networkidle2", timeout: 60_000 });
await page.waitForFunction(() => !!window.__sim?.current && !!window.__store, { timeout: 30_000 });
await page.waitForFunction(() => document.body.innerText.includes("runs"), { timeout: 30_000 });
await new Promise((r) => setTimeout(r, 2_500));

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok });
  console.log(`${ok ? "ok  " : "FAIL"} ${name} — ${detail}`);
};
const finish = async (fatal) => {
  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (fatal || failed.length) {
    console.log("FAIL");
    process.exit(1);
  }
  console.log("PASS");
};

// --- 1. every MVP 6 registry line is in the registry, in order --------------

const routeKeys = await page.evaluate(() => window.__store.getState().routes.map((r) => r.key));
check(
  `the ${LINES.length}-line registry renders in order`,
  routeKeys.length === LINES.length && routeKeys.every((k, i) => k === LINES[i].key),
  routeKeys.join(", "),
);

// --- 2. MRT Blue actually has underground track (data-level) ----------------

const blueBands = await page.evaluate(() => {
  const net = window.__store.getState().routes;
  const blue = net.find((l) => l.key === "blue");
  const bands = new Set(blue?.track.map((p) => p[3]));
  return { found: !!blue, bands: [...bands] };
});
check(
  "MRT Blue's alignment is genuinely mixed, not nominally uniform",
  blueBands.found && blueBands.bands.includes("underground") && blueBands.bands.length > 1,
  `structures present: ${blueBands.bands.join(", ")}`,
);

// --- 3 (replacement A). mixed-structure track renders as separate decks -----
// Task 3's actual deliverable: buildTrackDeck (src/map/trackGeometry.ts)
// returns a THREE.Group, one child Mesh per maximal same-structure run, each
// tagged mesh.userData.structure. Check 2 above only proves the *data* is
// mixed; this proves the rendered scene genuinely split the deck rather than
// drawing one uniform mesh at a single nominal altitude.

const blueDeck = await page.evaluate(() => {
  // window.__map.getLayer() hands back MapLibre's own StyleLayer wrapper,
  // not the CustomLayerInterface passed to addLayer() — the real
  // NetworkLayer instance (and its Three scene) lives on `.implementation`
  // (documented gotcha, CLAUDE.md "MVP 5 — multi-line breadth").
  const scene = window.__map.getLayer("network-3d")?.implementation?.scene;
  const lineGroup = scene?.children.find((o) => o.name === "line-blue");
  const structures = new Set();
  let taggedMeshCount = 0;
  lineGroup?.traverse((obj) => {
    if (typeof obj.userData?.structure === "string") {
      structures.add(obj.userData.structure);
      taggedMeshCount++;
    }
  });
  return { found: !!lineGroup, structures: [...structures], taggedMeshCount };
});
check(
  "MRT Blue's rendered deck is split into separate per-structure meshes, including underground",
  blueDeck.found &&
    blueDeck.taggedMeshCount > 1 &&
    blueDeck.structures.length > 1 &&
    blueDeck.structures.includes("underground"),
  `line-blue: ${blueDeck.taggedMeshCount} structure-tagged meshes, distinct structures: ${blueDeck.structures.join(", ")}`,
);

// --- 4. underground mode re-weights both the basemap and the scene ----------

const dim = await page.evaluate(() => {
  const layerId = window.__map.getStyle().layers.find((l) => l.type === "fill-extrusion")?.id;
  const before = window.__map.getPaintProperty(layerId, "fill-extrusion-opacity") ?? 1;
  window.__store.getState().setUndergroundMode(true);
  return new Promise((resolve) =>
    setTimeout(() => {
      const after = window.__map.getPaintProperty(layerId, "fill-extrusion-opacity") ?? 1;
      resolve({ before, after });
    }, 600),
  );
});
check(
  "underground mode fades the basemap into the SRS F3.2 band",
  dim.after < dim.before && dim.after >= 0.1 && dim.after <= 0.4,
  `fill-extrusion-opacity ${dim.before} -> ${dim.after} (F3.2 wants 0.1–0.4)`,
);
await page.evaluate(() => window.__store.getState().setUndergroundMode(false));

// --- 5. the sun tracks the simulated clock -----------------------------------

const sun = await page.evaluate(async () => {
  const scene = window.__map.getLayer("network-3d")?.implementation?.scene;
  const light = scene?.children.find((o) => o.type === "DirectionalLight");
  const day = new Date();
  day.setHours(0, 0, 0, 0);
  const read = async (secOfDay) => {
    window.__sim.current.setClock(day.getTime() + secOfDay * 1000, 1);
    await new Promise((r) => setTimeout(r, 1200));
    return light.position.z;
  };
  const noon = await read(12 * 3600);
  const midnight = await read(0);
  return { noon, midnight };
});
check(
  "the sun follows the simulated clock",
  sun.noon > 0 && sun.midnight < sun.noon,
  `light z at 12:00 ${sun.noon.toFixed(0)} vs 00:00 ${sun.midnight.toFixed(0)}`,
);

// --- 6 (replacement B). the basemap itself themes with the sim clock --------
// Task 10b, added by human ruling beyond SRS F3.3: MapContainer.tsx blends
// each themeable style layer's *captured original* colour toward
// basemapTheme.ts's NIGHT_THEME by nightFactor(sun elevation), on a ~2 Hz
// loop gated on engineStatus === "ready". This asserts the *basemap's*
// background-color (not just the Three.js sun/sky, which check 5 already
// covers) is measurably darker at a midnight sim clock than at noon.

const theme = await page.evaluate(async () => {
  const bgId = window.__map.getStyle().layers.find((l) => l.type === "background")?.id;
  const day = new Date();
  day.setHours(0, 0, 0, 0);
  const read = async (secOfDay) => {
    window.__sim.current.setClock(day.getTime() + secOfDay * 1000, 1);
    await new Promise((r) => setTimeout(r, 1200));
    return window.__map.getPaintProperty(bgId, "background-color");
  };
  const noon = await read(12 * 3600);
  const midnight = await read(0);
  return { bgId, noon, midnight };
});
// basemapTheme.ts's mixColor always returns either `#rrggbb` (toHex, opaque)
// or `rgba(r, g, b, a)` (toCss) — parse just those two forms rather than
// pulling in the module's full parseColor (which also accepts hsl()/hex3/
// hex8, forms this pipeline never actually emits).
function relLuminance(css) {
  const hex = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(css ?? "");
  const rgb = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i.exec(css ?? "");
  let r;
  let g;
  let b;
  if (hex) [r, g, b] = [hex[1], hex[2], hex[3]].map((h) => parseInt(h, 16));
  else if (rgb) [r, g, b] = [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  else return null;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const noonLum = relLuminance(theme.noon);
const midnightLum = relLuminance(theme.midnight);
check(
  "the basemap itself (background-color) themes darker at a midnight sim clock than at noon",
  noonLum !== null && midnightLum !== null && midnightLum < noonLum,
  `layer '${theme.bgId}' background-color noon ${theme.noon} (Y=${noonLum?.toFixed(1)}) vs midnight ${theme.midnight} (Y=${midnightLum?.toFixed(1)})`,
);

await finish(false);
