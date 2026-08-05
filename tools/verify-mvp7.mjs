// MVP 7 acceptance check ("Guardrails & Presentation"): the 12-line registry
// (unchanged since the Orange East+West merge — see CLAUDE.md's "Orange
// merge" note) still renders in the right order with Orange still track-only
// and pre-revenue; Orange's merged alignment is still a single clean
// traverse, not a doubled-back polyline; the theme tri-state, basemap style
// cycle, auto-underground-while-following, sky dome, eco mode and fullscreen
// features shipped across Tasks 4-10 all work end-to-end against the real
// running app.
//
// Same discipline as verify-mvp5.mjs/verify-mvp6.mjs: assertions go through
// the store, the engine's own buffers, and the real rendered Three scene via
// `network-3d`'s `.implementation` (MapLibre wraps every added layer — the
// NetworkLayer instance and its Three scene live on `.implementation`, not
// on the wrapper `getLayer()` returns).
//
// -----------------------------------------------------------------------
// CORRECTIONS TO THE ORIGINAL TASK-12 BRIEF (registry drift since it was
// written — see task-12-report.md for the full account)
// -----------------------------------------------------------------------
// The brief's checks 1-2 assumed a 13-line registry with a separate
// `orange-west` entry (the shape right after Task 3). An ad-hoc task
// (requested mid-plan, after Task 3, not in the original plan file) merged
// MRT Orange's East and West sections into one combined `orange` entry
// before Task 12 ever ran. There is no `orange-west` key today. So:
//   - Check 1 asserts LINES.length === 12, not 13, and applies the
//     pre-revenue/never-simulates assertions to the `orange` key.
//   - Check 2 ("single traverse") applies to `orange`'s full COMBINED track
//     (275 points, ~35.3 km — western 105 pts/13.5 km + eastern 171 pts/
//     21.8 km minus 1 shared junction point), not the original ~13.5-21.8 km
//     West-only/East-only figures. The ad-hoc merge task's whole point was
//     fixing a real doubled-back-polyline bug in an earlier pass of Orange's
//     fetch — re-verifying the merged line is still a single clean traverse
//     is exactly as valuable a check as the brief intended, just against the
//     current combined geometry.
//
// Usage: npm run verify:mvp7   (dev server must be running on :5173)
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
const consoleErrors = [];
page.on("pageerror", (e) => {
  consoleErrors.push(e.message);
  console.log(`[pageerror] ${e.message}`);
});
page.on("console", (m) => {
  if (m.type() === "error") {
    consoleErrors.push(m.text());
    console.log(`[console.error] ${m.text().slice(0, 200)}`);
  }
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

// --- 1. the 12-line registry renders in order; `orange` is pre-revenue and --
//        never simulates; its station_board query resolves empty, not an
//        error, even for an out-of-range station (it has zero stations).

const reg1 = await page.evaluate(async () => {
  const routes = window.__store.getState().routes;
  const routeKeys = routes.map((r) => r.key);
  const orangeIdx = routes.findIndex((r) => r.key === "orange");
  const orange = routes[orangeIdx];
  const { vehicles, count } = window.__sim.current.getInterpolated(performance.now());
  let orangeInBuffer = false;
  for (let i = 0; i < count; i++) {
    if (vehicles[i * 8 + 6] === orangeIdx) orangeInBuffer = true;
  }
  let boardResult;
  let boardThrew = false;
  try {
    boardResult = await window.__sim.current.getStationBoard(orangeIdx, 0, window.__sim.current.getSimNow());
  } catch (e) {
    boardThrew = true;
    boardResult = String(e);
  }
  return {
    routeKeys,
    orangeIdx,
    // `orange.gtfsRouteId` is expected to be the literal `null` (a valid,
    // meaningful value — "track-only") — `??` would treat that null as
    // absent and mask it as "MISSING" too, so check presence explicitly.
    gtfsRouteId: orange === undefined ? "ROUTE_NOT_FOUND" : orange.gtfsRouteId,
    orangeInBuffer,
    boardThrew,
    boardResult,
  };
});
// A literal hardcoded 12, not just `LINES.length` compared against itself:
// the brief's original check ("LINES.length === 13") was a real registry-
// drift detector — a silent 13th/14th line added to BOTH the config and the
// running store would still make `reg1.routeKeys.length === LINES.length`
// pass trivially, since that comparison only proves the two ends of the
// SAME pipeline agree with each other, never that the count is what it's
// actually supposed to be. This literal keeps that drift-detection property.
check(
  "the registry is still exactly 12 lines (10 simulated + orange/purple-ext track-only)",
  LINES.length === 12,
  `LINES.length = ${LINES.length}`,
);
check(
  `the ${LINES.length}-line registry renders in order`,
  reg1.routeKeys.length === LINES.length && reg1.routeKeys.every((k, i) => k === LINES[i].key),
  reg1.routeKeys.join(", "),
);
check(
  "MRT Orange is pre-revenue, gtfsRouteId null, and never appears in the simulated vehicle buffer",
  reg1.orangeIdx >= 0 && reg1.gtfsRouteId === null && reg1.orangeInBuffer === false,
  `orange route_idx ${reg1.orangeIdx}, gtfsRouteId=${JSON.stringify(reg1.gtfsRouteId)}, in vehicle buffer=${reg1.orangeInBuffer}`,
);
check(
  "MRT Orange's station_board query resolves to an empty board rather than erroring (it has zero stations)",
  reg1.boardThrew === false && reg1.boardResult === null,
  `threw=${reg1.boardThrew}, result=${JSON.stringify(reg1.boardResult)}`,
);

// --- 2. MRT Orange's merged alignment is a single traverse, not doubled ----
// Same haversine-length technique Task 3's own brief specified. A doubled
// out-and-back polyline (the real bug the ad-hoc merge task fixed in an
// earlier pass of Orange's fetch, caught in code review) reads as ~2x the
// true alignment length.

const orangeLen = await page.evaluate(() => {
  const R = 6371008.8; // MapLibre's own earth radius (CLAUDE.md MVP2/3 note)
  const toRad = (d) => (d * Math.PI) / 180;
  const hav = (a, b) => {
    const dLat = toRad(b[1] - a[1]);
    const dLon = toRad(b[0] - a[0]);
    const la1 = toRad(a[1]);
    const la2 = toRad(b[1]);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  };
  const orange = window.__store.getState().routes.find((r) => r.key === "orange");
  let total = 0;
  for (let i = 1; i < orange.track.length; i++) total += hav(orange.track[i - 1], orange.track[i]);
  return { points: orange.track.length, lengthM: total };
});
// Published figure: ~35.3 km combined (see tools/lines.config.mjs's `orange`
// entry comment: 105 western + 171 eastern - 1 shared junction = 275 pts).
const PUBLISHED_ORANGE_KM = 35.3;
const orangeKm = orangeLen.lengthM / 1000;
const orangeDeltaFrac = Math.abs(orangeKm - PUBLISHED_ORANGE_KM) / PUBLISHED_ORANGE_KM;
check(
  "MRT Orange's merged alignment is a single traverse (haversine length within 15% of the published ~35.3 km, not ~2x)",
  orangeLen.points === 275 && orangeDeltaFrac <= 0.15,
  `${orangeLen.points} points, ${orangeKm.toFixed(2)} km measured vs ${PUBLISHED_ORANGE_KM} km published (${(orangeDeltaFrac * 100).toFixed(1)}% delta)`,
);

// --- 3. theme tri-state ------------------------------------------------------
// light always reproduces the pristine ("daytime original") colour regardless
// of the sim clock (effectiveElevationDeg pins DAY_ELEVATION_DEG=3, and
// nightFactor(3) = 0 by basemapTheme.ts's own definition — mixColor(original,
// NIGHT, 0) = original exactly). dark always moves toward NIGHT_THEME.
// auto changes with the clock. Uses the store directly, same pattern as
// verify-mvp6.mjs's sun/theme checks.

const theme = await page.evaluate(async () => {
  const bgId = window.__map.getStyle().layers.find((l) => l.type === "background")?.id;
  const day = new Date();
  day.setHours(0, 0, 0, 0);
  const setModeAndClock = async (mode, secOfDay) => {
    window.__store.getState().setThemeMode(mode);
    window.__sim.current.setClock(day.getTime() + secOfDay * 1000, 1);
    await new Promise((r) => setTimeout(r, 1200));
    return window.__map.getPaintProperty(bgId, "background-color");
  };
  const lightMidnight = await setModeAndClock("light", 0);
  const lightNoon = await setModeAndClock("light", 12 * 3600);
  const darkNoon = await setModeAndClock("dark", 12 * 3600);
  const autoNoon = await setModeAndClock("auto", 12 * 3600);
  const autoMidnight = await setModeAndClock("auto", 0);
  return { bgId, lightMidnight, lightNoon, darkNoon, autoNoon, autoMidnight };
});
// basemapTheme.ts's mixColor always emits either `#rrggbb` or `rgba(...)`.
function parseRgb(css) {
  const hex = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(css ?? "");
  const rgb = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i.exec(css ?? "");
  if (hex) return [hex[1], hex[2], hex[3]].map((h) => parseInt(h, 16));
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  return null;
}
const relLum = (rgb) => (rgb ? 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2] : null);
// Mirrors basemapTheme.ts's NIGHT.background (0x0a, 0x12, 0x20) — same
// duplication precedent as verify-legibility.mjs's DECK_WIDTH_M mirror
// (documented in CLAUDE.md's Task 11 notes).
const NIGHT_BACKGROUND_RGB = [0x0a, 0x12, 0x20];
const dist = (a, b) => Math.sqrt(a.reduce((s, v, i) => s + (v - b[i]) ** 2, 0));

const lightMidnightRgb = parseRgb(theme.lightMidnight);
const lightNoonRgb = parseRgb(theme.lightNoon);
const darkNoonRgb = parseRgb(theme.darkNoon);
const autoNoonRgb = parseRgb(theme.autoNoon);
const autoMidnightRgb = parseRgb(theme.autoMidnight);

const lightIsClockIndependent =
  lightMidnightRgb && lightNoonRgb && dist(lightMidnightRgb, lightNoonRgb) < 1;
const darkMovedTowardNight =
  darkNoonRgb &&
  lightNoonRgb &&
  relLum(darkNoonRgb) < relLum(lightNoonRgb) &&
  dist(darkNoonRgb, NIGHT_BACKGROUND_RGB) < dist(lightNoonRgb, NIGHT_BACKGROUND_RGB);
const autoChangesWithClock =
  autoNoonRgb && autoMidnightRgb && dist(autoNoonRgb, autoMidnightRgb) > 1;

check(
  "theme tri-state: light is clock-independent and equals the daytime original; dark moves toward NIGHT_THEME; auto tracks the clock",
  lightIsClockIndependent && darkMovedTowardNight && autoChangesWithClock,
  `light@00:00=${theme.lightMidnight} light@12:00=${theme.lightNoon} dark@12:00=${theme.darkNoon} ` +
    `auto@12:00=${theme.autoNoon} auto@00:00=${theme.autoMidnight}`,
);
// Leave the store in "auto" for the remaining checks (the default, and what
// the sky-dome/eco checks below implicitly assume).
await page.evaluate(() => window.__store.getState().setThemeMode("auto"));

// --- 4. style swap rebinds cleanly -------------------------------------------

const errBeforeSwap = consoleErrors.length;
await page.evaluate(() => window.__store.getState().setBasemapStyle("positron"));
await page.waitForFunction(
  () => !!window.__map.getLayer("network-3d")?.implementation?.scene,
  { timeout: 15_000 },
);
await new Promise((r) => setTimeout(r, 1_000)); // let style.load settle fully
const swap = await page.evaluate(async () => {
  const impl = window.__map.getLayer("network-3d")?.implementation;
  const scene = impl?.scene;
  const groupNames = new Set();
  scene?.traverse((o) => {
    if (o.type === "Group" && typeof o.name === "string" && o.name.startsWith("line-")) {
      groupNames.add(o.name);
    }
  });
  const { count } = window.__sim.current.getInterpolated(performance.now());
  // Positron (one of the 3 cycled styles, roadmap item 21) has NO
  // fill-extrusion (building) layer at all, unlike Liberty/Bright — mirror
  // styleBinding.ts's own `dimmable` selection, which falls back to a plain
  // "fill" layer for exactly this reason, rather than assuming
  // fill-extrusion always exists.
  const layers = window.__map.getStyle().layers;
  const dimmableLayer =
    layers.find((l) => l.type === "fill-extrusion") ?? layers.find((l) => l.type === "fill");
  const prop = dimmableLayer?.type === "fill-extrusion" ? "fill-extrusion-opacity" : "fill-opacity";
  const before = dimmableLayer ? (window.__map.getPaintProperty(dimmableLayer.id, prop) ?? 1) : null;
  window.__store.getState().setUndergroundMode(true);
  await new Promise((r) => setTimeout(r, 600));
  const after = dimmableLayer ? (window.__map.getPaintProperty(dimmableLayer.id, prop) ?? 1) : null;
  window.__store.getState().setUndergroundMode(false);
  return {
    layerExists: !!scene,
    groupNames: [...groupNames],
    vehicleCount: count,
    hasDimmableLayer: !!dimmableLayer,
    before,
    after,
  };
});
const errDuringSwap = consoleErrors.slice(errBeforeSwap);
// KNOWN, ALREADY-DOCUMENTED deferred finding (MVP 7 Task 6's ledger entry):
// styleBinding.ts's underground-opacity capture has no type guard for
// expression-valued paint properties (unlike its own colour-capture code,
// which does guard) — on styles whose landcover/landuse/aeroway layers use a
// zoom EXPRESSION for fill-opacity rather than a flat number,
// `Math.min(expression, 0.25)` silently NaNs and MapLibre logs a validation
// error for that one layer (which then just never dims under underground
// mode — the mode still works overall). Previously only observed on the
// Bright style (landcover-glacier); re-confirmed here that Positron hits the
// same class on 4 different layers. This is a real, pre-existing, disclosed
// gap — out of scope for Task 12 (a docs+harness task, not a styleBinding.ts
// fix) — so it is excused by exact message pattern here, not swallowed
// wholesale: any OTHER console error during the swap still fails this check.
const KNOWN_EXPRESSION_OPACITY_ERROR = /paint\.fill-opacity: number expected, NaN found/;
const unexpectedErrors = errDuringSwap.filter((e) => !KNOWN_EXPRESSION_OPACITY_ERROR.test(e));
const expectedGroups = LINES.map((l) => `line-${l.key}`);
check(
  "style swap (positron) rebinds the network-3d layer, its per-line groups, and underground dimming, with no UNEXPECTED console errors",
  swap.layerExists &&
    expectedGroups.every((g) => swap.groupNames.includes(g)) &&
    swap.vehicleCount > 0 &&
    swap.hasDimmableLayer &&
    swap.after < swap.before &&
    swap.after >= 0.1 &&
    swap.after <= 0.4 &&
    unexpectedErrors.length === 0,
  `${swap.groupNames.length}/${expectedGroups.length} line groups present, vehicleCount=${swap.vehicleCount}, ` +
    `dimmable-layer opacity ${swap.before} -> ${swap.after}, ${errDuringSwap.length} console error(s) during swap ` +
    `(${errDuringSwap.length - unexpectedErrors.length} known expression-opacity NaN, ${unexpectedErrors.length} unexpected)`,
);

// --- 5. auto underground while following -------------------------------------
// The brief's literal wording is "step the clock until the followed vehicle's
// LANE_Z goes below -5m [...] until it exceeds -1m." Positions are a pure
// function of time (no integration — CLAUDE.md MVP2/3 notes), so an
// equivalent and far more robust way to exercise the SAME production code
// path (MapContainer's beforeRender reading LANE_Z for whichever run is
// selected, decideAutoUnderground consuming it in the rAF loop) is to hold
// the sim clock at one busy moment and switch `selectedRunIdx` between two
// DIFFERENT concurrently-active Blue vehicles — one already underground, one
// already surfaced — rather than scanning forward through simulated time
// waiting for one specific vehicle to cross the boundary. selectRun()
// deliberately preserves `following` (see MapContainer.tsx's own comment on
// this), so this exercises exactly the same "followed vehicle's altitude
// changed" trigger decideAutoUnderground reacts to. This substitution is a
// deliberate adaptation, documented here and in task-12-report.md.

async function findBlueCandidates(page, secOfDay) {
  return page.evaluate(async (secOfDay) => {
    const day = new Date();
    day.setHours(0, 0, 0, 0);
    window.__sim.current.setClock(day.getTime() + secOfDay * 1000, 1);
    await new Promise((r) => setTimeout(r, 500));
    const blueIdx = window.__store.getState().routes.findIndex((r) => r.key === "blue");
    const { vehicles, count } = window.__sim.current.getInterpolated(performance.now());
    const cands = [];
    for (let i = 0; i < count; i++) {
      if (vehicles[i * 8 + 6] === blueIdx) {
        cands.push({ runIdx: vehicles[i * 8 + 5], z: vehicles[i * 8 + 2] });
      }
    }
    return { blueIdx, cands };
  }, secOfDay);
}

const ANCHOR_TIMES_SEC = [8, 9, 12, 13, 17, 18, 19, 20].map((h) => h * 3600);
let auto5 = null;
for (const sec of ANCHOR_TIMES_SEC) {
  const { blueIdx, cands } = await findBlueCandidates(page, sec);
  const under = cands.filter((c) => c.z < -5).sort((a, b) => a.z - b.z)[0]; // deepest
  const above = cands.filter((c) => c.z > -1).sort((a, b) => b.z - a.z)[0]; // highest
  if (under && above && under.runIdx !== above.runIdx) {
    auto5 = { blueIdx, under, above, sec };
    break;
  }
}

if (!auto5) {
  check("auto underground while following", false, "no anchor time produced both an underground and a surfaced concurrently-active Blue vehicle");
} else {
  const { under, above } = auto5;
  const drive = await page.evaluate(
    async (underRunIdx, aboveRunIdx) => {
      const store = window.__store.getState();
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));

      store.selectRun(underRunIdx);
      store.setFollowing(true);
      await wait(500);
      const engaged = window.__store.getState().undergroundMode;

      store.selectRun(aboveRunIdx); // following is preserved across selectRun
      await wait(500);
      const released = window.__store.getState().undergroundMode;

      store.selectRun(underRunIdx); // re-engage
      await wait(500);
      const reEngaged = window.__store.getState().undergroundMode;

      window.__store.getState().setUndergroundMode(false); // manual override mid-follow
      await wait(500);
      const overriddenNow = window.__store.getState().undergroundMode;
      // "step deeper" — stay on the same (already below -5m) underground run
      // for two more frame ticks; if the override held, auto must NOT
      // re-engage even though altitude is still well below the engage
      // threshold.
      await wait(500);
      const stillOverridden = window.__store.getState().undergroundMode;

      store.setFollowing(false);
      store.selectRun(null);
      return { engaged, released, reEngaged, overriddenNow, stillOverridden };
    },
    under.runIdx,
    above.runIdx,
  );
  check(
    "auto underground engages below -5m and releases above -1m while following",
    drive.engaged === true && drive.released === false && drive.reEngaged === true,
    `anchor ${(auto5.sec / 3600).toFixed(0)}:00 — engaged=${drive.engaged} (z=${under.z.toFixed(1)}m), ` +
      `released=${drive.released} (z=${above.z.toFixed(1)}m), reEngaged=${drive.reEngaged}`,
  );
  check(
    "a manual setUndergroundMode(false) mid-follow overrides auto — it does not silently re-engage",
    drive.overriddenNow === false && drive.stillOverridden === false,
    `right after override=${drive.overriddenNow}, one tick later (still underground)=${drive.stillOverridden}`,
  );
}

// --- 6. sky renders above the horizon only -----------------------------------
// Task 8's primary horizon-clipped Three.js sky dome shipped (not the
// MapLibre-sky fallback — confirmed directly in skyDome.ts: RADIUS_M=120_000,
// a real THREE.Mesh with renderOrder=-1, depthWrite/depthTest both false).

const sky = await page.evaluate(() => {
  const scene = window.__map.getLayer("network-3d")?.implementation?.scene;
  let found = false;
  scene?.traverse((o) => {
    if (
      o.isMesh &&
      o.renderOrder < 0 &&
      o.material &&
      o.material.depthWrite === false &&
      o.material.depthTest === false
    ) {
      found = true;
    }
  });
  return { found };
});
check(
  "the sky dome mesh renders above the horizon only (renderOrder < 0, depthWrite/depthTest false)",
  sky.found,
  `found=${sky.found}`,
);

// --- 7. eco mode --------------------------------------------------------------

const eco = await page.evaluate(async () => {
  const impl = window.__map.getLayer("network-3d")?.implementation;
  const origRender = impl.render.bind(impl);
  let renderCount = 0;
  impl.render = (...args) => {
    renderCount++;
    return origRender(...args);
  };

  window.__store.getState().setEcoMode(true);
  // There is a one-time burst of repaints in the ~1s right after flipping
  // ecoMode on (measured directly: MapLibre's own internal repaint activity
  // settling — tile/symbol state, not our app's throttle — the STEADY state
  // that follows is a clean, exact 1 render/sec matching ECO_TICK_MS). Let it
  // settle before starting the measurement window, or the transient makes a
  // correctly-throttled loop look unthrottled.
  await new Promise((r) => setTimeout(r, 1_500));
  renderCount = 0;
  await new Promise((r) => setTimeout(r, 3_500));
  const ecoRenderCount = renderCount;

  const client = window.__sim.current;
  const before = client.getInterpolated(performance.now());
  const beforeRunIdx = before.count > 0 ? before.vehicles[5] : null;
  const beforePos = before.count > 0 ? [before.vehicles[0], before.vehicles[1], before.vehicles[2]] : null;

  renderCount = 0;
  window.__store.getState().setEcoMode(false);
  await new Promise((r) => setTimeout(r, 50));
  const after = client.getInterpolated(performance.now());
  const afterPos =
    after.count > 0 && beforeRunIdx !== null
      ? (() => {
          for (let i = 0; i < after.count; i++) {
            if (after.vehicles[i * 8 + 5] === beforeRunIdx) {
              return [after.vehicles[i * 8], after.vehicles[i * 8 + 1], after.vehicles[i * 8 + 2]];
            }
          }
          return null;
        })()
      : null;

  await new Promise((r) => setTimeout(r, 1_000));
  const normalRenderCountPerSec = renderCount;

  impl.render = origRender;

  const posDeltaM =
    beforePos && afterPos
      ? Math.hypot(afterPos[0] - beforePos[0], afterPos[1] - beforePos[1], afterPos[2] - beforePos[2])
      : null;

  return { ecoRenderCount, normalRenderCountPerSec, posDeltaM };
});
check(
  "eco mode drops repaints to well under 10 over a steady-state window, and recovers to well above 30/s once disabled",
  eco.ecoRenderCount < 10 && eco.normalRenderCountPerSec > 30,
  `eco: ${eco.ecoRenderCount} repaints/3.5s steady-state (1.5s settle excluded); normal: ${eco.normalRenderCountPerSec} repaints/1s`,
);
check(
  "a vehicle's position immediately after disabling eco mode matches a fresh getInterpolated — nothing drifted",
  eco.posDeltaM === null || eco.posDeltaM < 2,
  eco.posDeltaM === null ? "no active vehicle to sample" : `position delta ${eco.posDeltaM.toFixed(3)} m`,
);

// --- 8. fullscreen -------------------------------------------------------------

const fullscreen = await page.evaluate(() => {
  const target = document.querySelector('[data-testid="map-container"]');
  const hasApi = typeof target?.requestFullscreen === "function";
  let called = false;
  const orig = target.requestFullscreen;
  target.requestFullscreen = () => {
    called = true;
    return Promise.resolve();
  };
  const btn = [...document.querySelectorAll("button")].find((b) =>
    b.textContent?.includes("Fullscreen"),
  );
  btn?.click();
  target.requestFullscreen = orig;
  return { hasApi, foundButton: !!btn, called };
});
check(
  "the map-container element exposes requestFullscreen, and the Fullscreen button calls it",
  fullscreen.hasApi && fullscreen.foundButton && fullscreen.called,
  `hasApi=${fullscreen.hasApi} foundButton=${fullscreen.foundButton} called=${fullscreen.called}`,
);

await finish(false);
