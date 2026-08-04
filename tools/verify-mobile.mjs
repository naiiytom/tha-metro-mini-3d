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

// Selectors target data-testid, not Tailwind class strings — this file (and
// trainTooltip.ts before it) churns those classes on every layout tweak, so
// a class-string selector silently stops matching (finding 9).
const LINE_SELECTOR = '[data-testid="line-selector"]';
const TRAIN_INSPECTOR = '[data-testid="train-inspector"]';
const TIME_SCRUBBER = '[data-testid="time-scrubber"]';
const BOTTOM_SHEET_STACK = '[data-testid="bottom-sheet-stack"]';

// --- 375px: LineSelector must not overlap MapLibre's NavigationControl -----

const rectsOverlap = (a, b) =>
  !!a && !!b && a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

const overlap375 = await page.evaluate((sel) => {
  const legend = document.querySelector(sel);
  const nav = document.querySelector(".maplibregl-ctrl-top-right");
  return { legend: legend?.getBoundingClientRect().toJSON(), nav: nav?.getBoundingClientRect().toJSON() };
}, LINE_SELECTOR);
check(
  "LineSelector doesn't overlap NavigationControl at 375px",
  !!overlap375.legend && !!overlap375.nav && !rectsOverlap(overlap375.legend, overlap375.nav),
  `legend right=${overlap375.legend?.right?.toFixed(0)}, nav left=${overlap375.nav?.left?.toFixed(0)}`,
);

// --- LineSelector expands and its rows clear the ~40px touch target -------

const expandBtn = await page.$('button[aria-label="Expand line list"]');
if (expandBtn) await expandBtn.click();
await new Promise((r) => setTimeout(r, 300));
const rowHeights = await page.evaluate((sel) => {
  const legend = document.querySelector(sel);
  return [...(legend?.querySelectorAll("li button") ?? [])].map(
    (el) => el.getBoundingClientRect().height,
  );
}, LINE_SELECTOR);
check(
  "expanded line rows clear the 40px touch-target guideline",
  rowHeights.length > 0 && rowHeights.every((h) => h >= 40),
  `${rowHeights.length} rows, min height ${Math.min(...rowHeights, Infinity).toFixed(1)}px`,
);

// --- the expanded LineSelector (top-left) doesn't collide with the bottom
// sheet stack, even though both are visible with no train/station selected
// (TimeScrubber + TimeControls render unconditionally once the engine is
// ready — this isn't only a "something is selected" scenario) -------------

const legendVsStack = await page.evaluate(
  (legendSel, stackSel) => {
    const legend = document.querySelector(legendSel);
    const stack = document.querySelector(stackSel);
    return { legend: legend?.getBoundingClientRect().toJSON(), stack: stack?.getBoundingClientRect().toJSON() };
  },
  LINE_SELECTOR,
  BOTTOM_SHEET_STACK,
);
check(
  "expanded LineSelector doesn't overlap the bottom sheet stack",
  !!legendVsStack.legend && !!legendVsStack.stack && !rectsOverlap(legendVsStack.legend, legendVsStack.stack),
  `legend bottom=${legendVsStack.legend?.bottom?.toFixed(0)}, stack top=${legendVsStack.stack?.top?.toFixed(0)}`,
);

// LineSelector is deliberately left expanded here — the hide-UI check below
// relies on it being expanded (so the legend's <ul> is actually in the DOM)
// to exercise uiHidden's effect on it, same as before this check was added.

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
  const geom = await page.evaluate(
    (sheetSel, scrubberSel) => {
      const sheet = document.querySelector(sheetSel);
      const scrubber = document.querySelector(scrubberSel);
      return {
        sheet: sheet?.getBoundingClientRect().toJSON(),
        scrubberTop: scrubber?.getBoundingClientRect().top,
        viewportWidth: window.innerWidth,
      };
    },
    TRAIN_INSPECTOR,
    TIME_SCRUBBER,
  );
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
  const hiddenState = await page.evaluate(
    (legendSel, stackSel) => {
      const legendBody = document.querySelector(legendSel)?.querySelector("ul");
      const stack = document.querySelector(stackSel);
      return {
        legendBodyVisible: !!legendBody && legendBody.getClientRects().length > 0,
        bottomStackVisible: !!stack && getComputedStyle(stack).display !== "none",
      };
    },
    LINE_SELECTOR,
    BOTTOM_SHEET_STACK,
  );
  check(
    "hide-UI toggle hides the legend body and bottom stack",
    !hiddenState.legendBodyVisible && !hiddenState.bottomStackVisible,
    `legendBodyVisible=${hiddenState.legendBodyVisible}, bottomStackVisible=${hiddenState.bottomStackVisible}`,
  );

  const showBtn = await page.$('button[aria-label="Show map controls"]');
  if (showBtn) await showBtn.click();
  await new Promise((r) => setTimeout(r, 300));
  const restoredState = await page.evaluate((stackSel) => {
    const stack = document.querySelector(stackSel);
    return !!stack && getComputedStyle(stack).display !== "none";
  }, BOTTOM_SHEET_STACK);
  check("hide-UI toggle restores the bottom stack", restoredState, `bottomStackVisible=${restoredState}`);
} else {
  check("hide-UI toggle hides the legend body and bottom stack", false, "hide button not found");
  check("hide-UI toggle restores the bottom stack", false, "hide button not found");
}

// --- a real single-finger touch drag pans the map ---------------------------
// The PR body's claim that camera touch gestures needed no changes was
// previously asserted, not verified — nothing here actually drove a touch
// event. cameraControls.ts's orbit controller only binds mouse-button +
// modifier-key drags (see its own module comment), so a single-finger touch
// drag should fall through untouched to MapLibre's own dragPan handler.

// x=300 sits clear of LineSelector (right edge ~256px at this viewport) and
// MapLibre's NavigationControl (left edge ~336px); y stays above the bottom
// sheet stack (top ~457px) throughout the drag — otherwise the touch lands
// on an overlay panel instead of the bare map canvas and dragPan never sees it.
const centerBefore = await page.evaluate(() => window.__map.getCenter());
await page.touchscreen.touchStart(300, 300);
await page.touchscreen.touchMove(300, 200);
await page.touchscreen.touchMove(300, 120);
await page.touchscreen.touchEnd();
await new Promise((r) => setTimeout(r, 300));
const centerAfter = await page.evaluate(() => window.__map.getCenter());
const centerMoved =
  Math.abs(centerAfter.lng - centerBefore.lng) > 1e-6 || Math.abs(centerAfter.lat - centerBefore.lat) > 1e-6;
check(
  "a real single-finger touch drag pans the map",
  centerMoved,
  `before (${centerBefore.lng.toFixed(6)}, ${centerBefore.lat.toFixed(6)}) -> after (${centerAfter.lng.toFixed(6)}, ${centerAfter.lat.toFixed(6)})`,
);

// --- devicePixelRatio cap ---------------------------------------------------
// deviceScaleFactor:3 so an uncapped build reports ~3 and fails this check —
// the earlier 375px viewport used deviceScaleFactor:2, which can't tell a
// capped-at-2 build apart from an uncapped one (Math.min(2, 2) === 2 either
// way).

await page.setViewport({ width: 375, height: 667, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
await new Promise((r) => setTimeout(r, 300));
const dprRatio = await page.evaluate(() => {
  const canvas = window.__map.getCanvas();
  return canvas.width / canvas.clientWidth;
});
check("devicePixelRatio is capped at 2 on the shared canvas", dprRatio <= 2 + 0.01, `ratio ${dprRatio.toFixed(2)}`);

// --- 768px boundary: desktop classes must apply exactly, nothing mobile leaks

await page.setViewport({ width: 768, height: 1024, isMobile: false, hasTouch: false, deviceScaleFactor: 1 });
await new Promise((r) => setTimeout(r, 500));
const desktopWidth = await page.evaluate((sel) => {
  const legend = document.querySelector(sel);
  return legend?.getBoundingClientRect().width;
}, LINE_SELECTOR);
check(
  "LineSelector reverts to its 240px desktop width at 768px",
  !!desktopWidth && Math.abs(desktopWidth - 240) < 4,
  `width ${desktopWidth?.toFixed(1)}px`,
);

// --- 320px: smallest realistic phone — still no overlap --------------------

await page.setViewport({ width: 320, height: 568, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
await new Promise((r) => setTimeout(r, 500));
const overlap320 = await page.evaluate((sel) => {
  const legend = document.querySelector(sel);
  const nav = document.querySelector(".maplibregl-ctrl-top-right");
  return { legend: legend?.getBoundingClientRect().toJSON(), nav: nav?.getBoundingClientRect().toJSON() };
}, LINE_SELECTOR);
check(
  "LineSelector doesn't overlap NavigationControl at 320px",
  !!overlap320.legend && !!overlap320.nav && !rectsOverlap(overlap320.legend, overlap320.nav),
  `legend right=${overlap320.legend?.right?.toFixed(0)}, nav left=${overlap320.nav?.left?.toFixed(0)}`,
);

await finish(false);
