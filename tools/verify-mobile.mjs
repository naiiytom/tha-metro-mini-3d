// Mobile / responsive acceptance check: the panel restructure below `md:`
// (768px) doesn't overlap MapLibre's own NavigationControl or itself, touch
// targets clear ~40px, the hide-UI toggle actually hides/restores every
// overlay, the devicePixelRatio cap took effect, and nothing mobile-specific
// leaks above the `md:` boundary.
//
// Usage: npm run verify:mobile   (dev server must be running on :5173)
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
  defaultViewport: { width: 375, height: 667, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
});
const page = await browser.newPage();
page.on("pageerror", (e) => console.log(`[pageerror] ${e.message}`));
page.on("console", (m) => {
  if (m.type() === "error") console.log(`[console.error] ${m.text().slice(0, 200)}`);
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

await page.goto(URL, { waitUntil: "networkidle2", timeout: 60_000 });
await page.waitForFunction(() => !!window.__sim?.current && !!window.__store, { timeout: 30_000 });
await page.waitForFunction(() => document.body.innerText.includes("runs"), { timeout: 30_000 });
await new Promise((r) => setTimeout(r, 2_500));

// --- 375px: LineSelector must not overlap MapLibre's NavigationControl -----

const rectsOverlap = (a, b) =>
  !!a && !!b && a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

const overlap375 = await page.evaluate(() => {
  const legend = document.querySelector(".absolute.left-4.top-4");
  const nav = document.querySelector(".maplibregl-ctrl-top-right");
  return { legend: legend?.getBoundingClientRect().toJSON(), nav: nav?.getBoundingClientRect().toJSON() };
});
check(
  "LineSelector doesn't overlap NavigationControl at 375px",
  !!overlap375.legend && !!overlap375.nav && !rectsOverlap(overlap375.legend, overlap375.nav),
  `legend right=${overlap375.legend?.right?.toFixed(0)}, nav left=${overlap375.nav?.left?.toFixed(0)}`,
);

// --- LineSelector expands and its rows clear the ~40px touch target -------

const expandBtn = await page.$('button[aria-label="Expand line list"]');
if (expandBtn) await expandBtn.click();
await new Promise((r) => setTimeout(r, 300));
const rowHeights = await page.evaluate(() => {
  const legend = document.querySelector(".absolute.left-4.top-4");
  return [...(legend?.querySelectorAll("li button") ?? [])].map(
    (el) => el.getBoundingClientRect().height,
  );
});
check(
  "expanded line rows clear the 40px touch-target guideline",
  rowHeights.length > 0 && rowHeights.every((h) => h >= 40),
  `${rowHeights.length} rows, min height ${Math.min(...rowHeights, Infinity).toFixed(1)}px`,
);

// --- selecting a train renders a full-width bottom sheet, not a corner card,
// and it doesn't overlap the time scrubber/controls below it --------------

const live = await page.evaluate(() => {
  const { vehicles, count } = window.__sim.current.getInterpolated(performance.now());
  if (!count) return null;
  return { runIdx: vehicles[5], count };
});
if (live) {
  await page.evaluate((runIdx) => window.__store.getState().selectRun(runIdx), live.runIdx);
  await new Promise((r) => setTimeout(r, 800));
  const geom = await page.evaluate(() => {
    const sheet = document.querySelector(".rounded-t-2xl");
    const scrubberInput = document.querySelector('input[type="range"]');
    return {
      sheet: sheet?.getBoundingClientRect().toJSON(),
      scrubberTop: scrubberInput?.getBoundingClientRect().top,
      viewportWidth: window.innerWidth,
    };
  });
  check(
    "selected train renders as a full-width bottom sheet",
    !!geom.sheet && geom.sheet.width >= geom.viewportWidth - 32,
    `sheet width ${geom.sheet?.width?.toFixed(0)} vs viewport ${geom.viewportWidth}`,
  );
  check(
    "the bottom sheet doesn't overlap the time scrubber",
    geom.sheet != null && geom.scrubberTop != null && geom.sheet.bottom <= geom.scrubberTop + 1,
    `sheet bottom ${geom.sheet?.bottom?.toFixed(0)} vs scrubber top ${geom.scrubberTop?.toFixed(0)}`,
  );
  await page.evaluate(() => window.__store.getState().selectRun(null));
  await new Promise((r) => setTimeout(r, 300));
} else {
  check("selected train renders as a full-width bottom sheet", false, "no live vehicles to select");
  check("the bottom sheet doesn't overlap the time scrubber", false, "no live vehicles to select");
}

// --- hide-UI toggle actually hides, and un-hides, every overlay -----------

const hideBtn = await page.$('button[aria-label="Hide map controls"]');
if (hideBtn) {
  await hideBtn.click();
  await new Promise((r) => setTimeout(r, 300));
  const hiddenState = await page.evaluate(() => {
    const legendBody = document.querySelector(".absolute.left-4.top-4 ul");
    const bottomStack = document.querySelector('input[type="range"]')?.closest(".pointer-events-none");
    return {
      legendBodyVisible: !!legendBody && legendBody.getClientRects().length > 0,
      bottomStackVisible: !!bottomStack && getComputedStyle(bottomStack).display !== "none",
    };
  });
  check(
    "hide-UI toggle hides the legend body and bottom stack",
    !hiddenState.legendBodyVisible && !hiddenState.bottomStackVisible,
    `legendBodyVisible=${hiddenState.legendBodyVisible}, bottomStackVisible=${hiddenState.bottomStackVisible}`,
  );

  const showBtn = await page.$('button[aria-label="Show map controls"]');
  if (showBtn) await showBtn.click();
  await new Promise((r) => setTimeout(r, 300));
  const restoredState = await page.evaluate(() => {
    const bottomStack = document.querySelector('input[type="range"]')?.closest(".pointer-events-none");
    return !!bottomStack && getComputedStyle(bottomStack).display !== "none";
  });
  check("hide-UI toggle restores the bottom stack", restoredState, `bottomStackVisible=${restoredState}`);
} else {
  check("hide-UI toggle hides the legend body and bottom stack", false, "hide button not found");
  check("hide-UI toggle restores the bottom stack", false, "hide button not found");
}

// --- devicePixelRatio cap ---------------------------------------------------

const dprRatio = await page.evaluate(() => {
  const canvas = window.__map.getCanvas();
  return canvas.width / canvas.clientWidth;
});
check("devicePixelRatio is capped at 2 on the shared canvas", dprRatio <= 2 + 0.01, `ratio ${dprRatio.toFixed(2)}`);

// --- 768px boundary: desktop classes must apply exactly, nothing mobile leaks

await page.setViewport({ width: 768, height: 1024, isMobile: false, hasTouch: false, deviceScaleFactor: 1 });
await new Promise((r) => setTimeout(r, 500));
const desktopWidth = await page.evaluate(() => {
  const legend = document.querySelector(".absolute.left-4.top-4");
  return legend?.getBoundingClientRect().width;
});
check(
  "LineSelector reverts to its 240px desktop width at 768px",
  !!desktopWidth && Math.abs(desktopWidth - 240) < 4,
  `width ${desktopWidth?.toFixed(1)}px`,
);

// --- 320px: smallest realistic phone — still no overlap --------------------

await page.setViewport({ width: 320, height: 568, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
await new Promise((r) => setTimeout(r, 500));
const overlap320 = await page.evaluate(() => {
  const legend = document.querySelector(".absolute.left-4.top-4");
  const nav = document.querySelector(".maplibregl-ctrl-top-right");
  return { legend: legend?.getBoundingClientRect().toJSON(), nav: nav?.getBoundingClientRect().toJSON() };
});
check(
  "LineSelector doesn't overlap NavigationControl at 320px",
  !!overlap320.legend && !!overlap320.nav && !rectsOverlap(overlap320.legend, overlap320.nav),
  `legend right=${overlap320.legend?.right?.toFixed(0)}, nav left=${overlap320.nav?.left?.toFixed(0)}`,
);

await finish(false);
