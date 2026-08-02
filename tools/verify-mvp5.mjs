// MVP 5 acceptance check (SRS §7 MVP 5 DoD): the network is line-agnostic —
// every registered line renders and simulates together, hiding a line only
// touches the scene (never the engine or its clickability), interchange
// metadata surfaces in the UI, and different vehicle types actually render at
// different sizes.
//
// Assertions go through the store, the engine's own buffers/queries, and real
// canvas clicks — same discipline as verify-mvp4.mjs, generalized from two
// named branches to the full N-line registry.
//
// Usage: npm run verify:mvp5   (dev server must be running on :5173)
import { readFileSync } from "node:fs";
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

// Warp to the network's busiest recorded minute (per the preprocessor's own
// report) so "multiple lines have trains at once" doesn't depend on what time
// of day this happens to run — the same technique verify-perf.mjs uses.
const report = JSON.parse(readFileSync("public/data/network.report.json", "utf8"));
await page.evaluate((sec) => {
  const c = window.__sim.current;
  const day = new Date();
  day.setHours(0, 0, 0, 0);
  c.setClock(day.getTime() + sec * 1000, 1);
}, report.peak_concurrent_time);
await new Promise((r) => setTimeout(r, 2_000));

// --- 1. every registry line renders, in registry order ----------------------

const routeKeys = await page.evaluate(() => window.__store.getState().routes.map((r) => r.key));
check(
  "every registry line renders, in registry order",
  routeKeys.length === LINES.length && routeKeys.every((k, i) => k === LINES[i].key),
  routeKeys.join(", "),
);

// --- 2. trains run on more than one line at once -----------------------------

const routeIdxs = await page.evaluate(() => {
  const { vehicles, count } = window.__sim.current.getInterpolated(performance.now());
  const set = new Set();
  for (let i = 0; i < count; i++) set.add(vehicles[i * 8 + 6]);
  return [...set];
});
check(
  "trains run on 3+ lines simultaneously",
  routeIdxs.length >= 3,
  `route_idx present: ${routeIdxs.sort((a, b) => a - b).join(",")} (of ${LINES.length} lines)`,
);

// --- 3/4. hiding a line stops rendering, not simulation or clickability -----

// Silom (idx 1): central, geographically compact around the default Siam
// camera, and consistently busy — a good candidate for "still on screen after
// its track/trains are hidden."
const hiddenIdx = LINES.findIndex((l) => l.key === "silom");

const before = await page.evaluate(() => window.__store.getState().vehicleCount);
await page.evaluate((idx) => window.__store.getState().toggleRoute(idx), hiddenIdx);
await new Promise((r) => setTimeout(r, 1_500));
const after = await page.evaluate(() => window.__store.getState().vehicleCount);
check(
  "hiding a line does not stop its simulation",
  before > 0 && after > 0,
  `vehicleCount ${before} -> ${after} (route ${hiddenIdx}/'${LINES[hiddenIdx].key}' hidden)`,
);

await page.evaluate(() => window.__store.getState().selectRun(null));
const hiddenHit = await page.evaluate((idx) => {
  const c = window.__sim.current;
  const { vehicles, count } = c.getInterpolated(performance.now());
  for (let i = 0; i < count; i++) {
    const o = i * 8;
    if ((vehicles[o + 6] | 0) === idx) {
      const p = window.__map.project(window.__localToLngLat(vehicles[o], vehicles[o + 1]));
      return { x: p.x, y: p.y, runIdx: vehicles[o + 5] };
    }
  }
  return null;
}, hiddenIdx);

if (hiddenHit && hiddenHit.x > 0 && hiddenHit.y > 0 && hiddenHit.x < 1400 && hiddenHit.y < 900) {
  await page.mouse.click(hiddenHit.x, hiddenHit.y);
  await new Promise((r) => setTimeout(r, 500));
  const picked = await page.evaluate(() => window.__store.getState().selectedRunIdx);
  // Resolve the picked run's OWN route_idx (not just compare run indices):
  // the real invariant is "no vehicle on the hidden route is selectable",
  // which `picked !== hiddenHit.runIdx` alone does not prove — it would
  // also pass if pickAt leaked a DIFFERENT hidden-route vehicle (a genuine
  // bug this check exists to catch). Comparing routes, not run indices,
  // closes that hole.
  const pickedRouteIdx = await page.evaluate((runIdx) => {
    if (runIdx == null) return null;
    const c = window.__sim.current;
    const { vehicles, count } = c.getInterpolated(performance.now());
    for (let i = 0; i < count; i++) {
      const o = i * 8;
      if ((vehicles[o + 5] | 0) === runIdx) return vehicles[o + 6] | 0;
    }
    return null; // run no longer active in this frame
  }, picked);
  // The invariant under test is "no train on the hidden route is
  // selectable", NOT "nothing at all is selectable at that pixel" — pickAt
  // (src/map/selection.ts) has a 22 px pick radius (VEHICLE_PICK_PX), and
  // Silom and Blue physically interchange at Bang Wa (added task 5): a
  // real, still-visible Blue train can legitimately sit within 22 px of the
  // hidden Silom train's screen position there. When that happens, clicking
  // correctly selects the visible Blue train instead of nothing — that is
  // pickAt excluding the hidden route and falling through to the next-
  // nearest visible candidate, exactly as designed, not a leak. Asserting
  // on the picked train's route (not run index) tests the real invariant
  // and tolerates this legitimate overlap without also tolerating an
  // actual leak of a different train still on the hidden route.
  check(
    "a hidden line's train cannot be clicked",
    picked === null || pickedRouteIdx !== hiddenIdx,
    `clicked (${hiddenHit.x.toFixed(0)}, ${hiddenHit.y.toFixed(0)}) on hidden route ${hiddenIdx} (its own runIdx ${hiddenHit.runIdx}) -> selectedRunIdx ${picked} (route ${pickedRouteIdx})`,
  );
} else {
  check(
    "a hidden line's train cannot be clicked",
    false,
    `no on-screen train found on hidden route ${hiddenIdx} ('${LINES[hiddenIdx].key}') to exercise the click`,
  );
}

// Restore visibility so it doesn't leak into the remaining checks.
await page.evaluate((idx) => window.__store.getState().toggleRoute(idx), hiddenIdx);
await new Promise((r) => setTimeout(r, 300));

// --- 5. an interchange station shows at least one transfer chip -------------

const interchangeStation = await page.evaluate(() => {
  const stations = window.__store.getState().stations;
  return stations.find((s) => s.interchanges && s.interchanges.length > 0) ?? null;
});

if (interchangeStation) {
  await page.evaluate(
    (s) => window.__store.getState().selectStation({ routeIdx: s.route_idx, stationIdx: s.station_idx }),
    interchangeStation,
  );
  await new Promise((r) => setTimeout(r, 800));
  const chip = await page.evaluate((s) => {
    const routes = window.__store.getState().routes;
    const names = s.interchanges.map((ix) => routes[ix.route_idx]?.name).filter(Boolean);
    // The "Interchange" label and route-name chips render inside a
    // `uppercase` heading — innerText reflects the CSS text-transform, so
    // compare case-insensitively (same gotcha verify-mvp4.mjs documents for
    // "next departures").
    const text = document.body.innerText.toLowerCase();
    return {
      names,
      hasLabel: text.includes("interchange"),
      hasName: names.some((n) => text.includes(n.toLowerCase())),
    };
  }, interchangeStation);
  check(
    "an interchange station shows a transfer chip naming the other line",
    chip.hasLabel && chip.hasName,
    `${interchangeStation.name_en}: expected one of [${chip.names.join(", ")}]`,
  );
  await page.evaluate(() => window.__store.getState().selectStation(null));
} else {
  check(
    "an interchange station shows a transfer chip naming the other line",
    false,
    "no station in the engine's data carries interchanges — link_interchanges() regression?",
  );
}

// --- 6. a monorail train is visibly shorter than a heavy-rail train ---------
// Reads the actual InstancedMesh geometry built by VehicleManager (not just
// the ConsistSpec table), so a bug in buildTrainGeometry/vehicleModels.ts
// integration would fail this too.

const lengths = await page.evaluate(() => {
  // map.getLayer() hands back MapLibre's own StyleLayer wrapper, not the
  // CustomLayerInterface passed to addLayer() — the actual NetworkLayer
  // instance (and its Three scene) lives on `.implementation`.
  const layer = window.__map.getLayer("network-3d");
  const scene = layer?.implementation?.scene;
  const routes = window.__store.getState().routes;
  const meshLength = (routeIdx) => {
    const mesh = scene?.getObjectByName(`vehicles-route-${routeIdx}`);
    if (!mesh) return null;
    mesh.geometry.computeBoundingBox();
    const box = mesh.geometry.boundingBox;
    return box.max.x - box.min.x;
  };
  const heavyIdx = routes.findIndex((r) => r.vehicleType === "heavy");
  const monoIdx = routes.findIndex((r) => r.vehicleType === "monorail");
  return {
    heavyIdx,
    monoIdx,
    heavy: heavyIdx >= 0 ? meshLength(heavyIdx) : null,
    monorail: monoIdx >= 0 ? meshLength(monoIdx) : null,
  };
});
check(
  "a monorail train's rendered geometry is visibly shorter than a heavy-rail train's",
  lengths.heavy !== null && lengths.monorail !== null && lengths.monorail < lengths.heavy,
  `monorail (route ${lengths.monoIdx}) ${lengths.monorail?.toFixed(1)} m vs heavy (route ${lengths.heavyIdx}) ${lengths.heavy?.toFixed(1)} m`,
);

await finish(false);
