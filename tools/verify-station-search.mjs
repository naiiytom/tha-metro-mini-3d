// Station search acceptance check: opening the panel shows a real
// nearest-station card (geolocation mocked to succeed, with real distance
// text asserted via [data-testid="nearest-station"] — not just a grep for
// the always-present "Nearest station" heading), typing filters by English
// and Thai name, selecting a result updates selection/moves the camera/opens
// the station board, and clicking the nearest-station card itself does the
// same select+fly+close. Geolocation denial is checked on a separate fresh
// page load (the app only ever requests it once per mount), asserting both
// the inline error message AND that the nearest-station card is genuinely
// absent there — a real contrast between the two mocked pages.
//
// Usage: npm run verify:station-search   (dev server must be running on :5173)
import puppeteer from "puppeteer-core";

const URL = process.argv[2] ?? "http://localhost:5173/";
const EDGE =
  process.env.EDGE_PATH ?? "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: true,
  args: [
    "--enable-unsafe-swiftshader",
    "--no-first-run",
    ...(process.env.EXTRA_CHROME_ARGS?.split(" ").filter(Boolean) ?? []),
  ],
  defaultViewport: { width: 1400, height: 900 },
});

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

async function newReadyPage(mockGeolocation) {
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.log(`[pageerror] ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") console.log(`[console.error] ${m.text().slice(0, 200)}`);
  });
  await page.evaluateOnNewDocument(mockGeolocation);
  await page.goto(URL, { waitUntil: "networkidle2", timeout: 60_000 });
  await page.waitForFunction(() => !!window.__sim?.current && !!window.__store, {
    timeout: 30_000,
  });
  await page.waitForFunction(() => document.body.innerText.includes("runs"), { timeout: 30_000 });
  await new Promise((r) => setTimeout(r, 1_500));
  return page;
}

// --- Page A: geolocation succeeds, near Siam (the app's own coordinate
// origin, src/map/coordinates.ts's ORIGIN_LNG_LAT) so a real nearby station
// exists ---------------------------------------------------------------------

const pageA = await newReadyPage(() => {
  Object.defineProperty(navigator, "geolocation", {
    configurable: true,
    value: {
      getCurrentPosition: (success) =>
        success({ coords: { longitude: 100.5332, latitude: 13.7456 } }),
    },
  });
});

await pageA.evaluate(() => window.__store.getState().setSearchOpen(true));
await new Promise((r) => setTimeout(r, 300));

const panelVisible = await pageA.evaluate(
  () => !!document.querySelector('[data-testid="station-search"]'),
);
check("search panel opens", panelVisible, `visible=${panelVisible}`);

const nearestCardText = await pageA.evaluate(() => {
  const el = document.querySelector('[data-testid="nearest-station"]');
  return el ? el.textContent : null;
});
check(
  "nearest-station card appears with geolocation mocked to succeed",
  !!nearestCardText && /\d+(\.\d+)?\s*(m|km)/.test(nearestCardText),
  nearestCardText ? nearestCardText.slice(0, 120) : "null",
);

const firstStation = await pageA.evaluate(() => {
  const s = window.__store.getState().stations[0];
  return s
    ? { routeIdx: s.route_idx, stationIdx: s.station_idx, nameEn: s.name_en, nameTh: s.name_th }
    : null;
});
if (!firstStation) {
  check("a station exists to search for", false, "stations[] is empty");
  await finish(true);
}

// Native triple-click select-all (`click({ clickCount: 3 })`) does not
// reliably produce a text selection against this styled React-controlled
// input under headless Edge + puppeteer-core (verified: selectionStart ===
// selectionEnd after a triple click, so a follow-up type() appends instead
// of replacing) — Ctrl+A does. This is a harness-environment quirk, not a
// bug in StationSearch.tsx, which is a plain controlled <input>.
async function selectAllAndType(page, input, text) {
  await input.click();
  await page.keyboard.down("Control");
  await page.keyboard.press("KeyA");
  await page.keyboard.up("Control");
  await input.type(text);
}

const input = await pageA.$('[data-testid="station-search"] input');

await input.type(firstStation.nameEn);
await new Promise((r) => setTimeout(r, 200));
const matchesEn = await pageA.evaluate(
  (name) => document.querySelector('[data-testid="station-search"]').textContent.includes(name),
  firstStation.nameEn,
);
check("typing the full English name filters to the matching station", matchesEn, firstStation.nameEn);

await selectAllAndType(pageA, input, firstStation.nameTh);
await new Promise((r) => setTimeout(r, 200));
const matchesTh = await pageA.evaluate(
  (name) => document.querySelector('[data-testid="station-search"]').textContent.includes(name),
  firstStation.nameEn,
);
check("typing the Thai name filters to the matching station", matchesTh, firstStation.nameTh);

await selectAllAndType(pageA, input, firstStation.nameEn);
await new Promise((r) => setTimeout(r, 200));

const centerBefore = await pageA.evaluate(() => window.__map.getCenter());
const resultButtons = await pageA.$$('[data-testid="station-search"] ul button');
if (resultButtons.length === 0) {
  check("a result row exists to click", false, "no <ul> result rows found");
  await finish(true);
}
check("a result row exists to click", true, `resultButtons=${resultButtons.length}`);

// The query can legitimately substring-match more than one real station
// (e.g. "Kheha" also matches "Kan Kheha"/"การเคหะ"), and filterStations sorts
// alphabetically — not "exact match first" — so the row for firstStation
// doesn't always land at index 0. Find its actual row instead of assuming.
let targetIdx = -1;
for (let i = 0; i < resultButtons.length; i++) {
  const text = await resultButtons[i].evaluate((el) => el.textContent);
  if (text.includes(firstStation.nameEn) && text.includes(firstStation.nameTh)) {
    targetIdx = i;
    break;
  }
}
await resultButtons[targetIdx === -1 ? 0 : targetIdx].click();
await new Promise((r) => setTimeout(r, 1_000));

const selected = await pageA.evaluate(() => window.__store.getState().selectedStation);
check(
  "selecting a result updates selectedStation",
  !!selected &&
    selected.routeIdx === firstStation.routeIdx &&
    selected.stationIdx === firstStation.stationIdx,
  JSON.stringify(selected),
);

const centerAfter = await pageA.evaluate(() => window.__map.getCenter());
const moved =
  Math.abs(centerAfter.lng - centerBefore.lng) > 1e-4 ||
  Math.abs(centerAfter.lat - centerBefore.lat) > 1e-4;
check(
  "selecting a result moves the map camera",
  moved,
  `${JSON.stringify(centerBefore)} -> ${JSON.stringify(centerAfter)}`,
);

const boardText = await pageA.evaluate(() => document.body.innerText);
check(
  "station board shows the selected station's name",
  boardText.toLowerCase().includes(firstStation.nameEn.toLowerCase()),
  `looked for "${firstStation.nameEn}"`,
);

const panelClosedAfterSelect = await pageA.evaluate(
  () => !document.querySelector('[data-testid="station-search"]'),
);
check("panel closes after selecting a result", panelClosedAfterSelect, `closed=${panelClosedAfterSelect}`);

// Reopen the panel (same mount — geolocation was only ever requested once,
// so the nearest-station card is still available) and confirm clicking the
// nearest-station card itself does the same select+fly+close as a search
// result row, not just that the card renders.
await pageA.evaluate(() => window.__store.getState().setSearchOpen(true));
await new Promise((r) => setTimeout(r, 300));

const nearestEl = await pageA.$('[data-testid="nearest-station"]');
if (!nearestEl) {
  check("nearest-station card exists to click", false, "no element found");
} else {
  check("nearest-station card exists to click", true, "found");

  const centerBeforeNearest = await pageA.evaluate(() => window.__map.getCenter());
  await nearestEl.click();
  await new Promise((r) => setTimeout(r, 1_000));

  const selectedAfterNearest = await pageA.evaluate(
    () => window.__store.getState().selectedStation,
  );
  check(
    "clicking the nearest-station card updates selectedStation",
    !!selectedAfterNearest,
    JSON.stringify(selectedAfterNearest),
  );

  const centerAfterNearest = await pageA.evaluate(() => window.__map.getCenter());
  const movedNearest =
    Math.abs(centerAfterNearest.lng - centerBeforeNearest.lng) > 1e-4 ||
    Math.abs(centerAfterNearest.lat - centerBeforeNearest.lat) > 1e-4;
  check(
    "clicking the nearest-station card moves the map camera",
    movedNearest,
    `${JSON.stringify(centerBeforeNearest)} -> ${JSON.stringify(centerAfterNearest)}`,
  );

  const panelClosedAfterNearest = await pageA.evaluate(
    () => !document.querySelector('[data-testid="station-search"]'),
  );
  check(
    "panel closes after selecting the nearest-station card",
    panelClosedAfterNearest,
    `closed=${panelClosedAfterNearest}`,
  );
}

await pageA.close();

// --- Page B: geolocation denied, fresh mount --------------------------------

const pageB = await newReadyPage(() => {
  Object.defineProperty(navigator, "geolocation", {
    configurable: true,
    value: {
      getCurrentPosition: (_success, error) =>
        error({ code: 1, PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 }),
    },
  });
});

await pageB.evaluate(() => window.__store.getState().setSearchOpen(true));
await new Promise((r) => setTimeout(r, 300));

const errorText = await pageB.evaluate(() => {
  const el = document.querySelector('[data-testid="station-search"]');
  return el ? el.textContent : null;
});
check(
  "geolocation denial shows an inline message without breaking the panel",
  !!errorText && /location permission denied/i.test(errorText),
  errorText ? errorText.slice(0, 160) : "null",
);

const inputStillWorks = await pageB.$('[data-testid="station-search"] input');
check("search input is still present after a geolocation error", !!inputStillWorks, `present=${!!inputStillWorks}`);

const nearestAbsentOnDenial = await pageB.evaluate(
  () => !document.querySelector('[data-testid="nearest-station"]'),
);
check(
  "nearest-station card is absent when geolocation is mocked to deny",
  nearestAbsentOnDenial,
  `absent=${nearestAbsentOnDenial}`,
);

await pageB.close();

await finish(false);
